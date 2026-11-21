/**
 * Synthetic program and project funding: budgets, allocation requests and recorded decisions.
 * Money is a whole number of US cents. Sums and comparisons use BigInt, so no amount ever passes
 * through floating-point arithmetic. Every change returns its before and after values for the audit trail.
 * Decisions are simulated demonstration decisions. Nothing is obligated, paid or sent to a Treasury,
 * VA or SSA financial system, and nothing here decides an individual's benefit eligibility.
 * This file imports nothing. Budgets, allocations and cases are passed in.
 */

export type Row = Record<string, any>;
type Context = { id: string; now: string; actor: string };

export const fundingAgencies = ["va", "ssa"];
const agencyNames: Record<string, string> = { va: "VA", ssa: "SSA" };
export const allocationStates = ["draft", "proposed", "approved", "rejected", "reversed"];
export const decisionActions = ["propose", "approve", "reject", "reverse"];
/** $10,000,000,000.00, far above any demonstration figure and far below the exact-integer limit. */
export const maxAmountCents = 1_000_000_000_000;
const maxBudgets = 200;
const maxAllocationsPerBudget = 200;
export const simulatedLabel = "Simulated demo decision. Not an agency approval, obligation or payment.";
export const fundingNotice = "Simulated allocations on synthetic budgets: no government payment is sent, and no Treasury, VA or SSA financial system is connected. Amounts are money totals, not compliance scores. No individual benefit eligibility is decided. The shared demo login does not identify an individual approver.";
const supportNotice = "Linked documents and assessments show what a person relied on. They do not establish compliance, and no request is approved automatically.";
const outcomeLabels: Record<string, string> = { "sufficient-for-stated-check": "sufficient for the stated check", insufficient: "insufficient", "needs-clarification": "needs clarification" };

const transitions: Record<string, { from: string[]; to: string }> = {
  propose: { from: ["draft"], to: "proposed" },
  approve: { from: ["proposed"], to: "approved" },
  reject: { from: ["draft", "proposed"], to: "rejected" },
  reverse: { from: ["approved"], to: "reversed" },
};

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function objectOf(value: unknown, name: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object.`);
  return value as Row;
}

function onlyFields(row: Row, allowed: string[]) {
  for (const key of Object.keys(row)) if (!allowed.includes(key)) invalid(`Unsupported field: ${key.slice(0, 40)}`);
}

function textOf(value: unknown, name: string, max: number, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) invalid(`${name} must be ${min} to ${max} characters.`);
  return (value as string).trim();
}

function reasonOf(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length < 10 || value.length > 2000) invalid(`Provide a ${name} of 10 to 2000 characters.`);
  return (value as string).trim();
}

function realDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// ---------- Money ----------

/** An amount sent to the API: a whole, positive number of cents within the supported range. */
export function centsOf(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid(`${name} must be a whole number of cents, for example 125000 for $1,250.00.`);
  if ((value as number) <= 0) invalid(`${name} must be more than $0.00.`);
  if ((value as number) > maxAmountCents) invalid(`${name} can be at most ${formatUsd(maxAmountCents)}.`);
  return value as number;
}

function total(values: number[]): bigint {
  return values.reduce((sum, value) => sum + BigInt(value), 0n);
}

function centsFrom(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) invalid("A total is outside the supported range.", 409);
  return Number(value);
}

/** Cents as US dollars, for example 123456789 as $1,234,567.89. */
export function formatUsd(cents: number | bigint): string {
  const value = BigInt(cents);
  const size = value < 0n ? -value : value;
  const dollars = (size / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value < 0n ? "-" : ""}$${dollars}.${(size % 100n).toString().padStart(2, "0")}`;
}

// ---------- Agencies, identifiers and dates ----------

/** VA or SSA from a case's agency name, or null when the case names neither. */
export function agencyOfCase(item: Row): string | null {
  const text = typeof item?.agency === "string" ? item.agency : "";
  if (/veterans affairs/i.test(text)) return "va";
  if (/social security/i.test(text)) return "ssa";
  return null;
}

/** A federal fiscal year runs from 1 October of the previous calendar year to 30 September. */
export function fiscalYearWindow(year: number) {
  return { start: `${year - 1}-10-01`, end: `${year}-09-30` };
}

function agencyOf(value: unknown): string {
  if (!fundingAgencies.includes(value as string)) invalid("agency must be va or ssa.");
  return value as string;
}

