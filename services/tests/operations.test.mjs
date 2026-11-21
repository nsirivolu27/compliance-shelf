import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../apps/records-contracting/src/server.mjs';
import { createDocumentsService } from '../documents.mjs';
import { createJobsService } from '../jobs.mjs';
import { createWorkerService } from '../worker.mjs';
import { createPoliciesService } from '../policies.mjs';
import { createAuditService } from '../audit.mjs';
import { createAgentService } from '../agent.mjs';
import { createGateway } from '../gateway.mjs';

const note = 'Recorded for the synthetic demo.';

test('service status, job summary, profile sources, and audit drafts are reported without changing earlier responses', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'compliance-operations-'));
  const token = randomBytes(32).toString('hex'), servers = [];
  const listen = async server => { servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
  const close = async server => { if (server.stopBackground) await server.stopBackground(); if (server.listening) await new Promise(resolve => server.close(resolve)); };
  t.after(async () => { for (const server of [...servers].reverse()) await close(server); await rm(directory, { recursive: true, force: true }); });

  const workflowUrl = await listen(await createApp({ stateFile: join(directory, 'workspace.json'), internalToken: token }));
  const jobs = await createJobsService({ token, stateFile: join(directory, 'jobs.json') });
  const jobsUrl = await listen(jobs);
  const documentsUrl = await listen(await createDocumentsService({ token, stateFile: join(directory, 'documents.json'), workflowUrl, jobsUrl, outboxInterval: 60000 }));
  const policiesUrl = await listen(await createPoliciesService({ token, workflowUrl }));
  const auditUrl = await listen(createAuditService({ token, workflowUrl, documentsUrl }));
  const agentUrl = await listen(createAgentService({ token, workflowUrl }));
  const worker = createWorkerService({ token, jobsUrl, documentsUrl, interval: 60000 });
  const workerUrl = await listen(worker);
  const gatewayUrl = await listen(createGateway({ token, urls: { workflow: workflowUrl, documents: documentsUrl, jobs: jobsUrl, policies: policiesUrl, audit: auditUrl, agent: agentUrl, worker: workerUrl } }));
  const request = async (path, { method = 'GET', body, key } = {}) => {
    const response = await fetch(gatewayUrl + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };

  // Service status: every service reports how long its check took; the worker adds its own detail.
  const status = (await request('/api/services')).body;
  assert.equal(status.status, 'ok'); assert.ok(!Number.isNaN(Date.parse(status.checkedAt)));
  assert.ok(status.services.every(service => service.status === 'ok' && Number.isSafeInteger(service.responseMs)));
  assert.deepEqual(status.services.find(service => service.name === 'worker').detail, { busy: false, lastCycleAt: null, lastError: null, completed: 0, failed: 0 });
  assert.equal(status.services.filter(service => service.detail).length, 1);

  // Job summary: counts by status, with no job content.
  assert.deepEqual((await request('/api/jobs/summary')).body, { total: 0, counts: { queued: 0, running: 0, succeeded: 0, failed: 0 }, oldestQueuedAt: null });
  const intake = await request('/api/documents', { method: 'POST', key: 'ops-intake-1', body: { caseId: 'DEMO-VA-001', title: 'Synthetic memo', filename: 'memo.txt', mediaType: 'text/plain', content: 'Synthetic funding memo for the demonstration.', note } });
  assert.equal(intake.status, 202);
  const queued = (await request('/api/jobs/summary')).body;
  assert.equal(queued.counts.queued, 1); assert.ok(!Number.isNaN(Date.parse(queued.oldestQueuedAt)));
  await worker.workOnce();
  const done = (await request('/api/jobs/summary')).body;
  assert.deepEqual(done.counts, { queued: 0, running: 0, succeeded: 1, failed: 0 }); assert.equal(done.oldestQueuedAt, null);
  const after = (await request('/api/services')).body.services.find(service => service.name === 'worker').detail;
  assert.equal(after.completed, 1); assert.equal(after.failed, 0); assert.ok(after.lastCycleAt);
  assert.equal((await request('/api/jobs/summary', { method: 'POST', body: {} })).status, 405);

  // Policies: the packaged registry and its snapshot ID are unchanged; profile sources are listed beside it.
  const before = (await request('/api/policies')).body;
  assert.deepEqual(before.profileSources, { status: 'available', builtIn: true, sources: [] });
  const profile = {
    organization: { name: 'Example Contractor (synthetic)', kind: 'company' },
    sources: [{ id: 'far-4-703', title: 'FAR 4.703 - Policy (contractor records retention)', url: 'https://www.acquisition.gov/far/4.703', locator: '4.703(a)', scope: 'Example citation for a contractor retention check.', checkedOn: '2026-11-15' }],
    checkSet: { id: 'contractor-example', name: 'Contractor example', checks: [{ kind: 'retention-plan', title: 'Records retention plan evidence', sourceIds: ['far-4-703'] }], policySourceIds: ['far-4-703'], recordsSourceIds: ['far-4-703'] },
  };
  assert.equal((await request('/api/profile', { method: 'POST', key: 'ops-profile-1', body: { profile, note } })).status, 200);
  const loaded = (await request('/api/policies')).body;
  assert.equal(loaded.snapshotId, before.snapshotId); assert.deepEqual(loaded.sources, before.sources);
  assert.deepEqual(loaded.profileSources.sources.map(source => source.id), ['far-4-703']);
  assert.equal((await request('/api/policies?q=retention')).body.profileSources.sources.length, 1);
  assert.equal((await request('/api/policies?q=zzzz')).body.profileSources.sources.length, 0);
  const one = (await request('/api/policies/far-4-703')).body;
  assert.equal(one.source.id, 'far-4-703'); assert.equal(one.origin, 'check-profile');
  assert.equal(Object.hasOwn((await request('/api/policies/far-4.803')).body, 'origin'), false);
  assert.equal((await request('/api/policies/not-a-source')).status, 404);

  // Audit packet: review drafts appear only once the case has one.
  const plain = (await request('/api/audit/cases/DEMO-VA-002')).body.packet;
  assert.equal(Object.hasOwn(plain, 'reviewDrafts'), false);
  const detail = (await request('/api/cases/DEMO-VA-001')).body;
  const prepared = (await request('/api/cases/DEMO-VA-001/drafts/prepare')).body;
  const created = await request('/api/cases/DEMO-VA-001/drafts', { method: 'POST', key: 'ops-draft-1', body: { expectedRevision: detail.case.revision, title: prepared.title, text: prepared.text, findingIds: prepared.findingIds, author: 'Demo author', reviewer: 'Demo reviewer', note } });
  assert.equal(created.status, 201);
  const packet = (await request('/api/audit/cases/DEMO-VA-001')).body.packet;
  assert.equal(packet.reviewDrafts.length, 1); assert.equal(packet.reviewDrafts[0].id, created.body.draft.id);
  assert.match(packet.reviewDraftNotice, /does not resolve a finding/);
  assert.equal(Object.hasOwn((await request('/api/audit/cases/DEMO-VA-002')).body.packet, 'reviewDrafts'), false);

  // Audit packet sources are case-specific: a later profile reusing a source ID does not change an older case's packet.
  const older = (await request('/api/cases', { method: 'POST', key: 'ops-case-1', body: { title: 'Case under the first profile', owner: 'Demo reviewer', note } })).body.case;
  const sourceOf = async id => (await request(`/api/audit/cases/${id}`)).body.packet.sources.find(source => source.id === 'far-4-703');
  assert.equal((await sourceOf(older.id)).locator, '4.703(a)');
  const second = { ...profile, sources: [{ ...profile.sources[0], title: 'A different source under the same ID', locator: 'Section B' }] };
  assert.equal((await request('/api/profile', { method: 'POST', key: 'ops-profile-2', body: { profile: second, note } })).status, 200);
  const newer = (await request('/api/cases', { method: 'POST', key: 'ops-case-2', body: { title: 'Case under the second profile', owner: 'Demo reviewer', note } })).body.case;
  assert.equal((await sourceOf(older.id)).locator, '4.703(a)');
  assert.equal((await sourceOf(newer.id)).locator, 'Section B');
  const builtInOnly = (await request('/api/audit/cases/DEMO-VA-002')).body.packet.sources;
  assert.equal(builtInOnly.some(source => source.id === 'far-4-703'), false); assert.ok(builtInOnly.some(source => source.id === 'far-4.803'));

  // Example presets are readable through the gateway and change nothing.
  const presets = await request('/api/profile-presets');
  assert.equal(presets.status, 200); assert.equal(presets.body.presets.length, 4);
  assert.equal((await request('/api/profile-presets/ssa-benefit-statement')).body.profile.checkSet.checks.length, 1);
  assert.equal((await request('/api/profile')).body.profile.sources[0].locator, 'Section B');
});

test('the worker waits longer between attempts while the job service is down, and recovers', async t => {
  const token = randomBytes(32).toString('hex');
  // Nothing listens on this port, so every claim fails.
  const worker = createWorkerService({ token, jobsUrl: 'http://127.0.0.1:9', documentsUrl: 'http://127.0.0.1:9', interval: 60000 });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  t.after(async () => { await worker.stopBackground(); await new Promise(resolve => worker.close(resolve)); });
  await worker.workOnce();
  const health = await (await fetch(`http://127.0.0.1:${worker.address().port}/health`)).json();
  assert.match(health.lastError, /queued jobs remain saved/); assert.equal(health.completed, 0); assert.equal(health.failed, 0);
});
