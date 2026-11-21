// Overview: workload counts computed by the server, plus the latest activity.

import * as api from '../api.js';
import { h, status, pageHeader, loadingState, errorState, emptyState, dataTable, retentionStatus, actionLabels, describeEvent, formatDay, formatTime, shortId } from '../dom.js';

// Each row explains what the count means and links to the list behind it.
const countRows = [
  { key: 'evidenceGaps', label: 'Evidence gaps', meaning: 'Checks with no matching reference in this workspace', href: '#/workbench?status=needs-evidence' },
  { key: 'pendingReviews', label: 'Pending reviews', meaning: 'Unknown applicability, unverified references, or record questions', href: '#/workbench?status=needs-review' },
  { key: 'activeHolds', label: 'Active holds', meaning: 'Records that must stay preserved', href: '#/records?hold=active' },
  { key: 'recordsNeedingReview', label: 'Records needing review', meaning: 'No owner, unknown schedule or hold, or review date reached', href: '#/records?needsReview=true' },
  { key: 'openTasks', label: 'Open tasks', meaning: 'Follow-up tasks not marked done (open or in progress)', href: '#/tasks' },
  { key: 'overdueTasks', label: 'Overdue tasks', meaning: 'Not done and past the due date', href: '#/tasks?show=overdue' },
  { key: 'tasksNeedingFollowUp', label: 'Tasks with an open finding', meaning: 'Includes done tasks whose finding has not changed', href: '#/tasks?show=follow-up' },
  { key: 'cases', label: 'Cases', meaning: 'Synthetic cases in this workspace', href: '#/cases' },
];

export function create() {
  const body = h('div', null, loadingState('Loading overview…'));

  async function load() {
    try {
      // The attention lists reuse the same list endpoints as the Records and Tasks pages.
      const [data, holds, due, queue, policy] = await Promise.all([
        api.getDashboard(),
        api.getRecords({ hold: 'active', limit: 5 }),
        api.getRecords({ status: 'review-due', limit: 5 }),
        api.getTasks(),
        api.getPolicyReassessment(),
      ]);
      body.replaceChildren(render(data, { holds, due, overdue: queue.tasks.filter(task => task.overdue), policy }));
    } catch (error) {
      body.replaceChildren(errorState(error, load));
    }
  }

  load();
  return { key: 'overview', el: h('div', null, pageHeader('Overview'), body) };
}

const recordLink = record => h('a', { href: `#/records/${encodeURIComponent(record.caseId)}/${encodeURIComponent(record.id)}` }, record.title);
const more = (shown, total, href, label) => total > shown && h('p', { class: 'hint' }, h('a', { href }, `See all ${total} ${label}`));

// Short lists of the items a reviewer should look at before anything else.
function attention({ holds, due, overdue }) {
  if (holds.items.length + due.items.length + overdue.length === 0) {
    return h('p', { class: 'hint' }, 'No active holds, no records with a review date reached, and no overdue tasks.');
  }
  return h('div', { class: 'attention' },
    holds.items.length > 0 && h('div', null,
      h('h3', null, 'Active holds. Keep these records preserved.'),
      dataTable({ label: 'Records on active hold', rows: holds.items, columns: [
        { header: 'Record', cell: recordLink },
        { header: 'Case', cell: record => record.caseTitle },
        { header: 'Owner', cell: record => record.owner?.trim() ? record.owner : h('span', { class: 'missing' }, 'Not assigned') },
      ] }),
      more(holds.items.length, holds.pagination.total, '#/records?hold=active', 'records on hold')),
    due.items.length > 0 && h('div', null,
      h('h3', null, 'Review date reached. A records officer review is due, not disposal.'),
      dataTable({ label: 'Records due for review', rows: due.items, columns: [
        { header: 'Record', cell: recordLink },
        { header: 'Case', cell: record => record.caseTitle },
        { header: 'Review date', cell: record => formatDay(record.retention.reviewDate) },
        { header: 'Retention', cell: record => status(retentionStatus, record.retention.status) },
      ] }),
      more(due.items.length, due.pagination.total, '#/records?status=review-due', 'records due for review')),
    overdue.length > 0 && h('div', null,
      h('h3', null, 'Overdue follow-up tasks'),
      dataTable({ label: 'Overdue tasks', rows: overdue.slice(0, 5), columns: [
        { header: 'Task', cell: task => h('a', { href: `#/cases/${encodeURIComponent(task.caseId)}/tasks` }, task.title) },
        { header: 'Case', cell: task => task.caseTitle },
        { header: 'Assigned to', cell: task => task.owner },
        { header: 'Due', cell: task => formatDay(task.dueDate) },
      ] }),
      more(5, overdue.length, '#/tasks?show=overdue', 'overdue tasks')));
}