function fiscalYearOf(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 2020 || (value as number) > 2100) invalid("fiscalYear must be a federal fiscal year from 2020 to 2100.");
  return value as number;
}

const fundingSourcePattern = /^SYN-(VA|SSA)-[A-Z0-9][A-Z0-9._-]{1,50}$/;
function fundingSourceOf(value: unknown, agency: string): string {
  const reference = typeof value === "string" ? value.trim() : "";
  if (!fundingSourcePattern.test(reference)) invalid("fundingSource must be a synthetic reference such as SYN-VA-FY27-0001: SYN-, the agency code, then 2 to 51 capital letters, digits, dots, underscores or hyphens.");
  const code = reference.split("-")[1].toLowerCase();
  if (code !== agency) invalid(`Funding-source reference ${reference} belongs to ${agencyNames[code]}, not ${agencyNames[agency]}. VA and SSA funding stay separate.`);
  return reference;
}

function historyEntry(context: Context, action: string, rationale: string, before: Row | null, after: Row, extra: Row = {}) {
  return { at: context.now, actor: context.actor, action, rationale, before, after, simulated: true, ...extra };
}

function changedOnly(before: Row, after: Row) {
  const keys = Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (!keys.length) invalid("Nothing to change.");
  return { before: Object.fromEntries(keys.map(key => [key, before[key]])), after: Object.fromEntries(keys.map(key => [key, after[key]])) };
}

// ---------- Budgets ----------

function budgetSnapshot(budget: Row) {
  return { name: budget.name, agency: budget.agency, program: budget.program, fundingSource: budget.fundingSource, fiscalYear: budget.fiscalYear, availableCents: budget.availableCents, owner: budget.owner, note: budget.note };
}

export function newBudget(input: unknown, budgets: Row[], context: Context) {
  const row = objectOf(input, "Budget");
  onlyFields(row, ["name", "agency", "program", "fundingSource", "fiscalYear", "availableCents", "owner", "note"]);
  const agency = agencyOf(row.agency);
  const fields = {
    name: textOf(row.name, "name", 160, 3), agency, program: textOf(row.program, "program or project", 160, 3),
    fundingSource: fundingSourceOf(row.fundingSource, agency), fiscalYear: fiscalYearOf(row.fiscalYear),
    availableCents: centsOf(row.availableCents, "Available funds"), owner: textOf(row.owner, "owner", 120, 2), note: reasonOf(row.note, "supporting note"),
  };
  if (budgets.length >= maxBudgets) invalid(`A workspace holds at most ${maxBudgets} budgets.`, 409);
  if (budgets.some(other => other.fundingSource === fields.fundingSource && other.fiscalYear === fields.fiscalYear)) invalid(`Funding-source reference ${fields.fundingSource} already has a fiscal year ${fields.fiscalYear} budget.`, 409);
  const after = budgetSnapshot(fields);
  const budget = { id: context.id, ...fields, synthetic: true, revision: 1, createdAt: context.now, createdBy: context.actor,
    history: [historyEntry(context, "budget-created", fields.note, null, after, { budgetRevision: 1 })] };
  return { budget, change: { command: "funding-budget-created", budgetId: budget.id, rationale: fields.note, before: null, after } };
}

/** Name, owner, note and available funds can change with a reason. Agency, program, source and year identify the budget. */
export function amendBudget(input: unknown, budget: Row, allocations: Row[], context: Omit<Context, "id">) {
  const row = objectOf(input, "Budget change");
  for (const key of ["agency", "program", "fundingSource", "fiscalYear"]) if (Object.hasOwn(row, key)) invalid(`${key} cannot be changed. Create a separate budget for another agency, program, funding source or fiscal year.`);
  onlyFields(row, ["expectedRevision", "name", "availableCents", "owner", "note", "reason"]);
  const reason = reasonOf(row.reason, "reason for this change");
  const next: Row = {
    ...budget,
    ...(Object.hasOwn(row, "name") ? { name: textOf(row.name, "name", 160, 3) } : {}),
    ...(Object.hasOwn(row, "owner") ? { owner: textOf(row.owner, "owner", 120, 2) } : {}),
    ...(Object.hasOwn(row, "note") ? { note: reasonOf(row.note, "supporting note") } : {}),
    ...(Object.hasOwn(row, "availableCents") ? { availableCents: centsOf(row.availableCents, "Available funds") } : {}),
  };
  const { before, after } = changedOnly(budgetSnapshot(budget), budgetSnapshot(next));
  const approved = budgetTotals(budget, allocations).approvedCents;
  if (BigInt(next.availableCents) < BigInt(approved)) invalid(`Available funds cannot be set below the approved allocations (${formatUsd(approved)}). Reverse an allocation first.`, 409);
  const revision = budget.revision + 1;
  const amended = { ...next, revision, history: [...budget.history, historyEntry({ ...context, id: budget.id }, "budget-amended", reason, before, after, { budgetRevision: revision })] };
  return { budget: amended, change: { command: "funding-budget-amended", budgetId: budget.id, rationale: reason, before, after } };
}

