import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { canonicalJson } from '../src/lib/core/canonical.ts';
import {
  formatUsd, centsOf, newBudget, amendBudget, newAllocation, changeAllocation, decideAllocation,
  budgetTotals, budgetView, agencyOfCase, fiscalYearWindow, allocationStates,
} from '../src/lib/core/funding.ts';
import { parseUsd, formatUsd as formatUsdInBrowser } from '../public/js/money.js';

const asOf = '2026-11-20';
const context = (id = 'X') => ({ id, now: '2026-11-20T12:00:00.000Z', actor: 'local-demo-operator' });
const budgetInput = (extra = {}) => ({ name: 'Synthetic portal remediation', agency: 'va', program: 'VA regional services portal', fundingSource: 'SYN-VA-FY27-0001', fiscalYear: 2027, availableCents: 100_000_000, owner: 'Demo budget officer', note: 'Synthetic budget for the funding demonstration.', ...extra });
const vaCase = { id: 'DEMO-VA-001', title: 'Synthetic VA case', agency: 'Department of Veterans Affairs', provenance: 'synthetic', evidence: [{ id: 'EV-1', kind: 'funding', title: 'Funds memo', locator: 'document://DOC-1#p1', verified: true }, { id: 'EV-2', kind: 'records-plan', title: 'Records plan', locator: 'demo://plan', verified: false }], assessments: [{ id: 'AS-1', findingId: 'DEMO-VA-001:funding', outcome: 'sufficient-for-stated-check', at: '2026-11-19T10:00:00.000Z' }], records: [] };
const ssaCase = { id: 'SSA-1', title: 'Synthetic SSA case', agency: 'Social Security Administration (synthetic example)', provenance: 'synthetic', evidence: [], assessments: [], records: [] };
const allocationInput = (extra = {}) => ({ destination: 'Accessibility retest', purpose: 'Retest the corrected portal build against the six named flows.', requestedCents: 25_000_000, owner: 'Demo program lead', caseId: 'DEMO-VA-001', evidenceIds: ['EV-1'], assessmentIds: ['AS-1'], rationale: 'The retest is needed before the delivery can be accepted.', ...extra });
const decision = (action, extra = {}) => ({ expectedRevision: 1, action, rationale: `Synthetic ${action} decision for the demonstration.`, ...extra });

function status(fn) {
  try { fn(); } catch (error) { return error.status; }
  return 'no error';
}

// ---------- Pure core ----------

test('money: whole cents only, formatted and parsed without floating-point arithmetic', () => {
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(5), '$0.05');
  assert.equal(formatUsd(123_456_789), '$1,234,567.89');
  assert.equal(formatUsd(-250), '-$2.50');
  for (const value of [0, 7, 100, 99_999, 123_456_789, 900_719_925_474_099, -250]) assert.equal(formatUsdInBrowser(value), formatUsd(value), `browser and server agree on ${value}`);
  assert.equal(parseUsd('1,234.5'), 123_450);
  assert.equal(parseUsd('$0.10'), 10);
  assert.equal(parseUsd(' 250000 '), 25_000_000);
  assert.equal(parseUsd('0.07'), 7);
  for (const bad of ['', 'abc', '-5', '1.234', '1,23', '12,34.00', '1e3', '0.1.2', '$', '90071992547409.92', 1000]) assert.equal(parseUsd(bad), null, `${bad} is refused`);
  for (const bad of [100.5, '100', -1, 0, Number.NaN, Infinity, 2 ** 53, 1_000_000_000_001]) assert.equal(status(() => centsOf(bad, 'Amount')), 400, `${bad} is refused`);
  assert.equal(centsOf(1, 'Amount'), 1);
});

