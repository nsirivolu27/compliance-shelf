import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { auditCaseSection, auditTotals } from '../src/lib/core/audit-report.ts';

const asOf = '2026-11-15';
const note = 'Recorded for the synthetic demo.';

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cp-audit-report-'));
  const server = await createApp({ stateFile: join(directory, 'workspace.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body) => {
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${asOf}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const revisionOf = async caseId => (await call(`/api/cases/${caseId}/paperwork`)).body.caseRevision;
  return { call, revisionOf };
}

// Hand-built inputs, so each section rule can be shown on its own.
const gap = (id, status, extra = {}) => ({ id: `C-1:${id}`, ruleId: id, title: `Gap ${id}`, detail: 'Detail.', toClear: 'Clear it.', subjectType: 'check', subjectId: id, subjectTitle: `Check ${id}`, section: 'findings', state: 'x', status,
  decision: status === 'open' ? null : { id: `D-${id}`, decision: status, note: 'Reviewed against the file.', at: '2026-11-10T10:00:00.000Z', actor: 'local-demo-operator', identity: 'local-operator', current: true }, ...extra });
const finding = (id, status, category = 'contracting') => ({ id: `C-1:${id}`, caseId: 'C-1', category, status, title: `Finding ${id}`, explanation: 'Why.', nextAction: 'Do this.', sourceIds: ['far-4.805'], evidenceIds: ['E-1'] });
const paperwork = (id, extra = {}, readiness = {}) => ({ id, paperworkId: 'PW-A50-CAP', status: 'drafting', dueDate: null, reference: null, recordTitle: null, entry: { title: 'Corrective action plan entry', formNumber: null }, readiness: { state: 'incomplete', summary: '2 of 6 facts present', overdue: false, attention: null, ...readiness }, ...extra });
const baseItem = { id: 'C-1', title: 'Synthetic case', agency: 'Example agency', businessUnit: 'Example office', recordFamily: 'General records', revision: 4,
  evidence: [{ id: 'E-1', kind: 'funding', title: 'Funding memo', locator: 'Synthetic share, folder 4', verified: false, provenance: 'user-supplied' }],
  records: [{ id: 'R-1', title: 'Held record', owner: 'Demo records officer', hold: 'active', holdReview: { status: 'active', reference: 'Synthetic hold notice 7', releaseReference: null, note: 'Hold confirmed.', reviewedAt: '2026-11-02T09:00:00.000Z', actor: 'local-demo-operator' } }, { id: 'R-2', title: 'Other record', owner: null, hold: 'none' }] };
const score = { label: 'Documentation completeness', complete: 2, countable: 6, percent: 33, checks: {}, records: {}, items: [] };
const keysOf = value => (Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]) : []);

