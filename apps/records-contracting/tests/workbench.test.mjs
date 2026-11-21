import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { reviewWorkbench, evidenceLibrary, analyzeCase } from '../src/lib/core/compliance.ts';

const fixtures = JSON.parse(await readFile(new URL('../data/demo-cases.json', import.meta.url), 'utf8'));
const asOf = '2026-11-15';

test('workbench puts holds first, explains overdue work, and preserves unresolved completed tasks', () => {
  const cases = structuredClone(fixtures);
  cases[0].tasks = [
    { id: 'overdue', findingId: 'DEMO-VA-001:funding', title: 'Collect funds reference', owner: 'Task reviewer', status: 'open', dueDate: '2026-11-01' },
    { id: 'done', findingId: 'DEMO-VA-001:market-research', title: 'Completed request', owner: 'Task reviewer', status: 'done', dueDate: '2026-01-01' },
    { id: 'ongoing', findingId: 'DEMO-VA-001:records-plan', title: 'Check obligations', owner: 'Another reviewer', status: 'in-progress', dueDate: null },
  ];
  const before = structuredClone(cases);
  const rows = reviewWorkbench(cases, asOf, []);
  assert.equal(rows[0].id, 'DEMO-VA-001:record:REC-001');
  assert.equal(rows[0].attention, 'preserve-record');
  assert.equal(rows[0].record.retention.canDestroy, false);
  assert.equal(rows[1].id, 'DEMO-VA-001:funding');
  assert.equal(rows[1].attention, 'overdue-task');
  assert.equal(rows[1].owner, 'Demo contracting officer');
  assert.deepEqual(rows[1].taskOwners, ['Task reviewer']);
  assert.equal(rows[1].earliestDueDate, '2026-11-01');
  const done = rows.find(row => row.id === 'DEMO-VA-001:market-research');
  assert.equal(done.attention, 'assign-follow-up'); assert.equal(done.status, 'needs-evidence');
  assert.equal(done.hasOpenTask, false); assert.equal(done.overdue, false); assert.equal(done.needsFollowUp, true);
  assert.equal(done.tasks.length, 1);
  assert.equal(rows.find(row => row.id === 'DEMO-VA-001:records-plan').attention, 'follow-up');
  assert.equal(rows.find(row => row.id === 'DEMO-VA-003:funding').attention, 'monitor');
  assert.equal(rows.find(row => row.id === 'DEMO-VA-002:record:REC-002').owner, null);
  for (const item of cases) {
    const report = analyzeCase(item, asOf);
    for (const finding of report.findings) assert.equal(rows.find(row => row.id === finding.id).status, finding.status);
  }
  assert.deepEqual(cases, before);
  assert.throws(() => reviewWorkbench(cases, '2026-02-30', []));
});

test('review freshness uses the committed review revision and never guesses for legacy annotations', () => {
  const cases = structuredClone(fixtures); cases[0].revision = 1;
  const reviews = [{ id: 'review-1', caseId: cases[0].id, findingId: 'DEMO-VA-001:funding', caseRevisionAtReview: 0 }];
  const events = [{ caseId: cases[0].id, action: 'finding-reviewed', caseRevision: 1, details: { id: 'review-1' } }];
  const row = () => reviewWorkbench(cases, asOf, reviews, events).find(row => row.id === reviews[0].findingId);
  assert.equal(row().lastReviewStale, false);
  cases[0].revision = 2; assert.equal(row().lastReviewStale, true);
  assert.equal(reviewWorkbench(cases, asOf, reviews).find(row => row.id === reviews[0].findingId).lastReviewStale, null);
  assert.equal(row().status, 'needs-evidence');
});

test('evidence library scopes mappings to their case and keeps verification separate from applicability', () => {
  const cases = structuredClone(fixtures);
  cases[1].evidence.push({ ...cases[0].evidence[0], title: 'Different case reference', locator: 'demo://other' });
  cases[1].applicability['signed-award'] = 'unknown';
  const before = structuredClone(cases);
  const rows = evidenceLibrary(cases, asOf);
  const original = rows.find(row => row.id === 'EV-001' && row.caseId === 'DEMO-VA-001');
  const other = rows.find(row => row.id === 'EV-001' && row.caseId === 'DEMO-VA-002');
  assert.deepEqual(original.linkedFindings.map(row => row.id), ['DEMO-VA-001:signed-award']);
  assert.deepEqual(other.linkedFindings.map(row => row.id), ['DEMO-VA-002:signed-award']);
  assert.equal(other.verificationStatus, 'verified-reference');
  assert.equal(other.linkedFindings[0].status, 'needs-review');
  assert.equal('evidenceOwner' in original, false, 'do not invent an evidence owner from case ownership');
  assert.equal(original.caseProvenance, 'synthetic');
  assert.deepEqual(cases, before);
  cases[0].evidence[0].locator = '  ';
  assert.equal(evidenceLibrary(cases, asOf)[0].verificationStatus, 'unverified-reference');
});