test('budget: identifiers, fiscal year and agency relationships are validated', () => {
  const { budget, change } = newBudget(budgetInput(), [], context('FB-1'));
  assert.equal(budget.revision, 1);
  assert.equal(budget.availableCents, 100_000_000);
  assert.equal(budget.synthetic, true);
  assert.deepEqual([change.before, change.after.availableCents, budget.history[0].rationale], [null, 100_000_000, 'Synthetic budget for the funding demonstration.']);
  assert.deepEqual(fiscalYearWindow(2027), { start: '2026-10-01', end: '2027-09-30' });
  assert.equal(status(() => newBudget(budgetInput({ fundingSource: 'SYN-SSA-FY27-0001' }), [], context())), 400, 'an SSA reference cannot fund a VA budget');
  assert.equal(status(() => newBudget(budgetInput({ fundingSource: 'TREAS-0001' }), [], context())), 400, 'only synthetic references are accepted');
  assert.equal(status(() => newBudget(budgetInput({ agency: 'treasury' }), [], context())), 400);
  assert.equal(status(() => newBudget(budgetInput({ fiscalYear: 2027.5 }), [], context())), 400);
  assert.equal(status(() => newBudget(budgetInput({ fiscalYear: 1999 }), [], context())), 400);
  assert.equal(status(() => newBudget(budgetInput({ availableCents: 1000.25 }), [], context())), 400);
  assert.equal(status(() => newBudget(budgetInput({ note: 'short' }), [], context())), 400);
  assert.equal(status(() => newBudget(budgetInput({ payee: 'someone' }), [], context())), 400, 'unknown fields are refused');
  assert.equal(status(() => newBudget(budgetInput(), [budget], context())), 409, 'the same reference cannot open a second budget in the same year');
  assert.equal(agencyOfCase(vaCase), 'va');
  assert.equal(agencyOfCase(ssaCase), 'ssa');
  assert.equal(agencyOfCase({ agency: 'Example agency' }), null);
});

test('allocation: proposals do not consume funds, approval does, and balances stay exact to the cent', () => {
  let { budget } = newBudget(budgetInput({ availableCents: 100_000_000 }), [], context('FB-1'));
  let allocations = [];
  const add = (cents, id) => {
    const { allocation } = newAllocation(allocationInput({ requestedCents: cents }), budget, allocations, [vaCase], context(id));
    allocations = [...allocations, allocation];
    return allocation;
  };
  const decide = (id, action) => {
    const current = allocations.find(item => item.id === id);
    const { allocation } = decideAllocation(decision(action), current, budget, allocations, context());
    allocations = allocations.map(item => (item.id === id ? allocation : item));
    return allocation;
  };
  for (const [id, cents] of [['A', 33_333_333], ['B', 33_333_333], ['C', 33_333_334]]) { add(cents, id); decide(id, 'propose'); }
  assert.deepEqual(budgetTotals(budget, allocations), { availableCents: 100_000_000, draftCents: 0, proposedCents: 100_000_000, approvedCents: 0, remainingCents: 100_000_000, reversedCents: 0, rejectedCents: 0, proposedBeyondRemainingCents: 0, counts: { draft: 0, proposed: 3, approved: 0, rejected: 0, reversed: 0 } });
  for (const id of ['A', 'B', 'C']) decide(id, 'approve');
  const totals = budgetTotals(budget, allocations);
  assert.equal(totals.approvedCents, 100_000_000);
  assert.equal(totals.remainingCents, 0, 'one third, one third and the rest add up to the budget exactly');
  // Ten cents and twenty cents are thirty cents, not 0.30000000000000004 dollars.
  ({ budget } = newBudget(budgetInput({ availableCents: 30, fundingSource: 'SYN-VA-FY27-0002' }), [], context('FB-2')));
  allocations = [];
  add(10, 'D'); decide('D', 'propose'); decide('D', 'approve');
  add(20, 'E'); decide('E', 'propose'); decide('E', 'approve');
  assert.equal(budgetTotals(budget, allocations).remainingCents, 0);
});

