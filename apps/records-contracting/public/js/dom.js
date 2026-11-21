// DOM helpers and small shared components. All text goes through text nodes,
// so user-supplied titles, notes, and locators are never parsed as HTML.

// Translate known system messages only. Documents and reviewer notes stay verbatim.
const workflowMessages = new Map([
  ['Applicability not decided', 'Not yet decided whether this check applies'],
  ['No sufficiency assessment recorded', 'Evidence has not been reviewed'],
  ['A reviewer records a sufficiency assessment for the check.', 'Review the evidence and save your decision.'],
  ['Evidence assessed as not sufficient', 'More evidence needed'],
  ['The current assessment is "insufficient".', 'The reviewer needs more evidence to complete this check.'],
  ['The current assessment is "needs-clarification".', 'The reviewer needs clarification before completing this check.'],
  ['Supply further evidence, then record a new assessment.', 'Add the missing evidence, then review it again.'],
  ['Assessment needs another review', 'Evidence needs another review'],
  ['Assessment freshness cannot be established', 'Unable to check whether the evidence changed'],
  ['Restore the document service or record a new assessment.', 'Reconnect the document service or review the evidence again.'],
  ['Reassess the check against the changed evidence, applicability, or policy.', 'Review this check again because its evidence or requirements changed.'],
  ['Evidence metadata is present but has not been verified with a usable locator.', 'A reference is on file. Open the document and check its location.'],
  ['Open the source record and verify the evidence reference.', 'Open the document and check the reference.'],
  ['Applicability has not been established. This is not a finding of noncompliance.', 'A reviewer still needs to decide whether this check applies.'],
  ['Request the evidence or its official system-of-record locator.', 'Request the document or its location in the agency system.'],
  ['Confirm which policy versions and deviations govern this case before treating screening rules as requirements.', 'Confirm which policy versions and approved exceptions apply to this case.'],
  ['Review the governing policy versions and case-specific applicability.', 'Check which policy versions apply to this case.'],
  ['Identify records, custodians, and schedule authorities.', 'List the records, their owners, and the approved rules for keeping them.'],
  ['Confirm ownership, schedule, trigger evidence, and hold status with the records officer.', 'Ask the records officer to confirm the owner, retention rule, start date, and any hold.'],
]);
export const workflowText = text => workflowMessages.get(text) ?? text;

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (tag === 'button') el.addEventListener('click', event => {
    if (el.getAttribute('aria-disabled') === 'true') { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') el.className = value;
    else if (name.startsWith('on')) el.addEventListener(name.slice(2), event => {
      if (el.getAttribute('aria-disabled') !== 'true') return value(event);
      event.preventDefault();
    });
    else if (value === true) el.setAttribute(name, '');
    else el.setAttribute(name, value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child);
  }
}

// Replaces an element's children, skipping empty values. The built-in replaceChildren
// would print null or false as text.
export function setChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ---------- Formatting ----------

const dayFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function formatDay(value) {
  if (!value) return 'Not recorded';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? String(value) : dayFormat.format(date);
}

export function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : timeFormat.format(date);
}

export function formatMoney(value) {
  return typeof value === 'number' ? moneyFormat.format(value) : 'Not reported';
}

// Generated case IDs end in a long random value. Tables show a short form.
export function shortId(id) {
  const text = String(id);
  return text.length > 20 ? `${text.slice(0, 16)}…` : text;
}

// ---------- Labels ----------

export const findingStatus = {
  'evidence-present': { label: 'Reference checked', tone: 'ok' },
  'needs-evidence': { label: 'Needs evidence', tone: 'warn' },
  'needs-review': { label: 'Needs review', tone: 'review' },
  'not-applicable': { label: 'Not applicable', tone: 'muted' },
  'blocked': { label: 'Blocked by hold', tone: 'block' },
  'unavailable': { label: 'Finding unavailable', tone: 'muted' },
};

export const retentionStatus = {
  'blocked': { label: 'Blocked by active hold', tone: 'block' },
  'unknown': { label: 'Unknown, keep retained', tone: 'review' },
  'retain': { label: 'Retain', tone: 'ok' },
  'review-due': { label: 'Officer review due', tone: 'warn' },
};

