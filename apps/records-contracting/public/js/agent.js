// Guided assistant panel. Every button runs one fixed, read-only tool through
// POST /api/cases/:id/agent and shows the tool trace. No language model is involved.

import * as api from './api.js';
import { h, status, facts, notice, loadingState, locator, findingStatus, retentionStatus, taskStatus, holdStatus, applicabilityLabels, formatDay, formatTime, announce } from './dom.js';
import { isKnownRoute } from './routes.js';

const caseIntents = [
  { value: 'overview', label: 'Summarize this case', tool: 'analyze_case' },
  { value: 'evidence', label: 'List evidence gaps', tool: 'list_evidence_gaps' },
  { value: 'tasks', label: 'Show follow-up tasks', tool: 'list_follow_up_tasks' },
  { value: 'retention', label: 'Review retention', tool: 'review_retention' },
  { value: 'handoff', label: 'Preview the case handoff', tool: 'preview_handoff' },
];
const findingIntents = [
  { value: 'explain-finding', label: 'Explain the selected finding', tool: 'explain_finding' },
  { value: 'finding-evidence', label: 'Show supporting and missing evidence', tool: 'evidence_for_finding' },
];

export function setupAgent(ctx) {
  const panel = document.getElementById('agent-panel');
  const toggle = document.getElementById('agent-toggle');
  const shell = document.getElementById('shell');
  const local = { cases: [], caseId: null, findings: [], findingId: null, phase: 'idle', response: null, error: null, ranAt: null, loadError: null, query: '' };

  async function loadFindings() {
    local.findings = [];
    if (!local.caseId) return;
    try {
      local.findings = (await api.getCase(local.caseId)).report.findings;
      if (!local.findings.some(finding => finding.id === local.findingId)) local.findingId = local.findings[0]?.id || null;
    } catch { /* the case buttons still work without the finding list */ }
  }

  async function setOpen(open) {
    panel.hidden = !open;
    shell.classList.toggle('agent-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (!open) {
      toggle.focus();
      return;
    }
    draw();
    document.getElementById('agent-title').focus();
    try {
      local.cases = (await api.getCases()).cases;
      local.loadError = null;
      // Pick up the case and finding of the page that is open behind the panel.
      const here = contextOf(lastRoute);
      if (here.caseId) local.caseId = here.caseId;
      if (here.findingId) local.findingId = here.findingId;
      if (!local.cases.some(item => item.id === local.caseId)) local.caseId = local.cases[0]?.id || null;
      await loadFindings();
    } catch (error) {
      local.loadError = error;
    }
    draw();
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });

  async function run(intent, extra = {}) {
    local.phase = 'loading';
    local.error = null;
    draw();
    try {
      local.response = await api.runAgent(local.caseId, intent, extra);
      local.ranAt = new Date().toISOString();
      local.phase = 'done';
      announce('Assistant result ready.');
    } catch (error) {
      local.error = error;
      local.phase = 'error';
    }
    draw();
    document.getElementById('agent-output')?.focus();
  }

  function intentButton(intent, extra, disabled) {
    const tool = ctx.tools.find(entry => entry.name === intent.tool);
    return h('button', { type: 'button', class: 'agent-intent', disabled: disabled || local.phase === 'loading', onclick: () => run(intent.value, extra) },
      h('span', { class: 'agent-intent-label' }, intent.label),
      h('span', { class: 'hint' }, tool ? tool.description : ''));
  }

  function draw() {
    const head = h('div', { class: 'inspector-head' },
      h('h2', { id: 'agent-title', tabindex: '-1' }, 'Guided assistant'),
      h('button', { type: 'button', class: 'button button-quiet', onclick: () => setOpen(false) }, 'Close'));
    const mode = notice('info', 'Deterministic guided mode',
      'Each button runs one fixed, read-only tool and shows exactly what it returned. No language model is connected, so it cannot answer free-form questions. It can explain a finding, list evidence and tasks, preview the handoff, and take you to a page.');

    if (local.loadError) {
      panel.replaceChildren(head, mode, notice('error', 'Cases could not be loaded', local.loadError.offline ? 'The local server is not reachable.' : local.loadError.message));
      return;
    }
    if (local.cases.length === 0) {
      panel.replaceChildren(head, mode, h('p', { class: 'hint' }, 'Loading cases, or the workspace has none yet.'));
      return;
    }

    const caseSelect = h('select', { id: 'agent-case' }, local.cases.map(item => h('option', { value: item.id }, item.title)));
    caseSelect.value = local.caseId;
    caseSelect.addEventListener('change', async () => {
      local.caseId = caseSelect.value;
      local.findingId = null;
      local.phase = 'idle';
      local.response = null;
      await loadFindings();
      draw();
    });

    const findingSelect = h('select', { id: 'agent-finding' }, local.findings.map(finding => h('option', { value: finding.id }, finding.title)));
    if (local.findingId) findingSelect.value = local.findingId;
    findingSelect.addEventListener('change', () => { local.findingId = findingSelect.value; });

    const goInput = h('input', { type: 'text', id: 'agent-go', maxlength: '200', autocomplete: 'off' });
    goInput.value = local.query;
    const goForm = h('form', { class: 'agent-go' },
      h('label', { for: 'agent-go', class: 'label' }, 'Go to a page or case section'),
      h('div', { class: 'line' }, goInput, h('button', { type: 'submit', class: 'button' }, 'Find')),
      h('p', { class: 'hint' }, 'For example: evidence library, review drafts, case file, tasks. Matched against a fixed list of pages.'));
    goForm.addEventListener('submit', event => {
      event.preventDefault();
      local.query = goInput.value.trim();
      run('navigate', { query: local.query });
    });

    panel.replaceChildren(head, mode,
      h('div', { class: 'field' }, h('label', { for: 'agent-case', class: 'label' }, 'Case'), caseSelect),
      h('div', { class: 'agent-intents', role: 'group', 'aria-label': 'About this case' }, caseIntents.map(intent => intentButton(intent, {}, false))),
      h('div', { class: 'field' }, h('label', { for: 'agent-finding', class: 'label' }, 'Finding'), findingSelect),
      h('div', { class: 'agent-intents', role: 'group', 'aria-label': 'About the selected finding' },
        findingIntents.map(intent => h('button', { type: 'button', class: 'agent-intent', disabled: !local.findings.length || local.phase === 'loading', onclick: () => run(intent.value, { findingId: findingSelect.value }) },
          h('span', { class: 'agent-intent-label' }, intent.label),
          h('span', { class: 'hint' }, ctx.tools.find(entry => entry.name === intent.tool)?.description || '')))),
      goForm,
      h('div', { id: 'agent-output', class: 'agent-output', tabindex: '-1' }, output()));
  }

  function output() {
    if (local.phase === 'idle') return h('p', { class: 'hint' }, 'Choose an action to run a tool on the selected case.');
    if (local.phase === 'loading') return loadingState('Running the tool…');
    if (local.phase === 'error') return notice('error', 'The tool call failed', local.error.offline ? 'The local server is not reachable.' : local.error.message);

    const { response } = local;
    return [
      h('h3', null, 'Tool trace'),
      h('ol', { class: 'trace' }, response.trace.map(step => h('li', null,
        'Called ', h('code', null, step.tool), ' on ', h('span', { class: 'mono' }, step.caseId),
        step.findingId ? [', finding ', h('span', { class: 'mono wrap' }, step.findingId)] : null,
        step.asOf ? `, screening date ${formatDay(step.asOf)}` : ''))),
      h('p', { class: 'hint' }, `Mode: ${response.mode}. Ran ${formatTime(local.ranAt)}.`),
      h('h3', null, 'Result'),
      resultFor(response, run),
      h('p', { class: 'hint' }, response.note),
    ];
  }

  // The case and finding a page address refers to, if any.
  function contextOf(route) {
    if (!route) return {};
    if (route.name === 'cases' && route.parts[0]) {
      return { caseId: route.parts[0], findingId: ['findings', 'links'].includes(route.parts[1]) && route.parts[2] ? route.parts[2] : null };
    }
    if (route.name === 'workbench' && route.parts[0]) {
      return { caseId: local.cases.find(item => route.parts[0].startsWith(`${item.id}:`))?.id || null, findingId: route.parts[0] };
    }
    return {};
  }

  // Keep the selected case and finding in step with the page the user is on.
  let lastRoute = null;
  function followRoute(route) {
    lastRoute = route;
    if (panel.hidden) return;
    const { caseId, findingId } = contextOf(route);
    if (!caseId || (caseId === local.caseId && (!findingId || findingId === local.findingId))) return;
    const caseChanged = caseId !== local.caseId;
    local.caseId = caseId;
    if (findingId) local.findingId = findingId;
    if (caseChanged) {
      local.phase = 'idle';
      local.response = null;
      loadFindings().then(draw);
    } else {
      draw();
    }
  }

  return { followRoute };
}

