// Detail panels shown beside a table: a finding, a record, and an evidence reference.
// Each reads from a loaded case and offers the actions that apply to it.

import * as api from './api.js';
import { workflowText, 
  h, button, status, facts, citations, locator, notice, announce, containDialogFocus, errorState, findingStatus, retentionStatus, holdStatus, taskStatus,
  applicabilityLabels, evidenceKinds, dispositions, categoryLabels, areaLabel, deciderLabel, caseSources, actionLabels, draftStates, describeEvent, formatDay, formatTime, shortId,
} from './dom.js';
import { downloadText } from './csv.js';
import * as actions from './case-actions.js';
import { reviewSection } from './views/case-review.js';

// ---------- Inspector shell ----------

// Remembers the last focused control outside a panel or form. Opening a panel redraws
// the table, so the opener is found again by its id when the panel closes.
let lastFocusId = null;
document.addEventListener('focusin', event => {
  if (event.target.id && !event.target.closest('.inspector, dialog')) lastFocusId = event.target.id;
});

// Keep already-open inspectors modal when the viewport crosses the breakpoint.
// One listener covers every route; detached panels are never retained by a listener.
window.matchMedia('(max-width: 1099px)').addEventListener('change', () => {
  for (const panel of document.querySelectorAll('dialog.inspector[open]')) {
    const focused = document.activeElement;
    panel.close();
    if (window.innerWidth < 1100 && !document.querySelector('dialog.drawer[open]')) panel.showModal();
    else panel.show();
    (panel.contains(focused) ? focused : panel.querySelector('h2'))?.focus();
  }
});

// A panel that sits to the right of a table on wide screens and covers the page on narrow ones.
export function createInspector(onClose) {
  const title = h('h2', { id: 'inspector-title', tabindex: '-1' });
  const body = h('div', { class: 'inspector-body' });
  const el = h('dialog', { class: 'inspector', 'aria-labelledby': 'inspector-title', hidden: true },
    h('div', { class: 'inspector-head' }, title, h('button', { type: 'button', class: 'button button-quiet', onclick: () => close() }, 'Close')),
    body);
  let openerId = null;
  containDialogFocus(el);
  el.addEventListener('cancel', event => { event.preventDefault(); close(); });

  function show(titleText, content, { focus = true } = {}) {
    // A reload can redraw this panel while a form is open over it. Closing and reopening the panel's
    // dialog would move focus out of that form, so note where focus is and put it back afterwards.
    const formFocus = document.activeElement?.closest('dialog.drawer[open]') ? document.activeElement : null;
    // Redrawing the same item after a save keeps the reader's place, so the next button stays where it was.
    const sameItem = !el.hidden && title.textContent === titleText;
    const keepScroll = sameItem ? el.scrollTop : 0;
    // A keyboard user may be on a button inside the panel when it is redrawn. Put focus on the new copy of it.
    const panelFocusId = sameItem && el.contains(document.activeElement) ? document.activeElement.id : '';
    if (el.hidden) openerId = lastFocusId;
    title.textContent = titleText;
    body.replaceChildren(content);
    el.hidden = false;
    el.parentElement?.classList.add('has-inspector');
    // Reconnecting a dialog during a redraw can remove it from the top layer.
    if (el.open) el.close();
    if (window.innerWidth < 1100 && !document.querySelector('dialog.drawer[open]')) el.showModal();
    else el.show();
    el.scrollTop = keepScroll;
    const redrawnControl = panelFocusId && el.querySelector(`[id="${CSS.escape(panelFocusId)}"]`);
    if (formFocus) {
      if (formFocus.isConnected && document.activeElement !== formFocus) formFocus.focus({ preventScroll: true });
    } else if (redrawnControl) {
      redrawnControl.focus({ preventScroll: true });
    } else if (focus) {
      title.focus();
    }
  }

  function close() {
    if (el.hidden) return;
    el.close();
    el.hidden = true;
    el.parentElement?.classList.remove('has-inspector');
    onClose?.();
    (openerId && document.getElementById(openerId))?.focus();
  }

  el.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });

  return { el, show, close, get isOpen() { return !el.hidden; } };
}

// ---------- Shared pieces ----------

