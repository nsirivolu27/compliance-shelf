import { reviewWorkbench, evidenceLibrary, ruleVersion } from './lib/core/compliance.ts';
import { parseListQuery, queryPage } from './lib/core/catalog.ts';
import { pendingRules } from './lib/core/audit-report.ts';
import { pictureOf } from './documentation.mjs';

/**
 * Recorded sufficiency problems, by finding ID: the same documentation gaps the Documentation tab and the audit report show
 * (not sufficient, needs another review, freshness unknown), with the reviewer's decision on each. Only cases with an
 * assessment are examined. `reviewFor` may ask the document service, exactly as those views do, so the three agree.
 */
async function assessmentIssuesFor(state, asOf, reviewFor) {
  const issues = {};
  if (!reviewFor) return issues;
  for (const item of state.cases) {
    if (!(item.assessments ?? []).length) continue;
    const { gaps } = await pictureOf(item, asOf, reviewFor);
    for (const gap of gaps) {
      if (gap.subjectType !== 'check' || !pendingRules.includes(gap.ruleId)) continue;
      issues[`${item.id}:${gap.subjectId}`] = { gapId: gap.id, ruleId: gap.ruleId, title: gap.title, detail: gap.detail, toClear: gap.toClear, gapStatus: gap.status };
    }
  }
  return issues;
}

export async function handleWorkbench({ pathname, method, searchParams, state, asOf, sources, sourcesOf, reviewFor }) {
  if (!['/api/workbench', '/api/evidence'].includes(pathname)) return null;
  if (method !== 'GET') throw Object.assign(new Error('Method not allowed'), { status: 405 });
  const query = parseListQuery(searchParams);
  let result;
  if (pathname === '/api/workbench') {
    const issues = await assessmentIssuesFor(state, asOf, reviewFor);
    const rows = reviewWorkbench(state.cases, asOf, state.reviews, state.events, issues).map(row => ({ ...row, searchText: [row.caseOwner, ...row.evidence.flatMap(e => [e.title, e.locator]), ...row.tasks.flatMap(t => [t.title, t.owner])].join('\n') }));
    const page = queryPage(rows, query, {
      revision: state.revision, textFields: ['id', 'title', 'caseId', 'caseTitle', 'owner', 'searchText'],
      filters: { caseId: null, owner: null, category: ['contracting', 'records', 'policy'], status: ['evidence-present', 'needs-evidence', 'needs-review', 'not-applicable', 'blocked'], attention: ['preserve-record', 'overdue-task', 'resolve-assessment', 'assign-follow-up', 'follow-up', 'monitor'], hasOpenTask: ['true', 'false'], overdue: ['true', 'false'], needsFollowUp: ['true', 'false'] },
    });
    result = { ...page, items: page.items.map(({ searchText, ...row }) => row) };
  } else {
    result = queryPage(evidenceLibrary(state.cases, asOf), query, {
      revision: state.revision, textFields: ['id', 'title', 'locator', 'caseId', 'caseTitle', 'caseOwner'],
      filters: { caseId: null, kind: ['signed-award', 'funding', 'market-research', 'records-plan'], verificationStatus: ['verified-reference', 'unverified-reference'] },
    });
  }
  const cited = new Set(result.items.flatMap(item => item.sourceIds));
  // `sources` is the workspace discovery list (one entry per ID). `caseSources` gives, for each case on this page
  // that stores its own sources, the ones its rows cite, so a row is never described by another case's source.
  const caseSources = {};
  for (const row of result.items) {
    const item = state.cases.find(candidate => candidate.id === row.caseId);
    if (!item?.checkSet?.sources?.length || caseSources[row.caseId]) continue;
    const citedHere = new Set(result.items.filter(other => other.caseId === row.caseId).flatMap(other => other.sourceIds ?? []));
    const own = item.checkSet.sources.filter(source => citedHere.has(source.id));
    if (own.length) caseSources[row.caseId] = own;
  }
  return { status: 200, body: { asOf, ruleVersion, ...result, sources: sources.filter(source => cited.has(source.id)), ...(Object.keys(caseSources).length ? { caseSources } : {}), limitation: 'Synthetic workspace screening. Reference verification, task completion, and reviewer notes do not certify compliance or authorize record destruction.' } };
}