/** Money totals for one budget. Proposals are shown separately and never reduce the remaining budget. */
export function budgetTotals(budget: Row, allocations: Row[]) {
  const mine = allocations.filter(allocation => allocation.budgetId === budget.id);
  const sumOf = (state: string, field: string) => total(mine.filter(allocation => allocation.state === state).map(allocation => allocation[field]));
  const approved = sumOf("approved", "approvedCents");
  const proposed = sumOf("proposed", "requestedCents");
  const remaining = BigInt(budget.availableCents) - approved;
  return {
    availableCents: budget.availableCents, draftCents: centsFrom(sumOf("draft", "requestedCents")), proposedCents: centsFrom(proposed),
    approvedCents: centsFrom(approved), remainingCents: centsFrom(remaining),
    reversedCents: centsFrom(sumOf("reversed", "approvedCents")), rejectedCents: centsFrom(sumOf("rejected", "requestedCents")),
    proposedBeyondRemainingCents: centsFrom(proposed > remaining ? proposed - remaining : 0n),
    counts: Object.fromEntries(allocationStates.map(state => [state, mine.filter(allocation => allocation.state === state).length])),
  };
}

// ---------- Allocation requests ----------

function idList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some(id => typeof id !== "string" || !/^[A-Za-z0-9:_.-]{1,160}$/.test(id))) invalid(`${name} must be a list of up to 20 identifiers.`);
  if (new Set(value).size !== (value as string[]).length) invalid(`${name} lists the same identifier twice.`);
  return [...(value as string[])];
}

/** The supporting case and its evidence. A case must be synthetic and belong to the budget's agency. */
function supportOf(row: Row, budget: Row, cases: Row[]) {
  const caseId = row.caseId ?? null;
  const evidenceIds = idList(row.evidenceIds, "evidenceIds");
  const assessmentIds = idList(row.assessmentIds, "assessmentIds");
  if (caseId === null) {
    if (evidenceIds.length || assessmentIds.length) invalid("Choose the supporting case before linking its documents or assessments.");
    return { caseId, evidenceIds, assessmentIds };
  }
  if (typeof caseId !== "string") invalid("caseId must be a case identifier or null.");
  const item = cases.find(candidate => candidate.id === caseId);
  if (!item) invalid(`Supporting case ${caseId} is not in this workspace.`);
  if (item.provenance !== "synthetic") invalid(`Case ${caseId} is not synthetic. Funding demonstrations link synthetic cases only.`);
  const caseAgency = agencyOfCase(item);
  if (caseAgency !== budget.agency) invalid(caseAgency
    ? `Cross-agency link refused: ${caseId} is an ${agencyNames[caseAgency]} case and this budget is ${agencyNames[budget.agency]}. VA and SSA funding stay separate.`
    : `Case ${caseId} names neither VA nor SSA, so it cannot support a ${agencyNames[budget.agency]} allocation.`);
  for (const id of evidenceIds) if (!(item.evidence ?? []).some((entry: Row) => entry.id === id)) invalid(`Evidence reference ${id} is not on case ${caseId}.`);
  for (const id of assessmentIds) if (!(item.assessments ?? []).some((entry: Row) => entry.id === id)) invalid(`Assessment ${id} is not on case ${caseId}.`);
  return { caseId, evidenceIds, assessmentIds };
}

function neededByOf(value: unknown, budget: Row): string | null {
  if (value === undefined || value === null) return null;
  if (!realDate(value)) invalid("neededBy must be a real date in YYYY-MM-DD form.");
  const window = fiscalYearWindow(budget.fiscalYear);
  if (value < window.start || value > window.end) invalid(`neededBy must fall in fiscal year ${budget.fiscalYear} (${window.start} to ${window.end}).`);
  return value;
}

