// Paginated audit trail with search, filters, and a before and after view of each change.

import * as api from '../api.js';
import { h, rowButton, pageHeader, loadingState, errorState, facts, dataTable, actionLabels, describeEvent, formatDay, formatTime, shortId } from '../dom.js';
import { createList } from '../lists.js';
import { createInspector } from '../panels.js';

const show = value => {
  if (value === null || value === undefined || value === '') return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

// Lists the fields that differ between two snapshots of the same item.
function changeTable(before, after) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
  if (keys.length === 0) return h('p', { class: 'hint' }, 'No field values changed.');
  return dataTable({
    label: 'Changed fields',
    rows: keys,
    columns: [
      { header: 'Field', cell: key => key },
      { header: 'Before', cell: key => h('span', { class: 'wrap' }, before ? show(before[key]) : 'Did not exist') },
      { header: 'After', cell: key => h('span', { class: 'wrap' }, show(after?.[key])) },
    ],
  });
}

// Workspace-level events, such as a loaded profile or a funding change, belong to no case.
function caseCell(event, label) {
  if (event.caseId) return h('a', { href: `#/cases/${encodeURIComponent(event.caseId)}`, title: event.caseId }, label);
  return event.action.startsWith('funding-') ? h('a', { href: '#/funding' }, 'Funding (no case)') : h('span', { class: 'missing' }, 'Workspace (no case)');
}

function eventDetail(event) {
  const details = event.details || {};
  const change = details.change;
  const { subject, note } = describeEvent(event);
  let changes = null;
  if (event.action === 'analysis-run') {
    changes = facts([
      ['Review date', formatDay(details.asOf)],
      ['Rule version', details.ruleVersion],
      ['Needs evidence', String(details.summary.needsEvidence)],
      ['Needs review', String(details.summary.needsReview)],
      ['Blocked by hold', String(details.summary.blocked)],
      ['Reference checked', String(details.summary.evidencePresent)],
    ], true);
  } else if (change) {
    changes = [
      changeTable(change.before, change.after),
      change.reference && facts([['Review reference', change.reference], change.releaseReference && ['Release authorization', change.releaseReference]], true),
    ];
  } else if (details.before || details.after) {
    changes = changeTable(details.before, details.after);
  } else if (event.action === 'evidence-added') {
    changes = changeTable(null, details);
  } else if (event.action === 'finding-reviewed') {
    changes = facts([['Finding', details.findingSnapshot?.title || details.findingId], ['Finding status at review', details.findingSnapshot?.status || 'Not recorded']], true);
  }

  return h('div', null,
    facts([
      ['When', formatTime(event.at)],
      ['Who', 'Local demo operator (not authenticated)'],
      ['Case', caseCell(event, shortId(event.caseId))],
      subject && ['Subject', subject],
      ['Workspace revision', show(event.workspaceRevision)],
      ['Case revision after', show(event.caseRevision)],
    ], true),
    note && h('section', { class: 'panel-section' }, h('h3', null, 'Reason given'), h('p', { class: 'wrap' }, note)),
    changes && h('section', { class: 'panel-section' }, h('h3', null, event.action === 'analysis-run' ? 'Result' : 'What changed'), changes));
}

export function create() {
  const body = h('div', null, loadingState('Loading activity…'));
  let selectedId = null;
  let list = null;

  const inspector = createInspector(() => {
    selectedId = null;
    list?.redraw();
  });

  function open(event) {
    selectedId = event.id;
    list.redraw();
    inspector.show(actionLabels[event.action] || event.action, eventDetail(event));
  }

  async function start() {
    try {
      const { cases } = await api.getCases();
      list = createList({
        label: 'Activity',
        searchLabel: 'Search action or case ID',
        load: api.getActivity,
        emptyText: 'Nothing has been logged yet. Changes and check runs appear here.',
        filters: [
          { name: 'action', label: 'Action', options: Object.entries(actionLabels).map(([value, label]) => ({ value, label })) },
          { name: 'caseId', label: 'Case', options: cases.map(item => ({ value: item.id, label: item.title })) },
        ],
        csv: {
          filename: 'Compliance Shelf activity',
          columns: [
            { header: 'When (UTC)', value: event => event.at },
            { header: 'Action', value: event => actionLabels[event.action] || event.action },
            { header: 'Case ID', value: event => event.caseId ?? '' },
            { header: 'Subject', value: event => describeEvent(event).subject },
            { header: 'Reason given', value: event => describeEvent(event).note },
            { header: 'Actor', value: event => `${event.actor} (not authenticated)` },
            { header: 'Workspace revision', value: event => event.workspaceRevision ?? '' },
            { header: 'Case revision after', value: event => event.caseRevision ?? '' },
            { header: 'Event ID', value: event => event.id },
          ],
        },
        isSelected: event => event.id === selectedId,
        columns: [
          { header: 'Action', cell: event => rowButton(actionLabels[event.action] || event.action, () => open(event), event.id === selectedId, `open-${event.id}`) },
          { header: 'When', cell: event => formatTime(event.at) },
          { header: 'Case', cell: event => caseCell(event, cases.find(item => item.id === event.caseId)?.title || shortId(event.caseId)) },
          { header: 'Subject', cell: event => h('span', { class: 'wrap' }, describeEvent(event).subject) },
          { header: 'Workspace rev.', class: 'num', cell: event => show(event.workspaceRevision) },
        ],
      });
      body.replaceChildren(h('div', { class: 'split' }, h('div', { class: 'split-main' }, list.el), inspector.el));
    } catch (error) {
      body.replaceChildren(errorState(error, start));
    }
  }

  start();
  return {
    key: 'activity',
    el: h('div', null,
      pageHeader('Activity', 'Every saved change and logged check run, newest first. This local history can be edited on disk. It is not a tamper-proof audit log.',
        h('a', { class: 'button', href: '#/export' }, 'Audit export')),
      body),
  };
}