// Cases where a recorded policy decision is behind a later version of that policy.
function policyAttention(policy) {
  if (!policy || policy.total === 0) return null;
  return h('div', { class: 'policy-attention' },
    h('h3', null, 'Policy decisions needing reassessment. Earlier reviews are kept.'),
    dataTable({ label: 'Cases needing policy reassessment', rows: policy.cases, columns: [
      { header: 'Case', cell: item => h('a', { href: `#/cases/${encodeURIComponent(item.caseId)}/policy` }, item.title) },
      { header: 'Owner', cell: item => item.owner },
      { header: 'Policy', cell: item => item.entries.map(entry => entry.title).join('; ') },
    ] }));
}

function render(data, lists) {
  return h('div', { class: 'stack' },
    h('p', { class: 'page-description' },
      `Counts computed by the server as of ${formatDay(data.asOf)}. They measure open work and can overlap. They are not a compliance score.`),

    h('section', { 'aria-labelledby': 'attention-heading' },
      h('h2', { id: 'attention-heading' }, 'Needs attention first'),
      attention(lists),
      policyAttention(lists.policy)),

    h('div', { class: 'dashboard' },
      h('section', { 'aria-labelledby': 'work-heading' },
        h('h2', { id: 'work-heading' }, 'Open work'),
        h('div', { class: 'table-wrap' },
          h('table', { class: 'count-table' },
            h('thead', null, h('tr', null,
              h('th', { scope: 'col' }, 'Item'), h('th', { scope: 'col', class: 'num' }, 'Count'), h('th', { scope: 'col' }, 'What it counts'))),
            h('tbody', null, countRows.map(row => h('tr', null,
              h('th', { scope: 'row' }, h('a', { href: row.href }, row.label)),
              h('td', { class: 'num count' }, String(data.counts[row.key])),
              h('td', { class: 'muted' }, row.meaning))))))),

      h('section', { 'aria-labelledby': 'recent-heading' },
        h('h2', { id: 'recent-heading' }, 'Recent activity'),
        data.recentEvents.length === 0
          ? emptyState('Nothing logged yet.', 'Open a case and run its checks to start the audit trail.',
              h('a', { class: 'button', href: '#/cases' }, 'Go to cases'))
          : h('ol', { class: 'feed' }, data.recentEvents.map(event => {
              const { subject } = describeEvent(event);
              return h('li', null,
                h('p', null, h('strong', null, actionLabels[event.action] || event.action), subject ? `: ${subject}` : ''),
                h('p', { class: 'hint' }, formatTime(event.at), ' · ',
                  h('a', { href: `#/cases/${encodeURIComponent(event.caseId)}`, title: event.caseId }, shortId(event.caseId))));
            })),
        data.recentEvents.length > 0 && h('p', null, h('a', { href: '#/activity' }, 'All activity')))),

    h('section', { class: 'reading-notes', 'aria-labelledby': 'notes-heading' },
      h('h2', { id: 'notes-heading' }, 'How to read these numbers'),
      h('ul', { class: 'plain-list' },
        h('li', null, 'Every case is synthetic. Real public awards appear only under Public awards and are never linked to a finding.'),
        h('li', null, 'An evidence gap means nothing was supplied here. It does not establish agency noncompliance.'),
        h('li', null, '"Evidence present" means a reviewer confirmed a reference exists. It is not a legal compliance certification.'),
        h('li', null, 'A retention review date prompts a records officer review. It never authorizes destruction, and an active hold comes first.'),
        h('li', null, 'Finishing a task does not clear its finding.'))),

    h('p', { class: 'hint' }, `Rule version ${data.ruleVersion} · Workspace revision ${data.workspaceRevision} · Local demo mode, no sign-in`));
}
