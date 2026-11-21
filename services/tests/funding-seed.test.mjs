import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { busyPorts } from '../free-ports.mjs';
import { startPitchDemo } from '../pitch-runner.mjs';
import { seedContractReview } from '../contract-review-seed.mjs';
import { completeContractReview } from '../contract-review-completion.mjs';
import { seedFunding } from '../funding-seed.mjs';

async function freeGatewayPort() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const start = 20000 + Math.floor(Math.random() * 30000);
    if ((await busyPorts('127.0.0.1', Array.from({ length: 8 }, (_, index) => start + index))).length === 0) return start;
  }
  throw new Error('No free block of eight ports was found');
}

test('funding demo: the seeded figures, the walkthrough order (approve $420,000, then $900,000 is refused), reversal history and audit data', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'cp-funding-demo-'));
  let demo;
  t.after(async () => {
    if (demo) { demo.stop(); await demo.exited; }
    await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const today = new Date().toISOString().slice(0, 10);
  const seed = async context => {
    const initial = await seedContractReview(context);
    await completeContractReview({ ...context, caseId: initial.caseId });
    return { ...initial, funding: await seedFunding({ ...context, vaCaseId: initial.caseId }) };
  };
  demo = await startPitchDemo({ env: process.env, gatewayPort: await freeGatewayPort(), folder, today, seed, output: { log() {}, error() {} } });
  const seeded = await demo.ready;
  assert.ok(seeded?.funding, 'the seed finished');
  const get = async path => (await fetch(`${demo.base}${path}${path.includes('?') ? '&' : '?'}asOf=${today}`)).json();
  const post = async (path, body, key) => {
    const response = await fetch(`${demo.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const figures = totals => [totals.availableCents, totals.approvedCents, totals.remainingCents, totals.proposedCents, totals.reversedCents];

  // As seeded: nothing is decided for the two open proposals, and the earlier reversal is already in the balance.
  const overview = await get('/api/funding');
  assert.deepEqual(overview.budgets.map(budget => budget.agency), ['va', 'ssa']);
  assert.deepEqual(overview.summaries.map(row => row.agency), ['va', 'ssa'], 'VA and SSA totals stay separate');
  const [va, ssa] = overview.budgets;
  assert.deepEqual(figures(va.totals), [120_000_000, 50_000_000, 70_000_000, 132_000_000, 25_000_000]);
  assert.deepEqual(figures(ssa.totals), [80_000_000, 30_000_000, 50_000_000, 100_000_000, 15_000_000]);

  for (const [budget, result] of [[va, seeded.funding.va], [ssa, seeded.funding.ssa]]) {
    const byId = id => budget.allocations.find(allocation => allocation.id === id);
    const reversed = byId(result.reversedAllocationId);
    assert.deepEqual(reversed.history.map(entry => entry.action), ['allocation-created', 'propose', 'approve', 'reverse'], 'the reversal keeps the original approval');
    assert.equal(reversed.history[3].remainingAfterCents, budget.totals.remainingCents, 'the reversed amount is already in the remaining budget; it is not added again');
    assert.equal(reversed.history[3].remainingAfterCents - reversed.history[3].remainingBeforeCents, reversed.approvedCents);
    const overBudget = byId(result.overBudgetAllocationId);
    assert.deepEqual([overBudget.state, overBudget.history.map(entry => entry.action)], ['proposed', ['allocation-created', 'propose']], 'the seed decides nothing for it');
    assert.ok(overBudget.support.gaps.includes('No supporting document linked.'), 'missing support stays visible');
    const supported = byId(result.supportedAllocationId);
    assert.deepEqual([supported.state, supported.approvalCheck.fits], ['proposed', true]);
    assert.ok(supported.support.documents.length > 0 && supported.support.assessments.length > 0);
    assert.equal(supported.support.gaps.some(gap => /No reviewer assessment|No supporting document/.test(gap)), false);
    assert.match(`${supported.purpose} ${supported.rationale}`, /fictional next phase/i, 'the proposal is for a separate next phase');
    assert.match(supported.rationale, /does not show that any (monitoring|operating work) has been (performed|done)/, 'the evidence supports the baseline, not future work');
  }
  const vaSupported = va.allocations.find(allocation => allocation.id === seeded.funding.va.supportedAllocationId);
  assert.equal(vaSupported.destination, 'Post-release accessibility monitoring');
  assert.doesNotMatch(JSON.stringify(va.allocations.filter(allocation => allocation.state === 'proposed')), /acceptance retest/i, 'the completed case already holds the final retest');
  assert.ok(vaSupported.support.documents.every(doc => doc.documentId), 'VA support points at stored case documents');
  const vaOver = va.allocations.find(allocation => allocation.id === seeded.funding.va.overBudgetAllocationId);
  assert.deepEqual([vaOver.requestedCents, vaOver.approvalCheck.exceedsByCents], [90_000_000, 20_000_000], 'before any approval it is $200,000 over the $700,000 remaining');

  // The walkthrough order. First the supported $420,000 proposal is approved: $920,000 approved, $280,000 remaining.
  const approved = await post(`/api/funding/allocations/${vaSupported.id}/decision`, { expectedRevision: va.revision, action: 'approve', rationale: 'Presenter approves the supported monitoring proposal.' }, 'walkthrough-approve');
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.deepEqual(figures(approved.body.budget.totals), [120_000_000, 92_000_000, 28_000_000, 90_000_000, 25_000_000]);
  // Then the $900,000 request is refused: it exceeds the $280,000 now remaining by $620,000, and nothing changes.
  const refused = await post(`/api/funding/allocations/${vaOver.id}/decision`, { expectedRevision: approved.body.budget.revision, action: 'approve', rationale: 'Presenter tries the larger request after the approval.' }, 'walkthrough-refused');
  assert.equal(refused.status, 409);
  assert.equal(refused.body.currentRevision, undefined, 'a rule refusal, not a revision conflict');
  assert.match(refused.body.error, /\$900,000\.00 requested and \$280,000\.00 remaining.*exceed the remaining budget by \$620,000\.00\. Nothing was changed\./);
  const after = (await get('/api/funding?agency=va')).budgets[0];
  assert.deepEqual(figures(after.totals), [120_000_000, 92_000_000, 28_000_000, 90_000_000, 25_000_000], 'balances are unchanged by the refusal');
  assert.equal(after.revision, approved.body.budget.revision, 'the refusal recorded nothing');
  const stillOpen = after.allocations.find(allocation => allocation.id === vaOver.id);
  assert.deepEqual([stillOpen.state, stillOpen.approvalCheck.exceedsByCents], ['proposed', 62_000_000]);
  assert.deepEqual(figures((await get('/api/funding?agency=ssa')).budgets[0].totals), [80_000_000, 30_000_000, 50_000_000, 100_000_000, 15_000_000], 'a VA decision leaves SSA untouched');

  // Records protection and the audit handoff: the hold stays, and the recorded decision travels with the packet and the export.
  const workspace = await get('/api/workspace');
  assert.ok(workspace.events.filter(event => event.action.startsWith('funding-')).every(event => event.caseId === null), 'funding events never change a case');
  assert.ok(workspace.cases.find(item => item.id === seeded.caseId).records.some(record => record.hold === 'active'), 'the VA hold remains active');
  assert.equal((await get('/api/records?hold=active')).items.every(record => record.retention.canDestroy === false), true);
  const packet = await get(`/api/cases/${seeded.caseId}/packet`);
  const packetDecision = packet.fundingAllocations.find(allocation => allocation.id === vaSupported.id).history.at(-1);
  assert.deepEqual([packet.fundingAllocations.length, packetDecision.action, packetDecision.rationale, packetDecision.remainingAfterCents, packetDecision.simulated], [2, 'approve', 'Presenter approves the supported monitoring proposal.', 28_000_000, true]);
  assert.match(packet.fundingNotice, /no government payment is sent/);
  const exported = await get('/api/export');
  assert.equal(exported.fundingSummary.budgets.find(budget => budget.agency === 'va').totals.remainingCents, 28_000_000);
  assert.ok(exported.events.some(event => event.action === 'funding-allocation-decided' && event.details.allocationId === vaSupported.id && event.details.after.state === 'approved'), 'the export holds the recorded decision');
});
