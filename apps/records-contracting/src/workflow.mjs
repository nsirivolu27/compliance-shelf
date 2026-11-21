import { randomUUID } from 'node:crypto';
import { applyCaseChange, createDemoCase, expectedRevision, taskQueue, caseSummary } from './lib/core/compliance.ts';
import { newCaseOptions } from './profile.mjs';
import { parseListQuery, queryPage } from './lib/core/catalog.ts';

const routes = [
  { path: /^\/api\/cases\/([^/]+)\/context$/, command: 'context' },
  { path: /^\/api\/cases\/([^/]+)\/records$/, command: 'record-create', created: true },
  { path: /^\/api\/cases\/([^/]+)\/records\/([^/]+)$/, command: 'record-update' },
  { path: /^\/api\/cases\/([^/]+)\/records\/([^/]+)\/hold$/, command: 'record-hold' },
  { path: /^\/api\/cases\/([^/]+)\/evidence\/([^/]+)$/, command: 'evidence-update' },
  { path: /^\/api\/cases\/([^/]+)\/tasks$/, command: 'task-create', created: true },
  { path: /^\/api\/cases\/([^/]+)\/tasks\/([^/]+)$/, command: 'task-update' },
];
const fail = (message, status) => Object.assign(new Error(message), { status });

// This bridge owns IDs and persistence. Validation and workflow decisions stay in core.
export async function handleWorkflow({ pathname, method, readBody, store, asOf, sourcesOf, searchParams = new URLSearchParams(), actor = 'local-demo-operator' }) {
  if (pathname === '/api/tasks') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    const state = store.read(), tasks = taskQueue(state.cases, asOf);
    if (!['q', 'owner', 'status', 'overdue', 'needsFollowUp', 'limit', 'offset', 'workspaceRevision'].some(key => searchParams.has(key))) return { status: 200, body: { asOf, tasks } };
    const result = queryPage(tasks, parseListQuery(searchParams), { revision: state.revision, textFields: ['id', 'title', 'owner', 'caseId', 'caseTitle', 'findingId'], filters: { owner: null, status: ['open', 'in-progress', 'done'], overdue: ['true', 'false'], needsFollowUp: ['true', 'false'] } });
    return { status: 200, body: { asOf, tasks: result.items, pagination: result.pagination } };
  }
  if (pathname === '/api/cases') {
    if (method === 'GET') {
      const state = store.read();
      if (!['q', 'limit', 'offset', 'workspaceRevision'].some(key => searchParams.has(key))) return { status: 200, body: { cases: state.cases } };
      const result = queryPage(state.cases.map(item => ({ ...item, summary: caseSummary(item, asOf) })), parseListQuery(searchParams), { revision: state.revision, textFields: ['title', 'id', 'owner'], filters: {} });
      return { status: 200, body: { cases: result.items, pagination: result.pagination } };
    }
    if (method !== 'POST') throw fail('Method not allowed', 405);
    // A loaded profile supplies the organization and checks for new cases. Existing cases are never changed.
    const { prefix, options } = newCaseOptions(store.read());
    const { item, note } = createDemoCase(await readBody(), `${prefix}-${randomUUID()}`, options);
    const result = await store.mutate('case-created', item.id, state => {
      state.cases.push(item);
      return { case: item, change: { note, before: null, after: item } };
    });
    return { status: 201, body: result };
  }
  for (const route of routes) {
    const match = pathname.match(route.path);
    if (!match) continue;
    if (method !== 'POST') throw fail('Method not allowed', 405);
    const [, caseId, targetId] = match;
    if (!store.read().cases.some(c => c.id === caseId)) throw fail('Case not found', 404);
    const body = await readBody();
    const revision = expectedRevision(body.expectedRevision);
    const result = await store.mutate(route.command, caseId, state => {
      const index = state.cases.findIndex(c => c.id === caseId);
      const { item, change } = applyCaseChange(state.cases[index], route.command, body, { id: randomUUID(), targetId, asOf, sourceIds: sourcesOf(state.cases[index]).map(s => s.id), reviewedAt: new Date().toISOString(), actor });
      state.cases[index] = item;
      return { case: item, change };
    }, { expectedRevision: revision });
    return { status: route.created ? 201 : 200, body: result };
  }
  return null;
}
