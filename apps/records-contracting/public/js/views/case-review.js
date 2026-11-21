// Evidence review for one finding: what material supports this check, where it says
// that, who assessed it, and whether anything changed since.
//
// Four separate facts are shown side by side and never merged:
//   material received, passage linked, reference verified, assessed as sufficient.
// Source text is untrusted. It is only ever placed in the page as text.

import * as api from '../api.js';
import { h, button, status, notice, announce, formatTime, shortId, openReadDialog, locator, errorState } from '../dom.js';
import { openForm, noteField } from '../forms.js';
import { decideGap } from '../case-actions.js';

export const outcomeLabels = {
  'sufficient-for-stated-check': { label: 'Enough evidence for this check', tone: 'ok' },
  insufficient: { label: 'More evidence needed', tone: 'warn' },
  'needs-clarification': { label: 'Needs clarification', tone: 'review' },
};
export const freshnessLabels = {
  current: { label: 'Up to date', tone: 'ok' },
  'needs-review': { label: 'Needs another review', tone: 'warn' },
  'cannot-establish': { label: 'Unable to check for changes', tone: 'review' },
};
const checkLabels = {
  valid: { label: 'Matches the stored document', tone: 'ok' },
  'document-changed': { label: 'Stored document differs', tone: 'warn' },
  'extraction-changed': { label: 'Extracted again since', tone: 'warn' },
  'document-missing': { label: 'Document no longer held', tone: 'warn' },
  'not-checked': { label: 'Not checked just now', tone: 'review' },
};

const lines = location => (location.startLine === location.endLine ? `line ${location.startLine}` : `lines ${location.startLine} to ${location.endLine}`);
const documentIdOf = locator => (/^document:\/\/([A-Za-z0-9_-]+)/.exec(locator || '') || [])[1] || null;

// ---------- Paged reads ----------

// The document service returns at most 100 items per request. These helpers follow
// nextOffset so later pages are never silently dropped. They stop at a fixed bound
// and report that they stopped, so a very large list is labelled as incomplete.
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

async function allPages(fetchPage) {
  const items = [];
  let first = null;
  let offset = 0;
  for (let count = 0; count < MAX_PAGES; count++) {
    const page = await fetchPage(offset);
    first ??= page;
    items.push(...page.items);
    if (page.pagination.nextOffset === null) return { first, items, complete: true };
    offset = page.pagination.nextOffset;
  }
  return { first, items, complete: false };
}

const allSpans = documentId => allPages(offset => api.getDocumentSpans(documentId, { limit: PAGE_SIZE, offset }));
const allDocuments = caseId => allPages(offset => api.getDocuments({ caseId, limit: PAGE_SIZE, offset }));

// Looks for one span, page by page, and stops as soon as it is found.
async function findSpan(documentId, spanId) {
  let offset = 0;
  let sha256 = null;
  for (let count = 0; count < MAX_PAGES; count++) {
    const page = await api.getDocumentSpans(documentId, { limit: PAGE_SIZE, offset });
    sha256 ??= page.sha256;
    const span = page.items.find(entry => entry.id === spanId);
    if (span) return { span, sha256, searchedAll: true };
    if (page.pagination.nextOffset === null) return { span: null, sha256, searchedAll: true };
    offset = page.pagination.nextOffset;
  }
  return { span: null, sha256, searchedAll: false };
}

// ---------- Passage in context ----------

