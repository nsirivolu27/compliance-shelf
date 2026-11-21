// Funding: synthetic VA and SSA program and project budgets, allocation requests and their recorded decisions.
// Every total is computed by the server in whole cents. Proposals are shown apart and never reduce the
// remaining budget; only an approval does. Decisions are simulated: no government payment is sent.

import * as api from '../api.js';
import { h, setChildren, pageHeader, loadingState, errorState, emptyState, button, notice, facts, status, announce, formatDay, formatTime, openReadDialog } from '../dom.js';
import { openForm } from '../forms.js';
import { parseUsd, formatUsd, usdInput } from '../money.js';

const agencies = ['va', 'ssa'];
const agencyLabels = { va: 'VA', ssa: 'SSA' };
const stateMap = {
  draft: { label: 'Draft', tone: 'muted' },
  proposed: { label: 'Proposed', tone: 'review' },
  approved: { label: 'Approved (simulated)', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'muted' },
  reversed: { label: 'Reversed', tone: 'warn' },
};
const historyLabels = {
  'budget-created': 'Budget created', 'budget-amended': 'Budget amended', 'allocation-created': 'Request created',
  'allocation-edited': 'Request edited', propose: 'Proposed', approve: 'Approved (simulated)', reject: 'Rejected', reverse: 'Reversed',
};
const decisionCopy = {
  propose: { title: 'Propose request', submit: 'Propose request', done: 'Request proposed. It does not reduce the remaining budget.' },
  approve: { title: 'Approve allocation', submit: 'Approve allocation (simulated)', done: 'Allocation approved as a simulated demo decision.' },
  reject: { title: 'Reject request', submit: 'Reject request', done: 'Request rejected. The decision is kept in its history.' },
  reverse: { title: 'Record reversal', submit: 'Record reversal', done: 'Reversal recorded. The amount is back in the remaining budget and the original approval is kept.' },
};
const fieldLabels = {
  name: 'Budget name', availableCents: 'Available funds', owner: 'Owner', note: 'Supporting note', destination: 'Destination', purpose: 'Purpose',
  requestedCents: 'Requested amount', approvedCents: 'Approved allocation', caseId: 'Supporting case', evidenceIds: 'Supporting documents',
  assessmentIds: 'Reviewer assessments', rationale: 'Rationale', neededBy: 'Needed by', state: 'Status',
};
const outcomeLabels = { 'sufficient-for-stated-check': 'sufficient for the stated check', insufficient: 'insufficient', 'needs-clarification': 'needs clarification' };

const amountError = value => {
  const cents = parseUsd(value);
  if (cents === null) return 'Enter dollars and cents, such as 250,000.00. No minus sign.';
  return cents > 0 ? null : 'Enter an amount above $0.00.';
};
const amountField = (name, label, value, hint) => ({ name, label, required: true, maxlength: 24, value, hint: hint || 'US dollars and cents, such as 250,000.00.', validate: amountError });
const reasonField = (name, label, hint) => ({ name, type: 'textarea', label, hint, required: true, minlength: 10, maxlength: 2000, rows: 3 });
const draftHint = 'Unsaved input is kept for this form while this tab remains open. Closing the browser clears it.';

function currentFiscalYear() {
  const today = new Date();
  return today.getUTCFullYear() + (today.getUTCMonth() >= 9 ? 1 : 0);
}

function filtersFrom(query) {
  const filters = {};
  for (const key of ['agency', 'program', 'fiscalYear', 'status']) if (query[key]) filters[key] = query[key];
  return filters;
}

const figure = (label, cents, hint) => h('div', { class: 'funding-figure' },
  h('dt', null, label), h('dd', { class: 'funding-amount' }, formatUsd(cents)), hint && h('dd', { class: 'hint' }, hint));

function figures(totals) {
  return h('dl', { class: 'funding-figures' },
    figure('Available funds', totals.availableCents),
    figure('Proposed allocations', totals.proposedCents, 'Not approved. Does not reduce the remaining budget.'),
    figure('Approved allocations', totals.approvedCents),
    figure('Remaining budget', totals.remainingCents));
}