test('allocation: overspending, invalid transitions and silent edits of approved amounts are refused', () => {
  const { budget } = newBudget(budgetInput({ availableCents: 1_000_00 }), [], context('FB-1'));
  const draft = newAllocation(allocationInput({ requestedCents: 600_00 }), budget, [], [vaCase], context('A')).allocation;
  assert.equal(draft.state, 'draft');
  assert.equal(status(() => newAllocation(allocationInput({ requestedCents: 1_000_01 }), budget, [], [vaCase], context())), 400, 'a request larger than the whole budget is refused at once');
  assert.equal(status(() => decideAllocation(decision('approve'), draft, budget, [draft], context())), 409, 'a draft must be proposed before approval');
  assert.equal(status(() => decideAllocation(decision('reverse'), draft, budget, [draft], context())), 409);
  assert.equal(status(() => decideAllocation(decision('approve', { rationale: 'ok' }), draft, budget, [draft], context())), 400, 'a decision needs a rationale');
  assert.equal(status(() => decideAllocation(decision('pay'), draft, budget, [draft], context())), 400);
  const proposed = decideAllocation(decision('propose'), draft, budget, [draft], context()).allocation;
  const approved = decideAllocation(decision('approve'), proposed, budget, [proposed], context()).allocation;
  assert.equal(approved.approvedCents, 600_00);
  const second = decideAllocation(decision('propose'), newAllocation(allocationInput({ requestedCents: 400_01 }), budget, [approved], [vaCase], context('B')).allocation, budget, [approved], context()).allocation;
  const refused = (() => { try { decideAllocation(decision('approve'), second, budget, [approved, second], context()); } catch (error) { return error; } return null; })();
  assert.equal(refused.status, 409);
  assert.match(refused.message, /exceed the remaining budget by \$0\.01/);
  assert.equal(refused.currentRevision, undefined, 'a rule refusal is not a revision conflict');
  assert.equal(status(() => changeAllocation({ expectedRevision: 1, requestedCents: 500_00, reason: 'Lower the approved amount quietly.' }, approved, budget, [approved], [vaCase], context())), 409, 'an approved amount cannot be edited');
  const edited = changeAllocation({ expectedRevision: 1, requestedCents: 400_00, reason: 'Reduced to fit the remaining budget.' }, second, budget, [approved, second], [vaCase], context());
  assert.deepEqual([edited.change.before.requestedCents, edited.change.after.requestedCents], [400_01, 400_00]);
  assert.equal(decideAllocation(decision('approve'), edited.allocation, budget, [approved, edited.allocation], context()).allocation.state, 'approved');
  assert.equal(status(() => amendBudget({ expectedRevision: 1, availableCents: 500_00, reason: 'Cut the budget below what is approved.' }, budget, [approved], context())), 409);
});

test('allocation: a reversal restores the balance, keeps the original decision, and allows a replacement', () => {
  const { budget } = newBudget(budgetInput({ availableCents: 1_000_00 }), [], context('FB-1'));
  const created = newAllocation(allocationInput({ requestedCents: 700_00 }), budget, [], [vaCase], context('A')).allocation;
  const proposed = decideAllocation(decision('propose'), created, budget, [created], context()).allocation;
  const approved = decideAllocation(decision('approve'), proposed, budget, [proposed], context()).allocation;
  assert.equal(budgetTotals(budget, [approved]).remainingCents, 300_00);
  const { allocation: reversed, change } = decideAllocation(decision('reverse'), approved, budget, [approved], context());
  assert.equal(reversed.state, 'reversed');
  assert.equal(reversed.approvedCents, 700_00, 'the original approved amount is kept');
  assert.equal(budgetTotals(budget, [reversed]).remainingCents, 1_000_00);
  assert.deepEqual(reversed.history.map(entry => entry.action), ['allocation-created', 'propose', 'approve', 'reverse']);
  const approval = reversed.history[2];
  assert.deepEqual([approval.fromState, approval.toState, approval.simulated, approval.remainingBeforeCents, approval.remainingAfterCents], ['proposed', 'approved', true, 1_000_00, 300_00]);
  assert.match(approval.label, /Simulated demo decision/);
  assert.deepEqual([change.before.state, change.after.state, change.remainingBeforeCents, change.remainingAfterCents], ['approved', 'reversed', 300_00, 1_000_00]);
  assert.equal(status(() => decideAllocation(decision('approve'), reversed, budget, [reversed], context())), 409, 'a reversed allocation is closed');
  const replacement = newAllocation(allocationInput({ requestedCents: 650_00, replacesAllocationId: 'A' }), budget, [reversed], [vaCase], context('B')).allocation;
  assert.equal(replacement.replacesAllocationId, 'A');
  // A status filter shows only some requests; the reversed one still knows its replacement is open.
  assert.equal(budgetView(budget, [reversed, replacement], [vaCase], 'reversed').allocations[0].openReplacementId, replacement.id);
  assert.equal(budgetView(budget, [reversed], [vaCase]).allocations[0].openReplacementId, null);
  assert.equal(status(() => newAllocation(allocationInput({ requestedCents: 100_00, replacesAllocationId: 'A' }), budget, [reversed, replacement], [vaCase], context('C'))), 409, 'one reversed allocation has one open replacement');
  assert.equal(status(() => newAllocation(allocationInput({ requestedCents: 100_00, replacesAllocationId: 'B' }), budget, [reversed, replacement], [vaCase], context('C'))), 409, 'only a reversed allocation can be replaced');
});