// Shows the stored span with the quoted passage marked. Text nodes only: nothing in the document is interpreted.
async function showContext(citation, target) {
  target.replaceChildren(h('p', { class: 'hint' }, 'Loading the stored passage…'));
  try {
    const { span, sha256, searchedAll } = await findSpan(citation.documentId, citation.location.spanId);
    // Three different situations, each said plainly: a different document version, a part that is
    // not in the stored extraction, and a document too large to search fully.
    if (sha256 !== citation.sha256) {
      target.replaceChildren(h('p', { class: 'hint' }, 'The stored document is not the version that was cited, so the passage is not shown in context.'));
      return;
    }
    if (!span) {
      target.replaceChildren(h('p', { class: 'hint' }, searchedAll
        ? `The stored extraction of this document has no part named ${citation.location.spanId}. The citation is shown as it was recorded.`
        : `The cited part was not found in the first ${PAGE_SIZE * MAX_PAGES} parts of this document, and the search stops there. The citation is shown as it was recorded.`));
      return;
    }
    const from = citation.location.startOffset - span.startOffset;
    const to = citation.location.endOffset - span.startOffset;
    if (span.text.slice(from, to) !== citation.quote) {
      target.replaceChildren(h('p', { class: 'hint' }, 'The stored text at that location no longer matches the quoted passage.'));
      return;
    }
    target.replaceChildren(
      h('p', { class: 'hint' }, `Stored text, lines ${span.startLine} to ${span.endLine}. Shown as plain text. Nothing in it is treated as an instruction.`),
      h('pre', { class: 'span-text', tabindex: '0', 'aria-label': 'Passage in context' }, span.text.slice(0, from), h('mark', null, span.text.slice(from, to)), span.text.slice(to)));
  } catch (error) {
    target.replaceChildren(errorState(error, () => showContext(citation, target)));
  }
}

// ---------- Forms ----------

// Three small steps: choose the document, choose the span, then trim the quote to the exact passage.
export async function attachPassage(handle, finding, evidence, replaces = null) {
  let documents;
  let documentsComplete = true;
  try {
    const listed = await allDocuments(handle.id);
    documents = listed.items;
    documentsComplete = listed.complete;
  } catch (error) {
    const dialog = openReadDialog('Documents could not be loaded', errorState(error, () => { dialog.close(); attachPassage(handle, finding, evidence, replaces); }));
    return;
  }
  const ready = documents.filter(document => document.status === 'ready');
  if (ready.length === 0) {
    announce(documents.length ? 'The documents for this case are not ready to read yet.' : 'No documents have been added to this case. Add one under Documents.');
    return;
  }
  const preferred = replaces?.documentId || documentIdOf(evidence.locator);
  openForm({
    waitFor: () => handle.loading,
    title: replaces ? 'Correct the passage: choose the document' : 'Attach a passage: choose the document',
    intro: `For "${evidence.title}". Only documents ready to read are listed. PDF and scanned files are not supported.${documentsComplete ? '' : ` Only the first ${PAGE_SIZE * MAX_PAGES} documents of this case are listed.`}`,
    submitLabel: 'Continue',
    fields: [{ name: 'documentId', type: 'select', label: 'Document', required: true, value: ready.some(document => document.id === preferred) ? preferred : ready[0].id,
      options: ready.map(document => ({ value: document.id, label: `${document.title} (${document.filename})` })) }],
    // Every part of the document is loaded, not only the first page of parts.
    submit: async values => {
      const listed = await allSpans(values.documentId);
      return { document: ready.find(document => document.id === values.documentId), spans: { items: listed.items, sha256: listed.first.sha256, total: listed.first.pagination.total, complete: listed.complete } };
    },
    onSuccess: ({ document, spans }) => chooseSpan(handle, finding, evidence, replaces, document, spans),
  });
}