const section = (heading, ...content) => h('section', { class: 'panel-section' }, h('h3', null, heading), content);
const missing = text => h('span', { class: 'missing' }, text);
const caseLine = item => h('p', { class: 'hint' },
  h('a', { href: `#/cases/${encodeURIComponent(item.id)}` }, item.title), ` · ${shortId(item.id)} · Synthetic case`);

export const attentionLabels = {
  'preserve-record': { label: 'Preserve record', tone: 'block' },
  'overdue-task': { label: 'Overdue task', tone: 'warn' },
  'resolve-assessment': { label: 'Evidence needs review', tone: 'warn' },
  'assign-follow-up': { label: 'Needs assignment', tone: 'review' },
  'follow-up': { label: 'Follow-up assigned', tone: 'info' },
  'monitor': { label: 'Monitoring', tone: 'muted' },
};

export const verificationLabels = {
  'verified-reference': { label: 'Reference checked', tone: 'ok' },
  'unverified-reference': { label: 'Reference not checked', tone: 'review' },
};

const verificationOf = entry => (entry.verified && entry.locator.trim() ? 'verified-reference' : 'unverified-reference');

function taskLine(handle, task) {
  return h('li', null,
    h('div', { class: 'line' },
      h('span', null, task.title),
      button('Update', () => actions.editTask(handle, task), 'button-small', `task-edit-${task.id}`)),
    h('p', { class: 'hint' }, status(taskStatus, task.status), ` · Assigned to ${task.owner} · ${task.dueDate ? `due ${formatDay(task.dueDate)}` : 'no due date'}${task.overdue ? ' · overdue' : ''}`),
    task.status === 'done' && task.needsFollowUp && h('p', { class: 'hint' }, 'Done, but the finding is still open.'));
}

// Hold reviews saved on the record itself, oldest first as stored.
function holdHistory(record) {
  const reviews = record.holdReviews || [];
  if (reviews.length === 0) {
    return h('p', { class: 'hint' }, 'No hold review is saved on this record. The current status came with the case data or predates saved reviews.');
  }
  return h('ul', { class: 'item-list' }, [...reviews].reverse().map(review => h('li', null,
    h('p', null, h('strong', null, `Reviewed as ${holdStatus[review.status]?.label || review.status}`)),
    h('p', { class: 'wrap' }, review.note),
    h('p', { class: 'hint wrap' }, 'Review reference: ', locator(String(review.reference)),
      review.releaseReference ? [' · Release authorization: ', locator(String(review.releaseReference))] : null),
    h('p', { class: 'hint' }, `${formatTime(review.reviewedAt)} · ${review.actor}`))));
}

// Downloads the server's per-case packet exactly as returned.
function packetButton(caseId, id) {
  const problem = h('p', { class: 'field-error', hidden: true });
  const control = h('button', { type: 'button', class: 'button button-small', id }, 'Download case packet');
  control.addEventListener('click', async () => {
    control.setAttribute('aria-disabled', 'true');
    problem.hidden = true;
    try {
      const response = await api.getCasePacket(caseId);
      const stamp = String(response.body.exportedAt).replace(/[:.]/g, '-');
      downloadText(`Compliance Shelf case packet ${shortId(caseId).replace('…', '')} ${stamp}.json`, response.text, 'application/json');
      announce('Case packet downloaded. Its digest detects accidental change only. It is not a tamper-proof seal.');
    } catch (error) {
      problem.textContent = error.offline ? 'The packet was not downloaded. The local server could not be reached.' : `The packet was not downloaded. ${error.message}`;
      problem.hidden = false;
    }
    control.removeAttribute('aria-disabled');
  });
  return h('div', null, control, problem);
}