test('allocation: cross-agency links, foreign evidence and dates outside the fiscal year are refused', () => {
  const { budget } = newBudget(budgetInput(), [], context('FB-1'));
  assert.equal(status(() => newAllocation(allocationInput({ caseId: 'SSA-1', evidenceIds: [], assessmentIds: [] }), budget, [], [vaCase, ssaCase], context())), 400, 'a VA budget cannot fund an SSA case');
  assert.equal(status(() => newAllocation(allocationInput({ caseId: 'NONE' }), budget, [], [vaCase], context())), 400);
  assert.equal(status(() => newAllocation(allocationInput({ caseId: 'REAL-1', evidenceIds: [], assessmentIds: [] }), budget, [], [{ ...vaCase, id: 'REAL-1', provenance: 'public' }], context())), 400, 'only synthetic cases');
  assert.equal(status(() => newAllocation(allocationInput({ evidenceIds: ['EV-9'] }), budget, [], [vaCase], context())), 400);
  assert.equal(status(() => newAllocation(allocationInput({ assessmentIds: ['AS-9'] }), budget, [], [vaCase], context())), 400);
  assert.equal(status(() => newAllocation(allocationInput({ evidenceIds: ['EV-1', 'EV-1'] }), budget, [], [vaCase], context())), 400);
  assert.equal(status(() => newAllocation(allocationInput({ caseId: null }), budget, [], [vaCase], context())), 400, 'evidence needs its case');
  assert.equal(status(() => newAllocation(allocationInput({ neededBy: '2027-10-01' }), budget, [], [vaCase], context())), 400, 'outside fiscal year 2027');
  assert.equal(status(() => newAllocation(allocationInput({ neededBy: '2027-02-30' }), budget, [], [vaCase], context())), 400);
  assert.equal(newAllocation(allocationInput({ neededBy: '2027-09-30' }), budget, [], [vaCase], context()).allocation.neededBy, '2027-09-30');
  const unlinked = newAllocation(allocationInput({ caseId: null, evidenceIds: [], assessmentIds: [] }), budget, [], [vaCase], context()).allocation;
  assert.equal(unlinked.caseId, null, 'missing support is allowed and stays visible');
  assert.deepEqual(allocationStates, ['draft', 'proposed', 'approved', 'rejected', 'reversed']);
});

