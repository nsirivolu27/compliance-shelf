// Labels and small cells shared by the paperwork pages and the audit team report.
// Every state is shown as words. Color only repeats what the words say.

import { h, status, formatDay } from './dom.js';

export const paperworkStatus = {
  'not-started': { label: 'Not started', tone: 'muted' },
  'drafting': { label: 'Drafting', tone: 'review' },
  'ready-for-signature': { label: 'Ready for signature', tone: 'info' },
  'filed-by-agency': { label: 'Filed by the agency', tone: 'ok' },
};

export const readinessState = {
  'blocked': { label: 'Blocked by an active hold', tone: 'block' },
  'incomplete': { label: 'Facts missing', tone: 'review' },
  'facts-complete': { label: 'All facts on file', tone: 'ok' },
  'not-tracked': { label: 'Listed only', tone: 'muted' },
};

export const factState = {
  'present': { label: 'On file', tone: 'ok' },
  'missing': { label: 'Missing', tone: 'review' },
  'blocked': { label: 'Blocked by an active hold', tone: 'block' },
};

export const verificationStatus = {
  'seen': { label: 'Source read', tone: 'muted' },
  'candidate': { label: 'Not confirmed', tone: 'warn' },
};

export const originLabels = {
  case: 'Read from the case',
  record: 'Read from the linked record',
  manual: 'Entered by a person',
  reader: 'Accepted from a document reader',
};

export const familyLabels = {
  'records-transfer': 'Records transfer',
  'records-disposal': 'Records disposal',
  'records-reporting': 'Records reporting',
  'internal-control': 'Internal control',
  'audit-follow-up': 'Audit follow up',
  'privacy': 'Privacy',
};

export const scopeLabels = { 'government-wide': 'Government wide', va: 'VA', ssa: 'SSA' };

export const entryTitle = entry => (entry ? `${entry.formNumber ? `${entry.formNumber}: ` : ''}${entry.title}` : 'No longer in the catalog');

// Readiness is a count of facts, shown with its state in words.
export function readinessCell(readiness) {
  return h('div', null, status(readinessState, readiness.state), h('p', { class: 'hint' }, readiness.summary),
    readiness.attention && h('p', null, h('span', { class: 'status status-warn' }, readiness.attention)));
}

export function dueCell(view) {
  if (!view.dueDate) return h('span', { class: 'missing' }, 'No date entered');
  return h('div', null,
    h('span', { class: 'mono' }, formatDay(view.dueDate)),
    view.readiness.overdue && h('p', null, h('span', { class: 'status status-warn' }, 'Past its due date')));
}