// The newest entries of the case's audit trail, read from the activity endpoint.
function recentActivity(caseId) {
  const box = h('div', null, h('p', { class: 'hint' }, 'Loading recent activity…'));
  const load = () => api.getActivity({ caseId, limit: 5 }).then(result => {
    box.replaceChildren(result.items.length === 0
      ? h('p', { class: 'hint' }, 'Nothing has been logged for this case yet.')
      : h('ul', { class: 'item-list' }, result.items.map(event => {
          const { subject } = describeEvent(event);
          return h('li', null,
            h('p', { class: 'wrap' }, actionLabels[event.action] || event.action, subject ? `: ${subject}` : ''),
            h('p', { class: 'hint' }, formatTime(event.at)));
        })),
      h('p', { class: 'hint' }, h('a', { href: `#/cases/${encodeURIComponent(caseId)}/history` }, `All ${result.pagination.total} entries for this case`)));
  }).catch(error => box.replaceChildren(errorState(error, load)));
  load();
  return box;
}

function evidenceLine(handle, entry) {
  return h('li', null,
    h('div', { class: 'line' },
      h('span', null, entry.title),
      h('span', { class: 'button-row' },
        verificationOf(entry) !== 'verified-reference' && button('Verify', () => actions.verifyEvidence(handle, entry), 'button-small', `ev-verify-${entry.id}`),
        button('Correct', () => actions.correctEvidence(handle, entry), 'button-small', `ev-correct-${entry.id}`))),
    h('p', { class: 'hint' }, verificationLabels[verificationOf(entry)].label, ' · ', locator(entry.locator)));
}

// ---------- Finding ----------

