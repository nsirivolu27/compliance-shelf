// Review workbench: the daily work queue. One row per finding, in the server's order:
// active holds, overdue tasks, findings needing an assignment, assigned follow-up, then monitoring.

import * as api from '../api.js';
import { h, rowButton, status, authority, pageHeader, loadingState, errorState, findingStatus, categoryLabels, areaLabel, caseSources, formatDay } from '../dom.js';
import { createList } from '../lists.js';
import { createInspector, findingPanel, missingPanel, attentionLabels } from '../panels.js';
import { createCaseHandle } from '../case-actions.js';

const options = map => Object.entries(map).map(([value, entry]) => ({ value, label: entry.label || entry }));

export function create(route, ctx) {
  const body = h('div', null, loadingState('Loading the workbench…'));
  let selectedId = route.parts[0] || null;
  let handle = null;
  let list = null;
  let countStrip = null;
  const countProblem = h('div');
  async function refreshCounts() {
    try {
      const { counts } = await api.getDashboard();
      for (const node of countStrip?.querySelectorAll('[data-count]') || []) node.textContent = String(counts[node.dataset.count]);
      countProblem.replaceChildren();
    } catch (error) { countProblem.replaceChildren(errorState(error, refreshCounts)); }
  }

  const inspector = createInspector(() => {
    selectedId = null;
    handle = null;
    history.replaceState(null, '', '#/workbench');
    list?.redraw();
  });

  function showPanel(focus) {
    const panel = findingPanel(handle, selectedId, ctx, { showCase: true }) || missingPanel();
    inspector.show(panel.title, panel.node, { focus });
  }

  async function open(findingId, caseId, focus = true) {
    selectedId = findingId;
    history.replaceState(null, '', `#/workbench/${encodeURIComponent(findingId)}`);
    list?.redraw();
    let firstLoad = true;
    // After a save the panel and the queue both show the new state.
    const current = createCaseHandle(caseId, () => {
      if (handle !== current) return;
      showPanel(firstLoad && focus);
      if (!firstLoad) { list.reload(); refreshCounts(); }
      firstLoad = false;
    });
    handle = current;
    inspector.show('Loading…', loadingState('Loading finding…'), { focus });
    try {
      await current.load();
    } catch (error) {
      if (handle === current) inspector.show('Finding', errorState(error, () => open(findingId, caseId)), { focus: false });
    }
  }

  async function start() {
    try {
      const [{ cases }, dashboard] = await Promise.all([api.getCases(), api.getDashboard()]);
      const counts = h('nav', { class: 'count-strip', 'aria-label': 'Filter workbench by finding status' },
        [
          ['needs-evidence', 'Evidence gaps', dashboard.counts.evidenceGaps],
          ['needs-review', 'Pending reviews', dashboard.counts.pendingReviews],
          ['blocked', 'Active holds', dashboard.counts.activeHolds],
        ].map(([value, label, count]) => h('a', {
          href: `#/workbench?status=${value}`,
          'aria-current': route.query.status === value ? 'true' : null,
        }, h('span', { class: 'num' }, String(count)), h('span', null, label))),
        h('a', { href: '#/workbench', 'aria-current': !route.query.status ? 'true' : null }, 'All findings'));
      countStrip = counts;
      [...counts.querySelectorAll('.num')].forEach((node, index) => { node.dataset.count = ['evidenceGaps', 'pendingReviews', 'activeHolds'][index]; });
      // Responsible owners are record owners for record findings and case owners for the rest.
      const owners = [...new Set(cases.flatMap(item => [item.owner, ...item.records.map(record => record.owner?.trim())]).filter(Boolean))].sort();
      list = createList({
        label: 'Review workbench',
        searchLabel: 'Search finding, case, owner, evidence, or task',
        initial: { filters: route.query },
        load: api.getWorkbench,
        emptyText: 'There is nothing to review because the workspace has no cases.',
        filters: [
          { name: 'attention', label: 'Queue', options: options(attentionLabels) },
          { name: 'status', label: 'Finding status', options: options(findingStatus).filter(option => option.value !== 'unavailable') },
          { name: 'caseId', label: 'Case', options: cases.map(item => ({ value: item.id, label: item.title })) },
          { name: 'owner', label: 'Responsible owner', options: owners.map(owner => ({ value: owner, label: owner })) },
          { name: 'hasOpenTask', label: 'Follow-up task', options: [{ value: 'true', label: 'Has an open task' }, { value: 'false', label: 'No open task' }] },
        ],
        csv: {
          filename: 'Compliance Shelf workbench',
          columns: [
            { header: 'Finding ID', value: row => row.id },
            { header: 'Finding', value: row => row.title },
            { header: 'Case ID', value: row => row.caseId },
            { header: 'Case', value: row => row.caseTitle },
            { header: 'Data type', value: () => 'Synthetic' },
            { header: 'Area', value: row => areaLabel(row, cases.find(item => item.id === row.caseId)) },
            { header: 'Finding status', value: row => findingStatus[row.status]?.label || row.status },
            { header: 'Authority', value: row => authority(row.sourceIds, caseSources(ctx, cases.find(item => item.id === row.caseId))) },
            { header: 'Responsible owner', value: row => row.owner || 'Not assigned' },
            { header: 'Case owner', value: row => row.caseOwner },
            { header: 'Task assignees', value: row => row.taskOwners.join('; ') },
            { header: 'Earliest due date', value: row => row.earliestDueDate || '' },
            { header: 'Overdue', value: row => row.overdue ? 'Yes' : 'No' },
            { header: 'Queue', value: row => attentionLabels[row.attention]?.label || row.attention },
            { header: 'Queue reason', value: row => row.attentionReason },
            { header: 'Next action', value: row => row.nextAction },
          ],
        },
        isSelected: row => row.id === selectedId,
        columns: [
          { header: 'Finding', cell: row => [
            rowButton(row.title, () => open(row.id, row.caseId), row.id === selectedId, `open-${row.id}`),
            h('p', { class: 'hint cell-note' }, row.attentionReason),
            h('p', { class: 'cell-next' }, h('strong', null, 'Next: '), row.nextAction),
          ] },
          { header: 'Case', cell: row => h('a', { href: `#/cases/${encodeURIComponent(row.caseId)}`, title: row.caseId }, row.caseTitle) },
          { header: 'Finding status', cell: row => status(findingStatus, row.status) },
          { header: 'Responsible owner', cell: row => row.owner?.trim() ? row.owner : h('span', { class: 'missing' }, 'Not assigned') },
          { header: 'Task assignees', cell: row => row.taskOwners.length ? row.taskOwners.join(', ') : h('span', { class: 'missing' }, 'No open task') },
          { header: 'Earliest due', cell: row => row.earliestDueDate ? [formatDay(row.earliestDueDate), row.overdue && h('span', { class: 'overdue' }, ' Overdue')] : '' },
          { header: 'Queue', cell: row => status(attentionLabels, row.attention) },
        ],
      });
      body.replaceChildren(counts, countProblem, h('p', { class: 'hint' }, 'Workspace counts from the server. Select a count to filter findings; counts may overlap.'),
        h('div', { class: 'split' }, h('div', { class: 'split-main' }, list.el), inspector.el));
      // A link can point straight at one finding. Its case ID is the part before the first colon.
      if (selectedId) {
        const item = cases.find(entry => selectedId.startsWith(`${entry.id}:`));
        if (item) open(selectedId, item.id, false);
        else selectedId = null;
      }
    } catch (error) {
      body.replaceChildren(errorState(error, start));
    }
  }

  start();
  return {
    key: 'workbench',
    el: h('div', null,
      pageHeader('Review workbench', 'A reviewer checks whether a synthetic contract or records file holds adequate, traceable evidence, records the judgment, and prepares an audit handoff. This queue lists every finding in working order: active holds first, then overdue tasks, assessments that found evidence not sufficient, findings with no one assigned, assigned follow-up, and items to monitor. It is a work queue, not a risk score or a compliance rating.'),
      body),
  };
}