test('audit report sections: only recorded facts are listed, and unreviewed items stay out unless asked for', () => {
  const input = {
    item: baseItem, score,
    gaps: [gap('evidence-missing', 'confirmed'), gap('record-owner-missing', 'dismissed'), gap('assessment-missing', 'open')],
    findings: [finding('funding', 'needs-evidence'), finding('plan', 'needs-review'), finding('award', 'evidence-present'), finding('market', 'not-applicable'), finding('record:R-1', 'blocked', 'records')],
    paperwork: [paperwork('P-1', { dueDate: '2026-11-01' }, { overdue: true }), paperwork('P-2', { dueDate: '2026-12-31' }), paperwork('P-3', { status: 'filed-by-agency', reference: 'Synthetic receipt' }, { state: 'facts-complete' })],
  };
  const section = auditCaseSection(input, { asOf, includeCandidates: false });
  assert.deepEqual([section.caseId, section.caseRevision, section.organization, section.businessUnit], ['C-1', 4, 'Example agency', 'Example office']);
  assert.deepEqual(section.completeness, { label: 'Documentation completeness', complete: 2, countable: 6, percent: 33 });
  assert.deepEqual(section.confirmedGaps.map(entry => entry.id), ['C-1:evidence-missing'], 'a dismissed gap never appears, and an undecided one is not an exception');
  assert.deepEqual([section.confirmedGaps[0].decision.actor, section.confirmedGaps[0].decision.at, section.confirmedGaps[0].decision.note], ['local-demo-operator', '2026-11-10T10:00:00.000Z', 'Reviewed against the file.']);
  assert.deepEqual(section.unresolvedFindings.map(entry => entry.id), ['C-1:funding', 'C-1:plan'], 'a record blocked by a hold is listed once, under holds');
  assert.deepEqual(section.unresolvedFindings[0].evidenceIds, ['E-1']);
  assert.deepEqual(section.unresolvedFindings[0].evidence, [{ id: 'E-1', title: 'Funding memo', locator: 'Synthetic share, folder 4', verified: false }], 'each open result carries the evidence on file for it');
  assert.equal(section.overduePaperwork[0].attention, null);
  assert.deepEqual(section.activeHolds, [{ recordId: 'R-1', title: 'Held record', owner: 'Demo records officer', reference: 'Synthetic hold notice 7', note: 'Hold confirmed.', reviewedAt: '2026-11-02T09:00:00.000Z', actor: 'local-demo-operator' }]);
  assert.deepEqual(section.overduePaperwork.map(entry => entry.id), ['P-1']);
  assert.deepEqual(section.openPaperwork.map(entry => entry.id), ['P-2'], 'filed paperwork is not open, and overdue paperwork is listed once');
  assert.equal('candidates' in section, false);
  assert.deepEqual(section.counts, { confirmedGaps: 1, pendingReviewIssues: 0, unresolvedFindings: 2, activeHolds: 1, overduePaperwork: 1, openPaperwork: 1 });
  assert.equal(section.nothingRecorded, false);

  const withCandidates = auditCaseSection(input, { asOf, includeCandidates: true });
  assert.deepEqual(withCandidates.candidates.map(entry => entry.id), ['C-1:assessment-missing']);
  assert.equal(withCandidates.counts.candidates, 1);
  assert.deepEqual(withCandidates.confirmedGaps, section.confirmedGaps, 'asking for candidates changes nothing else');

  // A confirmation that no longer describes the gap is not current, so the gap is a candidate again.
  const stale = auditCaseSection({ ...input, gaps: [gap('evidence-missing', 'open', { decision: { decision: 'confirmed', current: false } })] }, { asOf, includeCandidates: true });
  assert.deepEqual([stale.confirmedGaps.length, stale.candidates.length], [0, 1]);

  // No rate, no verdict: the report counts lines and nothing else.
  assert.equal(keysOf(withCandidates).some(key => /rate|pass|fail|grade|verdict|compliance|score/i.test(key)), false);

  const totals = auditTotals([section, section]);
  assert.deepEqual(totals, { cases: 2, confirmedGaps: 2, pendingReviewIssues: 0, unresolvedFindings: 4, activeHolds: 2, overduePaperwork: 2, openPaperwork: 2 });
});