export function findingPanel(handle, findingId, ctx, { showCase = false } = {}) {
  const detail = handle.detail;
  const finding = detail.report.findings.find(entry => entry.id === findingId);
  if (!finding) return null;

  const item = detail.case;
  const row = handle.rows.get(findingId);
  const kind = finding.category === 'contracting' ? finding.id.slice(item.id.length + 1) : null;
  const evidence = item.evidence.filter(entry => finding.evidenceIds.includes(entry.id));
  const tasks = detail.tasks.filter(task => task.findingId === finding.id);
  const reviews = detail.reviews.filter(review => review.findingId === finding.id);
  const atLastRun = detail.lastRun?.details?.findings?.find(entry => entry.id === finding.id);
  const record = finding.category === 'records' ? item.records.find(entry => `${item.id}:record:${entry.id}` === finding.id) : null;
  const computed = record && detail.report.records.find(entry => entry.id === record.id);
  const latest = row?.lastReview;
  const drafts = handle.drafts.filter(draft => draft.findingIds.includes(finding.id));

  const freshness = {
    true: 'The case has changed since this note was written, so it may not reflect the current data.',
    false: 'Written against the current case revision.',
    null: 'Freshness is not available for this note.',
  }[String(row?.lastReviewStale ?? null)];

  const node = h('div', null,
    showCase && caseLine(item),
    h('p', { class: 'panel-status' }, status(findingStatus, finding.status), ` · ${areaLabel(finding, item)}`),
    h('p', null, finding.status === 'evidence-present' ? 'A reviewer checked that a reference exists. Review the evidence below to decide whether it meets this check.' : workflowText(finding.explanation)),
    finding.status === 'blocked' && h('p', { class: 'emphasis-block' }, 'The record stays preserved. A retention date never overrides an active hold.'),
    facts([
      ['Next action', row?.assessmentIssue ? 'Request the missing evidence, then review it again.' : workflowText(finding.nextAction)],
      row && ['What needs attention', row.assessmentIssue ? 'The evidence review is still open. Add the missing evidence and review it again.' : `${attentionLabels[row.attention]?.label || row.attention}. ${row.attentionReason}`],
      ['Responsible owner', record ? (record.owner?.trim() ? `${record.owner} (record owner)` : missing('No record owner assigned')) : `${item.owner} (case owner)`],
      kind && ['Does this check apply?', h('span', null, applicabilityLabels[item.applicability[kind]],
        item.applicability[kind] === 'unknown' ? `. Not yet decided by ${deciderLabel(item)}.` : '', ' ',
        button('Change', () => actions.editCase(handle, caseSources(ctx, item)), 'button-link', 'finding-applicability'))],
      atLastRun && atLastRun.status !== finding.status && ['At last logged run', findingStatus[atLastRun.status]?.label],
    ]),

    section('Evidence',
      kind && (evidence.length === 0
        ? h('p', { class: 'hint' }, 'No reference supplied in this workspace. That does not show the document is missing from agency files.')
        : h('ul', { class: 'item-list' }, evidence.map(entry => evidenceLine(handle, entry)))),
      kind && h('p', { class: 'hint' }, 'A verified reference means a reviewer confirmed the reference exists. It is not approval of the document or a compliance certification.'),
      kind && h('p', null, button('Add reference', () => actions.addEvidence(handle, kind), 'button-small', 'finding-add-evidence')),
      !kind && h('p', { class: 'hint' }, 'This check does not use evidence references.'),
      citations(finding.sourceIds, caseSources(ctx, item))),

    kind && section('Supporting passages and review', ...reviewSection(handle, finding)),

    section('Follow-up',
      tasks.length === 0
        ? h('p', { class: 'hint' }, 'No tasks for this finding. Task assignees are separate from the responsible owner.')
        : h('ul', { class: 'item-list' }, tasks.map(task => taskLine(handle, task))),
      h('p', null, button('New task', () => actions.createTask(handle, finding), 'button-small', 'finding-new-task'))),

    section('Reviews',
      latest
        ? h('div', null,
            h('p', null, h('strong', null, `Latest: ${dispositions[latest.disposition] || latest.disposition}`)),
            h('p', { class: 'wrap' }, latest.note),
            h('p', { class: 'hint' }, `${formatTime(latest.at)}. ${freshness}`))
        : h('p', { class: 'hint' }, 'No review notes yet.'),
      reviews.length > 1 && h('details', null,
        h('summary', null, `All ${reviews.length} notes`),
        h('ul', { class: 'item-list' }, [...reviews].reverse().map(review => h('li', null,
          h('p', null, h('strong', null, dispositions[review.disposition] || review.disposition)),
          h('p', { class: 'wrap' }, review.note),
          h('p', { class: 'hint' }, formatTime(review.at)))))),
      drafts.length > 0 && h('p', { class: 'hint' }, 'Review drafts citing this finding: ',
        drafts.map((draft, index) => [index ? ', ' : '', h('a', { href: `#/cases/${encodeURIComponent(item.id)}/drafts/${encodeURIComponent(draft.id)}` }, `${draft.title} (${draftStanding(draft)})`)])),
      h('p', { class: 'hint' }, 'A note never closes or hides a finding.'),
      h('p', null, button('Add review note', () => actions.addReviewNote(handle, finding), 'button-small', 'finding-add-note'))),

    record && computed && section('Record context',
      facts([
        ['Record', h('a', { href: `#/records/${encodeURIComponent(item.id)}/${encodeURIComponent(record.id)}` }, record.title)],
        ['Schedule', record.schedule
          ? `${record.schedule.authority}${record.schedule.itemNumber ? `, item ${record.schedule.itemNumber}` : ''}. ${record.schedule.years} years after final payment${record.schedule.confirmed ? '' : ', not yet confirmed'}`
          : missing('Unknown. Keep retained.')],
        ['Hold', status(holdStatus, record.hold)],
        ['Retention', status(retentionStatus, computed.retention.status)],
        ['Review date', reviewDateText(computed.retention)],
      ]),
      h('h3', null, 'Hold reviews'),
      holdHistory(record),
      h('p', null, button('Record a hold review', () => actions.reviewHold(handle, record), 'button-small', 'finding-hold'))),

    section('History and packet',
      recentActivity(item.id),
      packetButton(item.id, 'finding-packet')));

  return { title: finding.title, node };
}

// ---------- Record ----------

export function reviewDateText(retention) {
  if (retention.status === 'blocked') return 'Not applicable while a hold is active';
  if (!retention.reviewDate) return 'Cannot be computed yet';
  return formatDay(retention.reviewDate);
}

