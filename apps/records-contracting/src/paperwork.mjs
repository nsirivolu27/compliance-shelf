// Agency paperwork on a case: the catalog, the items a case tracks, and a draft worksheet.
// Reads are computed from stored cases. The two writes add an item or record a person's change to one.
// Nothing here submits, signs, or files anything, and nothing here changes a record, hold, finding, or task.
import { randomUUID } from 'node:crypto';
import { validateCatalog, paperworkReadiness, newPaperworkItem, changePaperworkItem, paperworkWorksheet, paperworkStatuses, paperworkFamilies, paperworkScopes } from './lib/core/paperwork.ts';

function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

const limitation = 'Paperwork readiness counts the required facts that are on file. It is not a compliance rating and does not show that a form is correct or complete. Having every fact on file does not establish compliance and does not authorize disposal. This system never submits, signs, or files anything, and never answers a disposal notice. A worksheet is a draft for a person to check against the current official form. Entries marked as candidates were not confirmed against an agency source.';
const identityOf = trusted => (trusted
  ? { trusted: true, notice: 'Changes are attributed to the signed-in identity.' }
  : { trusted: false, notice: 'Local demo: changes are attributed to the local operator. No one has signed in, so a change does not prove who made it.' });

/** Validates the shipped catalog once at startup, and checks that every shipped preset suggests catalog entries only. */
export function readCatalog(file, presets = []) {
  const catalog = validateCatalog(file);
  const ids = catalog.map(entry => entry.id);
  for (const preset of presets) for (const id of preset.profile.checkSet.paperwork ?? []) if (!ids.includes(id)) throw new Error(`Preset ${preset.summary.id} suggests paperwork that is not in the catalog: ${id}`);
  return catalog;
}

const entrySummary = entry => (entry
  ? { id: entry.id, title: entry.title, formNumber: entry.formNumber, family: entry.family, scope: entry.scope, cadence: entry.cadence, verification: entry.verification, mode: entry.mode, needsRecord: entry.needsRecord, sourceUrl: entry.sourceUrl, ...(entry.benefit ? { benefit: entry.benefit, note: entry.note } : {}) }
  : null);

/** One paperwork item as screens show it: the stored item, its catalog entry, its record, and its computed readiness. */
export function paperworkView(paperwork, catalog, item, asOf) {
  const entry = catalog.find(candidate => candidate.id === paperwork.paperworkId) ?? null;
  const record = paperwork.recordId ? item.records.find(candidate => candidate.id === paperwork.recordId) ?? null : null;
  return { ...paperwork, entry: entrySummary(entry), recordTitle: record?.title ?? null, readiness: paperworkReadiness(paperwork, entry, item, asOf) };
}

/** Counts by readiness state. These are counts of items, never a rating. */
export function paperworkSummary(views) {
  const count = test => views.filter(test).length;
  return {
    total: views.length, blocked: count(view => view.readiness.state === 'blocked'), incomplete: count(view => view.readiness.state === 'incomplete'),
    factsComplete: count(view => view.readiness.state === 'facts-complete'), notTracked: count(view => view.readiness.state === 'not-tracked'),
    overdue: count(view => view.readiness.overdue), needsAttention: count(view => Boolean(view.readiness.attention)), filed: count(view => view.status === 'filed-by-agency'),
  };
}

