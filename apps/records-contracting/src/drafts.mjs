import { randomUUID, createHash } from 'node:crypto';
import { analyzeCase, expectedRevision } from './lib/core/compliance.ts';
import { createDraft, reviseDraft, submitDraft, decideDraft, draftView, prepareDraftText, evidenceSnapshot, evidenceHash, caseJourney } from './lib/core/drafts.ts';

const fail = (message, status) => Object.assign(new Error(message), { status });
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const limitation = 'A reviewed draft describes the note only. It does not resolve a finding, verify evidence, release a hold, or authorize destruction.';
const commands = {
  revise: { action: 'review-draft-revised', run: reviseDraft },
  submit: { action: 'review-draft-submitted', run: submitDraft },
  decision: { action: 'review-draft-decided', run: decideDraft },
};

/** Draft views for one case, with staleness computed against the current evidence. */
export function draftViews(state, item, asOf) {
  const report = analyzeCase(item, asOf);
  return (state.drafts ?? []).filter(draft => draft.caseId === item.id).map(draft => draftView(draft, item, report, hash));
}

export function journeyFor(state, item, asOf, context) {
  return caseJourney({ item, report: context.report, tasks: context.tasks, reviews: context.reviews, drafts: draftViews(state, item, asOf), lastRun: context.lastRun, lastRunStale: context.lastRunStale });
}

function identityOf(trusted) {
  return trusted
    ? { trusted: true, notice: 'Authors and reviewers are taken from the signed-in identity. An author cannot review their own note.' }
    : { trusted: false, notice: 'This local demo has no sign-in. Author and reviewer names are typed and are not verified, so a recorded decision does not prove an independent review.' };
}

// Drafts are stored beside the cases. Saving one does not change the case revision,
// so drafting a note never makes the case itself look edited.
export async function handleDrafts({ pathname, method, searchParams, readBody, store, asOf, actor = 'local-demo-operator', trusted = false }) {
  const match = pathname.match(/^\/api\/cases\/([^/]+)\/drafts(?:\/(prepare)|\/([A-Za-z0-9-]+)(?:\/(submit|decision))?)?$/);
  if (!match) return null;
  const [, caseId, prepare, draftId, operation] = match;
  const state = store.read();
  const item = state.cases.find(c => c.id === caseId);
  if (!item) throw fail('Case not found', 404);
  const allowed = prepare ? ['asOf', 'findingIds'] : ['asOf'];
  for (const key of searchParams.keys()) if (!allowed.includes(key)) throw fail(`Unknown query parameter: ${key}`, 400);

  if (method === 'GET') {
    const report = analyzeCase(item, asOf);
    if (prepare) {
      const ids = searchParams.has('findingIds')
        ? searchParams.get('findingIds').split(',').map(id => id.trim()).filter(Boolean)
        : undefined;
      const prepared = prepareDraftText(item, report, ids);
      const snapshot = evidenceSnapshot(item, report, prepared.findingIds);
      return { status: 200, body: { ...prepared, asOf, ruleVersion: report.ruleVersion, caseRevision: item.revision ?? 0, snapshot, evidenceHash: evidenceHash(snapshot, hash), limitation } };
    }
    const views = draftViews(state, item, asOf);
    if (draftId) {
      const view = views.find(draft => draft.id === draftId);
      if (!view) throw fail('Draft not found', 404);
      return { status: 200, body: { draft: view, asOf, identity: identityOf(trusted), limitation } };
    }
    if (operation) throw fail('Method not allowed', 405);
    return { status: 200, body: { asOf, ruleVersion: report.ruleVersion, caseRevision: item.revision ?? 0, drafts: views, identity: identityOf(trusted), limitation } };
  }
  if (method !== 'POST' || prepare) throw fail('Method not allowed', 405);

  const body = await readBody();
  const revision = expectedRevision(body.expectedRevision);
  const context = { id: randomUUID(), now: new Date().toISOString(), actor, trusted, hash };
  const action = draftId ? commands[operation ?? 'revise'].action : 'review-draft-created';
  const result = await store.mutate(action, caseId, next => {
    const current = next.cases.find(c => c.id === caseId);
    const report = analyzeCase(current, asOf);
    next.drafts ??= [];
    if (!draftId) {
      const created = createDraft(body, current, report, context);
      next.drafts.push(created.draft);
      return { draft: draftView(created.draft, current, report, hash), change: created.change };
    }
    const index = next.drafts.findIndex(draft => draft.id === draftId && draft.caseId === caseId);
    if (index < 0) throw fail('Draft not found', 404);
    const changed = commands[operation ?? 'revise'].run(next.drafts[index], body, current, report, context);
    next.drafts[index] = changed.draft;
    return { draft: draftView(changed.draft, current, report, hash), change: changed.change };
  }, { expectedRevision: revision, keepCaseRevision: true });
  return { status: draftId ? 200 : 201, body: { ...result, limitation } };
}