test('audit report sections: an assessment problem nobody has confirmed yet is listed as pending, apart from confirmed gaps', () => {
  // The auditor simulation found an insufficient assessment that the default report left out until a second confirmation.
  const item = { ...baseItem, assessments: [
    { id: 'A-1', findingId: 'C-1:notice', outcome: 'needs-clarification', rationale: 'Earlier view.', at: '2026-11-08T10:00:00.000Z', actor: 'local-demo-operator' },
    { id: 'A-2', findingId: 'C-1:notice', outcome: 'insufficient', rationale: 'The export names no notice document or dispatch.', at: '2026-11-09T10:00:00.000Z', actor: 'local-demo-operator' },
  ] };
  const pending = gap('assessment-not-sufficient', 'open', { subjectId: 'notice', subjectTitle: 'Manual notice', detail: 'The current assessment is "insufficient".' });
  const input = { item, score, gaps: [pending, gap('assessment-missing', 'open')], findings: [finding('notice', 'evidence-present')], paperwork: [] };

  const section = auditCaseSection(input, { asOf, includeCandidates: false });
  assert.deepEqual(section.pendingReviewIssues.map(entry => entry.id), ['C-1:assessment-not-sufficient'], 'listed by default, without asking for candidates');
  assert.equal(section.pendingReviewIssues[0].status, 'pending-confirmation');
  assert.deepEqual(section.pendingReviewIssues[0].assessment, { id: 'A-2', outcome: 'insufficient', rationale: 'The export names no notice document or dispatch.', at: '2026-11-09T10:00:00.000Z', actor: 'local-demo-operator' }, 'carries the latest assessment in the reviewer\'s own words');
  assert.deepEqual(section.confirmedGaps, [], 'pending is not confirmed');
  assert.equal(section.counts.pendingReviewIssues, 1);
  assert.equal(section.nothingRecorded, false, 'an unresolved sufficiency problem is never "nothing recorded"');
  assert.match(section.statement, /2 lines are recorded/, 'the pending issue and the fixture\'s active hold');

  // Once a reviewer confirms it, it moves to confirmed gaps and leaves the pending list.
  const confirmed = auditCaseSection({ ...input, gaps: [gap('assessment-not-sufficient', 'confirmed', { subjectId: 'notice' })] }, { asOf, includeCandidates: false });
  assert.deepEqual([confirmed.confirmedGaps.length, confirmed.pendingReviewIssues.length], [1, 0]);
  // A dismissed one is listed nowhere, as before.
  const dismissed = auditCaseSection({ ...input, gaps: [gap('assessment-not-sufficient', 'dismissed', { subjectId: 'notice' })] }, { asOf, includeCandidates: false });
  assert.deepEqual([dismissed.confirmedGaps.length, dismissed.pendingReviewIssues.length], [0, 0]);
  // Stale and unknown-freshness assessments are pending too; other undecided gaps stay opt-in candidates.
  const stale = auditCaseSection({ ...input, gaps: [gap('assessment-needs-review', 'open', { subjectId: 'notice' }), gap('assessment-freshness-unknown', 'open', { subjectId: 'notice' }), gap('reference-unverified', 'open')] }, { asOf, includeCandidates: false });
  assert.deepEqual(stale.pendingReviewIssues.map(entry => entry.ruleId), ['assessment-needs-review', 'assessment-freshness-unknown']);
  assert.equal(auditTotals([section, stale]).pendingReviewIssues, 3);
});

test('audit report sections: a case with nothing on file says so in words', () => {
  const quiet = auditCaseSection({ item: { ...baseItem, records: [] }, score: { ...score, complete: 0, countable: 0, percent: null }, gaps: [gap('evidence-missing', 'dismissed')], findings: [finding('award', 'evidence-present')], paperwork: [] }, { asOf, includeCandidates: false });
  assert.equal(quiet.nothingRecorded, true);
  assert.match(quiet.statement, /Nothing is recorded/);
  assert.match(quiet.statement, /not a finding that the case is in order/);
  assert.equal(quiet.completeness.percent, null, 'no percent is invented');
  assert.deepEqual(quiet.counts, { confirmedGaps: 0, pendingReviewIssues: 0, unresolvedFindings: 0, activeHolds: 0, overduePaperwork: 0, openPaperwork: 0 });
});

