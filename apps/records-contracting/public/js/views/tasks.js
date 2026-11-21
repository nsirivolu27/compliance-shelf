// Follow-up task queue across every case. The server filters and pages the queue and
// computes overdue flags and whether each task's finding is still open.

import * as api from '../api.js';
import { h, button, rowButton, status, pageHeader, notice, errorState, taskStatus, findingStatus, formatDay } from '../dom.js';
import { createList } from '../lists.js';
import { openForm } from '../forms.js';
import { createCaseHandle } from '../case-actions.js';
import * as actions from '../case-actions.js';

// Links from the Overview use a short "show" word. Translate it to the documented filters.
const shortcuts = { 'overdue': { overdue: 'true' }, 'follow-up': { needsFollowUp: 'true' }, 'done': { status: 'done' }, 'not-done': { status: 'open' } };

export function create(route) {
  const problem = h('div');

  // Loads the task's case first, so the form sends the current case revision.
  async function withCase(caseId, openerId, then) {
    problem.replaceChildren();
    const handle = createCaseHandle(caseId, () => { if (handle.ready) list.reload(); });
    try {
      await handle.load();
      handle.ready = true;
      document.getElementById(openerId)?.focus();
      then(handle);
    } catch (error) {
      problem.replaceChildren(errorState(error, () => withCase(caseId, openerId, then)));
    }
  }

  function editTask(task) {
    withCase(task.caseId, `task-${task.id}`, handle => {
      const current = handle.detail.tasks.find(entry => entry.id === task.id);
      if (current) {
        actions.editTask(handle, current);
      } else {
        problem.replaceChildren(notice('info', 'This task no longer exists.', 'The list was reloaded.'));
        list.reload();
      }
    });
  }

  async function newTask() {
    problem.replaceChildren();
    let cases;
    try {
      ({ cases } = await api.getCases());
    } catch (error) {
      problem.replaceChildren(errorState(error, newTask));
      return;
    }
    if (cases.length === 0) {
      problem.replaceChildren(notice('info', 'There are no cases yet.', 'Create a case before adding tasks.'));
      return;
    }
    openForm({
      title: 'New follow-up task',
      intro: 'Choose the case first. The next step lists its findings.',
      submitLabel: 'Continue',
      fields: [{ name: 'caseId', type: 'select', label: 'Case', required: true, value: cases[0].id, options: cases.map(item => ({ value: item.id, label: item.title })) }],
      submit: async values => values.caseId,
      onSuccess: caseId => withCase(caseId, 'new-task', handle => actions.createTask(handle)),
    });
  }

  const list = createList({
    label: 'Follow-up tasks',
    searchLabel: 'Search task, assignee, case, or finding ID',
    initial: { filters: { ...route.query, ...shortcuts[route.query.show] } },
    // The paginated form of the task list returns its rows under "tasks".
    load: async query => {
      const result = await api.searchTasks(query);
      return { items: result.tasks, pagination: result.pagination };
    },
    emptyText: 'No follow-up tasks yet. Create a task from a finding to assign the work and set a due date.',
    filters: [
      { name: 'status', label: 'Task status', options: Object.entries(taskStatus).map(([value, entry]) => ({ value, label: entry.label })) },
      { name: 'owner', label: 'Assigned to', options: [] },
      { name: 'overdue', label: 'Due', options: [{ value: 'true', label: 'Overdue' }, { value: 'false', label: 'Not overdue' }] },
      { name: 'needsFollowUp', label: 'Finding', options: [{ value: 'true', label: 'Still open' }, { value: 'false', label: 'No longer open' }] },
    ],
    csv: {
      filename: 'Compliance Shelf tasks',
      columns: [
        { header: 'Task', value: task => task.title },
        { header: 'Case ID', value: task => task.caseId },
        { header: 'Case', value: task => task.caseTitle },
        { header: 'Finding ID', value: task => task.findingId },
        { header: 'Assigned to', value: task => task.owner },
        { header: 'Due date', value: task => task.dueDate || '' },
        { header: 'Overdue', value: task => task.overdue ? 'Yes' : 'No' },
        { header: 'Task status', value: task => taskStatus[task.status]?.label || task.status },
        { header: 'Finding status now', value: task => findingStatus[task.findingStatus]?.label || task.findingStatus },
        { header: 'Finding still open', value: task => task.needsFollowUp ? 'Yes' : 'No' },
      ],
    },
    columns: [
      { header: 'Task', cell: task => rowButton(task.title, () => editTask(task), false, `task-${task.id}`) },
      { header: 'Case', cell: task => h('a', { href: `#/cases/${encodeURIComponent(task.caseId)}/tasks`, title: task.caseId }, task.caseTitle) },
      { header: 'Assigned to', cell: task => task.owner },
      { header: 'Due', cell: task => task.dueDate ? [formatDay(task.dueDate), task.overdue && h('span', { class: 'overdue' }, ' Overdue')] : 'No date' },
      { header: 'Task status', cell: task => status(taskStatus, task.status) },
      { header: 'Finding now', cell: task => h('a', { class: 'plain-link', href: `#/workbench/${encodeURIComponent(task.findingId)}` }, status(findingStatus, task.findingStatus)) },
    ],
  });

  // The assignee filter lists the people who currently have tasks.
  const loadOwners = () => api.getTasks().then(({ tasks }) => {
    problem.replaceChildren();
    list.setFilterOptions('owner', [...new Set(tasks.map(task => task.owner))].sort().map(owner => ({ value: owner, label: owner })));
  }).catch(error => problem.replaceChildren(errorState(error, loadOwners)));
  loadOwners();

  return {
    key: 'tasks',
    el: h('div', null,
      pageHeader('Tasks', 'Follow-up work assigned on findings, overdue first. Marking a task done does not clear its finding. The last column shows where each finding stands now.',
        button('New task', newTask, 'button-primary', 'new-task')),
      problem,
      list.el),
  };
}