export function recordPanel(handle, recordId, ctx, { showCase = false } = {}) {
  const detail = handle.detail;
  const computed = detail.report.records.find(entry => entry.id === recordId);
  const record = detail.case.records.find(entry => entry.id === recordId);
  if (!computed || !record) return null;

  const item = detail.case;
  const { retention } = computed;
  const { schedule } = record;
  const findingId = `${item.id}:record:${record.id}`;
  const tasks = detail.tasks.filter(task => task.findingId === findingId);

  const node = h('div', null,
    showCase && caseLine(item),
    h('p', { class: 'panel-status' }, status(retentionStatus, retention.status)),
    h('p', null, h('a', { href: `#/records/${encodeURIComponent(item.id)}/${encodeURIComponent(record.id)}/file` }, 'Open the record file'), h('span', { class: 'hint' }, ' Record, contract, and audit trail on one page.')),
    h('p', null, retention.reason),
    retention.status === 'review-due' && h('p', { class: 'emphasis-warn' }, 'The review date has passed. That calls for a records officer review. It does not authorize destruction.'),
    retention.status === 'blocked' && h('p', { class: 'emphasis-block' }, 'Preserve this record. The hold applies even though the retention interval may have elapsed.'),

    section('Ownership and schedule',
      facts([
        ['Records owner', record.owner?.trim() ? record.owner : missing('Not assigned')],
        ['Schedule authority', schedule ? schedule.authority : missing('Unknown. Keep retained.')],
        schedule?.itemNumber && ['Schedule item number', schedule.itemNumber],
        ['Retention period', schedule ? `${schedule.years} years after final payment` : missing('Unknown')],
        ['Schedule confirmed', schedule ? (schedule.confirmed ? 'Yes, by a records officer' : missing('Not yet confirmed')) : missing('No schedule on file')],
        ['Verified final payment', record.finalPaymentDate ? formatDay(record.finalPaymentDate) : missing('Not recorded')],
        ['Review date', reviewDateText(retention)],
      ], true),
      h('p', { class: 'hint' }, 'A review date prompts a records officer review. This workspace has no destruction operation.'),
      h('p', null, button('Edit record', () => actions.editRecord(handle, record), 'button-small', 'record-edit'))),

    section('Hold',
      h('p', null, status(holdStatus, record.hold)),
      holdHistory(record),
      h('p', null, button('Record a hold review', () => actions.reviewHold(handle, record), 'button-small', 'record-hold'))),

    section('Follow-up tasks',
      tasks.length === 0
        ? h('p', { class: 'hint' }, 'No tasks for this record.')
        : h('ul', { class: 'item-list' }, tasks.map(task => taskLine(handle, task))),
      h('p', null, button('New task', () => actions.createTask(handle, detail.report.findings.find(entry => entry.id === findingId)), 'button-small', 'record-new-task'))),

    section('Official source', citations(detail.report.findings.find(entry => entry.id === findingId)?.sourceIds ?? [], caseSources(ctx, item))),
    section('History and packet', recentActivity(item.id), packetButton(item.id, 'record-packet')));

  return { title: record.title, node };
}

// ---------- Evidence reference ----------