function chooseSpan(handle, finding, evidence, replaces, document, spans) {
  const quoteStep = span => openForm({
    title: 'Quote the exact passage',
    intro: `From "${document.title}", lines ${span.startLine} to ${span.endLine}. Trim the text to the passage that supports this check. It must match the stored text exactly, and the server checks it.`,
    submitLabel: replaces ? 'Save corrected passage' : 'Link passage',
    fields: [
      { name: 'quote', type: 'textarea', label: 'Quoted passage', value: span.text.length <= 2000 ? span.text.trimEnd() : '', required: true, minlength: 3, maxlength: 2000, rows: 8,
        hint: 'Copied from the stored text. Do not retype or paraphrase.' },
      noteField(replaces ? 'Why the passage is being corrected' : 'Why this passage supports the check'),
    ],
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note, findingId: finding.id, evidenceId: evidence.id,
        documentId: document.id, sha256: spans.sha256, spanId: span.id, quote: values.quote, ...(replaces ? { replaces: replaces.id } : {}) };
      return api.linkCitation(handle.id, body, keyFor(body));
    },
    onConflict: () => handle.load(),
    onSuccess: async () => {
      await handle.load();
      // Say what is actually true of the reference: linking a passage neither verifies nor unverifies it.
      const verifiedNow = handle.detail.case.evidence.find(entry => entry.id === evidence.id)?.verified;
      announce(replaces ? 'Passage corrected. The earlier passage stays in the history.'
        : verifiedNow ? 'Passage linked. The reference was checked; you still need to decide whether it is enough evidence.'
        : 'Passage linked. The reference is still unverified until a reviewer verifies it.');
    },
  });
  if (spans.items.length === 1) return quoteStep(spans.items[0]);
  openForm({
    title: 'Choose the part of the document',
    intro: `"${document.title}" is stored in ${spans.total} parts. Choose the part that holds the passage.${spans.complete ? '' : ` Only the first ${spans.items.length} parts are listed.`}`,
    submitLabel: 'Continue',
    fields: [{ name: 'spanId', type: 'select', label: 'Part', required: true, value: replaces?.location.spanId && spans.items.some(span => span.id === replaces.location.spanId) ? replaces.location.spanId : spans.items[0].id,
      options: spans.items.map(span => ({ value: span.id, label: `Lines ${span.startLine} to ${span.endLine}: ${span.text.trim().slice(0, 60)}` })) }],
    submit: async values => spans.items.find(span => span.id === values.spanId),
    onSuccess: quoteStep,
  });
}

export function recordAssessment(handle, finding, entry) {
  const identity = handle.evidenceReview?.identity;
  openForm({
    title: 'Review the evidence',
    draftKey: `${handle.id}:${finding.id}:assessment`,
    waitFor: () => handle.loading,
    getRevision: () => handle.revision,
    currentValues: () => {
      const saved = handle.evidenceReview?.findings.find(row => row.findingId === finding.id)?.currentAssessment;
      return saved ? { outcome: saved.outcome, rationale: saved.rationale, evidenceIds: saved.evidenceIds, revision: handle.revision } : { assessment: 'Not reviewed yet', revision: handle.revision };
    },
    intro: `For the check "${finding.title}" only. Your decision is saved with the evidence and sources you reviewed. It does not approve the case, complete a task, or release a records hold. ${identity?.notice || ''}`,
    submitLabel: 'Save evidence review',
    fields: [
      { name: 'evidenceIds', type: 'checks', label: 'Evidence reviewed', shortLabel: 'Evidence', value: entry.evidence.map(evidence => evidence.id),
        options: entry.evidence.map(evidence => ({ value: evidence.id, label: `${evidence.title} (${evidence.passage === 'attached' ? 'passage attached' : 'reference only, no passage'}${evidence.verified ? ', reference verified' : ', reference unverified'})` })) },
      { name: 'outcome', type: 'select', label: 'Review decision', required: true, value: 'needs-clarification',
        options: Object.entries(outcomeLabels).map(([value, { label }]) => ({ value, label })) },
      { name: 'rationale', type: 'textarea', label: 'Reason for your decision', required: true, minlength: 10, maxlength: 2000, rows: 5,
        hint: 'Explain what the evidence shows and what is still missing. At least 10 characters.' },
    ],
    submit: (values, keyFor, expectedRevision) => {
      const body = { expectedRevision, findingId: finding.id, evidenceIds: values.evidenceIds || [], outcome: values.outcome, rationale: values.rationale };
      return api.recordAssessment(handle.id, body, keyFor(body));
    },
    onConflict: () => handle.load(),
    onSuccess: async () => {
      await handle.load();
      announce('Evidence review saved. Tasks and record holds are unchanged.');
    },
  });
}

// ---------- Display ----------