function findingLine(finding, detailed) {
  return h('li', null,
    h('div', { class: 'line' }, h('span', null, finding.title), status(findingStatus, finding.status)),
    detailed && h('p', { class: 'hint' }, finding.explanation),
    detailed && h('p', { class: 'hint' }, `Next action: ${finding.nextAction}`));
}

const referenceList = entries => h('ul', { class: 'item-list' }, entries.map(entry => h('li', null,
  h('p', { class: 'wrap' }, entry.title), h('p', { class: 'hint wrap' }, locator(entry.locator)))));

function resultFor(response, run) {
  const { intent, result } = response;

  if (intent === 'overview') {
    return [
      facts([
        ['Review date', formatDay(result.asOf)],
        ['Checks', String(result.summary.total)],
        ['Needs evidence', String(result.summary.needsEvidence)],
        ['Needs review', String(result.summary.needsReview)],
        ['Blocked by hold', String(result.summary.blocked)],
      ]),
      h('ul', { class: 'item-list' }, result.findings.map(finding => findingLine(finding, false))),
      h('p', { class: 'hint' }, result.limitation),
    ];
  }

  if (intent === 'evidence') {
    if (result.length === 0) return h('p', null, 'The tool returned no evidence gaps or pending checks for this case.');
    return h('ul', { class: 'item-list' }, result.map(finding => findingLine(finding, true)));
  }

  if (intent === 'tasks') {
    if (result.length === 0) return h('p', null, 'The tool returned no follow-up tasks for this case.');
    return [
      h('ul', { class: 'item-list' }, result.map(task => h('li', null,
        h('div', { class: 'line' }, h('span', null, task.title), status(taskStatus, task.status)),
        h('p', { class: 'hint' }, `${task.owner} · ${task.dueDate ? `due ${formatDay(task.dueDate)}` : 'no due date'}${task.overdue ? ' · overdue' : ''}`),
        h('p', { class: 'hint' }, 'Finding now: ', status(findingStatus, task.findingStatus))))),
      h('p', { class: 'hint' }, 'A done task does not clear its finding.'),
    ];
  }

  if (intent === 'explain-finding') {
    return [
      h('div', { class: 'line' }, h('strong', null, result.finding.title), status(findingStatus, result.finding.status)),
      h('p', null, result.finding.explanation),
      facts([
        ['Next action', result.finding.nextAction],
        result.applicability && ['Does this check apply?', applicabilityLabels[result.applicability]],
        ['Sources', result.finding.sourceIds.join(', ')],
        result.record && ['Record', `${result.record.title}: ${holdStatus[result.record.hold]?.label}, ${retentionStatus[result.record.retention.status]?.label}`],
        ['Follow-up tasks', result.tasks.length ? result.tasks.map(task => `${task.title} (${taskStatus[task.status]?.label})`).join('; ') : 'None'],
      ]),
      h('p', { class: 'hint' }, result.limitation),
      h('p', null, h('a', { href: `#/workbench/${encodeURIComponent(result.finding.id)}` }, 'Open this finding in the workbench')),
    ];
  }

  if (intent === 'finding-evidence') {
    return [
      h('div', { class: 'line' }, h('strong', null, result.title), status(findingStatus, result.status)),
      h('h3', null, 'Supporting (verified references)'),
      result.supporting.length ? referenceList(result.supporting) : h('p', { class: 'hint' }, 'None.'),
      h('h3', null, 'On file but unverified'),
      result.unverified.length ? referenceList(result.unverified) : h('p', { class: 'hint' }, 'None.'),
      h('h3', null, 'Missing'),
      h('p', null, result.missing || 'Nothing is missing for this check. A verified reference is not approval of the document.'),
      h('p', { class: 'hint' }, `Sources: ${result.sourceIds.join(', ')}`),
    ];
  }

  if (intent === 'handoff') {
    return [
      h('p', null, result.note),
      facts([
        ['Evidence references', `${result.evidence.verified} verified of ${result.evidence.total}`],
        ['Open tasks', String(result.openTasks.length)],
      ]),
      h('h3', null, 'Unresolved findings in the packet'),
      result.unresolvedFindings.length ? h('ul', { class: 'item-list' }, result.unresolvedFindings.map(finding => findingLine(finding, false))) : h('p', { class: 'hint' }, 'None.'),
      h('h3', null, 'Active holds in the packet'),
      result.activeHolds.length ? h('ul', { class: 'item-list' }, result.activeHolds.map(record => h('li', null, `${record.title}. Must stay preserved.`))) : h('p', { class: 'hint' }, 'None.'),
      h('p', null, h('a', { href: `#/cases/${encodeURIComponent(result.caseId)}/file` }, 'Open the case file to download the packet')),
    ];
  }

  if (intent === 'navigate') {
    if (!result.matched) {
      return [
        h('p', null, 'No page matches that. This assistant only matches page names. Choose a page:'),
        h('div', { class: 'button-row' }, result.destinations.map(destination =>
          h('button', { type: 'button', class: 'button button-small', onclick: () => run('navigate', { destination: destination.id }) }, destination.label))),
      ];
    }
    // Only follow addresses that belong to this application.
    if (!isKnownRoute(result.destination.hash)) return h('p', null, 'The tool returned an address this application does not have, so it was not followed.');
    return h('p', null, h('a', { class: 'button button-primary', href: result.destination.hash, id: 'agent-open' }, `Open ${result.destination.label}`));
  }

  if (result.length === 0) return h('p', null, 'The tool returned no records for this case.');
  return [
    h('ul', { class: 'item-list' }, result.map(record => h('li', null,
      h('div', { class: 'line' }, h('span', null, record.title), status(retentionStatus, record.retention.status)),
      h('p', { class: 'hint' }, record.retention.reason),
      record.retention.reviewDate && h('p', { class: 'hint' }, `Review date: ${formatDay(record.retention.reviewDate)}`)))),
    h('p', { class: 'hint' }, 'The tool never authorizes destruction. Every result carries canDestroy: false.'),
  ];
}