export async function handlePaperwork({ pathname, method, searchParams = new URLSearchParams(), readBody, store, asOf, catalog, actor, trusted }) {
  const known = pathname === '/api/paperwork' || pathname === '/api/paperwork/items' || /^\/api\/cases\/[A-Za-z0-9_-]+\/paperwork(?:\/|$)/.test(pathname);
  if (known) for (const key of searchParams.keys()) if (key !== 'asOf') throw fail(`Unknown query parameter: ${key}`);
  if (pathname === '/api/paperwork') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    return { status: 200, body: { catalog, enums: { status: paperworkStatuses, family: paperworkFamilies, scope: paperworkScopes, verification: ['seen', 'candidate'], factState: ['present', 'missing', 'blocked'], readiness: ['blocked', 'incomplete', 'facts-complete', 'not-tracked'] }, limitation } };
  }
  // Every tracked item across the workspace, for the paperwork page.
  if (pathname === '/api/paperwork/items') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    const state = store.read();
    const items = state.cases.flatMap(item => (item.paperwork ?? []).map(paperwork => ({ ...paperworkView(paperwork, catalog, item, asOf), caseId: item.id, caseTitle: item.title, organization: item.agency, recordFamily: item.recordFamily ?? null, caseRevision: item.revision ?? 0 })));
    return { status: 200, body: { asOf, workspaceRevision: state.revision, items, summary: paperworkSummary(items), enums: { status: paperworkStatuses }, limitation } };
  }
  const match = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/paperwork(?:\/([A-Za-z0-9_-]+)(\/worksheet)?)?$/);
  if (!match) return null;
  const [, caseId, itemId, worksheet] = match;
  const found = store.read().cases.find(item => item.id === caseId);
  if (!found) throw fail('Case not found', 404);
  const views = item => (item.paperwork ?? []).map(paperwork => paperworkView(paperwork, catalog, item, asOf));
  const one = (item, id) => {
    const paperwork = (item.paperwork ?? []).find(candidate => candidate.id === id);
    if (!paperwork) throw fail('Paperwork item not found', 404);
    return paperwork;
  };

  if (worksheet) {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    const paperwork = one(found, itemId);
    const entry = catalog.find(candidate => candidate.id === paperwork.paperworkId) ?? null;
    return { status: 200, body: { worksheet: paperworkWorksheet(paperwork, entry, found, asOf, new Date().toISOString()), caseRevision: found.revision ?? 0 } };
  }

  if (method === 'GET') {
    if (itemId) return { status: 200, body: { caseId, asOf, caseRevision: found.revision ?? 0, item: paperworkView(one(found, itemId), catalog, found, asOf), identity: identityOf(trusted), limitation } };
    const items = views(found);
    const tracked = items.map(view => view.paperworkId);
    // Suggestions come from the check set the case was created with. Nothing is added until a person adds it.
    const suggested = (found.checkSet?.paperwork ?? []).filter(id => !tracked.includes(id)).map(id => entrySummary(catalog.find(entry => entry.id === id))).filter(Boolean);
    return { status: 200, body: { caseId, asOf, caseRevision: found.revision ?? 0, items, summary: paperworkSummary(items), suggested, enums: { status: paperworkStatuses }, identity: identityOf(trusted), limitation } };
  }

  if (method !== 'POST') throw fail('Method not allowed', 405);
  const body = await readBody();
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw fail('expectedRevision must be a non-negative integer');
  const context = { id: randomUUID(), now: new Date().toISOString(), actor: actor ?? 'local-demo-operator', asOf };
  const result = await store.mutate(itemId ? 'paperwork-changed' : 'paperwork-added', caseId, state => {
    const current = state.cases.find(item => item.id === caseId);
    if (itemId) {
      const { paperwork, change } = changePaperworkItem(body, current, catalog, itemId, context);
      current.paperwork = current.paperwork.map(candidate => (candidate.id === itemId ? paperwork : candidate));
      return { paperworkItemId: itemId, change };
    }
    const { paperwork, note } = newPaperworkItem(body, current, catalog, context);
    current.paperwork = [...(current.paperwork ?? []), paperwork];
    return { paperworkItemId: paperwork.id, change: { command: 'paperwork-added', note, before: null, after: { id: paperwork.id, paperworkId: paperwork.paperworkId, recordId: paperwork.recordId, status: paperwork.status, dueDate: paperwork.dueDate } } };
  }, { expectedRevision: body.expectedRevision });
  const fresh = store.read().cases.find(item => item.id === caseId);
  return { status: itemId ? 200 : 201, body: { item: paperworkView(one(fresh, result.paperworkItemId), catalog, fresh, asOf), change: result.change, case: fresh, identity: identityOf(trusted), limitation } };
}