function citationBlock(handle, finding, evidence, citation) {
  const context = h('div', { class: 'passage-context' });
  const inspect = () => {
    const passage = h('section', null, h('h3', null, 'Passage in stored source'), context);
    const source = h('section', null, h('h3', null, 'Source reference'),
      h('p', null, evidence.title), h('p', { class: 'wrap' }, locator(evidence.locator)),
      h('p', { class: 'wrap mono' }, `SHA-256 ${citation.sha256}`),
      h('p', null, lines(citation.location)),
      h('blockquote', { class: 'passage-quote' }, citation.quote),
      h('p', null, status(checkLabels, citation.check.status), ' ', citation.check.message));
    openReadDialog('Inspect passage and source', h('div', { class: 'passage-columns' }, passage, source));
    showContext(citation, context);
  };
  return h('div', { class: 'passage' },
    h('blockquote', { class: 'passage-quote' }, citation.quote),
    h('p', { class: 'hint' },
      `Document ${shortId(citation.documentId)}, ${lines(citation.location)}, ${citation.location.spanId}. File fingerprint ${citation.sha256.slice(0, 12)}…. Linked ${formatTime(citation.createdAt)} by ${citation.actor}.`),
    h('p', { class: 'hint' }, status(checkLabels, citation.check.status), `. ${citation.check.message}`),
    citation.state === 'active' && h('p', { class: 'button-row' },
      button('Show in context', inspect, 'button-small', `cite-context-${citation.id}`),
      button('Correct passage', () => attachPassage(handle, finding, evidence, citation), 'button-small', `cite-correct-${citation.id}`)),
    );
}

function assessmentBlock(assessment) {
  const fresh = assessment.freshness;
  return h('div', { class: 'assessment' },
    h('p', null, status(outcomeLabels, assessment.outcome), ' · ', status(freshnessLabels, fresh.state)),
    h('p', { class: 'wrap' }, assessment.rationale),
    fresh.causes.length > 0 && h('ul', { class: 'plain-list' }, fresh.causes.map(cause => h('li', null, cause.message))),
    h('p', { class: 'hint' },
      `${formatTime(assessment.at)} by ${assessment.actor}. `,
      assessment.identity === 'verified' ? 'Signed-in identity. ' : 'Demo user; identity not verified. ',
      assessment.snapshot
        ? `Saved with case version ${assessment.snapshot.caseRevision}, ${assessment.snapshot.evidence.length} evidence, ${assessment.snapshot.citations.length} ${assessment.snapshot.citations.length === 1 ? 'passage' : 'passages'}.`
        : 'Recorded without a snapshot.'));
}

// A recorded sufficiency problem stays open in the review queue. This shows that link where the assessment is read,
// and offers the documentation-gap decision right here instead of on a separate page. The reason box starts with the
// assessment's own evidence and rationale; the reviewer still chooses Confirm or Dismiss and edits the reason.
function assessmentFollowUp(handle, finding, entry) {
  const issue = handle.rows?.get(finding.id)?.assessmentIssue;
  if (!issue) return null;
  const decided = {
    open: 'Not yet confirmed as a documentation gap.',
    confirmed: 'A reviewer confirmed it as a documentation gap.',
    dismissed: 'A reviewer dismissed this issue. The evidence review is unchanged.',
  }[issue.gapStatus] ?? '';
  const current = entry.currentAssessment;
  const assessed = current ? entry.evidence.filter(evidence => (current.evidenceIds ?? []).includes(evidence.id)).map(evidence => evidence.title) : [];
  const prefill = current
    ? `Review on ${formatTime(current.at)} (${outcomeLabels[current.outcome]?.label || current.outcome}). Evidence reviewed: ${assessed.join('; ') || 'none listed'}. Reason: ${current.rationale}`
    : '';
  const decide = () => decideGap(handle.id, handle.revision, { id: issue.gapId, title: issue.title, detail: issue.detail, decision: null },
    async () => { await handle.load(); announce('Decision saved. The evidence review, check, and records hold are unchanged.'); },
    () => handle.load(), { note: prefill.slice(0, 2000) });
  return h('div', { class: 'notice notice-warn' },
    h('p', { class: 'notice-title' }, 'Evidence issue still open'),
    h('p', null, decided),
    h('p', { class: 'hint' }, 'Next: add the missing evidence, then review it again.'),
    issue.gapStatus !== 'confirmed' && h('p', null, button(issue.gapStatus === 'dismissed' ? 'Review the gap decision again' : 'Decide whether follow-up is needed', decide, 'button-small', 'assessment-gap-decision')));
}