export function evidencePanel(handle, evidenceId, ctx) {
  const item = handle.detail.case;
  const entry = item.evidence.find(candidate => candidate.id === evidenceId);
  if (!entry) return null;
  const linked = handle.detail.report.findings.filter(finding => finding.evidenceIds.includes(entry.id));
  const sourceIds = [...new Set(linked.flatMap(finding => finding.sourceIds))];
  const verification = verificationOf(entry);
  // References created from an intake document point back at it.
  const sourceDocument = entry.locator.match(/^document:\/\/([A-Za-z0-9_-]+)#/)?.[1];

  const node = h('div', null,
    caseLine(item),
    h('p', { class: 'panel-status' }, status(verificationLabels, verification)),
    h('p', null, verification === 'verified-reference'
      ? 'A reviewer confirmed that this reference exists. That is not approval of the document\'s content and not a compliance certification.'
      : 'No reviewer has confirmed this reference yet.'),
    facts([
      ['Supports', evidenceKinds[entry.kind] || entry.kind],
      ['Document location', locator(entry.locator)],
      sourceDocument && ['Source document', h('a', { href: `#/documents/${encodeURIComponent(sourceDocument)}` }, 'Open document')],
      ['Origin', entry.provenance === 'synthetic' ? 'Synthetic fixture' : 'Added in this workspace'],
      ['Case owner', item.owner],
    ]),
    h('p', { class: 'hint' }, 'This workspace does not track an evidence owner, a freshness date, or a renewal deadline. Only the title and locator are stored.'),
    h('p', { class: 'button-row' },
      verification !== 'verified-reference' && button('Verify', () => actions.verifyEvidence(handle, entry), 'button-small', `ev-verify-${entry.id}`),
      button('Correct', () => actions.correctEvidence(handle, entry), 'button-small', `ev-correct-${entry.id}`)),

    section('Linked findings',
      linked.length === 0
        ? h('p', { class: 'hint' }, 'No current finding uses this reference.')
        : h('ul', { class: 'item-list' }, linked.map(finding => h('li', null,
            h('div', { class: 'line' },
              h('a', { href: `#/workbench/${encodeURIComponent(finding.id)}` }, finding.title),
              status(findingStatus, finding.status))))),
      h('p', { class: 'hint' }, 'A finding with unknown applicability stays in review even when its reference is verified.')),

    sourceIds.length > 0 && section('Official source', citations(sourceIds, caseSources(ctx, item))));

  return { title: entry.title, node };
}

// Shown when a panel's item no longer exists after a reload.
export function missingPanel() {
  return { title: 'Not found', node: notice('info', 'This item is no longer in the case.', 'Close the panel and pick another row.') };
}

// ---------- Review draft ----------

const shortHash = value => (value ? `${String(value).slice(0, 12)}…` : 'Not available');
const staleText = { 'draft-text-changed': 'the note text changed afterwards', 'evidence-changed': 'the cited evidence changed afterwards' };
const decisionLabels = { 'submitted': 'Submitted for review', 'changes-requested': 'Changes requested', 'reviewed': 'Marked reviewed' };

// One line that says where the note stands, including when a review no longer applies.
export function draftStanding(draft) {
  if (draft.needsFreshReview) {
    return draft.state === 'reviewed' ? 'Reviewed, but now out of date' : draft.state === 'submitted' ? 'Submitted, but now out of date' : 'Out of date';
  }
  return draftStates[draft.state]?.label || draft.state;
}

export function draftPanel(handle, draftId, ctx) {
  const draft = handle.drafts.find(entry => entry.id === draftId);
  if (!draft) return null;
  const current = draft.versions[draft.versions.length - 1];
  const findings = handle.detail.report.findings;
  const snapshot = current.snapshot;
  const documents = snapshot.evidence.filter(entry => entry.documentId);

  const node = h('div', null,
    h('p', { class: 'panel-status' }, h('span', { class: `status status-${draft.needsFreshReview ? 'warn' : draftStates[draft.state]?.tone || 'muted'}` }, draftStanding(draft)), ` · version ${draft.version}`),
    draft.needsFreshReview && notice('warn', 'This review no longer matches the current state.',
      draft.evidenceChanged
        ? 'The evidence this note cites changed after it was submitted or reviewed. Save a version against the current evidence and have it reviewed again. The earlier decision stays in the history.'
        : 'The note changed after it was submitted or reviewed. It needs a fresh review.'),
    !draft.needsFreshReview && draft.evidenceChanged && notice('info', 'The cited evidence has changed since this version was saved.', 'Refresh or edit the draft before submitting it.'),
    h('p', { class: 'hint' }, 'Reviewed describes this note only. It never resolves a finding, verifies evidence, releases a hold, or authorizes destruction.'),

    h('p', { class: 'button-row' },
      draft.state === 'draft' && !draft.evidenceChanged && button('Submit for review', () => actions.submitDraft(handle, draft), 'button-small button-primary', 'draft-submit'),
      draft.state === 'submitted' && !draft.needsFreshReview && button('Record decision', () => actions.decideDraft(handle, draft), 'button-small button-primary', 'draft-decide'),
      draft.evidenceChanged && button('Refresh against current evidence', () => actions.refreshDraft(handle, draft), 'button-small', 'draft-refresh'),
      button('Edit', () => actions.editDraft(handle, draft), 'button-small', 'draft-edit')),

    section('Note', h('pre', { class: 'note-text', tabindex: '0' }, draft.text)),

    section('People',
      facts([
        ['Author', draft.author],
        ['Routed to', draft.reviewer || missing('No reviewer named yet')],
        ['Identity', draft.identity === 'verified' ? 'Verified sign-in' : 'Typed names, not verified'],
      ]),
      h('p', { class: 'hint' }, handle.draftIdentity?.notice)),

    section('Evidence snapshot for this version',
      facts([
        ['Saved', formatTime(current.savedAt)],
        ['Case revision', String(current.caseRevision)],
        ['Review date', formatDay(current.asOf)],
        ['Rule version', current.ruleVersion],
        ['Note hash', h('span', { class: 'mono', title: current.contentHash }, shortHash(current.contentHash))],
        ['Evidence hash', h('span', { class: 'mono', title: current.evidenceHash }, shortHash(current.evidenceHash))],
        ['Evidence now', draft.evidenceChanged ? h('strong', null, 'Changed since this version') : 'Unchanged since this version'],
      ]),
      h('h3', null, 'Findings cited'),
      h('ul', { class: 'item-list' }, snapshot.findings.map(entry => {
        const now = findings.find(finding => finding.id === entry.id);
        return h('li', null,
          h('div', { class: 'line' }, h('span', null, now?.title || entry.id), h('span', null, findingStatus[entry.status]?.label || entry.status)),
          now && now.status !== entry.status && h('p', { class: 'hint' }, `Now: ${findingStatus[now.status]?.label || now.status}`),
          !now && h('p', { class: 'hint' }, 'This finding is no longer in the case.'));
      })),
      h('h3', null, 'Evidence references cited'),
      snapshot.evidence.length === 0
        ? h('p', { class: 'hint' }, 'None. The cited findings had no evidence references when this version was saved.')
        : h('ul', { class: 'item-list' }, snapshot.evidence.map(entry => h('li', null,
            h('p', { class: 'wrap' }, entry.title),
            h('p', { class: 'hint wrap' }, entry.verified ? 'Reference checked' : 'Reference not checked', ' · ', locator(entry.locator))))),
      h('h3', null, 'Document versions and passages'),
      documents.length === 0
        ? h('p', { class: 'hint' }, 'None. No cited reference points at a stored document.')
        : h('ul', { class: 'item-list' }, documents.map(entry => h('li', null,
            h('p', { class: 'wrap' }, h('a', { href: `#/documents/${encodeURIComponent(entry.documentId)}` }, entry.title)),
            h('p', { class: 'hint mono wrap' }, entry.documentSha256 ? `SHA-256 ${entry.documentSha256}` : 'No hash in the locator'),
            h('p', { class: 'hint' }, entry.spanId ? `Span ${entry.spanId}` : 'No span is referenced. The reference points at the whole document.')))),
      h('h3', null, 'Policy sources'),
      citations(snapshot.sourceIds, caseSources(ctx, handle.detail.case))),

    section('Review history',
      draft.decisions.length === 0
        ? h('p', { class: 'hint' }, 'Not submitted yet.')
        : h('ul', { class: 'item-list' }, [...draft.decisions].reverse().map(decision => h('li', null,
            h('p', null, h('strong', null, decisionLabels[decision.type] || decision.type), ` · version ${decision.version}`),
            decision.stale && h('p', { class: 'emphasis-warn' }, `No longer applies: ${decision.staleReasons.map(reason => staleText[reason] || reason).join(' and ')}.`),
            decision.note && h('p', { class: 'wrap' }, decision.note),
            h('p', { class: 'hint' }, `${decision.type === 'submitted' ? 'Routed to' : 'By'} ${decision.reviewer} · ${decision.identity === 'verified' ? 'verified sign-in' : 'typed name, not verified'} · ${formatTime(decision.at)}`),
            h('p', { class: 'hint mono' }, `note ${shortHash(decision.contentHash)} · evidence ${shortHash(decision.evidenceHash)}`))))),

    draft.versions.length > 1 && section('Earlier versions',
      h('ul', { class: 'item-list' }, draft.versions.slice(0, -1).reverse().map(version => h('li', null,
        h('details', null,
          h('summary', null, `Version ${version.version}, saved ${formatTime(version.savedAt)}`),
          version.note && h('p', { class: 'hint wrap' }, version.note),
          h('pre', { class: 'note-text', tabindex: '0' }, version.text)))))));

  return { title: draft.title, node };
}