export const holdStatus = {
  'active': { label: 'Active hold', tone: 'block' },
  'none': { label: 'No hold', tone: 'muted' },
  'unknown': { label: 'Unknown', tone: 'review' },
};

export const taskStatus = {
  'open': { label: 'Open', tone: 'review' },
  'in-progress': { label: 'In progress', tone: 'info' },
  'done': { label: 'Done', tone: 'muted' },
};

export const gapStatus = {
  open: { label: 'Not reviewed', tone: 'review' },
  confirmed: { label: 'Confirmed by reviewer', tone: 'warn' },
  dismissed: { label: 'Dismissed by reviewer', tone: 'muted' },
};

// Documentation completeness as text with a bar. The words carry the meaning; the bar repeats them.
// With nothing countable there is no percent, and the text says why.
export function completeness(score) {
  if (score.percent === null) return h('span', { class: 'completeness' }, h('span', { class: 'missing' }, 'Nothing to count yet'));
  return h('span', { class: 'completeness' },
    h('span', { class: 'completeness-value' }, `${score.percent}%`),
    h('progress', { max: String(score.countable), value: String(score.complete), 'aria-label': `Documentation completeness: ${score.complete} of ${score.countable} items` }),
    h('span', { class: 'hint' }, `${score.complete} of ${score.countable} complete`));
}

export const applicabilityLabels = { yes: 'Applies', no: 'Does not apply', unknown: 'Unknown' };

// Labels for the built-in example checks. Checks from a loaded profile or from a
// case's own check set are added as they are seen, so every table can label them.
export const evidenceKinds = {
  'signed-award': 'Signed award',
  'funding': 'Availability of funds',
  'market-research': 'Market research',
  'records-plan': 'Contractor records obligations',
};
const builtInKinds = { ...evidenceKinds };

export function rememberChecks(checks) {
  for (const check of checks || []) if (!Object.hasOwn(evidenceKinds, check.kind)) evidenceKinds[check.kind] = check.title;
}

// The checks one case is screened against, as { kind: label }.
export function kindsOf(item) {
  if (!item?.checkSet) return builtInKinds;
  rememberChecks(item.checkSet.checks);
  return Object.fromEntries(item.checkSet.checks.map(check => [check.kind, check.title]));
}

export const dispositions = {
  'request-evidence': 'Evidence requested',
  'acknowledged': 'Acknowledged',
  'escalated': 'Escalated',
};

export const draftStates = {
  'draft': { label: 'Draft', tone: 'muted' },
  'submitted': { label: 'Submitted for review', tone: 'info' },
  'changes-requested': { label: 'Changes requested', tone: 'review' },
  'reviewed': { label: 'Reviewed', tone: 'ok' },
};

export const categoryLabels = { contracting: 'Contracting', policy: 'Policy', records: 'Records' };

// Evidence checks keep the internal category "contracting" on every case, because citations, assessments, and
// the guided tools recognize them by it. Only the words shown differ: a case with its own check set is not a
// contract file, so its checks read "Evidence check". The built-in example keeps "Contracting".
export function areaLabel(finding, item) {
  return finding.category === 'contracting' && item?.checkSet ? 'Evidence check' : categoryLabels[finding.category];
}

// Who decides applicability, in words that fit the case.
export const deciderLabel = item => (item?.checkSet ? 'a responsible reviewer' : 'a contracting officer');

// Sources for one case: the built-in registry plus the sources stored with that case.
// Never the loaded profile's or another case's, so a reused source ID cannot describe the wrong case.
export function caseSources(ctx, item) {
  return [...(ctx.builtInSources ?? ctx.sources), ...(item?.checkSet?.sources ?? [])];
}

