import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const access = JSON.parse(await readFile('.local/aws-demo-access/compliance-demo-public.json', 'utf8'));
if (!/^https:\/\/[a-z0-9]+\.cloudfront\.net$/.test(access.url)) throw new Error('Expected the deployed CloudFront HTTPS URL');
const base = access.url;
const authorization = 'Basic ' + Buffer.from(`${access.username}:${access.password}`).toString('base64');
const results = [];
const note = 'Synthetic AWS demo setup and engineering verification. Not an official agency record or reviewer decision.';
async function response(path, body, headers = {}) {
  return fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(60000),
    method: body === undefined ? 'GET' : 'POST', headers: { authorization, ...(body === undefined ? {} : {
      'Content-Type': 'application/json', Origin: base, 'Idempotency-Key': `aws-demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function call(path, body) {
  const res = await response(path, body);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status}: ${text.slice(0,300)}`);
  return JSON.parse(text);
}
for (const path of ['/', '/api/cases', '/api/export', '/js/app.js']) {
  assert.equal((await fetch(base + path, { redirect: 'manual' })).status, 401);
}
assert.equal((await response('/api/cases', undefined, { authorization: 'Basic wrong' })).status, 401);
results.push('Pages and APIs refuse missing or incorrect passwords');
assert.equal((await response('/api/cases', undefined, { Origin: 'https://untrusted.invalid' })).status, 403);
results.push('Foreign Origin refused');
assert.equal((await call('/api/services')).status, 'ok');
assert.equal((await response('/')).status, 200);
results.push('Authenticated UI and all eight services respond');
let list = await call('/api/cases');
const auditCase = list.cases.find(item => item.contractNumber === 'SYN-VA-PORTAL-2026-001');
assert.ok(auditCase, 'VA document-review case was seeded');
const initial = await call(`/api/cases/${auditCase.id}`);
const stale = await response(`/api/cases/${auditCase.id}/context`, { expectedRevision: initial.case.revision - 1, contractNumber: 'SYN-STALE-REFUSED', note });
assert.equal(stale.status, 409);
assert.equal((await stale.json()).currentRevision, initial.case.revision);
assert.deepEqual((await call(`/api/cases/${auditCase.id}`)).case, initial.case);
results.push('Stale save returns 409 without changing the VA case');
assert.ok(initial.case.records.some(record => record.hold === 'active'));
const records = await call('/api/records?hold=active');
assert.ok(records.items.length > 0);
assert.ok(records.items.every(item => item.retention.canDestroy === false));
results.push('Active holds remain; record destruction remains unavailable');

// Add the second agency through the public API. The existing VA case keeps its own profile.
const ssaTitle = 'Synthetic SSA system delivery: release 2.1';
let ssa = list.cases.find(item => item.title === ssaTitle);
if (!ssa) {
  const preset = await call('/api/profile-presets/ssa-system-delivery');
  await call('/api/profile', { profile: preset.profile, note });
  ssa = (await call('/api/cases', { title: ssaTitle, owner: 'Demo records officer', note })).case;
}
const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0,10);
for (const paperworkId of ['PW-SAORM', 'PW-RMSA', 'PW-FEREM', 'PW-A50-CAP']) {
  const paperwork = await call(`/api/cases/${ssa.id}/paperwork`);
  if (!paperwork.items.some(item => item.paperworkId === paperworkId)) {
    const current = (await call(`/api/cases/${ssa.id}`)).case;
    await call(`/api/cases/${ssa.id}/paperwork`, { expectedRevision: current.revision, paperworkId, dueDate: future, note });
  }
}
assert.deepEqual((await call(`/api/cases/${auditCase.id}`)).case, initial.case);
results.push('SSA paperwork case created; VA case-specific profile and history unchanged');

const packet = await call(`/api/cases/${auditCase.id}/packet`);
const { digest, ...body } = packet;
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
assert.equal(createHash('sha256').update(canonical(body)).digest('hex'), digest.value);
results.push('Downloaded VA packet SHA-256 independently verified');
const report = await call(`/api/audit-report?caseId=${auditCase.id}`);
assert.ok(report.cases[0].activeHolds.length > 0);
const documents = await call(`/api/documents?caseId=${auditCase.id}&limit=100`);
const entries = documents.items;
const manifest = JSON.parse(await readFile('demo/agency-contract-review/manifest.json', 'utf8'));
const completed = initial.case.assessments?.some(item => item.outcome === 'sufficient-for-stated-check');
const expectedDocuments = manifest.documents.filter(item => item.stage === 'initial' || completed && ['remediation', 'completion'].includes(item.stage));
for (const expected of expectedDocuments) {
  assert.ok(entries.some(item => item.sha256 === expected.files.companion.sha256), `${expected.documentId} v${expected.version} must be present with its exact content hash`);
}
assert.ok(entries.every(item => item.status === 'ready'));
results.push(`All ${expectedDocuments.length} required synthetic document versions processed and matched to the manifest`);
if (completed) {
  const review = await call(`/api/cases/${auditCase.id}/evidence-review`);
  assert.equal(review.findings.length, 3);
  assert.ok(review.findings.every(item => item.currentAssessment?.outcome === 'sufficient-for-stated-check' && item.currentAssessment.freshness.state === 'current'));
  assert.equal((await call(`/api/cases/${auditCase.id}/documentation`)).gaps.length, 0);
  assert.ok(initial.case.tasks.every(task => task.status === 'done'));
  assert.ok((await call(`/api/cases/${auditCase.id}/drafts`)).drafts.some(draft => draft.reviewCurrent));
  assert.ok(initial.case.assessments.some(item => item.outcome === 'insufficient'), 'Earlier adverse review is retained');
  results.push('Three current sufficient-evidence reviews, no documentation gaps or open tasks, reviewed handoff, adverse history retained');
}
const output = { checkedAt: new Date().toISOString(), url: base, results, va: auditCase.id, ssa: ssa.id,
  limitations: ['Shared demo password; local-demo-operator is not a verified individual.', 'Prepared text companions, not PDF OCR.', 'API verification; browser walkthrough reported separately.'] };
await mkdir('.local/aws-demo-verification', { recursive: true });
await writeFile('.local/aws-demo-verification/cloud-packet.json', JSON.stringify(packet, null, 2));
await writeFile('.local/aws-demo-verification/cloud-audit-report.json', JSON.stringify(report, null, 2));
await writeFile('.local/aws-demo-verification/cloud-workspace-before-restart.json', JSON.stringify(await call('/api/workspace'), null, 2));
await writeFile('.local/aws-demo-verification/cloud-results.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