function requestedOf(value: unknown, budget: Row): number {
  const cents = centsOf(value, "Requested amount");
  if (BigInt(cents) > BigInt(budget.availableCents)) invalid(`Requested amount ${formatUsd(cents)} is more than this budget's available funds (${formatUsd(budget.availableCents)}).`);
  return cents;
}

function allocationSnapshot(allocation: Row) {
  return {
    destination: allocation.destination, purpose: allocation.purpose, requestedCents: allocation.requestedCents, approvedCents: allocation.approvedCents,
    owner: allocation.owner, caseId: allocation.caseId, evidenceIds: allocation.evidenceIds, assessmentIds: allocation.assessmentIds,
    rationale: allocation.rationale, neededBy: allocation.neededBy, replacesAllocationId: allocation.replacesAllocationId, state: allocation.state,
  };
}

/** A new request starts as a draft. It does not reserve or consume funds. */
export function newAllocation(input: unknown, budget: Row, allocations: Row[], cases: Row[], context: Context) {
  const row = objectOf(input, "Allocation request");
  onlyFields(row, ["expectedRevision", "destination", "purpose", "requestedCents", "owner", "caseId", "evidenceIds", "assessmentIds", "rationale", "neededBy", "replacesAllocationId"]);
  const mine = allocations.filter(allocation => allocation.budgetId === budget.id);
  if (mine.length >= maxAllocationsPerBudget) invalid(`A budget holds at most ${maxAllocationsPerBudget} allocation requests.`, 409);
  const fields = {
    destination: textOf(row.destination, "destination program or project", 160, 3), purpose: textOf(row.purpose, "purpose", 500, 10),
    requestedCents: requestedOf(row.requestedCents, budget), owner: textOf(row.owner, "responsible owner", 120, 2),
    ...supportOf(row, budget, cases), rationale: reasonOf(row.rationale, "rationale"), neededBy: neededByOf(row.neededBy, budget),
  };
  let replacesAllocationId = null;
  if (row.replacesAllocationId !== undefined && row.replacesAllocationId !== null) {
    const source = mine.find(allocation => allocation.id === row.replacesAllocationId);
    if (!source) invalid(`Allocation ${String(row.replacesAllocationId).slice(0, 80)} is not on this budget.`);
    if (source.state !== "reversed") invalid(`Only a reversed allocation can be replaced. ${source.id} is ${source.state}. Record a reversal first; the original decision is kept.`, 409);
    const open = mine.find(allocation => allocation.replacesAllocationId === source.id && allocation.state !== "rejected");
    if (open) invalid(`Allocation ${source.id} already has a replacement request (${open.id}).`, 409);
    replacesAllocationId = source.id;
  }
  const revision = budget.revision + 1;
  const allocation: Row = { id: context.id, budgetId: budget.id, agency: budget.agency, ...fields, approvedCents: null, replacesAllocationId, state: "draft", synthetic: true, createdAt: context.now, createdBy: context.actor };
  const after = allocationSnapshot(allocation);
  allocation.history = [historyEntry(context, "allocation-created", fields.rationale, null, after, { fromState: null, toState: "draft", budgetRevision: revision })];
  return { allocation, budget: { ...budget, revision }, change: { command: "funding-allocation-created", budgetId: budget.id, allocationId: allocation.id, rationale: fields.rationale, before: null, after } };
}

