// Synthetic program and project funding: budgets, allocation requests and recorded, simulated decisions.
// Every write needs an Idempotency-Key and, after creation, the budget revision it was based on.
// Writes run inside the store's single queue, so the overspend check always sees every earlier approval.
// Nothing here pays, obligates or sends anything, and nothing changes a case, record, hold or finding.
import { randomUUID } from 'node:crypto';
import {
  newBudget, amendBudget, newAllocation, changeAllocation, decideAllocation, budgetView, fundingFilters, fundingOverview,
  fundingCases, caseFundingAllocations, fundingExportSummary, fundingNotice, fundingAgencies, allocationStates, decisionActions,
} from './lib/core/funding.ts';

function fail(message, status = 400, extra = {}) { return Object.assign(new Error(message), { status, ...extra }); }

const identityOf = trusted => (trusted
  ? { trusted: true, notice: 'Decisions are attributed to the signed-in identity. They remain simulated demo decisions.' }
  : { trusted: false, notice: 'Shared demo login: decisions are recorded as the local demo operator and labelled simulated. This is not individual authentication.' });

/** The workspace's funding plan. Workspaces saved before funding existed have none. */
export function fundingOf(state) {
  const funding = state.funding ?? { budgets: [], allocations: [] };
  if (!Array.isArray(funding.budgets) || !Array.isArray(funding.allocations)) throw fail('Saved funding data is unreadable. Preserve the workspace and inspect it.', 500);
  return funding;
}

/** Additive packet fields for a case that funding requests cite. Absent otherwise, so earlier packets keep their shape. */
export function fundingPacketFields(state, item) {
  const allocations = caseFundingAllocations(fundingOf(state), item, state.cases);
  return allocations.length ? { fundingAllocations: allocations, fundingNotice } : {};
}

/** Additive export field once the workspace holds a budget. */
export function fundingExportFields(state) {
  const funding = fundingOf(state);
  return funding.budgets.length ? { fundingSummary: fundingExportSummary(funding) } : {};
}

function expectedRevisionOf(body) {
  if (!Number.isSafeInteger(body?.expectedRevision) || body.expectedRevision < 0) throw fail('expectedRevision must be the budget revision you loaded (a non-negative integer)');
  return body.expectedRevision;
}

function budgetIn(funding, id) {
  const budget = funding.budgets.find(candidate => candidate.id === id);
  if (!budget) throw fail('Budget not found', 404);
  return budget;
}

function allocationIn(funding, id) {
  const allocation = funding.allocations.find(candidate => candidate.id === id);
  if (!allocation) throw fail('Allocation request not found', 404);
  return allocation;
}

function checkRevision(budget, expected) {
  if (budget.revision !== expected) throw fail('This budget changed since you loaded it. Reload, check the latest amounts, and try again.', 409, { currentRevision: budget.revision });
}

const replaceBudget = (funding, budget) => funding.budgets.map(candidate => (candidate.id === budget.id ? budget : candidate));
const replaceAllocation = (funding, allocation) => funding.allocations.map(candidate => (candidate.id === allocation.id ? allocation : candidate));