test('workbench and evidence APIs are paginated read-only views with strict filters and revision guards', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'compliance-workbench-'));
  const server = await createApp({ stateFile: join(directory, 'workspace.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, body, headers = {}) => {
    const response = await fetch(base + path, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const initial = (await request('/api/workspace')).body;
  const work = await request('/api/workbench?limit=1&asOf=' + asOf);
  assert.equal(work.status, 200); assert.equal(work.body.items[0].attention, 'preserve-record');
  assert.equal(work.body.pagination.nextOffset, 1); assert.equal(work.body.pagination.workspaceRevision, 0);
  assert.ok(work.body.sources.every(source => work.body.items[0].sourceIds.includes(source.id)));
  assert.equal(work.body.items[0].casePacketUrl, '/api/cases/DEMO-VA-001/packet?asOf=2026-11-15');
  assert.equal((await request(work.body.items[0].casePacketUrl)).status, 200);
  const next = await request('/api/workbench?limit=1&offset=1&workspaceRevision=0&asOf=' + asOf);
  assert.notEqual(next.body.items[0].id, work.body.items[0].id);
  assert.equal((await request('/api/workbench?caseId=DEMO-VA-001&status=needs-evidence&attention=assign-follow-up&needsFollowUp=true&hasOpenTask=false&overdue=false')).body.pagination.total, 3);
  const evidence = await request('/api/evidence?kind=funding&verificationStatus=unverified-reference');
  assert.deepEqual(evidence.body.items.map(row => row.id), ['EV-003']);
  assert.equal((await request('/api/evidence?q=demo%3A%2F%2FDEMO-VA-002%2Ffunding')).body.items[0].id, 'EV-003');
  assert.equal((await request('/api/workbench?q=Unverified%20funding%20reference')).body.items[0].id, 'DEMO-VA-002:funding');
  for (const route of ['/api/workbench', '/api/evidence']) {
    for (const query of ['limit=0', 'offset=-1', 'q=x&q=y', 'bogus=true', 'workspaceRevision=bad', 'asOf=2026-02-30', 'q=' + 'x'.repeat(201)]) assert.equal((await request(route + '?' + query)).status, 400, route + '?' + query);
    assert.equal((await request(route, {})).status, 405);
    assert.equal((await request(route, undefined, { Origin: 'https://unrelated.example' })).status, 403);
    assert.deepEqual((await request(route + '?q=no-match')).body.items, []);
  }
  for (const query of ['attention=critical', 'needsFollowUp=1', 'hasOpenTask=yes', 'status=approved']) assert.equal((await request('/api/workbench?' + query)).status, 400);
  assert.equal((await request('/api/evidence?verificationStatus=approved')).status, 400);
  assert.deepEqual((await request('/api/workspace')).body, initial, 'all reads and invalid calls leave the workspace unchanged');
  const path = '/api/cases/DEMO-VA-001';
  const review = await request(path + '/reviews', { expectedRevision: 0, findingId: 'DEMO-VA-001:funding', disposition: 'acknowledged', note: 'Reviewed the synthetic funding gap.' }, { 'Idempotency-Key': 'workbench-review' });
  assert.equal(review.status, 201);
  const reviewed = (await request('/api/workbench?q=DEMO-VA-001%3Afunding')).body.items[0];
  assert.equal(reviewed.lastReview.id, review.body.id); assert.equal(reviewed.lastReviewStale, false);
  assert.equal(reviewed.status, 'needs-evidence');
  const mutation = await request(path + '/tasks', { expectedRevision: 1, findingId: 'DEMO-VA-001:funding', title: 'Collect the demo funding reference', owner: 'Assigned reviewer', dueDate: '2026-11-01', note: 'Assigned the synthetic evidence request.' }, { 'Idempotency-Key': 'workbench-task' });
  assert.equal(mutation.status, 201);
  const assigned = (await request('/api/workbench?overdue=true&asOf=' + asOf)).body.items[0];
  assert.equal(assigned.id, 'DEMO-VA-001:funding'); assert.deepEqual(assigned.taskOwners, ['Assigned reviewer']);
  assert.equal(assigned.attention, 'overdue-task'); assert.equal(assigned.lastReviewStale, true);
  assert.equal((await request('/api/workbench?q=Assigned%20reviewer')).body.items[0].id, assigned.id);
  for (const route of ['/api/workbench', '/api/evidence']) {
    const stale = await request(route + '?workspaceRevision=0');
    assert.equal(stale.status, 409); assert.equal(stale.body.currentRevision, 2);
  }
  assert.equal((await request('/api/workspace')).body.events.length, 2);
  assert.deepEqual(Object.keys((await request('/api/cases')).body), ['cases']);
  assert.deepEqual(Object.keys((await request('/api/tasks')).body).sort(), ['asOf', 'tasks']);
});

test('workbench: a recorded sufficiency problem stays actionable even when the reference is verified', () => {
  const cases = structuredClone(fixtures);
  const issue = { gapId: 'DEMO-VA-001:assessment-not-sufficient:funding', ruleId: 'assessment-not-sufficient', title: 'Evidence assessed as not sufficient', detail: 'The current assessment is "insufficient".', toClear: 'Supply further evidence, then record a new assessment.', gapStatus: 'open' };
  const without = reviewWorkbench(cases, asOf, []);
  const withIssue = reviewWorkbench(cases, asOf, [], [], { 'DEMO-VA-001:funding': issue, 'DEMO-VA-001:record:REC-001': { ...issue, gapId: 'x' } });
  const row = withIssue.find(entry => entry.id === 'DEMO-VA-001:funding');
  assert.equal(row.status, without.find(entry => entry.id === 'DEMO-VA-001:funding').status, 'the screening status itself is unchanged');
  assert.equal(row.attention, 'resolve-assessment');
  assert.deepEqual(row.assessmentIssue, issue);
  assert.match(row.attentionReason, /assessment/i);
  assert.doesNotMatch(row.attentionReason, /No unresolved finding/);
  assert.equal(withIssue.find(entry => entry.id === 'DEMO-VA-001:record:REC-001').attention, 'preserve-record', 'an active hold still comes first');
  const order = withIssue.map(entry => entry.attention);
  assert.ok(order.indexOf('resolve-assessment') < order.indexOf('assign-follow-up'), 'listed before routine follow-up');
  assert.equal(without.find(entry => entry.id === 'DEMO-VA-001:funding').assessmentIssue, null, 'no issue, no field value');
});

test('workbench API: verified but insufficient evidence is actionable until a new assessment says otherwise', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cp-workbench-issue-'));
  const server = await createApp({ stateFile: join(directory, 'workspace.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body) => {
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${asOf}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const note = 'Synthetic workbench regression.';
  const revision = async () => (await call('/api/cases/DEMO-VA-001')).body.case.revision;
  const row = async () => (await call('/api/workbench?caseId=DEMO-VA-001&limit=100')).body.items.find(entry => entry.id === 'DEMO-VA-001:funding');

  assert.equal((await call('/api/cases/DEMO-VA-001/evidence', { kind: 'funding', title: 'Synthetic status export', locator: 'synthetic://export/1', expectedRevision: await revision() })).status, 201);
  const evidenceId = (await call('/api/cases/DEMO-VA-001')).body.case.evidence.find(entry => entry.title === 'Synthetic status export').id;
  assert.equal((await call('/api/cases/DEMO-VA-001/verify-evidence', { evidenceId, note, expectedRevision: await revision() })).status, 200);
  assert.deepEqual([(await row()).status, (await row()).attention], ['evidence-present', 'monitor']);

  // Codex's case A: the reference exists, but it is not enough for the check.
  assert.equal((await call('/api/cases/DEMO-VA-001/assessments', { expectedRevision: await revision(), findingId: 'DEMO-VA-001:funding', evidenceIds: [evidenceId], outcome: 'insufficient', rationale: 'The export exists but names no funding document.' })).status, 201);
  const flagged = await row();
  assert.equal(flagged.status, 'evidence-present', 'verification and sufficiency stay separate facts');
  assert.equal(flagged.attention, 'resolve-assessment');
  assert.deepEqual([flagged.assessmentIssue.ruleId, flagged.assessmentIssue.gapStatus], ['assessment-not-sufficient', 'open']);
  const filtered = (await call('/api/workbench?attention=resolve-assessment&limit=100')).body.items.map(entry => entry.id);
  assert.ok(filtered.includes('DEMO-VA-001:funding'));

  // Confirming the documentation gap records the reviewer's judgment; the problem stays actionable.
  assert.equal((await call('/api/cases/DEMO-VA-001/gap-decisions', { expectedRevision: await revision(), gapId: flagged.assessmentIssue.gapId, decision: 'confirmed', note: 'Confirmed: the export does not show the funding document.' })).status, 201);
  const confirmed = await row();
  assert.deepEqual([confirmed.attention, confirmed.assessmentIssue.gapStatus], ['resolve-assessment', 'confirmed']);

  // Only a new assessment changes the picture.
  assert.equal((await call('/api/cases/DEMO-VA-001/assessments', { expectedRevision: await revision(), findingId: 'DEMO-VA-001:funding', evidenceIds: [evidenceId], outcome: 'sufficient-for-stated-check', rationale: 'Synthetic: a funding document was supplied for this check only.' })).status, 201);
  const settled = await row();
  assert.deepEqual([settled.attention, settled.assessmentIssue], ['monitor', null]);
  assert.match(settled.attentionReason, /not a compliance approval/);
});
