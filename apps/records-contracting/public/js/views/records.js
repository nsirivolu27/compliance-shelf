// Record inventory across every case: ownership, schedule, hold, and review date.

import * as api from '../api.js';
import { h, rowButton, status, pageHeader, loadingState, errorState, retentionStatus, holdStatus, formatDay } from '../dom.js';
import { createList } from '../lists.js';
import { createInspector, recordPanel, missingPanel, reviewDateText } from '../panels.js';
import { createCaseHandle } from '../case-actions.js';
import { createRecordFile } from './record-file.js';

const options = map => Object.entries(map).map(([value, entry]) => ({ value, label: entry.label }));

export function create(route, ctx) {
  // A third address part opens the full record file instead of the list.
  if (route.parts[2] === 'file') return createRecordFile(route.parts[0], route.parts[1], ctx);

  // Record IDs are unique only inside a case, so a selection is a case ID plus a record ID.
  let selected = route.parts[1] ? { caseId: route.parts[0], recordId: route.parts[1] } : null;
  let handle = null;
  const isSelected = record => Boolean(selected) && record.caseId === selected.caseId && record.id === selected.recordId;

  const inspector = createInspector(() => {
    selected = null;
    handle = null;
    history.replaceState(null, '', '#/records');
    list.redraw();
  });

  function showPanel(focus) {
    const panel = recordPanel(handle, selected.recordId, ctx, { showCase: true }) || missingPanel();
    inspector.show(panel.title, panel.node, { focus });
  }

  async function open(caseId, recordId, focus = true) {
    selected = { caseId, recordId };
    history.replaceState(null, '', `#/records/${encodeURIComponent(caseId)}/${encodeURIComponent(recordId)}`);
    list.redraw();
    let firstLoad = true;
    const current = createCaseHandle(caseId, () => {
      if (handle !== current) return;
      showPanel(firstLoad && focus);
      if (!firstLoad) list.reload();
      firstLoad = false;
    });
    handle = current;
    inspector.show('Loading…', loadingState('Loading record…'), { focus });
    try {
      await current.load();
    } catch (error) {
      if (handle === current) inspector.show('Record', errorState(error, () => open(caseId, recordId)), { focus: false });
    }
  }

  const list = createList({
    label: 'Records',
    searchLabel: 'Search record, case, or owner',
    initial: { filters: route.query },
    load: api.getRecords,
    emptyText: 'No records are in any case inventory yet. Add records from a case.',
    filters: [
      { name: 'hold', label: 'Hold', options: options(holdStatus) },
      { name: 'status', label: 'Retention', options: options(retentionStatus) },
      { name: 'owner', label: 'Owner', options: [] },
      { name: 'needsReview', label: 'Needs review', options: [{ value: 'true', label: 'Needs review' }, { value: 'false', label: 'No review needed' }] },
    ],
    csv: {
      filename: 'Compliance Shelf records',
      columns: [
        { header: 'Record ID', value: record => record.id },
        { header: 'Record', value: record => record.title },
        { header: 'Case ID', value: record => record.caseId },
        { header: 'Case', value: record => record.caseTitle },
        { header: 'Data type', value: () => 'Synthetic' },
        { header: 'Owner', value: record => record.owner || 'Not assigned' },
        { header: 'Schedule authority', value: record => record.schedule?.authority || 'Unknown' },
        { header: 'Retention years', value: record => record.schedule?.years ?? '' },
        { header: 'Schedule confirmed', value: record => record.schedule ? (record.schedule.confirmed ? 'Yes' : 'No') : '' },
        { header: 'Verified final payment', value: record => record.finalPaymentDate || 'Not recorded' },
        { header: 'Hold', value: record => holdStatus[record.hold]?.label || record.hold },
        { header: 'Retention status', value: record => retentionStatus[record.retention.status]?.label || record.retention.status },
        { header: 'Review date (not a disposal date)', value: record => record.retention.reviewDate || '' },
        { header: 'Reason', value: record => record.retention.reason },
        { header: 'Destruction authorized', value: () => 'No' },
      ],
    },
    isSelected,
    columns: [
      { header: 'Record', cell: record => rowButton(record.title, () => open(record.caseId, record.id), isSelected(record), `open-${record.caseId}-${record.id}`) },
      { header: 'Case', cell: record => h('a', { href: `#/cases/${encodeURIComponent(record.caseId)}/records`, title: record.caseId }, record.caseTitle) },
      { header: 'Owner', cell: record => record.owner?.trim() ? record.owner : h('span', { class: 'missing' }, 'Not assigned') },
      { header: 'Schedule', cell: record => record.schedule
        ? `${record.schedule.years} years after final payment${record.schedule.confirmed ? '' : ', unconfirmed'}`
        : h('span', { class: 'missing' }, 'Unknown') },
      { header: 'Final payment', cell: record => record.finalPaymentDate ? formatDay(record.finalPaymentDate) : h('span', { class: 'missing' }, 'Not recorded') },
      { header: 'Hold', cell: record => status(holdStatus, record.hold) },
      { header: 'Retention', cell: record => status(retentionStatus, record.retention.status) },
      { header: 'Review date', cell: record => reviewDateText(record.retention) },
      { header: 'File', cell: record => h('a', { href: `#/records/${encodeURIComponent(record.caseId)}/${encodeURIComponent(record.id)}/file`, 'aria-label': `Record file for ${record.title}` }, 'Record file') },
    ],
  });

  const el = h('div', { class: 'records-page' },
    pageHeader('Records', 'The record inventory of every synthetic case. A review date tells a records officer when to look at a record. It never authorizes destruction, and an active hold always comes first.'),
    h('div', { class: 'split' }, h('div', { class: 'split-main' }, list.el), inspector.el));

  if (selected) open(selected.caseId, selected.recordId, false);

  // The owner filter lists the record owners that exist in the workspace.
  const ownerProblem = h('div');
  el.append(ownerProblem);
  const loadOwners = () => api.getCases().then(({ cases }) => {
    ownerProblem.replaceChildren();
    const owners = [...new Set(cases.flatMap(item => item.records.map(record => record.owner?.trim()).filter(Boolean)))].sort();
    list.setFilterOptions('owner', owners.map(owner => ({ value: owner, label: owner })));
  }).catch(error => ownerProblem.replaceChildren(errorState(error, loadOwners)));
  loadOwners();

  return { key: 'records', el };
}