export async function handleFunding({ pathname, method, searchParams, readBody, store, actor, trusted, hasIdempotencyKey }) {
  if (pathname !== '/api/funding' && !pathname.startsWith('/api/funding/')) return null;
  const identity = identityOf(trusted);
  const enums = { agency: fundingAgencies, state: allocationStates, action: decisionActions };

  if (pathname === '/api/funding') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    const filters = fundingFilters([...searchParams.entries()]);
    const state = store.read();
    return { status: 200, body: { workspaceRevision: state.revision, ...fundingOverview(fundingOf(state), state.cases, filters), cases: fundingCases(state.cases), enums, identity, notice: fundingNotice } };
  }

  const budgetRoute = pathname.match(/^\/api\/funding\/budgets(?:\/([A-Za-z0-9_-]{1,80})(\/allocations)?)?$/);
  const allocationRoute = pathname.match(/^\/api\/funding\/allocations\/([A-Za-z0-9_-]{1,80})(\/decision)?$/);
  if (!budgetRoute && !allocationRoute) throw fail('Route not found', 404);
  for (const key of searchParams.keys()) if (key !== 'asOf') throw fail(`Unknown query parameter: ${key.slice(0, 40)}`);

  if (method === 'GET') {
    if (!budgetRoute?.[1] || budgetRoute[2]) throw fail('Method not allowed', 405);
    const state = store.read();
    return { status: 200, body: { budget: budgetView(budgetIn(fundingOf(state), budgetRoute[1]), fundingOf(state).allocations, state.cases), cases: fundingCases(state.cases), enums, identity, notice: fundingNotice } };
  }
  if (method !== 'POST') throw fail('Method not allowed', 405);
  if (!hasIdempotencyKey) throw fail('Provide an Idempotency-Key header. A funding change is applied once, even when the request is retried.');
  const body = await readBody();
  const context = { now: new Date().toISOString(), actor: actor ?? 'local-demo-operator' };

  // The response always reflects the saved state, including when a retried request returns its stored receipt.
  const respond = (status, change) => {
    const state = store.read();
    const funding = fundingOf(state);
    const view = budgetView(budgetIn(funding, change.budgetId), funding.allocations, state.cases);
    const allocation = change.allocationId ? view.allocations.find(candidate => candidate.id === change.allocationId) : undefined;
    return { status, body: { budget: view, ...(allocation ? { allocation } : {}), change, identity, notice: fundingNotice } };
  };

  if (budgetRoute && !budgetRoute[1]) {
    const change = await store.mutate('funding-budget-created', null, state => {
      const funding = fundingOf(state);
      const { budget, change: result } = newBudget(body, funding.budgets, { ...context, id: `FB-${randomUUID()}` });
      state.funding = { ...funding, budgets: [...funding.budgets, budget] };
      return result;
    });
    return respond(201, change);
  }

  const expected = expectedRevisionOf(body);
  if (budgetRoute && !budgetRoute[2]) {
    budgetIn(fundingOf(store.read()), budgetRoute[1]);
    const change = await store.mutate('funding-budget-amended', null, state => {
      const funding = fundingOf(state);
      const current = budgetIn(funding, budgetRoute[1]);
      checkRevision(current, expected);
      const { budget, change: result } = amendBudget(body, current, funding.allocations, context);
      state.funding = { ...funding, budgets: replaceBudget(funding, budget) };
      return result;
    });
    return respond(200, change);
  }

  if (budgetRoute) {
    budgetIn(fundingOf(store.read()), budgetRoute[1]);
    const change = await store.mutate('funding-allocation-created', null, state => {
      const funding = fundingOf(state);
      const current = budgetIn(funding, budgetRoute[1]);
      checkRevision(current, expected);
      const { allocation, budget, change: result } = newAllocation(body, current, funding.allocations, state.cases, { ...context, id: `FA-${randomUUID()}` });
      state.funding = { budgets: replaceBudget(funding, budget), allocations: [...funding.allocations, allocation] };
      return result;
    });
    return respond(201, change);
  }

  allocationIn(fundingOf(store.read()), allocationRoute[1]);
  const decision = Boolean(allocationRoute[2]);
  const change = await store.mutate(decision ? 'funding-allocation-decided' : 'funding-allocation-edited', null, state => {
    const funding = fundingOf(state);
    const current = allocationIn(funding, allocationRoute[1]);
    const owner = budgetIn(funding, current.budgetId);
    checkRevision(owner, expected);
    const { allocation, budget, change: result } = decision
      ? decideAllocation(body, current, owner, funding.allocations, context, state.cases)
      : changeAllocation(body, current, owner, funding.allocations, state.cases, context);
    state.funding = { budgets: replaceBudget(funding, budget), allocations: replaceAllocation(funding, allocation) };
    return result;
  });
  return respond(200, change);
}