/** Drafts and proposals can be edited with a reason. Approved, rejected and reversed allocations cannot. */
export function changeAllocation(input: unknown, allocation: Row, budget: Row, allocations: Row[], cases: Row[], context: Omit<Context, "id">) {
  const row = objectOf(input, "Allocation change");
  if (allocation.state === "approved") invalid("An approved allocation cannot be edited. Record a reversal with its rationale, then create a replacement request. The original decision is kept.", 409);
  if (!["draft", "proposed"].includes(allocation.state)) invalid(`This allocation is ${allocation.state} and closed. Create a new request instead.`, 409);
  onlyFields(row, ["expectedRevision", "destination", "purpose", "requestedCents", "owner", "caseId", "evidenceIds", "assessmentIds", "rationale", "neededBy", "reason"]);
  const reason = reasonOf(row.reason, "reason for this change");
  const given = (key: string) => (Object.hasOwn(row, key) ? row[key] : allocation[key]);
  const next = {
    ...allocation,
    destination: Object.hasOwn(row, "destination") ? textOf(row.destination, "destination program or project", 160, 3) : allocation.destination,
    purpose: Object.hasOwn(row, "purpose") ? textOf(row.purpose, "purpose", 500, 10) : allocation.purpose,
    requestedCents: Object.hasOwn(row, "requestedCents") ? requestedOf(row.requestedCents, budget) : allocation.requestedCents,
    owner: Object.hasOwn(row, "owner") ? textOf(row.owner, "responsible owner", 120, 2) : allocation.owner,
    rationale: Object.hasOwn(row, "rationale") ? reasonOf(row.rationale, "rationale") : allocation.rationale,
    neededBy: Object.hasOwn(row, "neededBy") ? neededByOf(row.neededBy, budget) : allocation.neededBy,
    ...supportOf({ caseId: given("caseId"), evidenceIds: given("evidenceIds"), assessmentIds: given("assessmentIds") }, budget, cases),
  };
  const { before, after } = changedOnly(allocationSnapshot(allocation), allocationSnapshot(next));
  const revision = budget.revision + 1;
  const edited = { ...next, history: [...allocation.history, historyEntry({ ...context, id: allocation.id }, "allocation-edited", reason, before, after, { fromState: allocation.state, toState: allocation.state, budgetRevision: revision })] };
  return { allocation: edited, budget: { ...budget, revision }, change: { command: "funding-allocation-edited", budgetId: budget.id, allocationId: allocation.id, rationale: reason, before, after } };
}

function transitionRefusal(action: string, state: string): string {
  if (action === "approve" && state === "draft") return "A draft cannot be approved. Propose it first.";
  if (["rejected", "reversed"].includes(state)) return `This allocation is ${state} and closed. Create a new request instead.`;
  return `An allocation that is ${state} cannot be ${({ propose: "proposed", approve: "approved", reject: "rejected", reverse: "reversed" } as Record<string, string>)[action]}.`;
}

/**
 * An explicit decision with a rationale. Approval is refused when it would exceed the remaining budget.
 * A reversal keeps the approved amount on the record and returns it to the remaining budget.
 */
export function decideAllocation(input: unknown, allocation: Row, budget: Row, allocations: Row[], context: Omit<Context, "id">, cases: Row[] = []) {
  const row = objectOf(input, "Decision");
  onlyFields(row, ["expectedRevision", "action", "rationale"]);
  if (!decisionActions.includes(row.action)) invalid(`action must be one of: ${decisionActions.join(", ")}.`);
  const rationale = reasonOf(row.rationale, "rationale");
  const rule = transitions[row.action];
  if (!rule.from.includes(allocation.state)) invalid(transitionRefusal(row.action, allocation.state), 409);
  const requested = BigInt(allocation.requestedCents);
  const remainingBefore = BigInt(budgetTotals(budget, allocations).remainingCents);
  if (row.action === "propose" && requested > BigInt(budget.availableCents)) invalid(`Requested amount ${formatUsd(requested)} is more than this budget's available funds (${formatUsd(budget.availableCents)}). Edit the request first.`, 409);
  if (row.action === "approve" && requested > remainingBefore) {
    invalid(`Approval refused: ${formatUsd(requested)} requested and ${formatUsd(remainingBefore)} remaining in this budget. Approving it would exceed the remaining budget by ${formatUsd(requested - remainingBefore)}. Nothing was changed.`, 409);
  }
  const approvedCents = row.action === "approve" ? allocation.requestedCents : allocation.approvedCents;
  const remainingAfter = row.action === "approve" ? remainingBefore - requested
    : row.action === "reverse" ? remainingBefore + BigInt(allocation.approvedCents) : remainingBefore;
  const revision = budget.revision + 1;
  const before = { state: allocation.state, approvedCents: allocation.approvedCents };
  const after = { state: rule.to, approvedCents };
  const amounts = { remainingBeforeCents: centsFrom(remainingBefore), remainingAfterCents: centsFrom(remainingAfter) };
  const support = allocationSupport(allocation, cases);
  const record = historyEntry({ ...context, id: allocation.id }, row.action, rationale, before, after, {
    fromState: allocation.state, toState: rule.to, budgetRevision: revision, ...amounts, label: simulatedLabel,
    evidenceAtDecision: { caseId: allocation.caseId, evidenceIds: allocation.evidenceIds, assessmentIds: allocation.assessmentIds, gaps: support.gaps },
  });
  const decided = { ...allocation, state: rule.to, approvedCents, history: [...allocation.history, record] };
  return { allocation: decided, budget: { ...budget, revision }, change: { command: "funding-allocation-decided", budgetId: budget.id, allocationId: allocation.id, action: row.action, rationale, before, after, ...amounts, simulated: true } };
}

