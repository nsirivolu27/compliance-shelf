// Documentation completeness, the gap register, and the planning view.
// All three are read models computed from stored cases. The one write, a reviewer's decision on a
// detected gap, is appended to the case and changes no finding, score, hold, or task.
import { randomUUID } from 'node:crypto';
import { analyzeCase, taskQueue } from './lib/core/compliance.ts';
import { queryPage, parseListQuery } from './lib/core/catalog.ts';
import { documentationScore, detectGaps, withDecisions, newGapDecision, planningItems, gapRules, gapDecisions } from './lib/core/documentation.ts';
import { paperworkView } from './paperwork.mjs';

function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

const limitation = 'A gap is a documentation condition found by a rule, such as a missing reference or an undecided hold. It is not a finding of noncompliance, fraud, or wrongdoing. Confirming or dismissing a gap records a reviewer\'s judgment only: it changes no finding, percent, hold, or task. Documentation completeness is not a compliance rating.';
const planningLimitation = 'Dates come only from what is stored: task due dates, record review dates, period end dates, and paperwork due dates a person entered. No reporting window or deadline is computed here. A review date is when a records officer looks at a record; it never authorizes destruction. This view holds no amounts and gives no financial, tax, or legal advice.';
const identityOf = trusted => (trusted
  ? { trusted: true, notice: 'Decisions are attributed to the signed-in identity.' }
  : { trusted: false, notice: 'Local demo: decisions are attributed to the local operator. No one has signed in, so a decision does not prove who made it.' });

/** Score, gaps, and planning items for one case. reviewFor supplies the evidence review, which may ask the document service. */
export async function pictureOf(item, asOf, reviewFor) {
  const report = analyzeCase(item, asOf);
  const review = await reviewFor(item);
  const tasks = taskQueue([item], asOf);
  return { report, review, tasks, score: documentationScore(item, review), gaps: withDecisions(detectGaps(item, review, tasks), item) };
}

const scopeOf = item => ({ caseId: item.id, caseTitle: item.title, organization: item.agency, recordFamily: item.recordFamily ?? null });

/** Paperwork that is not yet filed, as planning entries. The date is the due date a person entered, if any. */
function paperworkNeeds(item, catalog, asOf) {
  const dated = [], undated = [];
  for (const paperwork of item.paperwork ?? []) {
    if (paperwork.status === 'filed-by-agency') continue;
    const view = paperworkView(paperwork, catalog, item, asOf);
    const title = `${view.entry?.formNumber ? `${view.entry.formNumber}: ` : ''}${view.entry?.title ?? 'Paperwork no longer in the catalog'}`;
    const entry = { ...scopeOf(item), type: 'paperwork', id: `${item.id}:paperwork:${paperwork.id}`, title, owner: item.owner ?? null, section: 'paperwork' };
    if (paperwork.dueDate) dated.push({ ...entry, date: paperwork.dueDate, note: view.readiness.overdue ? 'Paperwork past its stored due date.' : 'Paperwork due date entered by a person.' });
    else undated.push({ ...entry, note: 'Open paperwork with no due date.' });
  }
  return { dated, undated };
}

