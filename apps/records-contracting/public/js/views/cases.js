// Case list and case workspace. The workspace has tabs for findings, evidence,
// records, tasks, and history, with a detail panel beside the tables.

import * as api from '../api.js';
import { workflowText, 
  h, setChildren, button, rowButton, status, authority, pageHeader, notice, emptyState, loadingState, errorState, dataTable, locator,
  findingStatus, retentionStatus, holdStatus, taskStatus, applicabilityLabels, evidenceKinds, categoryLabels, areaLabel, caseSources, completeness, gapStatus, facts, announce,
  actionLabels, draftStates, describeEvent, formatDay, formatTime, shortId,
} from '../dom.js';
import { createList } from '../lists.js';
import { createInspector, findingPanel, recordPanel, draftPanel, draftStanding, missingPanel, reviewDateText } from '../panels.js';
import { createCaseHandle } from '../case-actions.js';
import * as actions from '../case-actions.js';
import { caseFile } from './case-file.js';
import { paperworkTab } from './case-paperwork.js';
import { linksTab, linkPanel, loadDocumentIndex } from './case-links.js';
import { policyTab, loadPolicyVersions } from './case-policy.js';

export function create(route, ctx) {
  return route.parts[0] ? createDetail(route, ctx) : createListView();
}

// ---------- Case list ----------

function createListView() {
  // Documentation completeness per case, computed by the server. The list still works if this read fails.
  const scores = new Map();
  const scoreProblem = h('div');
  const loadScores = () => api.getDocumentation().then(result => { scoreProblem.replaceChildren(); for (const entry of result.cases) scores.set(entry.caseId, entry.score); list.redraw(); }).catch(error => scoreProblem.replaceChildren(errorState(error, loadScores)));
  loadScores();
  const list = createList({
    label: 'Cases',
    searchLabel: 'Search title, ID, or owner',
    // The paginated form of the case list returns its rows under "cases", each with a summary.
    load: async query => {
      const result = await api.searchCases(query);
      return { items: result.cases, pagination: result.pagination };
    },
    emptyText: 'No cases yet. Create a synthetic case to start screening evidence and records.',
    columns: [
      { header: 'Case', cell: item => h('a', { href: `#/cases/${encodeURIComponent(item.id)}` }, item.title) },
      { header: 'ID', cell: item => h('span', { class: 'mono', title: item.id }, shortId(item.id)) },
      { header: 'Organization and record family', cell: item => h('div', null, h('p', { class: 'wrap' }, item.agency),
        h('p', { class: 'hint' }, item.recordFamily || (item.checkSet ? h('span', { class: 'missing' }, 'Family not recorded') : 'Contracting (built-in example)'))) },
      { header: 'Contract number', cell: item => item.contractNumber || h('span', { class: 'missing' }, 'None recorded') },
      { header: 'Case owner', cell: item => item.owner },
      { header: 'Documentation', cell: item => (scores.has(item.id) ? completeness(scores.get(item.id)) : h('span', { class: 'missing' }, 'Not loaded')) },
      { header: 'Needs evidence', class: 'num', cell: item => String(item.summary.needsEvidence) },
      { header: 'Needs review', class: 'num', cell: item => String(item.summary.needsReview) },
      { header: 'Active holds', class: 'num', cell: item => String(item.summary.activeHolds) },
      { header: 'Open tasks', class: 'num', cell: item => String(item.summary.openTasks) },
    ],
  });

  return {
    key: 'cases',
    el: h('div', null,
      pageHeader('Cases', 'Synthetic cases. None of them describes a real award, vendor, office, system, or person. The numbers are counts of open items, not a score.',
        button('New case', () => actions.newCase(item => { location.hash = `#/cases/${encodeURIComponent(item.id)}`; }), 'button-primary', 'new-case')),
      scoreProblem, list.el,
      h('p', { class: 'hint' }, 'Real public award data is kept apart from these cases. See ', h('a', { href: '#/awards' }, 'Public awards'), '.')),
  };
}