// ---------- API ----------

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cp-funding-'));
  const server = await createApp({ stateFile: join(directory, 'workspace.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let counter = 0;
  const call = async (path, body, key = body === undefined ? undefined : `test-${++counter}`) => {
    const headers = { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) };
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${asOf}`, body === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { call };
}

async function ssaWorkspaceCase(call) {
  const { body: { profile } } = await call('/api/profile-presets/ssa-system-delivery');
  const loaded = await call('/api/profile', { profile, note: 'Synthetic SSA example for funding tests.' });
  assert.equal(loaded.status, 200, JSON.stringify(loaded.body));
  const created = await call('/api/cases', { title: 'Synthetic SSA delivery', owner: 'Demo SSA lead', note: 'Synthetic SSA example for funding tests.' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.case;
}

test('API: budgets need an Idempotency-Key, and a repeated submission creates one budget', async t => {
  const { call } = await workspace(t);
  assert.equal((await call('/api/funding/budgets', budgetInput(), null)).status, 400);
  const first = await call('/api/funding/budgets', budgetInput(), 'budget-once');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const again = await call('/api/funding/budgets', budgetInput(), 'budget-once');
  assert.equal(again.status, 201);
  assert.equal(again.body.budget.id, first.body.budget.id);
  assert.equal((await call('/api/funding/budgets', budgetInput({ name: 'Different input' }), 'budget-once')).status, 409, 'a key reused for different input');
  const listing = (await call('/api/funding')).body;
  assert.equal(listing.budgets.length, 1);
  assert.equal((await call('/api/workspace')).body.events.filter(event => event.action === 'funding-budget-created').length, 1);
  assert.match(listing.notice, /no government payment is sent/);
  assert.equal(listing.identity.trusted, false);
});

test('API: concurrent approvals cannot overspend, and stale revisions return the current revision', async t => {
  const { call } = await workspace(t);
  const budget = (await call('/api/funding/budgets', budgetInput({ availableCents: 1_000_000_00 }))).body.budget;
  let revision = budget.revision;
  const ids = [];
  for (const destination of ['Project one', 'Project two']) {
    const created = await call(`/api/funding/budgets/${budget.id}/allocations`, { expectedRevision: revision, ...allocationInput({ destination, requestedCents: 600_000_00, caseId: null, evidenceIds: [], assessmentIds: [] }) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.push(created.body.allocation.id);
    const proposed = await call(`/api/funding/allocations/${created.body.allocation.id}/decision`, decision('propose', { expectedRevision: created.body.budget.revision }));
    assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
    revision = proposed.body.budget.revision;
  }
  const raced = await Promise.all(ids.map(id => call(`/api/funding/allocations/${id}/decision`, decision('approve', { expectedRevision: revision }))));
  assert.deepEqual(raced.map(result => result.status).sort(), [200, 409]);
  const loser = raced.find(result => result.status === 409);
  assert.equal(loser.body.currentRevision, revision + 1);
  // Even against the latest revision, the second approval would overspend and is refused.
  const retry = await call(`/api/funding/allocations/${ids[raced.indexOf(loser)]}/decision`, decision('approve', { expectedRevision: revision + 1 }));
  assert.equal(retry.status, 409);
  assert.equal(retry.body.currentRevision, undefined);
  assert.match(retry.body.error, /exceed the remaining budget by \$200,000\.00/);
  const after = (await call(`/api/funding/budgets/${budget.id}`)).body.budget;
  assert.deepEqual([after.totals.approvedCents, after.totals.remainingCents, after.totals.proposedCents, after.revision], [600_000_00, 400_000_00, 600_000_00, revision + 1]);
});

test('API: reversal history, cross-agency refusal, filters, missing evidence, export and case packet', async t => {
  const { call } = await workspace(t);
  const ssa = await ssaWorkspaceCase(call);
  const va = (await call('/api/funding/budgets', budgetInput())).body.budget;
  const ssaBudget = (await call('/api/funding/budgets', budgetInput({ agency: 'ssa', program: 'SSA field office modernization', fundingSource: 'SYN-SSA-FY27-0001', name: 'Synthetic SSA digitization' }))).body.budget;
  const vaCaseBefore = (await call('/api/cases/DEMO-VA-001')).body.case;

  const crossAgency = await call(`/api/funding/budgets/${va.id}/allocations`, { expectedRevision: va.revision, ...allocationInput({ caseId: ssa.id, evidenceIds: [], assessmentIds: [] }) });
  assert.equal(crossAgency.status, 400);
  assert.match(crossAgency.body.error, /SSA case/);

  const evidenceId = vaCaseBefore.evidence[0].id;
  const created = await call(`/api/funding/budgets/${va.id}/allocations`, { expectedRevision: va.revision, ...allocationInput({ evidenceIds: [evidenceId], assessmentIds: [] }) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.allocation.id;
  const support = created.body.allocation.support;
  assert.equal(support.caseTitle, vaCaseBefore.title);
  assert.ok(support.gaps.some(gap => /No reviewer assessment linked/.test(gap)), 'a missing assessment stays visible');
  assert.doesNotMatch(JSON.stringify(created.body), /"compliant"|is compliant/i);
  let revision = created.body.budget.revision;
  for (const action of ['propose', 'approve']) revision = (await call(`/api/funding/allocations/${id}/decision`, decision(action, { expectedRevision: revision }))).body.budget.revision;
  const silentEdit = await call(`/api/funding/allocations/${id}`, { expectedRevision: revision, requestedCents: 1_00, reason: 'Attempting to change an approved amount.' });
  assert.equal(silentEdit.status, 409);
  const reversed = await call(`/api/funding/allocations/${id}/decision`, decision('reverse', { expectedRevision: revision }));
  assert.equal(reversed.status, 200, JSON.stringify(reversed.body));
  assert.equal(reversed.body.budget.totals.remainingCents, va.availableCents);
  const history = reversed.body.allocation.history;
  assert.deepEqual(history.map(entry => entry.action), ['allocation-created', 'propose', 'approve', 'reverse']);
  for (const entry of history) {
    assert.equal(entry.actor, 'local-demo-operator');
    assert.match(entry.at, /^\d{4}-\d\d-\d\dT/);
    assert.ok(entry.rationale.length >= 10);
    assert.ok(Object.hasOwn(entry, 'before') && Object.hasOwn(entry, 'after'));
  }
  assert.equal(history[2].evidenceAtDecision.evidenceIds[0], evidenceId, 'the approval records what supported it');
  assert.equal((await call('/api/cases/DEMO-VA-001')).body.case.revision, vaCaseBefore.revision, 'funding never changes the case');

  // Filters: agencies stay separate; the status filter narrows the list, never the totals.
  const onlyVa = (await call('/api/funding?agency=va')).body;
  assert.deepEqual(onlyVa.budgets.map(budget => budget.agency), ['va']);
  assert.deepEqual(onlyVa.summaries.map(row => row.agency), ['va']);
  const both = (await call('/api/funding')).body;
  assert.deepEqual(both.summaries.map(row => `${row.agency}:${row.fiscalYear}`).sort(), ['ssa:2027', 'va:2027'], 'never one combined VA and SSA total');
  const approvedOnly = (await call('/api/funding?status=approved&agency=va')).body.budgets[0];
  assert.deepEqual([approvedOnly.allocations.length, approvedOnly.allocationCount, approvedOnly.totals.availableCents], [0, 1, va.availableCents]);
  assert.equal((await call('/api/funding?status=reversed&fiscalYear=2027&program=VA%20regional%20services%20portal')).body.budgets[0].allocations.length, 1);
  assert.equal((await call('/api/funding?fiscalYear=2026')).body.budgets.length, 0);
  for (const bad of ['agency=irs', 'status=paid', 'fiscalYear=27', 'payee=x', 'agency=va&agency=ssa']) assert.equal((await call(`/api/funding?${bad}`)).status, 400, bad);
  assert.equal((await call(`/api/funding/budgets/${ssaBudget.id}`)).body.budget.agency, 'ssa');
  assert.equal((await call('/api/funding/budgets/FB-missing')).status, 404);
  assert.equal((await call('/api/funding', {})).status, 405);

  // The audit export and the linked case packet carry the funding activity as additive fields.
  const exported = (await call('/api/export')).body;
  assert.equal(exported.funding.allocations.length, 1);
  assert.deepEqual(exported.fundingSummary.budgets.map(budget => budget.agency).sort(), ['ssa', 'va']);
  assert.match(exported.fundingSummary.notice, /Simulated/);
  assert.ok(exported.events.some(event => event.action === 'funding-allocation-decided' && event.details.after.state === 'reversed'));
  const packet = (await call('/api/cases/DEMO-VA-001/packet')).body;
  assert.equal(packet.fundingAllocations.length, 1);
  assert.equal(packet.fundingAllocations[0].budget.fundingSource, 'SYN-VA-FY27-0001');
  assert.deepEqual(packet.fundingAllocations[0].history.map(entry => entry.action), ['allocation-created', 'propose', 'approve', 'reverse']);
  const { digest, ...content } = packet;
  assert.equal(digest.value, createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex'));
  const unlinked = (await call('/api/cases/DEMO-VA-002/packet')).body;
  assert.equal(Object.hasOwn(unlinked, 'fundingAllocations'), false, 'packets without funding keep their earlier shape');
});

test('API: budget amendments are audited, stale tabs get a conflict, and a rejection is final', async t => {
  const { call } = await workspace(t);
  const budget = (await call('/api/funding/budgets', budgetInput({ availableCents: 500_00 }))).body.budget;
  const amended = await call(`/api/funding/budgets/${budget.id}`, { expectedRevision: budget.revision, availableCents: 750_00, reason: 'Synthetic supplemental amount for the demo.' });
  assert.equal(amended.status, 200, JSON.stringify(amended.body));
  assert.deepEqual([amended.body.change.before.availableCents, amended.body.change.after.availableCents], [500_00, 750_00]);
  assert.equal(amended.body.budget.history.at(-1).rationale, 'Synthetic supplemental amount for the demo.');
  const stale = await call(`/api/funding/budgets/${budget.id}`, { expectedRevision: budget.revision, owner: 'Other owner', reason: 'Stale browser tab sends an old revision.' });
  assert.deepEqual([stale.status, stale.body.currentRevision], [409, amended.body.budget.revision]);
  assert.equal((await call(`/api/funding/budgets/${budget.id}`, { expectedRevision: amended.body.budget.revision, agency: 'ssa', reason: 'Trying to move the budget to another agency.' })).status, 400);
  const created = await call(`/api/funding/budgets/${budget.id}/allocations`, { expectedRevision: amended.body.budget.revision, ...allocationInput({ requestedCents: 100_00, caseId: null, evidenceIds: [], assessmentIds: [] }) });
  const rejected = await call(`/api/funding/allocations/${created.body.allocation.id}/decision`, decision('reject', { expectedRevision: created.body.budget.revision }));
  assert.equal(rejected.body.allocation.state, 'rejected');
  assert.equal(rejected.body.budget.totals.remainingCents, 750_00);
  assert.equal((await call(`/api/funding/allocations/${created.body.allocation.id}/decision`, decision('propose', { expectedRevision: rejected.body.budget.revision }))).status, 409, 'a rejection is final');
});
