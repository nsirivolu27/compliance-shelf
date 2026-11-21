// Adds one isolated synthetic funding example per agency, through the public API only, so every change is
// validated and recorded with its rationale. It runs only on a workspace with no budgets yet.
// VA uses the completed contract-review case and its documents and assessments. SSA gets its own example case.
// Each agency then has: a budget with funds available, an approval that stands, an earlier approval that was
// reversed (already reflected in the remaining budget, with its history kept), a supported proposal for a separate
// next phase, and a larger proposal. In the walkthrough the supported proposal is approved first; the larger one
// then exceeds what is left and the server refuses it. The seed itself decides neither of them.
// Every decision is a simulated demo decision; nothing is paid.

const note = 'Synthetic funding demonstration data. Not an agency budget, obligation or payment.';

export async function seedFunding({ base, today, vaCaseId }) {
  let counter = 0;
  async function call(path, body, key) {
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${today}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key ?? `demo-funding:${++counter}` }, body: JSON.stringify(body),
    });
    const result = await response.json();
    return { status: response.status, body: result };
  }
  async function must(path, body, key) {
    const result = await call(path, body, key);
    if (result.status >= 300) throw new Error(`${path} was refused (${result.status}): ${result.body.error}`);
    return result.body;
  }
  const caseOf = async caseId => (await must(`/api/cases/${caseId}`)).case;
  // Assessments carry their own rationale and accept no separate note.
  const onCase = async (caseId, path, body, key, withNote = true) => must(`/api/cases/${caseId}${path}`, { expectedRevision: (await caseOf(caseId)).revision, ...(withNote ? { note } : {}), ...body }, key);

  if ((await must('/api/funding')).budgets.length) throw new Error('The funding demonstration needs a workspace without budgets. Nothing was changed.');
  const va = await caseOf(vaCaseId);
  if (va.provenance !== 'synthetic' || !/Veterans Affairs/i.test(va.agency)) throw new Error('The VA example must be a synthetic VA case');

  // SSA: a separate synthetic example case with one verified reference and one recorded assessment.
  const { profile } = await must('/api/profile-presets/ssa-system-delivery');
  await must('/api/profile', { profile, note }, 'demo-funding:ssa-profile');
  const ssaId = (await must('/api/cases', { title: 'Synthetic SSA field office records digitization pilot', owner: 'Demo SSA pilot lead', note }, 'demo-funding:ssa-case')).case.id;
  await onCase(ssaId, '/context', { applicability: { 'test-evidence': 'yes' } }, 'demo-funding:ssa-applicability');
  const evidenceId = (await onCase(ssaId, '/evidence', { kind: 'test-evidence', title: 'Synthetic pilot scanning test report, two field offices', locator: 'Synthetic SSA pilot share, test folder, report 2026-11' }, 'demo-funding:ssa-evidence')).id;
  await onCase(ssaId, '/verify-evidence', { evidenceId }, 'demo-funding:ssa-verify');
  await onCase(ssaId, '/assessments', { findingId: `${ssaId}:test-evidence`, evidenceIds: [evidenceId], outcome: 'sufficient-for-stated-check', rationale: 'Synthetic review: the pilot test report covers both field offices and the stated scanning checks.' }, 'demo-funding:ssa-assessment', false);
  const ssa = await caseOf(ssaId);

  // The assessments that currently find evidence sufficient, and the references they relied on.
  const support = item => {
    const latest = new Map();
    for (const assessment of item.assessments ?? []) latest.set(assessment.findingId, assessment);
    const sufficient = [...latest.values()].filter(assessment => assessment.outcome === 'sufficient-for-stated-check');
    const evidenceIds = [...new Set(sufficient.flatMap(assessment => assessment.evidenceIds))].filter(id => item.evidence.some(entry => entry.id === id)).slice(0, 20);
    return { caseId: item.id, evidenceIds, assessmentIds: sufficient.map(assessment => assessment.id).slice(0, 20) };
  };

  async function example(agency, item, plan) {
    const tag = `demo-funding:${agency}`;
    let budget = (await must('/api/funding/budgets', { agency, fiscalYear: 2027, note, ...plan.budget }, `${tag}:budget`)).budget;
    const request = async (step, fields, linked) => {
      const created = await must(`/api/funding/budgets/${budget.id}/allocations`, { expectedRevision: budget.revision, owner: plan.owner, ...fields, ...(linked ? support(item) : { caseId: null }) }, `${tag}:${step}`);
      budget = created.budget;
      return created.allocation.id;
    };
    const decide = async (id, action, rationale, step) => {
      budget = (await must(`/api/funding/allocations/${id}/decision`, { expectedRevision: budget.revision, action, rationale }, `${tag}:${step}`)).budget;
    };
    const standing = await request('standing', plan.standing, true);
    await decide(standing, 'propose', 'Ready for a decision: the supporting documents and assessment are linked.', 'standing-propose');
    await decide(standing, 'approve', 'Simulated approval for the demonstration: supported and within the remaining budget.', 'standing-approve');
    const reversed = await request('reversed', plan.reversed, false);
    await decide(reversed, 'propose', 'Proposed before the duplication was noticed.', 'reversed-propose');
    await decide(reversed, 'approve', 'Simulated approval recorded before the duplication was noticed.', 'reversed-approve');
    await decide(reversed, 'reverse', plan.reversalRationale, 'reversed-reverse');
    const supported = await request('supported', plan.supported, true);
    await decide(supported, 'propose', 'Supporting documents and a current sufficient assessment are linked. Ready for a decision.', 'supported-propose');
    const overBudget = await request('over-budget', plan.overBudget, false);
    await decide(overBudget, 'propose', 'Proposed for discussion. It is larger than the remaining budget.', 'over-budget-propose');
    return { budgetId: budget.id, caseId: item.id, totals: budget.totals, supportedAllocationId: supported, overBudgetAllocationId: overBudget, reversedAllocationId: reversed };
  }

  const vaResult = await example('va', va, {
    owner: 'Demo VA program budget officer',
    budget: { name: 'VA regional services portal: accessibility remediation (synthetic)', program: 'VA regional services portal', fundingSource: 'SYN-VA-FY27-PORTAL-01', availableCents: 120_000_000, owner: 'Demo VA program budget officer' },
    standing: { destination: 'Portal accessibility evaluation', purpose: 'Fund the evaluation and retest work recorded in the synthetic contract file.', requestedCents: 50_000_000, rationale: 'The evaluation produced the documents the review relied on.' },
    reversed: { destination: 'Duplicate screen-reader retest', purpose: 'A second retest of build 1.2 requested before the correction build was available.', requestedCents: 25_000_000, rationale: 'Requested to confirm the keyboard defects independently.' },
    reversalRationale: 'Simulated reversal: the vendor contract already covers this retest. This entry releases the $250,000.00 back to the remaining budget, and the approval stays on record.',
    // A separate, fictional next phase. The completed review already holds the final retest, so this is not another retest.
    supported: { destination: 'Post-release accessibility monitoring', purpose: 'Quarterly keyboard and screen-reader spot checks of the six named portal flows after release, with a defect log, for the rest of fiscal year 2027. A fictional next phase: no monitoring has been done.', requestedCents: 42_000_000, rationale: 'The completed review found the delivery evidence for correction build 1.2.1 sufficient. That documents the baseline this monitoring would watch for regressions. The linked evidence supports the baseline only; it does not show that any monitoring has been performed.' },
    overBudget: { destination: 'Full portal redesign', purpose: 'Replace the portal front end in the same fiscal year.', requestedCents: 90_000_000, rationale: 'Raised in planning as a larger alternative to remediation.' },
  });
  const ssaResult = await example('ssa', ssa, {
    owner: 'Demo SSA program budget officer',
    budget: { name: 'SSA field office modernization: records digitization (synthetic)', program: 'SSA field office modernization', fundingSource: 'SYN-SSA-FY27-FO-01', availableCents: 80_000_000, owner: 'Demo SSA program budget officer' },
    standing: { destination: 'Scanning equipment lease, two pilot offices', purpose: 'Lease scanning equipment for the two synthetic pilot field offices.', requestedCents: 30_000_000, rationale: 'The pilot test report shows the equipment meets the stated scanning checks.' },
    reversed: { destination: 'Duplicate vendor onboarding', purpose: 'Onboarding for a scanning vendor already covered by the equipment lease.', requestedCents: 15_000_000, rationale: 'Requested to start onboarding early.' },
    reversalRationale: 'Simulated reversal: the lease already includes onboarding. This entry releases the $150,000.00 back to the remaining budget, and the approval stays on record.',
    supported: { destination: 'Records digitization pilot operations', purpose: 'Operate the digitization pilot in two synthetic field offices for one quarter. A fictional next phase: no pilot operations have been performed.', requestedCents: 35_000_000, rationale: 'The verified pilot test report and its sufficient assessment show the scanning setup met the stated checks. That supports starting operations; it does not show that any operating work has been done.' },
    overBudget: { destination: 'Nationwide digitization rollout', purpose: 'Extend digitization to every field office this fiscal year.', requestedCents: 65_000_000, rationale: 'Raised in planning before the pilot results are known.' },
  });
  return { va: vaResult, ssa: ssaResult };
}