export async function handleDocumentation({ pathname, method, searchParams, readBody, store, asOf, reviewFor, actor, trusted, catalog = [] }) {
  const state = store.read();

  if (pathname === '/api/documentation') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    for (const key of searchParams.keys()) if (key !== 'asOf') throw fail(`Unknown query parameter: ${key}`);
    const cases = [];
    for (const item of state.cases) {
      const { score, gaps } = await pictureOf(item, asOf, reviewFor);
      const { items, limitation: ignored, ...summary } = score;
      cases.push({ ...scopeOf(item), caseRevision: item.revision ?? 0, score: summary, openGaps: gaps.filter(gap => gap.status === 'open').length });
    }
    const complete = cases.reduce((sum, entry) => sum + entry.score.complete, 0);
    const countable = cases.reduce((sum, entry) => sum + entry.score.countable, 0);
    return { status: 200, body: { asOf, workspaceRevision: state.revision, workspace: { label: 'Documentation completeness', complete, countable, percent: countable ? Math.floor((100 * complete) / countable) : null, undecidedChecks: cases.reduce((sum, entry) => sum + entry.score.checks.undecided, 0) }, cases, limitation } };
  }

  if (pathname === '/api/gaps') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    const query = parseListQuery(searchParams);
    const rows = [];
    for (const item of state.cases) {
      const { gaps } = await pictureOf(item, asOf, reviewFor);
      for (const gap of gaps) rows.push({ ...gap, ...scopeOf(item), caseRevision: item.revision ?? 0, searchText: [gap.decision?.note ?? '', item.agency, item.recordFamily ?? ''].join('\n') });
    }
    const page = queryPage(rows, query, {
      revision: state.revision, textFields: ['id', 'title', 'detail', 'subjectTitle', 'caseTitle', 'caseId', 'searchText'],
      filters: { caseId: null, ruleId: Object.keys(gapRules), status: ['open', ...gapDecisions], subjectType: ['check', 'record', 'record-type', 'case', 'task'] },
    });
    return { status: 200, body: { asOf, ...page, items: page.items.map(({ searchText, state: ignored, ...gap }) => gap), rules: Object.entries(gapRules).map(([id, rule]) => ({ id, ...rule })), limitation } };
  }

  if (pathname === '/api/planning') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    for (const key of searchParams.keys()) if (!['asOf', 'caseId'].includes(key)) throw fail(`Unknown query parameter: ${key}`);
    const only = searchParams.get('caseId');
    const dated = [], undated = [];
    for (const item of state.cases) {
      if (only && item.id !== only) continue;
      const result = planningItems(item, analyzeCase(item, asOf), taskQueue([item], asOf));
      const paperwork = paperworkNeeds(item, catalog, asOf);
      dated.push(...result.dated, ...paperwork.dated); undated.push(...result.undated, ...paperwork.undated);
    }
    dated.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    return { status: 200, body: { asOf, workspaceRevision: state.revision, dated: dated.map(entry => ({ ...entry, past: entry.date < asOf })), undated, limitation: planningLimitation } };
  }

  const match = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/(documentation|gap-decisions)$/);
  if (!match) return null;
  const [, caseId, resource] = match;
  const found = state.cases.find(item => item.id === caseId);
  if (!found) throw fail('Case not found', 404);

  if (resource === 'documentation') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    const { score, gaps } = await pictureOf(found, asOf, reviewFor);
    return { status: 200, body: { caseId, asOf, caseRevision: found.revision ?? 0, score, gaps: gaps.map(({ state: ignored, ...gap }) => gap), decisions: found.gapDecisions ?? [], enums: { decision: gapDecisions, status: ['open', ...gapDecisions] }, identity: identityOf(trusted), limitation } };
  }

  if (method !== 'POST') throw fail('Method not allowed', 405);
  const body = await readBody();
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw fail('expectedRevision must be a non-negative integer');
  // Gaps are detected before the write, from the case as it is read now. The revision check inside the write
  // refuses the decision if the case has changed since.
  const { gaps } = await pictureOf(found, asOf, reviewFor);
  const result = await store.mutate('gap-decision-recorded', caseId, current => {
    const item = current.cases.find(candidate => candidate.id === caseId);
    const decision = newGapDecision(body, gaps, { id: randomUUID(), now: new Date().toISOString(), actor: actor ?? 'local-demo-operator', trusted });
    const earlier = (item.gapDecisions ?? []).filter(entry => entry.gapId === decision.gapId);
    const before = earlier.length ? { id: earlier[earlier.length - 1].id, decision: earlier[earlier.length - 1].decision } : null;
    item.gapDecisions = [...(item.gapDecisions ?? []), decision];
    return { decision, case: item, change: { command: 'gap-decision-recorded', note: decision.note, before, after: { id: decision.id, gapId: decision.gapId, decision: decision.decision } } };
  }, { expectedRevision: body.expectedRevision });
  return { status: 201, body: { ...result, case: store.read().cases.find(item => item.id === caseId), identity: identityOf(trusted), limitation } };
}