test('audit report API: read only, compiled from the workspace, with a digest that is not a signature', async t => {
  const { call, revisionOf } = await workspace(t);
  const before = (await call('/api/workspace')).body.revision;

  const first = await call('/api/audit-report');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.cases.map(section => section.caseId), ['DEMO-VA-001', 'DEMO-VA-002', 'DEMO-VA-003']);
  assert.equal(first.body.includeCandidates, false);
  assert.equal(first.body.digestNotice, 'A digest is not a signature or tamper-proof seal. It only shows whether two copies of this report have the same content.');
  assert.match(first.body.digest.value, /^[0-9a-f]{64}$/);
  assert.match(first.body.limitation, /not a compliance rating/);
  const held = first.body.cases[0];
  assert.deepEqual(held.activeHolds.map(entry => entry.recordId), ['REC-001']);
  assert.equal(held.unresolvedFindings.some(entry => entry.id === 'DEMO-VA-001:record:REC-001'), false);
  assert.equal(first.body.cases.every(section => typeof section.statement === 'string' && section.statement.length > 10), true);
  assert.equal(first.body.totals.confirmedGaps, 0, 'nothing is an exception until a reviewer confirms it');

  // Reading twice gives the same digest and changes nothing.
  const again = await call('/api/audit-report');
  assert.equal(again.body.digest.value, first.body.digest.value);
  assert.equal((await call('/api/workspace')).body.revision, before);

  // A reviewer confirms one gap and dismisses another on DEMO-VA-002.
  const gaps = (await call('/api/cases/DEMO-VA-002/documentation')).body.gaps;
  const [confirmedGap, dismissedGap] = gaps;
  assert.equal((await call('/api/cases/DEMO-VA-002/gap-decisions', { expectedRevision: await revisionOf('DEMO-VA-002'), gapId: confirmedGap.id, decision: 'confirmed', note })).status, 201);
  assert.equal((await call('/api/cases/DEMO-VA-002/gap-decisions', { expectedRevision: await revisionOf('DEMO-VA-002'), gapId: dismissedGap.id, decision: 'dismissed', note })).status, 201);

  // A follow-up task is opened for an unresolved finding and then completed. The finding stays.
  const target = first.body.cases[1].unresolvedFindings[0];
  const task = await call('/api/cases/DEMO-VA-002/tasks', { expectedRevision: await revisionOf('DEMO-VA-002'), findingId: target.id, title: 'Request the missing reference', owner: 'Demo analyst', note });
  assert.equal(task.status, 201);
  const taskId = task.body.case.tasks.at(-1).id;
  assert.equal((await call(`/api/cases/DEMO-VA-002/tasks/${taskId}`, { expectedRevision: await revisionOf('DEMO-VA-002'), status: 'done', note })).status, 200);

  // One paperwork item is past its stored due date, one is not.
  assert.equal((await call('/api/cases/DEMO-VA-002/paperwork', { expectedRevision: await revisionOf('DEMO-VA-002'), paperworkId: 'PW-A50-CAP', dueDate: '2026-11-01', note })).status, 201);
  assert.equal((await call('/api/cases/DEMO-VA-002/paperwork', { expectedRevision: await revisionOf('DEMO-VA-002'), paperworkId: 'PW-RMSA', dueDate: '2026-12-31', note })).status, 201);

  const one = await call('/api/audit-report?caseId=DEMO-VA-002');
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.cases.map(section => section.caseId), ['DEMO-VA-002']);
  const section = one.body.cases[0];
  assert.deepEqual(section.confirmedGaps.map(entry => entry.id), [confirmedGap.id]);
  assert.equal(section.confirmedGaps[0].decision.note, note);
  assert.equal(section.unresolvedFindings.some(entry => entry.id === target.id), true, 'completing a task does not resolve its finding');
  assert.deepEqual(section.overduePaperwork.map(entry => entry.paperworkId), ['PW-A50-CAP']);
  assert.deepEqual(section.openPaperwork.map(entry => entry.paperworkId), ['PW-RMSA']);
  assert.equal('candidates' in section, false);
  assert.notEqual(one.body.digest.value, first.body.digest.value);

  const wide = (await call('/api/audit-report?caseId=DEMO-VA-002&include=candidates')).body;
  assert.equal(wide.includeCandidates, true);
  const candidateIds = wide.cases[0].candidates.map(entry => entry.id);
  assert.equal(candidateIds.includes(confirmedGap.id) || candidateIds.includes(dismissedGap.id), false);
  assert.ok(candidateIds.length >= 1, 'gaps nobody has decided are offered as candidates');

  assert.equal((await call('/api/audit-report?caseId=NOPE')).status, 404);
  assert.equal((await call('/api/audit-report?include=everything')).status, 400);
  assert.equal((await call('/api/audit-report?verdict=pass')).status, 400);
  assert.equal((await call('/api/audit-report', {})).status, 405);
});