export const actionLabels = {
  'case-created': 'Case created',
  'context': 'Case details updated',
  'record-create': 'Record added',
  'record-update': 'Record updated',
  'record-hold': 'Hold review recorded',
  'evidence-added': 'Evidence reference added',
  'evidence-update': 'Evidence reference corrected',
  'evidence-reference-verified': 'Evidence reference verified',
  'finding-reviewed': 'Review note added',
  'task-create': 'Task created',
  'task-update': 'Task updated',
  'analysis-run': 'Checks run',
  'profile-loaded': 'Check profile loaded',
  'profile-reset': 'Built-in example checks restored',
  'review-draft-created': 'Review note drafted',
  'review-draft-revised': 'Review note revised',
  'review-draft-submitted': 'Review note submitted',
  'review-draft-decided': 'Review note decision recorded',
  'policy-review-recorded': 'Policy review recorded',
  'citation-linked': 'Passage linked to a finding',
  'citation-corrected': 'Linked passage corrected',
  'sufficiency-assessed': 'Evidence review saved',
  'gap-decision-recorded': 'Documentation gap decision recorded',
  'funding-budget-created': 'Budget created (synthetic)',
  'funding-budget-amended': 'Budget amended',
  'funding-allocation-created': 'Allocation request created',
  'funding-allocation-edited': 'Allocation request edited',
  'funding-allocation-decided': 'Allocation decision recorded (simulated)',
};

// A status is plain text with a small colored marker. The text carries the meaning.
export function status(map, value) {
  const entry = map[value] || { label: `Unrecognized: ${value}`, tone: 'muted' };
  return h('span', { class: `status status-${entry.tone}${['unknown', 'unresolved', 'cannot-establish', 'not-checked'].includes(value) || !map[value] ? ' status-unknown' : ''}` }, entry.label);
}

// ---------- Page building blocks ----------

export function pageHeader(title, description, actions) {
  return h('div', { class: 'page-header' },
    h('div', { class: 'page-heading' },
      h('h1', { id: 'page-title', tabindex: '-1' }, title),
      description && h('p', { class: 'page-description' }, description)),
    actions && h('div', { class: 'page-actions' }, actions));
}

export function notice(tone, title, ...body) {
  return h('div', { class: `notice notice-${tone}`, role: tone === 'error' || tone === 'block' ? 'alert' : null },
    title && h('p', { class: 'notice-title' }, title),
    body.map(part => typeof part === 'string' ? h('p', null, part) : part));
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), text && h('p', null, text), action);
}

export function loadingState(label) {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), label);
}

export function errorState(error, retry) {
  const title = error.offline ? 'The local server is not reachable' : 'This could not be loaded';
  const text = error.offline ? 'Check that "npm run dev" is still running, then try again.' : error.message;
  return notice('error', title, text,
    h('p', null, h('button', { type: 'button', class: 'button', onclick: retry || (() => location.reload()) }, 'Try again')));
}

// Buttons that open a form get a stable id, so focus can return to them after a save.
export function button(label, onclick, variant = '', id = null) {
  return h('button', { type: 'button', class: `button ${variant}`.trim(), onclick, id }, label);
}

// Native dialogs make the background inert; keep tab navigation inside even when
// focus starts on a heading or controls are rebuilt following a save.
export function containDialogFocus(dialog) {
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !dialog.matches(':modal')) return;
    const controls = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]')]
      .filter(node => node.getClientRects().length && !node.closest('[hidden]'));
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}

export function openReadDialog(title, content) {
  const opener = document.activeElement;
  const heading = h('h2', { id: 'passage-dialog-title', tabindex: '-1' }, title);
  const dialog = h('dialog', { class: 'passage-dialog', 'aria-labelledby': heading.id },
    h('header', { class: 'inspector-head' }, heading, button('Close', () => dialog.close())), content);
  containDialogFocus(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); (document.getElementById(opener?.id) || opener)?.focus(); });
  document.body.append(dialog);
  dialog.showModal();
  heading.focus();
  return dialog;
}

// Only plain http(s) locators become links. Anything else is shown as text.
export function locator(value) {
  let safe = false;
  try { safe = /^https?:\/\//i.test(value) && /^https?:$/.test(new URL(value).protocol); } catch { /* not a URL */ }
  if (safe) return h('a', { href: value, target: '_blank', rel: 'noopener noreferrer', class: 'locator' }, value);
  return h('code', { class: 'locator', title: 'Reference only, not a link' }, value);
}

export function externalLink(href, text) {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text, h('span', { class: 'visually-hidden' }, ' (opens in a new tab)'));
}