// ---------- Case journey ----------

// Context, Evidence, Checks, Review, Handoff. Each stage states what is recorded and
// what is open, and links to the section where the work is done. No percentages.
function journeyStrip(stages) {
  if (!stages) return null;
  return h('nav', { class: 'journey', 'aria-label': 'Case journey' },
    h('ol', null, stages.map((stage, index) => h('li', { class: stage.outstanding.length && stage.id !== 'handoff' ? 'journey-stage has-open' : 'journey-stage' },
      h('p', { class: 'journey-label' }, `${index + 1}. `, h('a', { href: stage.link }, stage.label)),
      h('p', { class: 'journey-state' }, stage.state),
      h('p', { class: 'hint' }, stage.responsible ? `Responsible: ${stage.responsible}` : 'No one named yet'),
      h('details', null,
        h('summary', null, stage.outstanding.length ? `Details (${stage.outstanding.length})` : 'Next step'),
        stage.outstanding.length > 0 && h('ul', { class: 'plain-list' }, stage.outstanding.map(line => h('li', null, line))),
        h('p', { class: 'hint' }, `Next: ${stage.nextAction}`))))),
    h('p', { class: 'hint' }, 'The packet includes documents, recorded decisions, follow-up work, and instructions to preserve records.'));
}

// ---------- Case workspace ----------

const tabs = [
  { id: 'findings', label: 'Findings' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'records', label: 'Records' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'policy', label: 'Policy' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'paperwork', label: 'Paperwork' },
  { id: 'drafts', label: 'Review drafts' },
  { id: 'links', label: 'Relationships' },
  { id: 'history', label: 'History' },
  { id: 'file', label: 'Case file' },
];