function changeLines(before, after) {
  if (!before || !after) return null;
  const show = (key, value) => {
    if (value === null || value === undefined || value === '') return 'None';
    if (key.endsWith('Cents')) return formatUsd(value);
    if (key === 'state') return stateMap[value]?.label ?? value;
    return Array.isArray(value) ? (value.join(', ') || 'None') : String(value);
  };
  const keys = Object.keys(after).filter(key => key !== 'state' && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  return keys.length ? h('ul', { class: 'plain-list' }, keys.map(key => h('li', null, `${fieldLabels[key] || key}: ${show(key, before[key])} → ${show(key, after[key])}`))) : null;
}

function historyList(entries) {
  return h('ol', { class: 'funding-history' }, entries.map(entry => h('li', null,
    h('p', null, h('strong', null, historyLabels[entry.action] || entry.action), ` · ${formatTime(entry.at)} · ${entry.actor}`),
    entry.fromState !== undefined && entry.fromState !== entry.toState && h('p', null, `Status: ${stateMap[entry.fromState]?.label ?? 'New'} → ${stateMap[entry.toState]?.label ?? entry.toState}`),
    entry.remainingBeforeCents !== undefined && entry.remainingBeforeCents !== entry.remainingAfterCents && h('p', null, `Remaining budget: ${formatUsd(entry.remainingBeforeCents)} → ${formatUsd(entry.remainingAfterCents)}`),
    changeLines(entry.before, entry.after),
    h('p', { class: 'wrap' }, h('span', { class: 'funding-label' }, 'Rationale: '), entry.rationale),
    entry.evidenceAtDecision?.gaps?.length ? h('p', { class: 'hint wrap' }, `Open evidence gaps at that time: ${entry.evidenceAtDecision.gaps.join(' ')}`) : null,
    entry.label && h('p', { class: 'hint' }, entry.label))));
}

function supportBlock(support) {
  return h('div', { class: 'funding-support' },
    h('p', { class: 'funding-label' }, 'Supporting documents'),
    support.caseId && h('p', null, h('a', { href: `#/cases/${encodeURIComponent(support.caseId)}` }, support.caseTitle || support.caseId)),
    support.documents.length ? h('ul', { class: 'plain-list' }, support.documents.map(doc => h('li', { class: 'wrap' },
      doc.missing ? `${doc.id}: no longer on the case` : `${doc.title} · ${doc.verified ? 'verified reference' : 'not verified'}`))) : null,
    support.assessments.length ? h('ul', { class: 'plain-list' }, support.assessments.map(entry => h('li', { class: 'wrap' },
      entry.missing ? `Assessment ${entry.id}: no longer on the case` : `Assessment: ${outcomeLabels[entry.outcome] || entry.outcome}, ${formatTime(entry.at)}${entry.latestForCheck ? '' : ' (a newer assessment exists)'}`))) : null,
    support.gaps.length
      ? h('div', { class: 'funding-gaps' }, h('p', { class: 'emphasis-warn' }, `Missing or open (${support.gaps.length})`), h('ul', { class: 'plain-list' }, support.gaps.map(gap => h('li', { class: 'wrap' }, gap))))
      : h('p', { class: 'hint' }, 'No missing evidence listed. This is not a compliance determination.'));
}

export function create(route) {
  let filters = filtersFrom(route.query);
  let data = null;
  let reloading = null;
  const filterBar = h('div', { class: 'funding-filters' });
  const body = h('div', { class: 'stack' }, loadingState('Loading funding…'));

  const latestBudget = id => data?.budgets.find(budget => budget.id === id);

  // Rejects when the reload fails, so a form that just saved can say so instead of hiding it.
  async function load(focusId) {
    const keepFocus = focusId || document.activeElement?.id;
    const request = api.getFunding(filters);
    reloading = request.then(() => {}, () => {});
    try {
      data = await request;
    } catch (error) {
      setChildren(body, errorState(error, () => load().catch(() => {})));
      throw error;
    } finally {
      reloading = null;
    }
    render();
    if (keepFocus) document.getElementById(keepFocus)?.focus();
  }

  function setFilters(next) {
    const query = new URLSearchParams(Object.entries(next).filter(([, value]) => value));
    location.hash = `#/funding${query.size ? `?${query}` : ''}`;
  }

  function filterSelect(name, label, choices) {
    const id = `funding-filter-${name}`;
    const select = h('select', { id }, choices.map(choice => h('option', { value: choice.value }, choice.label)));
    select.value = filters[name] ?? '';
    select.addEventListener('change', () => setFilters({ ...filters, [name]: select.value || undefined, ...(name === 'agency' ? { program: undefined } : {}) }));
    return h('div', { class: 'toolbar-field' }, h('label', { for: id }, label), select);
  }

  function renderFilters() {
    const programs = data.options.programs.filter(entry => !filters.agency || entry.agency === filters.agency);
    setChildren(filterBar, h('form', { class: 'toolbar', 'aria-label': 'Filter funding', onsubmit: event => event.preventDefault() },
      filterSelect('agency', 'Agency', [{ value: '', label: 'All agencies' }, ...agencies.map(agency => ({ value: agency, label: agencyLabels[agency] }))]),
      filterSelect('program', 'Program or project', [{ value: '', label: 'All programs' }, ...programs.map(entry => ({ value: entry.program, label: `${entry.program} (${agencyLabels[entry.agency]})` }))]),
      filterSelect('fiscalYear', 'Fiscal year', [{ value: '', label: 'All years' }, ...data.options.fiscalYears.map(year => ({ value: String(year), label: `FY ${year}` }))]),
      filterSelect('status', 'Request status', [{ value: '', label: 'All statuses' }, ...Object.entries(stateMap).map(([value, entry]) => ({ value, label: entry.label }))]),
      Object.keys(filters).length ? button('Clear filters', () => setFilters({}), 'button-small button-quiet', 'funding-filter-clear') : null));
  }

  function render() {
    renderFilters();
    const groups = agencies.map(agency => ({ agency, budgets: data.budgets.filter(budget => budget.agency === agency), summaries: data.summaries.filter(row => row.agency === agency) }))
      .filter(group => group.budgets.length);
    if (!groups.length) {
      setChildren(body, Object.keys(filters).length
        ? emptyState('No budgets match these filters.', 'Clear the filters to see every synthetic budget.', button('Clear filters', () => setFilters({}), '', 'funding-empty-clear'))
        : emptyState('No budgets yet.', 'Create a synthetic VA or SSA budget to start. A prepared example runs with npm run demo:funding in its own workspace.', button('New budget', newBudget, 'button-primary', 'funding-empty-new')));
      return;
    }
    setChildren(body, groups.map(agencySection));
  }

  function agencySection({ agency, budgets, summaries }) {
    return h('section', { class: 'funding-agency', 'aria-labelledby': `funding-agency-${agency}` },
      h('h2', { id: `funding-agency-${agency}` }, `${agencyLabels[agency]} budgets`),
      summaries.map(row => h('p', { class: 'hint' }, `${agencyLabels[agency]} totals, fiscal year ${row.fiscalYear}, ${row.budgetCount} ${row.budgetCount === 1 ? 'budget' : 'budgets'}: available ${formatUsd(row.availableCents)} · proposed ${formatUsd(row.proposedCents)} · approved ${formatUsd(row.approvedCents)} · remaining ${formatUsd(row.remainingCents)}. Never combined with the other agency.`)),
      budgets.map(budgetCard));
  }

  function budgetCard(budget) {
    const shown = budget.allocations.length;
    return h('article', { class: 'funding-budget', 'aria-labelledby': `budget-title-${budget.id}` },
      h('header', { class: 'funding-budget-head' },
        h('div', null,
          h('h3', { id: `budget-title-${budget.id}`, tabindex: '-1' }, budget.name),
          h('p', { class: 'hint wrap' }, `${budget.program} · FY ${budget.fiscalYear} · ${budget.fundingSource} · Owner: ${budget.owner}`)),
        h('div', { class: 'button-row' },
          button('New allocation request', () => requestForm(budget), 'button-small button-primary', `fund-new-${budget.id}`),
          button('Amend budget', () => amendForm(budget), 'button-small', `fund-amend-${budget.id}`),
          button('Budget history', () => openReadDialog(`Budget history: ${budget.name}`, h('div', { class: 'inspector-body' }, historyList(budget.history))), 'button-small button-quiet', `fund-bhistory-${budget.id}`))),
      figures(budget.totals),
      budget.totals.proposedBeyondRemainingCents > 0 && h('p', { class: 'emphasis-warn' }, `Proposed requests exceed the remaining budget by ${formatUsd(budget.totals.proposedBeyondRemainingCents)}. Not all of them can be approved.`),
      h('p', { class: 'hint wrap' }, budget.note),
      shown
        ? h('ul', { class: 'funding-requests', 'aria-label': `Allocation requests for ${budget.name}` }, budget.allocations.map(allocation => requestItem(budget, allocation)))
        : h('p', { class: 'missing' }, filters.status ? `No ${stateMap[filters.status]?.label.toLowerCase() ?? filters.status} requests on this budget.` : 'No allocation requests yet.'),
      filters.status && h('p', { class: 'hint' }, `Showing ${shown} of ${budget.allocationCount} requests. The totals above include every request.`));
  }

  function requestItem(budget, allocation) {
    const { id, state } = allocation;
    const decide = action => button(decisionCopy[action].title, () => decisionForm(budget, allocation, action), `button-small${action === 'approve' ? ' button-primary' : ''}`, `fund-${action}-${id}`);
    const actions = [
      ['draft', 'proposed'].includes(state) && button('Edit request', () => requestForm(budget, allocation), 'button-small', `fund-edit-${id}`),
      state === 'draft' && decide('propose'),
      state === 'proposed' && decide('approve'),
      ['draft', 'proposed'].includes(state) && decide('reject'),
      state === 'approved' && decide('reverse'),
      state === 'reversed' && !allocation.openReplacementId && button('Request replacement', () => requestForm(budget, null, allocation), 'button-small', `fund-replace-${id}`),
      button('Decision history', () => openReadDialog(`Decision history: ${allocation.destination}`, h('div', { class: 'inspector-body' },
        h('p', { class: 'hint' }, 'Every change is kept, including reversed approvals. Decisions are simulated; the shared demo login does not identify an individual.'),
        historyList(allocation.history))), 'button-small button-quiet', `fund-history-${id}`),
    ];
    const check = allocation.approvalCheck;
    return h('li', { class: 'funding-request', id: `request-${id}` },
      h('div', { class: 'funding-request-main' },
        h('p', { class: 'funding-request-title' }, h('strong', null, allocation.destination), ' ', status(stateMap, state)),
        h('p', { class: 'wrap' }, allocation.purpose),
        h('p', { class: 'wrap' }, h('span', { class: 'funding-label' }, 'Rationale: '), allocation.rationale),
        h('p', { class: 'hint wrap' }, `Owner: ${allocation.owner}${allocation.neededBy ? ` · Needed by ${formatDay(allocation.neededBy)}` : ''}${allocation.replacesAllocationId ? ' · Replaces a reversed allocation' : ''}${allocation.openReplacementId ? ' · A replacement request is open' : ''}`),
        supportBlock(allocation.support)),
      h('div', { class: 'funding-request-side' },
        facts([
          ['Requested amount', h('span', { class: 'funding-amount' }, formatUsd(allocation.requestedCents))],
          ['Approved allocation', allocation.approvedCents === null ? h('span', { class: 'missing' }, 'None') : h('span', { class: 'funding-amount' }, `${formatUsd(allocation.approvedCents)}${state === 'reversed' ? ' (reversed)' : ''}`)],
        ]),
        check && !check.fits && h('p', { class: 'emphasis-warn' }, `Exceeds the remaining budget by ${formatUsd(check.exceedsByCents)}. Approval would be refused.`),
        h('div', { class: 'button-row' }, actions)));
  }

  // ---------- Forms ----------

  const afterSave = (focusId, message) => async () => {
    await load(focusId);
    announce(message);
  };

  function newBudget() {
    openForm({
      title: 'New budget',
      intro: 'A synthetic program or project budget. The funding-source reference is a made-up identifier; no real account or financial system is used.',
      submitLabel: 'Create budget',
      draftKey: 'funding:new-budget',
      draftHint,
      waitFor: () => reloading,
      fields: [
        { name: 'agency', type: 'radio', label: 'Agency', required: true, value: filters.agency || 'va', options: [{ value: 'va', label: 'VA (synthetic)' }, { value: 'ssa', label: 'SSA (synthetic)' }] },
        { name: 'name', label: 'Budget name', required: true, minlength: 3, maxlength: 160 },
        { name: 'program', label: 'Program or project', required: true, minlength: 3, maxlength: 160 },
        { name: 'fundingSource', label: 'Funding-source reference', required: true, maxlength: 59, hint: 'Synthetic only: SYN-VA- or SYN-SSA- followed by capital letters, digits or hyphens, such as SYN-VA-FY27-0001.',
          validate: (value, values) => {
            if (!/^SYN-(VA|SSA)-[A-Z0-9][A-Z0-9._-]{1,50}$/.test(value)) return 'Use a synthetic reference such as SYN-VA-FY27-0001, in capital letters.';
            return value.split('-')[1].toLowerCase() === values.agency ? null : 'The reference must name the same agency as the budget.';
          } },
        { name: 'fiscalYear', type: 'number', label: 'Fiscal year', required: true, min: 2020, max: 2100, value: currentFiscalYear(), hint: 'Federal fiscal year, which ends on 30 September.' },
        amountField('availableFunds', 'Available funds (USD)', ''),
        { name: 'owner', label: 'Budget owner', required: true, minlength: 2, maxlength: 120 },
        reasonField('note', 'Supporting note', 'Why this budget exists. Saved in the budget history. At least 10 characters.'),
      ],
      submit: (values, keyFor) => {
        const payload = { name: values.name, agency: values.agency, program: values.program, fundingSource: values.fundingSource, fiscalYear: values.fiscalYear, availableCents: parseUsd(values.availableFunds), owner: values.owner, note: values.note };
        return api.createBudget(payload, keyFor(payload));
      },
      onSuccess: result => afterSave(`budget-title-${result.budget.id}`, `Budget created: ${result.budget.name}.`)(),
    });
  }

  function amendForm(budget) {
    const current = () => latestBudget(budget.id) || budget;
    const valuesOf = item => ({ name: item.name, availableFunds: usdInput(item.availableCents), owner: item.owner, note: item.note });
    openForm({
      title: `Amend budget: ${budget.name}`,
      intro: `Agency, program, funding source and fiscal year identify the budget and cannot change. Available funds cannot go below the approved allocations (${formatUsd(budget.totals.approvedCents)}).`,
      submitLabel: 'Save budget change',
      draftKey: `funding:budget:${budget.id}`,
      subject: 'budget',
      draftHint,
      waitFor: () => reloading,
      getRevision: () => current().revision,
      currentValues: () => valuesOf(current()),
      fields: [
        { name: 'name', label: 'Budget name', required: true, minlength: 3, maxlength: 160, value: budget.name },
        amountField('availableFunds', 'Available funds (USD)', usdInput(budget.availableCents)),
        { name: 'owner', label: 'Budget owner', required: true, minlength: 2, maxlength: 120, value: budget.owner },
        { ...reasonField('note', 'Supporting note'), value: budget.note },
        reasonField('reason', 'Reason for this change', 'Saved in the budget history with the before and after values. At least 10 characters.'),
      ],
      validate: values => {
        const before = valuesOf(current());
        const changed = ['name', 'owner', 'note'].some(key => values[key] !== before[key]) || parseUsd(values.availableFunds) !== current().availableCents;
        return changed ? null : { form: 'Change at least one value before saving.' };
      },
      submit: (values, keyFor, revision) => {
        const latest = current();
        const payload = { expectedRevision: revision, reason: values.reason };
        if (values.name !== latest.name) payload.name = values.name;
        if (values.owner !== latest.owner) payload.owner = values.owner;
        if (values.note !== latest.note) payload.note = values.note;
        if (parseUsd(values.availableFunds) !== latest.availableCents) payload.availableCents = parseUsd(values.availableFunds);
        return api.amendBudget(budget.id, payload, keyFor(payload));
      },
      onConflict: () => load(),
      onSuccess: afterSave(`fund-amend-${budget.id}`, 'Budget change saved.'),
    });
  }

  // A new request, an edit of a draft or proposal, or a replacement for a reversed allocation.
  function requestForm(budget, existing = null, replacing = null) {
    const cases = data.cases.filter(item => item.agency === budget.agency);
    const start = existing || (replacing ? { ...replacing, requestedCents: replacing.approvedCents } : null);
    const linkFields = cases.flatMap((item, index) => [
      item.evidence.length && { name: `evidence_${index}`, type: 'checks', label: 'Supporting documents', kind: 'evidence', caseId: item.id,
        hint: 'Evidence references on this case. Unverified references stay listed as missing.', value: start?.caseId === item.id ? start.evidenceIds : [],
        when: values => values.caseId === item.id,
        options: item.evidence.map(entry => ({ value: entry.id, label: entry.title, hint: `${entry.verified ? 'Verified reference' : 'Not verified'} · ${entry.id}` })) },
      item.assessments.length && { name: `assessment_${index}`, type: 'checks', label: 'Reviewer assessments', kind: 'assessment', caseId: item.id,
        value: start?.caseId === item.id ? start.assessmentIds : [], when: values => values.caseId === item.id,
        options: item.assessments.map(entry => ({ value: entry.id, label: `${entry.findingId}: ${outcomeLabels[entry.outcome] || entry.outcome}`, hint: `${formatTime(entry.at)}${entry.latestForCheck ? '' : ' · a newer assessment exists'}` })) },
    ]).filter(Boolean);
    const window = { start: `${budget.fiscalYear - 1}-10-01`, end: `${budget.fiscalYear}-09-30` };
    const fields = [
      { name: 'destination', label: 'Destination program or project', required: true, minlength: 3, maxlength: 160, value: start?.destination },
      { name: 'purpose', type: 'textarea', label: 'Purpose', required: true, minlength: 10, maxlength: 500, rows: 2, value: start?.purpose },
      amountField('requested', 'Requested amount (USD)', start ? usdInput(start.requestedCents) : '', `Up to the available funds, ${formatUsd(budget.availableCents)}. Remaining now: ${formatUsd(budget.totals.remainingCents)}. A request does not reduce the remaining budget until it is approved.`),
      { name: 'owner', label: 'Responsible owner', required: true, minlength: 2, maxlength: 120, value: start?.owner },
      { name: 'neededBy', type: 'date', label: 'Needed by', value: start?.neededBy ?? '', hint: `Within fiscal year ${budget.fiscalYear}: ${formatDay(window.start)} to ${formatDay(window.end)}.`,
        validate: value => (!value || (value >= window.start && value <= window.end) ? null : `Choose a date in fiscal year ${budget.fiscalYear}.`) },
      { name: 'caseId', type: 'select', label: 'Supporting case', value: start?.caseId ?? '', hint: `${agencyLabels[budget.agency]} synthetic cases only. A request without support stays open with what is missing listed.`,
        options: [{ value: '', label: 'No supporting case yet' }, ...cases.map(item => ({ value: item.id, label: item.title }))] },
      ...linkFields,
      { ...reasonField('rationale', 'Rationale', 'Why this allocation is requested. At least 10 characters.'), value: start?.rationale },
      existing && reasonField('reason', 'Reason for this change', 'Saved in the decision history with the before and after values. At least 10 characters.'),
    ];
    const payloadOf = values => {
      const caseId = values.caseId || null;
      const linked = kind => { const spec = linkFields.find(entry => entry.kind === kind && entry.caseId === caseId); return spec ? values[spec.name] ?? [] : []; };
      return { destination: values.destination, purpose: values.purpose, requestedCents: parseUsd(values.requested), owner: values.owner, caseId,
        evidenceIds: linked('evidence'), assessmentIds: linked('assessment'), rationale: values.rationale, neededBy: values.neededBy || null };
    };
    const current = () => latestBudget(budget.id) || budget;
    const latestRequest = () => current().allocations.find(entry => entry.id === existing?.id) || existing;
    openForm({
      title: existing ? `Edit request: ${existing.destination}` : replacing ? `Replacement for: ${replacing.destination}` : `New allocation request: ${budget.name}`,
      intro: replacing
        ? `Replaces the reversed allocation of ${formatUsd(replacing.approvedCents)}. The reversal and the original approval stay in its decision history. The replacement starts as a draft.`
        : existing ? 'Only drafts and proposals can be edited. Every change is kept with its reason.' : 'The request starts as a draft. Propose it when it is ready for a decision.',
      submitLabel: existing ? 'Save request change' : 'Save draft request',
      draftKey: `funding:request:${existing?.id || replacing?.id || budget.id}`,
      subject: 'budget',
      draftHint,
      waitFor: () => reloading,
      getRevision: () => current().revision,
      currentValues: () => {
        const latest = latestRequest();
        if (!existing || !latest) return { 'Available funds': formatUsd(current().availableCents), 'Remaining budget': formatUsd(current().totals.remainingCents) };
        return { destination: latest.destination, purpose: latest.purpose, requested: usdInput(latest.requestedCents), owner: latest.owner, neededBy: latest.neededBy ?? '', rationale: latest.rationale, 'Request status': stateMap[latest.state].label };
      },
      fields,
      validate: values => {
        if (!existing) return null;
        const next = payloadOf(values);
        const before = latestRequest();
        const changed = Object.keys(next).some(key => JSON.stringify(next[key]) !== JSON.stringify(before[key] ?? null));
        return changed ? null : { form: 'Change at least one value before saving.' };
      },
      submit: (values, keyFor, revision) => {
        const next = payloadOf(values);
        if (!existing) {
          const payload = { expectedRevision: revision, ...next, ...(replacing ? { replacesAllocationId: replacing.id } : {}) };
          return api.createAllocation(budget.id, payload, keyFor(payload));
        }
        const before = latestRequest();
        const payload = { expectedRevision: revision, reason: values.reason };
        for (const [key, value] of Object.entries(next)) if (JSON.stringify(value) !== JSON.stringify(before[key] ?? null)) payload[key] = value;
        return api.changeAllocation(existing.id, payload, keyFor(payload));
      },
      onConflict: () => load(),
      onSuccess: result => afterSave(`fund-history-${result.allocation.id}`, existing ? 'Request change saved.' : 'Draft request saved. It does not reduce the remaining budget.')(),
    });
  }

  function decisionForm(budget, allocation, action) {
    const copy = decisionCopy[action];
    const remaining = BigInt(budget.totals.remainingCents);
    const requested = BigInt(allocation.requestedCents);
    const intro = h('div', { class: 'stack' },
      facts([
        ['Requested amount', formatUsd(allocation.requestedCents)],
        allocation.approvedCents !== null && ['Approved allocation', formatUsd(allocation.approvedCents)],
        ['Remaining budget now', formatUsd(remaining)],
        action === 'approve' && requested <= remaining && ['Remaining after approval', formatUsd(remaining - requested)],
        action === 'reverse' && ['Remaining after reversal', formatUsd(remaining + BigInt(allocation.approvedCents))],
      ]),
      action === 'approve' && requested > remaining && notice('warn', 'This approval exceeds the remaining budget.', `By ${formatUsd(requested - remaining)}. The server will refuse it and nothing will change.`),
      allocation.support.gaps.length ? notice('info', `Missing or open evidence (${allocation.support.gaps.length})`, h('ul', { class: 'plain-list' }, allocation.support.gaps.map(gap => h('li', null, gap)))) : null,
      action === 'reverse' && h('p', null, 'The approval stays in the decision history. To fund this work again, request a replacement after the reversal.'),
      h('p', { class: 'hint' }, `Simulated demo decision; no government payment is sent. ${data.identity.notice}`));
    openForm({
      title: `${copy.title}: ${allocation.destination}`,
      intro,
      submitLabel: copy.submit,
      draftKey: `funding:decision:${allocation.id}:${action}`,
      subject: 'budget',
      draftHint,
      waitFor: () => reloading,
      getRevision: () => (latestBudget(budget.id) || budget).revision,
      currentValues: () => {
        const latest = latestBudget(budget.id);
        const request = latest?.allocations.find(entry => entry.id === allocation.id);
        return { 'Request status': request ? stateMap[request.state].label : 'Not shown with the current filters', 'Remaining budget': latest ? formatUsd(latest.totals.remainingCents) : 'Not shown with the current filters' };
      },
      fields: [reasonField('rationale', 'Rationale', 'Saved with the decision in the decision history. At least 10 characters.')],
      submit: (values, keyFor, revision) => {
        const payload = { expectedRevision: revision, action, rationale: values.rationale };
        return api.decideAllocation(allocation.id, payload, keyFor(payload));
      },
      onConflict: () => load(),
      onSuccess: afterSave(`fund-history-${allocation.id}`, copy.done),
    });
  }

  load().catch(() => {});
  return {
    key: 'funding',
    update(next) {
      filters = filtersFrom(next.query);
      load().catch(() => {});
    },
    el: h('div', { class: 'funding' },
      pageHeader('Funding', 'Synthetic VA and SSA program and project budgets, allocation requests and their decisions. Amounts are money totals, not compliance scores.',
        button('New budget', newBudget, 'button-primary', 'funding-new-budget')),
      h('p', { class: 'funding-boundary' }, 'Allocations here are simulated, and no government payment is sent.'),
      filterBar,
      body),
  };
}