// Collapsible citation for each official source behind a check.
export function citations(sourceIds, sources) {
  if (!sourceIds?.length) return null;
  return h('div', { class: 'citations' }, sourceIds.map(id => {
    const source = sources.find(entry => entry.id === id);
    if (!source) return h('p', { class: 'hint' }, `Source "${id}" is not in the registry.`);
    return h('details', null,
      h('summary', null, source.title),
      h('dl', { class: 'facts' },
        h('dt', null, 'Cited section'), h('dd', null, source.locator),
        h('dt', null, 'Scope and limits'), h('dd', null, source.scope),
        h('dt', null, 'Last checked'), h('dd', null, formatDay(source.checkedOn)),
        h('dt', null, 'Link'), h('dd', null, externalLink(source.url, source.url))));
  }));
}

// Short name of the authority behind a check, such as "FAR 4.803".
export function authority(sourceIds, sources) {
  return (sourceIds || []).map(id => (sources.find(source => source.id === id)?.title || id).split(' - ')[0]).join('; ');
}

// One row of label and value pairs.
export function facts(pairs, wide) {
  return h('dl', { class: wide ? 'facts facts-wide' : 'facts' },
    pairs.filter(Boolean).map(([label, value]) => [h('dt', null, label), h('dd', null, value)]));
}

// ---------- Tables ----------

// columns: [{ header, cell(row), class }]. The first column should hold a real
// button or link so every row can be opened from the keyboard.
export function dataTable({ label, columns, rows, isSelected }) {
  return h('div', { class: 'table-wrap' },
    h('table', { 'aria-label': label },
      h('thead', null, h('tr', null, columns.map(column => h('th', { scope: 'col', class: column.class }, column.header)))),
      h('tbody', null, rows.map(row => h('tr', { class: isSelected?.(row) ? 'is-selected' : null },
        columns.map((column, index) => h(index === 0 ? 'th' : 'td', { scope: index === 0 ? 'row' : null, class: column.class, 'data-label': column.header }, column.cell(row))))))));
}

// Button styled as a link, used in the first table column to open a detail panel.
export function rowButton(label, onclick, current, id = null) {
  return h('button', { type: 'button', class: 'row-button', onclick, id, 'aria-current': current ? 'true' : null }, label);
}

// ---------- Activity ----------

export function describeEvent(event) {
  const details = event.details || {};
  const change = details.change || {};
  const title = actionLabels[event.action] || event.action;
  let subject = '';
  if (event.action === 'analysis-run' && details.summary) {
    subject = `${details.summary.needsEvidence} need evidence, ${details.summary.needsReview} need review, ${details.summary.blocked} blocked`;
  } else if (event.action === 'record-hold') {
    subject = `${change.after?.title}: ${holdStatus[change.before?.hold]?.label} to ${holdStatus[change.after?.hold]?.label}`;
  } else if (event.action === 'finding-reviewed') {
    subject = `${dispositions[details.disposition] || details.disposition}: ${details.findingSnapshot?.title || details.findingId}`;
  } else if (event.action === 'evidence-reference-verified') {
    subject = details.after?.title || '';
  } else if (event.action === 'evidence-added') {
    subject = details.title || '';
  } else if (event.action.startsWith('review-draft-')) {
    subject = `${details.draft?.title || ''}${change.after?.state ? ` (${draftStates[change.after.state]?.label || change.after.state})` : ''}`;
  } else if (event.action.startsWith('funding-')) {
    // Funding events carry their change at the top level of the details.
    const decided = details.action ? `${details.action}: ${details.before?.state} to ${details.after?.state}` : '';
    const amended = details.before && details.after ? `Changed: ${Object.keys(details.after).join(', ')}` : '';
    return { title, subject: details.after?.name || details.after?.destination || decided || amended, note: details.rationale || '' };
  } else if (event.action === 'context' || event.action === 'case-created') {
    subject = details.case?.title || '';
  } else {
    subject = change.after?.title || '';
  }
  return { title, subject, note: change.note || details.note || '' };
}

// ---------- Transient messages ----------

let toastTimer = null;

// Short confirmation shown at the bottom of the screen and read by screen readers.
export function announce(message) {
  const region = document.getElementById('toast');
  region.textContent = '';
  clearTimeout(toastTimer);
  setTimeout(() => {
    region.textContent = message;
    region.classList.add('is-visible');
    toastTimer = setTimeout(() => region.classList.remove('is-visible'), 6000);
  }, 50);
}
