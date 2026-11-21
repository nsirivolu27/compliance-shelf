// Gap register: documentation completeness by case, and every detected documentation gap across the workspace.
// A gap is a documentation condition found by a rule. A reviewer may confirm or dismiss it with a note.
// Neither decision changes a finding, the percent, a hold, or a task.

import * as api from '../api.js';
import { workflowText,  h, button, pageHeader, loadingState, errorState, dataTable, completeness, gapStatus, status, announce } from '../dom.js';
import { createList } from '../lists.js';
import { decideGap } from '../case-actions.js';

export function create(route) {
  const scores = h('div', null, loadingState('Loading documentation completeness…'));

  async function loadScores() {
    try {
      const result = await api.getDocumentation();
      scores.replaceChildren(
        h('p', { class: 'completeness-total' }, 'Workspace: ', completeness(result.workspace),
          result.workspace.undecidedChecks ? ` ${result.workspace.undecidedChecks} undecided ${result.workspace.undecidedChecks === 1 ? 'check is' : 'checks are'} not counted.` : ''),
        dataTable({
          label: 'Documentation completeness by case',
          rows: result.cases,
          columns: [
            { header: 'Case', cell: entry => h('a', { href: `#/cases/${encodeURIComponent(entry.caseId)}/documentation` }, entry.caseTitle) },
            { header: 'Organization and record family', cell: entry => h('div', null, h('p', { class: 'wrap' }, entry.organization), h('p', { class: 'hint' }, entry.recordFamily || 'Family not recorded')) },
            { header: 'Completeness', cell: entry => completeness(entry.score) },
            { header: 'Evidence checks', class: 'num', cell: entry => `${entry.score.checks.complete} of ${entry.score.checks.countable}` },
            { header: 'Undecided', class: 'num', cell: entry => String(entry.score.checks.undecided) },
            { header: 'Records', class: 'num', cell: entry => `${entry.score.records.complete} of ${entry.score.records.countable}` },
            { header: 'Open gaps', class: 'num', cell: entry => String(entry.openGaps) },
          ],
        }),
        h('p', { class: 'hint' }, result.limitation));
    } catch (error) {
      scores.replaceChildren(errorState(error, loadScores));
    }
  }

  const list = createList({
    label: 'Detected gaps',
    searchLabel: 'Search gap, case, or subject',
    initial: { filters: route.query },
    load: api.getGaps,
    emptyText: 'No documentation gap is detected in any case.',
    filters: [
      { name: 'status', label: 'Reviewer decision', options: Object.entries(gapStatus).map(([value, entry]) => ({ value, label: entry.label })) },
      { name: 'ruleId', label: 'Rule', options: [] },
      { name: 'caseId', label: 'Case', options: [] },
      { name: 'subjectType', label: 'About', options: [{ value: 'check', label: 'Evidence check' }, { value: 'record', label: 'Record' }, { value: 'record-type', label: 'Expected record type' }, { value: 'case', label: 'Case' }, { value: 'task', label: 'Task' }] },
    ],
    csv: {
      filename: 'Compliance Shelf gap register',
      columns: [
        { header: 'Gap ID', value: gap => gap.id },
        { header: 'Rule', value: gap => gap.ruleId },
        { header: 'Gap', value: gap => workflowText(gap.title) },
        { header: 'About', value: gap => gap.subjectTitle },
        { header: 'Case ID', value: gap => gap.caseId },
        { header: 'Case', value: gap => gap.caseTitle },
        { header: 'Organization', value: gap => gap.organization },
        { header: 'Record family', value: gap => gap.recordFamily || '' },
        { header: 'Data type', value: () => 'Synthetic' },
        { header: 'What was found', value: gap => workflowText(gap.detail) },
        { header: 'What would clear it', value: gap => workflowText(gap.toClear) },
        { header: 'Reviewer decision', value: gap => gapStatus[gap.status].label },
        { header: 'Decision note', value: gap => gap.decision?.note || '' },
        { header: 'Is this a finding of noncompliance', value: () => 'No' },
      ],
    },
    columns: [
      { header: 'Gap', cell: gap => h('div', null,
        h('p', null, h('a', { href: `#/cases/${encodeURIComponent(gap.caseId)}/${gap.section}` }, workflowText(gap.title))),
        h('p', { class: 'hint wrap' }, workflowText(gap.detail))) },
      { header: 'About', cell: gap => h('span', { class: 'wrap' }, gap.subjectTitle) },
      { header: 'Case', cell: gap => h('div', null, h('p', null, h('a', { href: `#/cases/${encodeURIComponent(gap.caseId)}/documentation`, title: gap.caseId }, gap.caseTitle)), h('p', { class: 'hint' }, gap.recordFamily || gap.organization)) },
      { header: 'What would clear it', cell: gap => h('span', { class: 'wrap' }, workflowText(gap.toClear)) },
      { header: 'Reviewer decision', cell: gap => h('div', null, status(gapStatus, gap.status),
        gap.decision && !gap.decision.current && h('p', { class: 'hint' }, 'An earlier decision no longer matches this gap.')) },
      { header: 'Action', cell: gap => button('Review', () => decideGap(gap.caseId, gap.caseRevision, gap, () => { list.reload(); loadScores(); announce('Decision recorded.'); }, () => list.reload()), 'button-small', `gap-${gap.id}`) },
    ],
  });

  loadScores();
  const filterProblem = h('div');
  const loadFilters = async () => {
    try {
      const [result, { cases }] = await Promise.all([api.getGaps({ limit: 1 }), api.getCases()]);
      list.setFilterOptions('ruleId', result.rules.map(rule => ({ value: rule.id, label: rule.title })));
      list.setFilterOptions('caseId', cases.map(item => ({ value: item.id, label: item.title })));
      filterProblem.replaceChildren();
    } catch (error) { filterProblem.replaceChildren(errorState(error, loadFilters)); }
  };
  loadFilters();

  return {
    key: 'gaps',
    el: h('div', null,
      pageHeader('Gap register', 'Documentation gaps found by fixed rules across every synthetic case, with how complete each case\'s documentation is. A gap is something to look at. It is not a finding of noncompliance, and the percent is not a compliance rating.'),
      h('section', null, h('h2', null, 'Documentation completeness'), scores),
      h('section', null, h('h2', null, 'Detected gaps'), filterProblem, list.el)),
  };
}
