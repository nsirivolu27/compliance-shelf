import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { documentationScore, detectGaps, withDecisions, planningItems, gapRules } from '../src/lib/core/documentation.ts';
import { validateProfile } from '../src/lib/core/profile.ts';

const asOf = '2026-11-15';
const note = 'Recorded for the synthetic demo.';

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cp-documentation-'));
  const server = await createApp({ stateFile: join(directory, 'workspace.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, key) => {
    const headers = { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) };
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${asOf}`, body === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const at = async path => (await call(path)).body.case.revision;
  return { call, at };
}

// A hand-built case and evidence review, so each rule can be shown on its own.
const check = (kind, extra = {}) => ({ findingId: `C-1:${kind}`, title: `${kind} evidence`, evidence: [], currentAssessment: null, ...extra });
const verifiedRef = { id: 'E-1', verified: true, passage: 'none' };
const assessed = (outcome, state, causes = []) => ({ outcome, freshness: { state, causes } });
const record = (id, extra = {}) => ({ id, title: `Record ${id}`, owner: 'Demo records officer', schedule: { authority: 'Synthetic', years: 6, trigger: 'final-payment', confirmed: true }, finalPaymentDate: null, hold: 'none', ...extra });

test('documentation completeness counts only what can be counted, and never invents a percent', () => {
  const item = { id: 'C-1', applicability: { a: 'yes', b: 'yes', c: 'unknown', d: 'no', e: 'yes', f: 'yes' }, records: [record('R-1'), record('R-2', { owner: null })], policyBasisConfirmed: true };
  const review = { findings: [
    check('a', { evidence: [{ ...verifiedRef, passage: 'attached' }], currentAssessment: assessed('sufficient-for-stated-check', 'current') }),
    check('b', { evidence: [verifiedRef], currentAssessment: assessed('sufficient-for-stated-check', 'needs-review', [{ message: 'Applicability changed.' }]) }),
    check('c'), check('d'),
    check('e', { evidence: [verifiedRef], currentAssessment: assessed('sufficient-for-stated-check', 'cannot-establish', [{ message: 'The document service did not answer.' }]) }),
    check('f', { evidence: [verifiedRef], currentAssessment: assessed('insufficient', 'current') }),
  ] };
  const score = documentationScore(item, review);
  assert.equal(score.label, 'Documentation completeness');
  assert.deepEqual({ complete: score.checks.complete, countable: score.checks.countable, undecided: score.checks.undecided, notApplicable: score.checks.notApplicable, withPassage: score.checks.withPassage }, { complete: 1, countable: 4, undecided: 1, notApplicable: 1, withPassage: 1 });
  assert.deepEqual({ complete: score.records.complete, countable: score.records.countable }, { complete: 1, countable: 2 });
  assert.deepEqual([score.complete, score.countable, score.percent], [2, 6, 33], 'the percent is rounded down');
  assert.match(score.limitation, /not a compliance rating/);
  assert.equal(Object.keys(score).some(key => /compliance|risk|grade/i.test(key)), false);

  // Nothing countable: no percent at all, rather than 0 or 100.
  const undecided = documentationScore({ id: 'C-1', applicability: { a: 'unknown', b: 'no' }, records: [] }, { findings: [check('a'), check('b')] });
  assert.deepEqual([undecided.complete, undecided.countable, undecided.percent], [0, 0, null]);
  // Everything complete is the only way to reach 100.
  const full = documentationScore({ id: 'C-1', applicability: { a: 'yes' }, records: [record('R-1', { hold: 'active' })] }, { findings: [check('a', { evidence: [verifiedRef], currentAssessment: assessed('sufficient-for-stated-check', 'current') })] });
  assert.equal(full.percent, 100); assert.equal(full.records.activeHolds, 1, 'an active hold is reported and does not lower the percent');
  // One incomplete item among 200 never rounds up to 100.
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`k${index}`, 'yes']));
  const almost = documentationScore({ id: 'C-1', applicability: many, records: [] }, { findings: Object.keys(many).map((kind, index) => check(kind, index ? { evidence: [verifiedRef], currentAssessment: assessed('sufficient-for-stated-check', 'current') } : {})) });
  assert.equal(almost.percent, 99);
});

test('each gap rule detects its own condition and names what would clear it', () => {
  const item = { id: 'C-1', policyBasisConfirmed: false, applicability: { a: 'unknown', b: 'yes', c: 'yes', d: 'yes', e: 'yes', f: 'yes', g: 'yes', h: 'no' },
    records: [record('R-1', { owner: ' ', schedule: null, hold: 'unknown' }), record('R-2', { recordType: 'ledger' })],
    checkSet: { expectedRecords: [{ kind: 'ledger', title: 'Ledger' }, { kind: 'plans', title: 'System plans' }] } };
  const review = { findings: [
    check('a'), check('b'), check('c', { evidence: [{ id: 'E-2', verified: false, passage: 'none' }] }), check('d', { evidence: [verifiedRef] }),
    check('e', { evidence: [verifiedRef], currentAssessment: assessed('needs-clarification', 'current') }),
    check('f', { evidence: [verifiedRef], currentAssessment: assessed('sufficient-for-stated-check', 'needs-review', [{ message: 'Evidence was corrected.' }]) }),
    check('g', { evidence: [verifiedRef], currentAssessment: assessed('sufficient-for-stated-check', 'cannot-establish') }),
    check('h'),
  ] };
  const tasks = [{ id: 'T-1', title: 'Request the plan', owner: 'Demo analyst', dueDate: '2026-11-01', overdue: true }, { id: 'T-2', title: 'Later', owner: 'Demo analyst', dueDate: '2027-01-01', overdue: false }];
  const gaps = detectGaps(item, review, tasks);
  const found = Object.fromEntries(gaps.map(gap => [`${gap.ruleId}:${gap.subjectId}`, gap]));
  assert.deepEqual(Object.keys(found).sort(), [
    'applicability-undecided:a', 'assessment-freshness-unknown:g', 'assessment-missing:d', 'assessment-needs-review:f', 'assessment-not-sufficient:e',
    'evidence-missing:b', 'policy-basis-unconfirmed:policy-basis', 'record-hold-undecided:R-1', 'record-owner-missing:R-1', 'record-schedule-unconfirmed:R-1',
    'record-type-missing:plans', 'reference-unverified:c', 'task-overdue:T-1',
  ]);
  assert.equal(Object.keys(found).some(key => key.endsWith(':h')), false, 'a check that does not apply raises nothing');
  assert.match(found['assessment-needs-review:f'].detail, /Evidence was corrected/);
  assert.match(found['record-type-missing:plans'].detail, /records officer/);
  for (const gap of gaps) { assert.equal(gap.toClear, gapRules[gap.ruleId].toClear); assert.equal(gap.id, `C-1:${gap.ruleId}:${gap.subjectId}`); }
  assert.equal(detectGaps({ id: 'C-1', policyBasisConfirmed: true, applicability: {}, records: [] }, { findings: [] }, []).map(gap => gap.ruleId).join(), 'inventory-empty');
  assert.equal(JSON.stringify(gaps).match(/noncompliant|violation|fraud/i), null);

  // A decision describes the gap as it was. Once the gap changes, the decision is out of date and the gap is open again.
  const decided = { ...item, gapDecisions: [{ id: 'D-1', gapId: 'C-1:reference-unverified:c', decision: 'dismissed', note, state: found['reference-unverified:c'].state, at: '2026-11-15T10:00:00.000Z', actor: 'local-demo-operator', identity: 'local-operator' }] };
  assert.equal(withDecisions(gaps, decided).find(gap => gap.subjectId === 'c').status, 'dismissed');
  const changedReview = { findings: review.findings.map(entry => entry.findingId === 'C-1:c' ? check('c', { evidence: [{ id: 'E-2', verified: false }, { id: 'E-3', verified: false }] }) : entry) };
  const reopened = withDecisions(detectGaps(item, changedReview, tasks), decided).find(gap => gap.subjectId === 'c');
  assert.equal(reopened.status, 'open'); assert.equal(reopened.decision.current, false);
});

test('planning items come only from stored dates', () => {
  const item = { id: 'C-1', title: 'Synthetic case', agency: 'Example office', owner: 'Demo owner', periodOfPerformance: { start: '2026-01-01', end: '2026-12-31' } };
  const report = { records: [
    { id: 'R-1', title: 'With a date', owner: 'Demo officer', retention: { status: 'retain', reviewDate: '2031-03-15' } },
    { id: 'R-2', title: 'Held', owner: null, retention: { status: 'blocked', reviewDate: null } },
    { id: 'R-3', title: 'Unknown', owner: null, retention: { status: 'unknown', reviewDate: null } },
  ] };
  const tasks = [{ id: 'T-1', title: 'Dated', owner: 'A', dueDate: '2026-11-20', status: 'open', overdue: false }, { id: 'T-2', title: 'Undated', owner: 'A', dueDate: null, status: 'open' }, { id: 'T-3', title: 'Done', owner: 'A', dueDate: '2026-11-01', status: 'done' }];
  const { dated, undated } = planningItems(item, report, tasks);
  assert.deepEqual(dated.map(entry => [entry.type, entry.date]), [['task', '2026-11-20'], ['record-review', '2031-03-15'], ['period-end', '2026-12-31']]);
  assert.deepEqual(undated.map(entry => entry.id), ['C-1:task:T-2', 'C-1:record:R-2', 'C-1:record:R-3']);
  assert.match(dated[1].note, /not a disposal date/); assert.match(undated[1].note, /Active hold/);
  assert.equal(JSON.stringify({ dated, undated }).match(/\$|amount|budget/i), null);
});

test('documentation routes: score, gap register, decisions, expected record types, and planning', async t => {
  const { call, at } = await workspace(t);
  const before = (await call('/api/workspace')).body;

  // Reads change nothing.
  const overview = await call('/api/documentation');
  assert.equal(overview.status, 200); assert.equal(overview.body.cases.length, before.cases.length);
  assert.equal(overview.body.workspace.label, 'Documentation completeness');
  assert.ok(overview.body.cases.every(entry => entry.score.percent === null || (entry.score.percent >= 0 && entry.score.percent <= 100)));
  assert.equal(Object.hasOwn(overview.body.cases[0].score, 'items'), false);
  const one = await call('/api/cases/DEMO-VA-001/documentation');
  assert.equal(one.status, 200); assert.equal(one.body.score.records.activeHolds, 1); assert.match(one.body.limitation, /not a finding of noncompliance/);
  assert.equal((await call('/api/cases/NOPE/documentation')).status, 404);
  assert.equal((await call('/api/documentation', {})).status, 405); assert.equal((await call('/api/gaps', {})).status, 405); assert.equal((await call('/api/planning', {})).status, 405);
  assert.equal((await call('/api/planning?days=30')).status, 400);
  const register = await call('/api/gaps?limit=100');
  assert.equal(register.status, 200); assert.equal(register.body.pagination.total, overview.body.cases.reduce((sum, entry) => sum + entry.openGaps, 0));
  assert.ok(register.body.items.every(gap => gap.status === 'open' && gap.caseTitle && gap.toClear && !Object.hasOwn(gap, 'state')));
  assert.equal(register.body.rules.length, Object.keys(gapRules).length);
  assert.equal((await call('/api/gaps?ruleId=not-a-rule')).status, 400);
  const filtered = (await call('/api/gaps?ruleId=evidence-missing&caseId=DEMO-VA-001')).body;
  assert.ok(filtered.items.length > 0 && filtered.items.every(gap => gap.ruleId === 'evidence-missing' && gap.caseId === 'DEMO-VA-001'));
  const after = (await call('/api/workspace')).body;
  assert.equal(after.revision, before.revision); assert.equal(after.events.length, before.events.length);

  // A decision needs a note, a detected gap, and the current revision. Replay is idempotent. Nothing else changes.
  const path = '/api/cases/DEMO-VA-001';
  const gapId = filtered.items[0].id;
  const detailBefore = (await call(path)).body;
  for (const body of [{ gapId, decision: 'confirmed' }, { gapId, decision: 'resolved', note }, { gapId: 'DEMO-VA-001:evidence-missing:nothing', decision: 'confirmed', note }, { gapId, decision: 'confirmed', note, extra: true }])
    assert.ok([400, 404].includes((await call(`${path}/gap-decisions`, { expectedRevision: await at(path), ...body })).status));
  assert.equal((await call(`${path}/gap-decisions`, { expectedRevision: 99, gapId, decision: 'confirmed', note })).status, 409);
  const body = { expectedRevision: await at(path), gapId, decision: 'dismissed', note: 'Synthetic: the reviewer judged this gap not relevant to the demo.' };
  const saved = await call(`${path}/gap-decisions`, body, 'gap-1');
  assert.equal(saved.status, 201); assert.equal(saved.body.decision.identity, 'local-operator'); assert.equal(saved.body.change.before, null);
  assert.equal((await call(`${path}/gap-decisions`, body, 'gap-1')).body.decision.id, saved.body.decision.id);
  const detailAfter = (await call(path)).body;
  assert.deepEqual(detailAfter.report, { ...detailBefore.report, revision: detailAfter.report.revision });
  assert.equal(detailAfter.case.gapDecisions.length, 1);
  const scored = (await call(`${path}/documentation`)).body;
  assert.deepEqual({ ...scored.score }, { ...one.body.score }, 'dismissing a gap does not change the percent');
  assert.equal(scored.gaps.find(gap => gap.id === gapId).status, 'dismissed');
  assert.equal((await call('/api/gaps?status=dismissed')).body.pagination.total, 1);
  assert.equal((await call('/api/activity?caseId=DEMO-VA-001')).body.items[0].action, 'gap-decision-recorded');
  // Supplying the evidence changes the gap, so the earlier decision no longer describes it.
  const kind = gapId.split(':')[2];
  assert.equal((await call(`${path}/evidence`, { kind, title: 'Synthetic reference', locator: 'synthetic://ref/1', expectedRevision: await at(path) })).status, 201);
  const moved = (await call(`${path}/documentation`)).body.gaps.filter(gap => gap.subjectId === kind);
  assert.deepEqual(moved.map(gap => [gap.ruleId, gap.status]), [['reference-unverified', 'open']]);

  // Expected record types: validated on the profile, copied to new cases, named on records, and reported when missing.
  const profile = (await call('/api/profile-presets/public-sector-records')).body.profile;
  assert.deepEqual(validateProfile(profile, before.builtInSourceIds), profile);
  assert.throws(() => validateProfile({ ...profile, checkSet: { ...profile.checkSet, expectedRecords: [profile.checkSet.expectedRecords[0], profile.checkSet.expectedRecords[0]] } }, before.builtInSourceIds), /repeated/);
  assert.throws(() => validateProfile({ ...profile, checkSet: { ...profile.checkSet, expectedRecords: [{ kind: 'x-records', title: 'X', sourceIds: ['missing'] }] } }, before.builtInSourceIds), /not defined/);
  assert.equal((await call('/api/profile', { profile, note })).status, 200);
  const created = (await call('/api/cases', { title: 'General records review (synthetic)', owner: 'Demo records officer', note })).body.case;
  assert.equal(created.recordFamily, 'General records'); assert.equal(created.checkSet.expectedRecords.length, 3);
  const made = `/api/cases/${created.id}`;
  let picture = (await call(`${made}/documentation`)).body;
  assert.deepEqual([picture.score.complete, picture.score.countable, picture.score.percent], [0, 3, 0], 'three expected record types, none inventoried, and no check decided yet');
  assert.equal(picture.score.checks.undecided, 4);
  assert.deepEqual(picture.gaps.filter(gap => gap.ruleId === 'record-type-missing').map(gap => gap.subjectId), ['financial-transaction-records', 'system-development-records', 'change-management-records']);
  assert.equal((await call(`${made}/records`, { expectedRevision: await at(made), note, title: 'Synthetic ledger', recordType: 'not-listed' })).status, 400);
  const added = await call(`${made}/records`, { expectedRevision: await at(made), note, title: 'Synthetic payment ledger', owner: 'Demo records officer', recordType: 'financial-transaction-records' });
  assert.equal(added.status, 201);
  const recordId = added.body.case.records[0].id;
  assert.equal((await call(`${made}/records/${recordId}`, { expectedRevision: await at(made), note, recordType: null })).status, 200);
  assert.equal((await call(`${made}/records/${recordId}`, { expectedRevision: await at(made), note, recordType: 'financial-transaction-records', schedule: { authority: 'GRS 1.1 item 010 (synthetic confirmation)', years: 6, trigger: 'final-payment', confirmed: true, itemNumber: '010' }, finalPaymentDate: '2025-06-30' })).status, 200);
  assert.equal((await call(`${made}/records/${recordId}/hold`, { expectedRevision: await at(made), note, status: 'none', reference: 'SYN-HOLD-REVIEW-1' })).status, 200);
  picture = (await call(`${made}/documentation`)).body;
  assert.deepEqual([picture.score.records.complete, picture.score.records.countable], [1, 3]);
  assert.equal(picture.gaps.filter(gap => gap.ruleId === 'record-type-missing').length, 2);
  assert.equal((await call('/api/cases/DEMO-VA-001/records', { expectedRevision: await at(path), note, title: 'No types here', recordType: 'financial-transaction-records' })).status, 400, 'a case without expected record types cannot name one');
  // The record's review date appears in the planning view; nothing permits destruction.
  const planning = (await call(`/api/planning?caseId=${created.id}`)).body;
  assert.deepEqual(planning.dated.map(entry => [entry.type, entry.date, entry.past]), [['record-review', '2031-06-30', false]]);
  assert.match(planning.limitation, /no financial, tax, or legal advice/);
  assert.equal((await call(`${made}/report`)).body.records[0].retention.canDestroy, false);
  const all = (await call('/api/planning')).body;
  assert.ok(all.dated.length >= 2 && all.dated.every((entry, index) => index === 0 || all.dated[index - 1].date <= entry.date));
});
