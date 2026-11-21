import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { analyzeCase, taskQueue, workspaceScreening, applyCaseChange, createDemoCase, caseSummary, findingSearchRows, recordNeedsReview } from '../src/lib/core/compliance.ts';
import { canonicalJson } from '../src/lib/core/canonical.ts';

const fixtures = JSON.parse(await readFile(new URL('../data/demo-cases.json', import.meta.url), 'utf8'));
const asOf = '2026-11-15';
const path = '/api/cases/DEMO-VA-001';
const note = 'Reviewed this synthetic demonstration record.';
const edit = fields => ({ expectedRevision: 0, note, ...fields });
const coreContext = { id: 'test-id', targetId: 'REC-001', asOf, sourceIds: ['va-rfo'], actor: 'test-reviewer', reviewedAt: '2026-11-15T12:00:00.000Z' };

async function app(t, initial) {
  const directory = await mkdtemp(join(tmpdir(), 'compliance-additive-'));
  const stateFile = join(directory, 'workspace.json');
  if (initial) await writeFile(stateFile, JSON.stringify(initial));
  let server, base;
  const start = async () => {
    server = await createApp({ stateFile, actor: 'test-reviewer' });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  };
  await start();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const request = async (route, body, key) => {
    const response = await fetch(base + route, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { request, stateFile, restart: async () => { await new Promise(resolve => server.close(resolve)); await start(); } };
}

test('case summaries use the existing rules without changing inputs', () => {
  const item = structuredClone(fixtures[0]);
  item.tasks = [{ status: 'open' }, { status: 'in-progress' }, { status: 'done' }];
  const before = structuredClone(item);
  assert.deepEqual(caseSummary(item, asOf), { needsEvidence: 3, needsReview: 1, blocked: 1, evidencePresent: 1, openTasks: 2, activeHolds: 1 });
  assert.deepEqual(item, before);
});

test('case search is opt-in, paginated, validated, and guarded against changed workspaces', async t => {
  const { request } = await app(t);
  const legacy = { cases: fixtures.map(item => ({ ...item, revision: 0, tasks: [] })) };
  assert.deepEqual(await request('/api/cases'), { status: 200, body: legacy });
  assert.deepEqual((await request(`/api/cases?asOf=${asOf}`)).body, legacy);
  for (const q of ['DIGITIZATION', 'demo-va-001', 'contracting officer']) {
    const result = await request(`/api/cases?q=${encodeURIComponent(q)}&limit=1&asOf=${asOf}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.cases[0].id, 'DEMO-VA-001');
    assert.deepEqual(result.body.cases[0].summary, caseSummary(legacy.cases[0], asOf));
  }
  const first = (await request('/api/cases?q=contracting&limit=1')).body;
  assert.deepEqual(first.pagination, { total: 2, offset: 0, limit: 1, nextOffset: 1, workspaceRevision: 0 });
  assert.equal((await request('/api/cases?q=contracting&limit=1&offset=1&workspaceRevision=0')).body.cases[0].id, 'DEMO-VA-003');
  assert.deepEqual((await request('/api/cases?q=no-match')).body.cases, []);
  for (const query of ['limit=0', 'limit=101', 'offset=-1', 'offset=1.5', 'q=x&q=y', 'q=x&bogus=1', 'q=' + 'x'.repeat(201), 'workspaceRevision=NaN', 'limit=1&asOf=2026-02-30']) {
    assert.equal((await request('/api/cases?' + query)).status, 400, query);
  }
  await request(path + '/context', edit({ title: 'Synthetic revised title' }), 'case-edit');
  const conflict = await request('/api/cases?workspaceRevision=0');
  assert.equal(conflict.status, 409); assert.equal(conflict.body.currentRevision, 1);
  assert.equal((await request('/api/workspace')).body.events.length, 1, 'reads never add events');
});

test('hold reviews persist server attribution and complete history, with retries and conflicts', async t => {
  const { request, restart, stateFile } = await app(t);
  const route = path + '/records/REC-001/hold';
  const oldRecord = (await request(path)).body.case.records[0];
  assert.deepEqual(oldRecord, fixtures[0].records[0], 'legacy records gain no invented review');
  for (const fields of [{ status: 'none', reference: 'demo://review' }, { status: 'unknown', reference: 'demo://review' }, { status: 'bogus', reference: 'demo://review' }, { status: 'active', reference: '' }, { status: 'active', reference: 'demo://review', actor: 'spoofed' }, { status: 'active', reference: 'demo://review', reviewedAt: coreContext.reviewedAt }]) {
    assert.equal((await request(route, edit(fields), 'hold-1')).status, 400);
  }
  const body = edit({ status: 'active', reference: 'demo://hold/one' });
  const first = await request(route, body, 'hold-1');
  assert.equal(first.status, 200);
  const record = first.body.case.records[0], review = record.holdReview;
  assert.deepEqual(review, { status: 'active', reference: body.reference, releaseReference: null, note, reviewedAt: review.reviewedAt, actor: 'test-reviewer' });
  assert.equal(new Date(review.reviewedAt).toISOString(), review.reviewedAt);
  assert.deepEqual(record.holdReviews, [review]);
  assert.deepEqual(first.body.change.before, oldRecord);
  assert.deepEqual(first.body.change.after, record);
  assert.deepEqual(await request(route, body, 'hold-1'), first);
  const stale = await request(route, edit({ status: 'active', reference: 'demo://hold/two' }), 'hold-2');
  assert.equal(stale.status, 409); assert.equal(stale.body.currentRevision, 1);
  assert.equal((await request(route, edit({ status: 'active', reference: 'changed' }), 'hold-1')).status, 409);
  const release = await request(route, edit({ expectedRevision: 1, status: 'unknown', reference: 'demo://hold/two', releaseReference: 'demo://release' }), 'hold-2');
  assert.equal(release.status, 200);
  assert.deepEqual(release.body.case.records[0].holdReviews[0], review);
  assert.equal(release.body.case.records[0].holdReview.status, 'unknown');
  assert.equal(release.body.change.before.holdReviews.length, 1);
  assert.equal(release.body.change.after.holdReviews.length, 2);
  await restart();
  assert.deepEqual(await request(route, body, 'hold-1'), first);
  assert.deepEqual((await request(path)).body.case.records[0], release.body.case.records[0]);
  const report = (await request(path + '/report')).body;
  assert.equal(report.records[0].retention.status, 'unknown');
  assert.equal(report.records[0].retention.canDestroy, false);
  const saved = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(saved.events.length, 2); assert.equal(saved.cases[0].records[0].holdReviews.length, 2);
  assert.equal(saved.events[1].actor, review.actor);
});

test('task filters preserve the legacy queue and completed tasks with unresolved findings', async t => {
  const { request } = await app(t);
  assert.deepEqual((await request(`/api/tasks?asOf=${asOf}`)).body, { asOf, tasks: [] });
  assert.deepEqual(Object.keys((await request('/api/tasks')).body).sort(), ['asOf', 'tasks']);
  const created = await request(path + '/tasks', edit({ findingId: 'DEMO-VA-001:funding', title: 'Obtain certification', owner: 'Demo reviewer', dueDate: '2026-11-01' }), 'task-1');
  assert.equal(created.status, 201);
  const id = created.body.change.after.id;
  const page = (await request(`/api/tasks?q=CERTIFICATION&owner=Demo%20reviewer&status=open&overdue=true&needsFollowUp=true&limit=1&offset=0&workspaceRevision=1&asOf=${asOf}`)).body;
  assert.equal(page.tasks[0].id, id);
  assert.deepEqual(page.pagination, { total: 1, limit: 1, offset: 0, nextOffset: null, workspaceRevision: 1 });
  for (const query of ['q=no-match', 'owner=SomeoneElse', 'status=done', 'overdue=false', 'needsFollowUp=false', 'offset=1']) assert.deepEqual((await request('/api/tasks?' + query)).body.tasks, []);
  for (const query of ['status=closed', 'overdue=1', 'needsFollowUp=TRUE', 'owner=', 'limit=101', 'limit=0', 'offset=-1', 'q=x&q=y', 'q=x&other=1', 'q=' + 'x'.repeat(201), 'workspaceRevision=-1']) assert.equal((await request('/api/tasks?' + query)).status, 400, query);
  const workspace = (await request('/api/workspace')).body;
  assert.deepEqual((await request(`/api/tasks?asOf=${asOf}`)).body, { asOf, tasks: taskQueue(workspace.cases, asOf) });
  await request(path + '/tasks/' + id, edit({ expectedRevision: 1, status: 'done' }), 'task-done');
  const conflict = await request('/api/tasks?workspaceRevision=1');
  assert.equal(conflict.status, 409); assert.equal(conflict.body.currentRevision, 2);
  const done = (await request('/api/tasks?status=done&needsFollowUp=true&overdue=false')).body;
  assert.equal(done.tasks.length, 1); assert.equal(done.tasks[0].findingStatus, 'needs-evidence');
  assert.deepEqual((await request('/api/findings?hasOpenTask=true')).body.items, []);
});

test('record review filter matches the dashboard including an ownerless blocked record', async t => {
  const { request } = await app(t);
  const baseline = (await request(`/api/records?asOf=${asOf}`)).body;
  assert.deepEqual(baseline.items, workspaceScreening(fixtures, asOf).records);
  assert.deepEqual(baseline.pagination, { total: 3, offset: 0, limit: 50, nextOffset: null, workspaceRevision: 0 });
  await request(path + '/records/REC-001', edit({ owner: null }), 'owner-clear');
  const dashboard = (await request(`/api/dashboard?asOf=${asOf}`)).body;
  const filtered = (await request(`/api/records?needsReview=true&asOf=${asOf}`)).body;
  assert.equal(filtered.pagination.total, dashboard.counts.recordsNeedingReview);
  assert.equal(filtered.pagination.total, 3);
  assert.ok(filtered.items.some(record => record.id === 'REC-001' && record.status === 'blocked'));
  assert.ok(filtered.items.every(record => record.retention.canDestroy === false && !('needsReview' in record)));
  assert.deepEqual((await request('/api/records?needsReview=false')).body.items, []);
  for (const query of ['needsReview=yes', 'needsReview=', 'needsReview=true&needsReview=false']) assert.equal((await request('/api/records?' + query)).status, 400);
  const conflict = await request('/api/records?needsReview=true&workspaceRevision=0');
  assert.equal(conflict.status, 409); assert.equal(conflict.body.currentRevision, 1);
});

test('findings search only linked evidence metadata and filter open tasks without changing response fields', async t => {
  const { request } = await app(t);
  const baseline = (await request(`/api/findings?asOf=${asOf}`)).body;
  assert.deepEqual(baseline.items, workspaceScreening(fixtures, asOf).findings);
  const title = (await request('/api/findings?q=Unverified%20funding%20reference')).body;
  assert.deepEqual(title.items.map(row => row.id), ['DEMO-VA-002:funding']);
  const locator = (await request('/api/findings?q=demo%3A%2F%2FDEMO-VA-002%2Ffunding')).body;
  assert.deepEqual(locator.items, title.items);
  await request(path + '/tasks', edit({ findingId: 'DEMO-VA-001:funding', title: 'Request funds reference', owner: 'Demo reviewer' }), 'open-task');
  const open = (await request('/api/findings?hasOpenTask=true')).body;
  assert.deepEqual(open.items.map(row => row.id), ['DEMO-VA-001:funding']);
  assert.ok(open.items.every(row => !('hasOpenTask' in row) && !('evidenceSearch' in row)));
  assert.equal((await request('/api/findings?hasOpenTask=false')).body.pagination.total, baseline.pagination.total - 1);
  assert.deepEqual((await request('/api/findings?hasOpenTask=true&q=Unverified%20funding%20reference')).body.items, []);
  for (const query of ['hasOpenTask=1', 'hasOpenTask=', 'hasOpenTask=true&hasOpenTask=false']) assert.equal((await request('/api/findings?' + query)).status, 400);
  const conflict = await request('/api/findings?hasOpenTask=true&workspaceRevision=0');
  assert.equal(conflict.status, 409); assert.equal(conflict.body.currentRevision, 1);
  const input = structuredClone(fixtures);
  input[1].evidence.push({ ...input[0].evidence[0], title: 'Cross-case sentinel', locator: 'demo://other-case' });
  const rows = findingSearchRows(input, analyzeCase(input[0], asOf).findings);
  assert.ok(rows.every(row => !row.evidenceSearch.includes('Cross-case sentinel')));
});

test('packet contains the entire case trail, cited sources and a reproducible non-seal digest', async t => {
  const events = Array.from({ length: 105 }, (_, index) => ({ id: `history-${index}`, caseId: 'DEMO-VA-001', action: 'historical-fixture', details: { sourceIds: ['va-rfo'] } }));
  events.push({ id: 'other-case', caseId: 'DEMO-VA-002', action: 'historical-fixture' });
  const { request } = await app(t, { version: 1, revision: 106, cases: fixtures, events, reviews: [{ id: 'review-1', caseId: 'DEMO-VA-001' }, { id: 'review-2', caseId: 'DEMO-VA-002' }] });
  const held = await request(path + '/records/REC-001/hold', edit({ status: 'active', reference: 'demo://hold' }), 'packet-hold');
  assert.equal(held.status, 200);
  const stale = await request(path + '/context', edit({ title: 'Must not appear in packet' }), 'stale');
  assert.equal(stale.status, 409); assert.equal(stale.body.currentRevision, 1);
  const packet = await request(path + `/packet?asOf=${asOf}`);
  assert.equal(packet.status, 200);
  const { digest, ...body } = packet.body;
  assert.deepEqual(Object.keys(body).sort(), ['asOf', 'case', 'digestNotice', 'events', 'exportedAt', 'holdReviews', 'report', 'reviews', 'sources', 'tasks']);
  assert.equal(body.events.length, 106);
  assert.ok(body.events.every(event => event.caseId === 'DEMO-VA-001'));
  assert.deepEqual(body.case, held.body.case);
  assert.deepEqual(body.report, (await request(path + `/report?asOf=${asOf}`)).body);
  assert.deepEqual(body.reviews, [{ id: 'review-1', caseId: 'DEMO-VA-001' }]);
  assert.deepEqual(body.tasks, []);
  assert.deepEqual(body.holdReviews, [{ recordId: 'REC-001', ...body.case.records[0].holdReview }]);
  assert.equal(body.asOf, asOf); assert.equal(new Date(body.exportedAt).toISOString(), body.exportedAt);
  assert.match(body.digestNotice, /accidental change only/); assert.match(body.digestNotice, /not a tamper-proof seal/);
  assert.ok(body.sources.some(source => source.id === 'va-rfo'));
  const cited = new Set(body.report.findings.flatMap(finding => finding.sourceIds).concat('va-rfo'));
  assert.ok(body.sources.every(source => cited.has(source.id)));
  // Independent sorted-key reconstruction verifies the documented wire algorithm.
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  assert.equal(digest.value, createHash('sha256').update(JSON.stringify(sorted(body))).digest('hex'));
  assert.equal(digest.algorithm, 'SHA-256'); assert.equal(digest.canonicalization, 'sorted-keys-json-v1'); assert.deepEqual(digest.excludedFields, ['digest']);
  assert.notEqual(digest.value, createHash('sha256').update(canonicalJson({ ...body, asOf: '2026-11-16' })).digest('hex'));
  for (const suffix of ['?asOf=2026-02-30', '?q=x', '?asOf=2026-11-15&asOf=2026-11-15']) assert.equal((await request(path + '/packet' + suffix)).status, 400);
  assert.equal((await request('/api/cases/missing/packet')).status, 404);
  assert.equal((await request(path + '/packet', {})).status, 405);
  const exported = (await request(`/api/export?asOf=${asOf}`)).body;
  assert.deepEqual(Object.keys(exported).sort(), ['asOf', 'cases', 'events', 'exportedAt', 'limitation', 'reports', 'reviews', 'revision', 'sources', 'version']);
  assert.equal(exported.events.length, 107, 'packet export and failed mutations add no events');
  assert.equal((await request('/api/cases/DEMO-VA-003/packet')).body.holdReviews.length, 0);
});

test('canonical JSON is stable for nested arrays, numeric keys, and optional fields', () => {
  const value = { z: [3, { b: true, a: null }, undefined], a: { '2': 'two', '10': 'ten', x: undefined } };
  assert.equal(canonicalJson(value), '{"a":{"10":"ten","2":"two"},"z":[3,{"a":null,"b":true},null]}');
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('record review predicate is identical for every retention status and ownership state', () => {
  for (const status of ['blocked', 'unknown', 'retain', 'review-due']) {
    for (const owner of [null, '', '   ', 'Demo reviewer']) {
      assert.equal(recordNeedsReview({ owner, retention: { status, canDestroy: false } }), !owner?.trim() || status === 'unknown' || status === 'review-due', `${status}/${owner}`);
    }
  }
});

test('hold review history is not capped by activity pagination and never mutates its input', () => {
  let item = structuredClone(fixtures[0]);
  for (let index = 0; index < 105; index++) {
    const previous = structuredClone(item);
    const result = applyCaseChange(item, 'record-hold', edit({ status: 'active', reference: `demo://hold/${index}` }), coreContext);
    assert.deepEqual(item, previous);
    item = result.item;
  }
  assert.equal(item.records[0].holdReviews.length, 105);
  assert.equal(item.records[0].holdReviews[0].reference, 'demo://hold/0');
  assert.deepEqual(item.records[0].holdReview, item.records[0].holdReviews[104]);
  assert.equal(analyzeCase(item, asOf).records[0].retention.canDestroy, false);
  assert.equal(analyzeCase(item, asOf).records[0].retention.status, 'blocked');
});

test('optional case and schedule metadata validate without inferring compliance or changing legacy fields', () => {
  const original = structuredClone(fixtures[0]);
  for (const metadata of [{ contractNumber: '' }, { contractNumber: 12 }, { contractNumber: 'x'.repeat(101) }, { contractNumber: 'DEMO\n123' }, { periodOfPerformance: [] }, { periodOfPerformance: { start: '2026-02-30', end: '2027-01-01' } }, { periodOfPerformance: { start: '2027-01-01', end: '2026-01-01' } }, { periodOfPerformance: { start: '2026-01-01' } }, { periodOfPerformance: { start: '2026-01-01', end: '2027-01-01', guessed: true } }]) {
    assert.throws(() => applyCaseChange(original, 'context', edit(metadata), coreContext), error => error.status === 400);
    assert.throws(() => createDemoCase({ title: 'Synthetic case', owner: 'Demo owner', note, ...metadata }, 'DEMO-NEW'), error => error.status === 400);
  }
  const legacy = applyCaseChange(original, 'context', edit({ title: 'Legacy title edit' }), coreContext);
  assert.equal('contractNumber' in legacy.item, false); assert.equal('periodOfPerformance' in legacy.change.after, false);
  const created = createDemoCase({ title: 'Legacy new case', owner: 'Demo owner', note }, 'DEMO-NEW').item;
  assert.equal('contractNumber' in created, false); assert.equal('periodOfPerformance' in created, false);
  const schedule = { ...original.records[0].schedule };
  for (const itemNumber of ['', 42, 'x'.repeat(101), 'DEMO\t1']) assert.throws(() => applyCaseChange(original, 'record-update', edit({ schedule: { ...schedule, itemNumber } }), coreContext), error => error.status === 400);
  const changed = applyCaseChange(original, 'record-update', edit({ schedule: { ...schedule, itemNumber: ' DEMO-010 ' } }), coreContext);
  assert.equal(changed.change.after.schedule.itemNumber, 'DEMO-010');
  const retained = applyCaseChange(changed.item, 'record-update', edit({ schedule }), coreContext);
  assert.equal(retained.change.after.schedule.itemNumber, 'DEMO-010', 'older clients must not silently clear the new field');
  assert.equal(analyzeCase(retained.item, asOf).records[0].retention.status, 'blocked');
  assert.deepEqual(original, fixtures[0]);
});

test('case context and schedule metadata are audited, retry-safe, clearable and synthetic', async t => {
  const { request, restart } = await app(t);
  const metadata = { contractNumber: 'DEMO-VA-2026-001', periodOfPerformance: { start: '2026-01-01', end: '2027-01-01' } };
  const body = edit(metadata);
  const response = await request(path + '/context', body, 'metadata');
  assert.equal(response.status, 200);
  assert.equal(response.body.case.provenance, 'synthetic');
  assert.equal(response.body.change.before.contractNumber, undefined);
  assert.equal(response.body.change.after.contractNumber, metadata.contractNumber);
  assert.deepEqual(response.body.change.after.periodOfPerformance, metadata.periodOfPerformance);
  assert.deepEqual(response.body.case.applicability, fixtures[0].applicability);
  assert.equal(response.body.case.policyBasisConfirmed, false);
  assert.deepEqual(await request(path + '/context', body, 'metadata'), response);
  const conflict = await request(path + '/context', body, 'metadata-stale');
  assert.equal(conflict.status, 409); assert.equal(conflict.body.currentRevision, 1);
  assert.equal((await request(path + '/context', edit({ ...metadata, contractNumber: 'DEMO-other' }), 'metadata')).status, 409);
  assert.equal((await request(path + '/context', edit({ expectedRevision: 1, periodOfPerformance: { start: 'invalid', end: '2027-01-01' } }))).status, 400);
  const route = path + '/records/REC-001';
  const schedule = { ...fixtures[0].records[0].schedule, itemNumber: 'DEMO-010' };
  assert.equal((await request(route, edit({ expectedRevision: 1, schedule: { ...schedule, itemNumber: 9 } }))).status, 400);
  const scheduled = await request(route, edit({ expectedRevision: 1, schedule }), 'schedule');
  assert.equal(scheduled.status, 200);
  assert.deepEqual(scheduled.body.change.before.schedule, fixtures[0].records[0].schedule);
  assert.equal(scheduled.body.change.after.schedule.itemNumber, 'DEMO-010');
  assert.deepEqual(await request(route, edit({ expectedRevision: 1, schedule }), 'schedule'), scheduled);
  const scheduleConflict = await request(route, edit({ expectedRevision: 1, schedule }), 'schedule-stale');
  assert.equal(scheduleConflict.status, 409); assert.equal(scheduleConflict.body.currentRevision, 2);
  assert.equal((await request(route, edit({ expectedRevision: 1, schedule: { ...schedule, itemNumber: 'DEMO-020' } }), 'schedule')).status, 409);
  const cleared = await request(path + '/context', edit({ expectedRevision: 2, contractNumber: null, periodOfPerformance: null }), 'clear-metadata');
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.change.before.contractNumber, metadata.contractNumber);
  assert.equal(cleared.body.change.after.contractNumber, null); assert.equal(cleared.body.change.after.periodOfPerformance, null);
  const clearItem = await request(route, edit({ expectedRevision: 3, schedule: { ...schedule, itemNumber: null } }), 'clear-item');
  assert.equal(clearItem.body.change.before.schedule.itemNumber, 'DEMO-010');
  assert.equal(clearItem.body.change.after.schedule.itemNumber, null);
  const created = await request('/api/cases', { title: 'Synthetic metadata case', owner: 'Demo owner', note, ...metadata }, 'create-metadata');
  assert.equal(created.status, 201); assert.equal(created.body.case.revision, 1);
  assert.equal(created.body.change.before, null); assert.equal(created.body.change.after.contractNumber, metadata.contractNumber);
  assert.equal(created.body.case.provenance, 'synthetic'); assert.ok(Object.values(created.body.case.applicability).every(value => value === 'unknown'));
  assert.equal((await request('/api/cases', { title: 'Bad metadata case', owner: 'Demo owner', note, contractNumber: 42 })).status, 400);
  await restart();
  assert.deepEqual(await request('/api/cases', { title: 'Synthetic metadata case', owner: 'Demo owner', note, ...metadata }, 'create-metadata'), created);
  assert.deepEqual((await request(path)).body.case, clearItem.body.case);
  assert.equal((await request('/api/workspace')).body.events.length, 5);
});