// ---------- Views ----------

/** What a request relies on, read from its case now. Gaps stay listed; nothing is declared compliant. */
export function allocationSupport(allocation: Row, cases: Row[]) {
  if (!allocation.caseId) return { caseId: null, caseTitle: null, documents: [], assessments: [], gaps: ["No supporting case linked.", "No supporting document linked.", "No reviewer assessment linked."], notice: supportNotice };
  const item = cases.find(candidate => candidate.id === allocation.caseId);
  if (!item) return { caseId: allocation.caseId, caseTitle: null, documents: [], assessments: [], gaps: [`Supporting case ${allocation.caseId} is not in this workspace.`], notice: supportNotice };
  const gaps: string[] = [];
  const documents = allocation.evidenceIds.map((id: string) => {
    const entry = (item.evidence ?? []).find((candidate: Row) => candidate.id === id);
    if (!entry) { gaps.push(`Evidence reference ${id} is no longer on the case.`); return { id, missing: true }; }
    if (entry.verified !== true) gaps.push(`Reference “${entry.title}” is not verified.`);
    return { id, title: entry.title, kind: entry.kind, locator: entry.locator, documentId: /^document:\/\/([^#/?]+)/.exec(entry.locator ?? "")?.[1] ?? null, verified: entry.verified === true };
  });
  if (!documents.length) gaps.push("No supporting document linked.");
  const assessments = allocation.assessmentIds.map((id: string) => {
    const entry = (item.assessments ?? []).find((candidate: Row) => candidate.id === id);
    if (!entry) { gaps.push(`Assessment ${id} is no longer on the case.`); return { id, missing: true }; }
    const sameCheck = (item.assessments ?? []).filter((candidate: Row) => candidate.findingId === entry.findingId);
    const latestForCheck = sameCheck[sameCheck.length - 1]?.id === entry.id;
    if (entry.outcome !== "sufficient-for-stated-check") gaps.push(`The assessment of ${entry.findingId} recorded “${outcomeLabels[entry.outcome] ?? entry.outcome}”.`);
    if (!latestForCheck) gaps.push(`A newer assessment exists for ${entry.findingId}.`);
    return { id, findingId: entry.findingId, outcome: entry.outcome, at: entry.at, latestForCheck };
  });
  if (!assessments.length) gaps.push("No reviewer assessment linked.");
  return { caseId: item.id, caseTitle: item.title, documents, assessments, gaps, notice: supportNotice };
}

function allocationView(allocation: Row, totals: Row, cases: Row[], siblings: Row[]) {
  const open = ["draft", "proposed"].includes(allocation.state);
  const replacement = allocation.state === "reversed" ? siblings.find(entry => entry.replacesAllocationId === allocation.id && entry.state !== "rejected") : undefined;
  const requested = BigInt(allocation.requestedCents);
  const remaining = BigInt(totals.remainingCents);
  return {
    ...allocation, support: allocationSupport(allocation, cases), openReplacementId: replacement?.id ?? null,
    approvalCheck: open ? { remainingCents: totals.remainingCents, fits: requested <= remaining, exceedsByCents: centsFrom(requested > remaining ? requested - remaining : 0n) } : null,
  };
}

/** One budget with its totals over every allocation, and the allocations in the chosen state. */
export function budgetView(budget: Row, allocations: Row[], cases: Row[], status?: string) {
  const mine = allocations.filter(allocation => allocation.budgetId === budget.id);
  const totals = budgetTotals(budget, mine);
  const shown = status ? mine.filter(allocation => allocation.state === status) : mine;
  return { ...budget, totals, allocationCount: mine.length, allocations: shown.map(allocation => allocationView(allocation, totals, cases, mine)) };
}

/** Query filters for the funding list. The status filter narrows the list shown, never the totals. */
export function fundingFilters(entries: [string, string][]) {
  const filters: Row = {};
  const seen = new Set<string>();
  for (const [key, value] of entries) {
    if (!["asOf", "agency", "program", "fiscalYear", "status"].includes(key)) invalid(`Unknown query parameter: ${key.slice(0, 40)}`);
    if (seen.has(key)) invalid(`Repeated query parameter: ${key}`);
    seen.add(key);
    if (key === "asOf" || value === "") continue;
    if (key === "agency") filters.agency = agencyOf(value);
    if (key === "program") filters.program = textOf(value, "program", 160);
    if (key === "fiscalYear") {
      if (!/^\d{4}$/.test(value)) invalid("fiscalYear must be a four-digit fiscal year.");
      filters.fiscalYear = fiscalYearOf(Number(value));
    }
    if (key === "status") {
      if (!allocationStates.includes(value)) invalid(`status must be one of: ${allocationStates.join(", ")}.`);
      filters.status = value;
    }
  }
  return filters;
}

const agencyOrder = (agency: string) => fundingAgencies.indexOf(agency);

/** Budgets and per-agency, per-year totals. VA and SSA amounts are never added together. */
export function fundingOverview(funding: Row, cases: Row[], filters: Row) {
  const budgets = funding.budgets
    .filter((budget: Row) => (!filters.agency || budget.agency === filters.agency) && (!filters.program || budget.program === filters.program) && (filters.fiscalYear === undefined || budget.fiscalYear === filters.fiscalYear))
    .sort((a: Row, b: Row) => agencyOrder(a.agency) - agencyOrder(b.agency) || a.fiscalYear - b.fiscalYear || a.name.localeCompare(b.name))
    .map((budget: Row) => budgetView(budget, funding.allocations, cases, filters.status));
  const groups = new Map<string, Row[]>();
  for (const view of budgets) groups.set(`${view.agency}:${view.fiscalYear}`, [...(groups.get(`${view.agency}:${view.fiscalYear}`) ?? []), view]);
  const summaries = [...groups.values()].map(group => {
    const add = (field: string) => centsFrom(total(group.map(view => view.totals[field])));
    return { agency: group[0].agency, fiscalYear: group[0].fiscalYear, budgetCount: group.length, availableCents: add("availableCents"), proposedCents: add("proposedCents"), approvedCents: add("approvedCents"), remainingCents: add("remainingCents") };
  });
  const programs = [...new Map<string, Row>(funding.budgets.map((budget: Row): [string, Row] => [`${budget.agency}|${budget.program}`, { agency: budget.agency, program: budget.program }])).values()]
    .sort((a: Row, b: Row) => agencyOrder(a.agency) - agencyOrder(b.agency) || a.program.localeCompare(b.program));
  const fiscalYears = [...new Set(funding.budgets.map((budget: Row) => budget.fiscalYear))].sort();
  return { filters, budgets, summaries, options: { programs, fiscalYears } };
}

/** Synthetic VA and SSA cases a request can cite, with the documents and assessments on each. */
export function fundingCases(cases: Row[]) {
  return cases.filter(item => item.provenance === "synthetic" && agencyOfCase(item)).map(item => ({
    id: item.id, title: item.title, agency: agencyOfCase(item),
    evidence: (item.evidence ?? []).map((entry: Row) => ({ id: entry.id, title: entry.title, kind: entry.kind, verified: entry.verified === true })),
    assessments: (item.assessments ?? []).map((entry: Row, index: number, all: Row[]) => ({ id: entry.id, findingId: entry.findingId, outcome: entry.outcome, at: entry.at, latestForCheck: !all.slice(index + 1).some(later => later.findingId === entry.findingId) })),
  }));
}

/** Allocations that cite this case, with their budget and decision history, for the case packet. */
export function caseFundingAllocations(funding: Row, item: Row, cases: Row[]) {
  return funding.allocations.filter((allocation: Row) => allocation.caseId === item.id).map((allocation: Row) => {
    const budget = funding.budgets.find((candidate: Row) => candidate.id === allocation.budgetId) ?? {};
    return { ...allocation, budget: { id: budget.id, name: budget.name, agency: budget.agency, program: budget.program, fiscalYear: budget.fiscalYear, fundingSource: budget.fundingSource }, support: allocationSupport(allocation, cases) };
  });
}

/** Per-budget totals for the audit export. */
export function fundingExportSummary(funding: Row) {
  return {
    budgets: funding.budgets.map((budget: Row) => ({ id: budget.id, name: budget.name, agency: budget.agency, program: budget.program, fiscalYear: budget.fiscalYear, fundingSource: budget.fundingSource, revision: budget.revision, totals: budgetTotals(budget, funding.allocations) })),
    notice: fundingNotice,
  };
}