function createDetail(route, ctx) {
  const caseId = route.parts[0];
  const basePath = `#/cases/${encodeURIComponent(caseId)}`;
  let tab = tabs.some(entry => entry.id === route.parts[1]) ? route.parts[1] : 'findings';
  let selected = route.parts[2] || null;
  let flash = null;

  const root = h('div', null, loadingState('Loading case…'));
  const inspector = createInspector(() => {
    selected = null;
    history.replaceState(null, '', `${basePath}/${tab}`);
    draw();
  });
  const handle = createCaseHandle(caseId, () => draw());
  // A newly saved draft opens in the panel straight away.
  handle.onDraftSaved = draftId => { tab = 'drafts'; select(draftId); };
  let documents = null;
  let policies = null;

  async function load() {
    root.replaceChildren(loadingState('Loading case…'));
    try {
      await handle.load();
    } catch (error) {
      root.replaceChildren(pageHeader('Case'), error.status === 404
        ? emptyState(`There is no case with the ID "${caseId}".`, null, h('a', { class: 'button', href: '#/cases' }, 'Back to all cases'))
        : errorState(error, load));
    }
  }

  function select(id) {
    selected = id;
    history.replaceState(null, '', `${basePath}/${tab}/${encodeURIComponent(id)}`);
    draw({ focusPanel: true });
  }

  async function runChecks(event) {
    const runButton = event.currentTarget;
    runButton.setAttribute('aria-disabled', 'true');
    runButton.textContent = 'Running…';
    flash = null;
    try {
      await actions.runChecks(handle);
    } catch (error) {
      if (error.revisionConflict) {
        flash = notice('warn', 'Checks were not run. The case changed since this page loaded.', 'The latest version is shown now. Run checks again to log it.');
        await handle.load().catch(() => {});
      } else if (error.offline) {
        flash = notice('error', 'Checks were not run. The server could not be reached.', 'Nothing was logged. Try again once the server is running.');
      } else {
        flash = notice('error', 'Checks were not run.', error.message);
      }
      draw();
    }
    document.getElementById('run-checks')?.focus();
  }

  function runLine(detail) {
    if (!detail.lastRun) return h('p', { class: 'run-line' }, 'No run has been logged for this case. The findings below are computed from the current data.');
    return h('p', { class: 'run-line' },
      `Last logged run ${formatTime(detail.lastRun.at)} at revision ${detail.lastRun.details.revision}. `,
      detail.lastRunStale
        ? h('strong', null, 'The case has changed since then. Run checks to log the current findings.')
        : 'The findings below match that run.');
  }

  function draw({ focusPanel = false } = {}) {
    const detail = handle.detail;
    const item = detail.case;

    let panel = null;
    if (selected && tab === 'findings') panel = findingPanel(handle, selected, ctx) || missingPanel();
    if (selected && tab === 'records') panel = recordPanel(handle, selected, ctx) || missingPanel();
    if (selected && tab === 'drafts') panel = draftPanel(handle, selected, ctx) || missingPanel();
    if (tab === 'links') {
      // Stored document metadata is loaded once, the first time this tab is shown.
      documents ??= loadDocumentIndex(caseId, () => { if (tab === 'links') draw(); });
      if (selected) panel = linkPanel(handle, selected, ctx, documents) || missingPanel();
    }

    const tabContent = {
      findings: findingsTab,
      evidence: evidenceTab,
      records: recordsTab,
      tasks: tasksTab,
      policy: () => policyTab(handle, policies, loaded => { policies = loaded?.policies ?? []; if (tab === 'policy') draw(); }),
      drafts: draftsTab,
      documentation: documentationTab,
      paperwork: () => paperworkTab(handle, { basePath, selected }),
      links: () => linksTab(handle, ctx, selected, select),
      history: historyTab,
      file: () => caseFile(detail, ctx, handle.drafts),
    }[tab](detail);

    const split = h('div', { class: `split${tab === 'findings' ? ' check-workspace' : ''}` }, h('div', { class: 'split-main' }, tabContent), inspector.el);

    setChildren(root,
      h('p', { class: 'breadcrumb' }, h('a', { href: '#/cases' }, 'Cases'), ' / ', item.title),
      pageHeader(item.title,
        h('span', null, h('span', { class: 'mono' }, item.id), ` · Synthetic case · ${item.agency}${item.recordFamily ? ` · ${item.recordFamily}` : ''}${item.contractNumber ? ` · Contract ${item.contractNumber}` : ''} · Owner: ${item.owner} · Revision ${item.revision}`),
        [button('Edit case', () => actions.editCase(handle, caseSources(ctx, item)), '', 'edit-case'),
          h('button', { type: 'button', class: tab === 'file' ? 'button' : 'button button-primary', id: 'run-checks', onclick: runChecks }, 'Run checks')]),
      flash,
      journeyStrip(detail.journey),
      runLine(detail),
      h('nav', { class: 'tabs', 'aria-label': 'Case sections' }, tabs.map(entry =>
        h('a', { href: `${basePath}/${entry.id}`, 'aria-current': entry.id === tab ? 'page' : null }, entry.label, tabCount(entry.id, detail)))),
      split);

    if (panel) inspector.show(panel.title, panel.node, { focus: focusPanel });
    else if (inspector.isOpen) inspector.close();
  }

  function tabCount(id, detail) {
    const count = {
      findings: detail.report.findings.filter(finding => ['needs-evidence', 'needs-review', 'blocked'].includes(finding.status)).length,
      evidence: detail.case.evidence.length,
      records: detail.case.records.length,
      tasks: detail.tasks.filter(task => task.status !== 'done').length,
      drafts: handle.drafts.length,
      policy: detail.policyContext ? detail.policyContext.counts.unresolved + detail.policyContext.counts.requiresReassessment : undefined,
    }[id];
    return count === undefined ? null : h('span', { class: 'tab-count' }, ` ${count}`, h('span', { class: 'visually-hidden' }, id === 'findings' ? ' open' : id === 'tasks' ? ' not done' : ' total'));
  }

  // ---------- Tabs ----------

  // Documentation completeness and the gaps detected on this case. Both are computed by the server each time.
  function documentationTab() {
    const box = h('div', { class: 'stack' }, loadingState('Loading documentation completeness…'));
    const fill = async () => {
      let result;
      try {
        result = await api.getCaseDocumentation(caseId);
      } catch (error) {
        box.replaceChildren(errorState(error, fill));
        return;
      }
      const { score, gaps } = result;
      box.replaceChildren(
        h('section', null,
          h('h2', null, 'Documentation completeness'),
          h('p', { class: 'completeness-total' }, completeness(score)),
          facts([
            ['Evidence checks that apply', `${score.checks.complete} of ${score.checks.countable} have a verified reference and a current, sufficient assessment`],
            ['Checks not counted', `${score.checks.undecided} undecided, ${score.checks.notApplicable} not applicable`],
            ['Records', `${score.records.complete} of ${score.records.countable} have an owner, a confirmed schedule, and a decided hold status`],
            score.records.expectedTypes > 0 && ['Expected record types', `${score.records.expectedTypes - score.records.expectedTypesMissing} of ${score.records.expectedTypes} inventoried`],
            score.records.activeHolds > 0 && ['Active holds', `${score.records.activeHolds}. A hold does not lower the percent, and the record stays preserved.`],
          ], true),
          h('p', { class: 'hint' }, score.limitation)),
        h('section', null,
          h('h2', null, `Detected gaps (${gaps.length})`),
          gaps.length === 0
            ? emptyState('No documentation gap is detected on this case.', 'That means nothing the rules look for is missing. It is not a statement that the case is compliant.')
            : dataTable({
              label: 'Detected gaps',
              rows: gaps,
              columns: [
                { header: 'Gap', cell: gap => h('div', null, h('p', null, h('a', { href: `${basePath}/${gap.section}` }, workflowText(gap.title))), h('p', { class: 'hint wrap' }, workflowText(gap.detail))) },
                { header: 'About', cell: gap => h('span', { class: 'wrap' }, gap.subjectTitle) },
                { header: 'What would clear it', cell: gap => h('span', { class: 'wrap' }, workflowText(gap.toClear)) },
                { header: 'Reviewer decision', cell: gap => h('div', null, status(gapStatus, gap.status),
                  gap.decision?.current && h('p', { class: 'hint wrap' }, gap.decision.note),
                  gap.decision && !gap.decision.current && h('p', { class: 'hint' }, 'An earlier decision no longer matches this gap.')) },
                { header: 'Action', cell: gap => button('Review', () => actions.decideGap(caseId, result.caseRevision, gap, async () => { await handle.load(); announce('Decision recorded.'); }, () => handle.load()), 'button-small', `gap-${gap.ruleId}-${gap.subjectId}`) },
              ],
            }),
          h('p', { class: 'hint' }, result.limitation, ' ', result.identity.notice)));
    };
    fill();
    return box;
  }

  function findingsTab(detail) {
    const item = detail.case;
    return h('div', null,
      dataTable({
        label: 'Findings',
        rows: detail.report.findings,
        isSelected: finding => finding.id === selected,
        columns: [
          { header: 'Check', cell: finding => rowButton(finding.title, () => select(finding.id), finding.id === selected, `open-${finding.id}`) },
          { header: 'Area', cell: finding => areaLabel(finding, item) },
          { header: 'Status', cell: finding => status(findingStatus, finding.status) },
          { header: 'Authority', cell: finding => authority(finding.sourceIds, caseSources(ctx, item)) },
          { header: 'Does this check apply?', cell: finding => {
            if (finding.category !== 'contracting') return '';
            return applicabilityLabels[item.applicability[finding.id.slice(item.id.length + 1)]];
          } },
          { header: 'Evidence', cell: finding => {
            if (finding.category !== 'contracting') return '';
            const supplied = item.evidence.filter(entry => finding.evidenceIds.includes(entry.id));
            return supplied.length ? `${supplied.filter(entry => entry.verified).length} of ${supplied.length} verified` : 'None supplied';
          } },
          { header: 'Open tasks', class: 'num', cell: finding => {
            const open = detail.tasks.filter(task => task.findingId === finding.id && task.status !== 'done').length;
            return open ? String(open) : '';
          } },
        ],
      }),
      h('p', { class: 'hint' }, detail.report.limitation, ' Missing evidence in this workspace does not establish agency noncompliance.'));
  }

  function evidenceTab(detail) {
    const item = detail.case;
    return h('div', null,
      h('div', { class: 'tab-bar' },
        h('p', { class: 'hint' }, 'References only. No document contents are stored, read, or validated.'),
        button('Add reference', () => actions.addEvidence(handle), '', 'add-evidence')),
      item.evidence.length === 0
        ? emptyState('No evidence references on this case.', 'Add a reference to record where a supporting document lives.')
        : dataTable({
            label: 'Evidence references',
            rows: item.evidence,
            columns: [
              { header: 'Reference', cell: entry => h('span', { class: 'wrap' }, entry.title) },
              { header: 'Supports', cell: entry => evidenceKinds[entry.kind] || entry.kind },
              { header: 'Document location', cell: entry => locator(entry.locator) },
              { header: 'Origin', cell: entry => entry.provenance === 'synthetic' ? 'Synthetic fixture' : 'Added here' },
              { header: 'Verification', cell: entry => entry.verified
                ? h('span', { class: 'status status-ok' }, 'Reference checked')
                : h('span', { class: 'status status-review' }, 'Reference not checked') },
              { header: 'Actions', cell: entry => h('span', { class: 'button-row' },
                !entry.verified && button('Verify', () => actions.verifyEvidence(handle, entry), 'button-small', `verify-${entry.id}`),
                button('Correct', () => actions.correctEvidence(handle, entry), 'button-small', `correct-${entry.id}`)) },
            ],
          }));
  }

  function recordsTab(detail) {
    return h('div', null,
      h('div', { class: 'tab-bar' },
        h('p', { class: 'hint' }, 'Review dates prompt a records officer review. They never authorize destruction.'),
        button('Add record', () => actions.addRecord(handle), '', 'add-record')),
      detail.report.records.length === 0
        ? emptyState('No records in this case inventory.', 'Add the records this case creates so ownership, schedule, and holds can be reviewed.')
        : dataTable({
            label: 'Records',
            rows: detail.report.records,
            isSelected: record => record.id === selected,
            columns: [
              { header: 'Record', cell: record => rowButton(record.title, () => select(record.id), record.id === selected, `open-${record.id}`) },
              { header: 'Owner', cell: record => record.owner?.trim() ? record.owner : h('span', { class: 'missing' }, 'Not assigned') },
              { header: 'Hold', cell: record => status(holdStatus, record.hold) },
              { header: 'Retention', cell: record => status(retentionStatus, record.retention.status) },
              { header: 'Review date', cell: record => reviewDateText(record.retention) },
            ],
          }));
  }

  function tasksTab(detail) {
    const titleOf = findingId => detail.report.findings.find(finding => finding.id === findingId)?.title || 'Finding no longer present';
    return h('div', null,
      h('div', { class: 'tab-bar' },
        h('p', { class: 'hint' }, 'Finishing a task does not clear its finding. The last column shows where the finding stands now.'),
        button('New task', () => actions.createTask(handle), '', 'new-task')),
      detail.tasks.length === 0
        ? emptyState('No follow-up tasks on this case.', 'Create a task to assign work on a finding and give it a due date.')
        : dataTable({
            label: 'Follow-up tasks',
            rows: detail.tasks,
            columns: [
              { header: 'Task', cell: task => rowButton(task.title, () => actions.editTask(handle, task), false, `task-${task.id}`) },
              { header: 'Finding', cell: task => titleOf(task.findingId) },
              { header: 'Assigned to', cell: task => task.owner },
              { header: 'Due', cell: task => task.dueDate ? [formatDay(task.dueDate), task.overdue && h('span', { class: 'overdue' }, ' Overdue')] : 'No date' },
              { header: 'Task status', cell: task => status(taskStatus, task.status) },
              { header: 'Finding now', cell: task => status(findingStatus, task.findingStatus) },
            ],
          }));
  }

  function draftsTab() {
    return h('div', null,
      h('div', { class: 'tab-bar' },
        h('p', { class: 'hint' }, 'Review notes prepared from the findings. A decision is tied to the exact text and evidence it was made against, and goes out of date if either changes.'),
        button('Prepare review note', () => actions.prepareDraft(handle), '', 'prepare-draft')),
      h('p', { class: 'hint' }, handle.draftIdentity?.notice),
      handle.drafts.length === 0
        ? emptyState('No review notes yet.', 'Prepare a note from the current findings, edit it, and route it to a reviewer.')
        : dataTable({
            label: 'Review drafts',
            rows: handle.drafts,
            isSelected: draft => draft.id === selected,
            columns: [
              { header: 'Review note', cell: draft => rowButton(draft.title, () => select(draft.id), draft.id === selected, `open-${draft.id}`) },
              { header: 'Standing', cell: draft => h('span', { class: `status status-${draft.needsFreshReview ? 'warn' : draftStates[draft.state]?.tone || 'muted'}` }, draftStanding(draft)) },
              { header: 'Version', class: 'num', cell: draft => String(draft.version) },
              { header: 'Author', cell: draft => draft.author },
              { header: 'Routed to', cell: draft => draft.reviewer || h('span', { class: 'missing' }, 'No one yet') },
              { header: 'Findings cited', class: 'num', cell: draft => String(draft.findingIds.length) },
              { header: 'Updated', cell: draft => formatTime(draft.updatedAt) },
            ],
          }));
  }

  function historyTab() {
    const runs = createList({
      label: 'Logged check runs',
      pageSize: 10,
      fixed: { caseId, action: 'analysis-run' },
      load: api.getActivity,
      emptyText: 'No check runs have been logged for this case.',
      columns: [
        { header: 'Run', cell: event => formatTime(event.at) },
        { header: 'Review date', cell: event => formatDay(event.details.asOf) },
        { header: 'Case revision', class: 'num', cell: event => String(event.details.revision) },
        { header: 'Needs evidence', class: 'num', cell: event => String(event.details.summary.needsEvidence) },
        { header: 'Needs review', class: 'num', cell: event => String(event.details.summary.needsReview) },
        { header: 'Blocked by hold', class: 'num', cell: event => String(event.details.summary.blocked) },
        { header: 'Reference checked', class: 'num', cell: event => String(event.details.summary.evidencePresent) },
      ],
    });
    const changes = createList({
      label: 'Case activity',
      pageSize: 10,
      fixed: { caseId },
      load: api.getActivity,
      emptyText: 'No activity has been logged for this case.',
      columns: [
        { header: 'When', cell: event => formatTime(event.at) },
        { header: 'Action', cell: event => actionLabels[event.action] || event.action },
        { header: 'Subject', cell: event => h('span', { class: 'wrap' }, describeEvent(event).subject) },
        { header: 'Reason given', cell: event => h('span', { class: 'wrap' }, describeEvent(event).note) },
        { header: 'Case revision', class: 'num', cell: event => event.caseRevision === null ? '' : String(event.caseRevision) },
      ],
    });
    return h('div', { class: 'stack' },
      h('section', null, h('h2', null, 'Analysis history'), runs.el),
      h('section', null, h('h2', null, 'All activity on this case'), changes.el,
        h('p', { class: 'hint' }, 'Before and after values for each change are in ', h('a', { href: '#/activity' }, 'Activity'), ' and in the audit export.')));
  }

  load();
  return {
    key: `cases/${caseId}`,
    el: root,
    update(next) {
      tab = tabs.some(entry => entry.id === next.parts[1]) ? next.parts[1] : 'findings';
      selected = next.parts[2] || null;
      if (handle.detail) draw({ focusPanel: Boolean(selected) });
    },
  };
}
