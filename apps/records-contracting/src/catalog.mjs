import { journeyFor } from './drafts.mjs';
import { policyContext } from './lib/core/policy.ts';
import { workspaceScreening, recordNeedsReview, findingSearchRows } from './lib/core/compliance.ts';
import { queryPage, parseListQuery } from './lib/core/catalog.ts';

const fail = (message, status) => Object.assign(new Error(message), { status });

export function handleCatalog({ pathname, method, searchParams, state, asOf, sourcesOf, mode = 'local-demo' }) {
  const detail = pathname.match(/^\/api\/cases\/([^/]+)$/);
  if (!detail && !['/api/dashboard', '/api/findings', '/api/records', '/api/activity'].includes(pathname)) return null;
  if (method !== 'GET') throw fail('Method not allowed', 405);
  const query = parseListQuery(searchParams);
  const page = (rows, textFields, filters) => queryPage(rows, query, { revision: state.revision, textFields, filters });
  if (pathname === '/api/activity') {
    // Revisions, rather than timestamps, establish the order of committed writes.
    return { status: 200, body: { asOf, ...page([...state.events].reverse(), ['action', 'caseId', 'actor'], { caseId: null, action: null }) } };
  }
  const computed = workspaceScreening(state.cases, asOf);
  if (pathname === '/api/findings') {
    const result = page(findingSearchRows(state.cases, computed.findings), ['id', 'title', 'caseTitle', 'owner', 'evidenceSearch'], { caseId: null, owner: null, category: ['contracting', 'records', 'policy'], status: ['evidence-present', 'needs-evidence', 'needs-review', 'not-applicable', 'blocked'], hasOpenTask: ['true', 'false'] });
    return { status: 200, body: { asOf, ...result, items: result.items.map(({ evidenceSearch, hasOpenTask, ...finding }) => finding) } };
  }
  if (pathname === '/api/records') {
    const result = page(computed.records.map(record => ({ ...record, needsReview: recordNeedsReview(record) })), ['id', 'title', 'caseTitle', 'owner'], { caseId: null, owner: null, hold: ['active', 'none', 'unknown'], status: ['blocked', 'unknown', 'retain', 'review-due'], needsReview: ['true', 'false'] });
    return { status: 200, body: { asOf, ...result, items: result.items.map(({ needsReview, ...record }) => record) } };
  }
  for (const key of Object.keys(query)) if (key !== 'asOf') throw fail(`Unknown query parameter: ${key}`, 400);
  if (detail) {
    const item = state.cases.find(c => c.id === detail[1]);
    if (!item) throw fail('Case not found', 404);
    const sources = sourcesOf(item);
    const report = computed.reports.find(r => r.caseId === item.id);
    const caseEvents = state.events.filter(e => e.caseId === item.id);
    const lastRun = [...caseEvents].reverse().find(e => e.action === 'analysis-run');
    return { status: 200, body: { case: item, report, tasks: computed.tasks.filter(t => t.caseId === item.id), reviews: state.reviews.filter(r => r.caseId === item.id), recentEvents: caseEvents.slice(-20).reverse(), lastRun: lastRun ?? null, lastRunStale: lastRun ? lastRun.details?.revision !== item.revision : null, policyContext: policyContext(item, report, sources, asOf), journey: journeyFor(state, item, asOf, { report, tasks: computed.tasks.filter(t => t.caseId === item.id), reviews: state.reviews.filter(r => r.caseId === item.id), lastRun: lastRun ?? null, lastRunStale: lastRun ? lastRun.details?.revision !== item.revision : null }), sources: sources.filter(s => report.findings.some(f => f.sourceIds.includes(s.id))), workspaceRevision: state.revision } };
  }
  return { status: 200, body: { asOf, ruleVersion: computed.ruleVersion, workspaceRevision: state.revision, counts: computed.counts, recentEvents: state.events.slice(-10).reverse(), mode } };
}