// The "Passages and sufficiency" part of a finding panel.
export function reviewSection(handle, finding) {
  const review = handle.evidenceReview;
  if (!review) return [h('p', { class: 'hint' }, 'Passages and reviews could not be loaded.')];
  const entry = review.findings.find(candidate => candidate.findingId === finding.id);
  if (!entry) return [h('p', { class: 'hint' }, 'This check does not use evidence references, so there is nothing to cite or assess.')];
  const canLink = review.documents.status === 'available';
  const earlier = entry.assessments.slice(0, -1).reverse();

  return [
    h('div', { class: 'review-dimensions' },
      h('section', null, h('h4', null, 'Does this check apply?'),
        status({ yes: { label: 'Applies', tone: 'info' }, no: { label: 'Does not apply', tone: 'muted' }, unknown: { label: 'Unknown', tone: 'review' } }, handle.detail.case.applicability[finding.id.slice(handle.id.length + 1)])),
      h('section', null, h('h4', null, 'Reference checks'),
        entry.evidence.length ? entry.evidence.map(evidence => h('p', null, evidence.title, ': ', evidence.verified ? 'Reference checked' : 'Reference not checked')) : h('p', null, 'No reference supplied')),
      h('section', null, h('h4', null, 'Review decision'), entry.currentAssessment ? status(outcomeLabels, entry.currentAssessment.outcome) : h('span', { class: 'missing' }, 'Not reviewed yet')),
      h('section', null, h('h4', null, 'Has the evidence changed?'), entry.currentAssessment
        ? [status(freshnessLabels, entry.currentAssessment.freshness.state), ...entry.currentAssessment.freshness.causes.map(cause => h('p', null, cause.message)),
          entry.currentAssessment.freshness.causes.length === 0 && h('p', { class: 'hint' }, 'No changes detected since this review.')]
        : h('p', { class: 'missing' }, 'Review the evidence first.'))),
    review.documents.status !== 'available' && notice('info', review.documents.status === 'not-configured' ? 'Passages are unavailable in this mode.' : 'Stored documents could not be checked just now.', review.documents.message),
    entry.evidence.length === 0
      ? h('p', { class: 'hint' }, 'No evidence reference is supplied for this check, so there is nothing to cite yet.')
      : h('ul', { class: 'item-list' }, entry.evidence.map(evidence => {
          const active = evidence.citations.filter(citation => citation.state === 'active');
          const replaced = evidence.citations.filter(citation => citation.state === 'replaced');
          return h('li', null,
            h('div', { class: 'line' },
              h('span', null, evidence.title),
              canLink && button('Attach passage', () => attachPassage(handle, finding, evidence), 'button-small', `cite-add-${evidence.id}`)),
            h('p', { class: 'hint' }, evidence.verified ? 'Reference verified. ' : 'Reference not verified. ',
              active.length === 0 ? 'No document passage is attached. This is a reference only.' : `${active.length} ${active.length === 1 ? 'passage' : 'passages'} attached.`),
            ...active.map(citation => citationBlock(handle, finding, evidence, citation)),
            replaced.length > 0 && h('details', null,
              h('summary', null, `Earlier passages (${replaced.length})`),
              ...replaced.map(citation => citationBlock(handle, finding, evidence, citation))));
        })),
    h('h4', { class: 'subhead' }, 'Evidence review'),
    entry.currentAssessment ? assessmentBlock(entry.currentAssessment) : h('p', { class: 'hint' }, 'Decide whether the supplied evidence is enough for this check.'),
    h('p', null, button(entry.currentAssessment ? 'Review updated evidence' : 'Save evidence review', () => recordAssessment(handle, finding, entry), 'button-small', 'assess-add')),
    assessmentFollowUp(handle, finding, entry),
    earlier.length > 0 && h('details', null,
      h('summary', null, `Earlier reviews (${earlier.length})`),
      ...earlier.map(assessmentBlock)),
    h('p', { class: 'hint' }, 'A document can exist without being enough evidence. This review is not a compliance approval.'),
  ].filter(Boolean);
}
