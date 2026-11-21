// Program directory and entry point into the existing audited paperwork/reader workflow.
import * as api from '../api.js';
import { h, pageHeader, loadingState, errorState, emptyState, button, externalLink, announce } from '../dom.js';
import { openForm, noteField } from '../forms.js';
import { downloadText } from '../csv.js';

export function create(route) {
  const body = h('div', { class: 'stack' }, loadingState('Loading benefits intake…'));
  const problem = h('div', { role: 'status' });
  let selectedCase = route.query.caseId || '', busy = false;

  async function track(program) {
    if (busy) return;
    if (!selectedCase) { announce('Choose a synthetic case first.'); document.getElementById('benefits-case')?.focus(); return; }
    busy = true;
    const caseId = selectedCase;
    try {
      let snapshot = await api.getCasePaperwork(caseId);
      openForm({
        title: `Track ${program.program}`,
        intro: 'This adds a project-defined intake worksheet to the selected synthetic case. Existing checks stay unchanged. No application is sent and no eligibility is decided.',
        submitLabel: 'Add intake worksheet',
        getRevision: () => snapshot.caseRevision,
        fields: [noteField('Reason for tracking this program')],
        submit: (values, keyFor, revision) => {
          const payload = { expectedRevision: revision, paperworkId: program.paperwork.id, note: values.note };
          return api.addPaperwork(caseId, payload, keyFor(payload));
        },
        onConflict: async () => { snapshot = await api.getCasePaperwork(caseId); },
        onSuccess: result => { location.hash = `#/cases/${encodeURIComponent(caseId)}/paperwork/${encodeURIComponent(result.item.id)}`; },
      });
    } catch (error) { problem.replaceChildren(errorState(error, () => track(program))); }
    finally { busy = false; }
  }

  async function sample(program) {
    try {
      const response = await api.getReaderSample(program.sampleId);
      // The download is the importable Blocks object, not a pretend completed application.
      downloadText(`${program.sampleId}.json`, JSON.stringify(response.sample.output, null, 2), 'application/json');
      announce('Synthetic reader sample downloaded. It was not produced by a reading service.');
    } catch (error) { problem.replaceChildren(errorState(error, () => sample(program))); }
  }

  function card(program) {
    const entry = program.paperwork;
    return h('article', { class: 'preset-card', 'data-program': program.programId },
      h('p', { class: 'hint' }, `${program.team} · example team`),
      h('h3', null, program.program),
      h('p', null, program.purpose),
      h('p', null, `${entry.formNumber} · ${entry.title}`),
      h('p', null, externalLink(entry.sourceUrl, 'Official form information'), ' · ', externalLink(program.guidanceUrl, 'Agency guidance')),
      h('details', null, h('summary', null, 'Worksheet scope and source'),
        h('p', { class: 'hint' }, entry.note),
        h('p', { class: 'hint' }, `Source read ${entry.checkedOn}. Eligibility: not assessed. No individual award or payment.`)),
      h('p', null, `${program.counts.tracked} tracked · ${program.counts.missingIntakeFacts} with intake facts missing · ${program.counts.blocked} blocked · ${program.counts.overdue} past an entered date`),
      h('div', { class: 'button-row' },
        button(`Track ${entry.formNumber}`, () => track(program), 'button-small', `track-${program.programId}`),
        button('Download synthetic reader sample', () => sample(program), 'button-small', `sample-${program.programId}`)),
      program.items.length ? h('ul', null, program.items.map(item => h('li', null,
        h('a', { href: `#/cases/${encodeURIComponent(item.caseId)}/paperwork/${encodeURIComponent(item.id)}` }, `${item.caseTitle} — open worksheet and form reader`),
        h('p', { class: 'hint' }, `${item.readiness.summary} · ${item.status}`)))) : h('p', { class: 'hint' }, 'No intake worksheets tracked for this program.'));
  }

  async function load() {
    try {
      const query = Object.fromEntries(['agency', 'q'].filter(key => route.query[key]).map(key => [key, route.query[key]]));
      const [result, { cases }] = await Promise.all([api.getBenefits(query), api.getCases()]);
      const agency = h('select', { id: 'benefits-agency' },
        [['', 'SSA and VA'], ['ssa', 'Social Security Administration'], ['va', 'Veterans Affairs']].map(([value, label]) => h('option', { value, selected: value === (route.query.agency || '') }, label)));
      const search = h('input', { id: 'benefits-search', type: 'search', maxlength: 200, value: route.query.q || '' });
      const caseSelect = h('select', { id: 'benefits-case', onchange: event => { selectedCase = event.target.value; } },
        h('option', { value: '' }, 'Choose a synthetic case'),
        cases.map(item => h('option', { value: item.id, selected: item.id === selectedCase }, `${item.title} · ${item.agency}`)));
      body.replaceChildren(...[
        h('section', { class: 'notice' },
          h('p', null, 'Synthetic intake review only. Agency reviewers decide eligibility and payments. Saved reader JSON is supported; PDF and image OCR are not connected.'),
          h('details', null, h('summary', null, 'How to review a form'),
          h('ol', null, h('li', null, 'Choose a program and an appropriate synthetic case; track its intake worksheet with a note.'),
            h('li', null, 'Open the case’s Paperwork tab. Import saved Textract JSON, or choose a clearly labeled synthetic sample in the document reader.'),
            h('li', null, 'Review extracted fields and explicitly accept each one into the worksheet, or reject it. Import alone fills nothing.'),
            h('li', null, 'Use case tasks for follow-up and the audit report for the review trail. Agency staff decide eligibility and any payments.')),
          h('p', null, 'Use synthetic data only; do not upload real names, Social Security numbers, banking or medical information.'),
          h('p', null, 'These seven starting points do not cover every benefit or claimant situation. Incomplete prototype worksheets must never delay a real application; use the official agency guidance.'))),
        h('form', { class: 'toolbar', onsubmit: event => {
          event.preventDefault(); const next = new URLSearchParams();
          if (agency.value) next.set('agency', agency.value);
          if (search.value.trim()) next.set('q', search.value.trim());
          if (selectedCase) next.set('caseId', selectedCase);
          location.hash = `#/benefits${next.size ? `?${next}` : ''}`;
        } }, h('div', { class: 'toolbar-field' }, h('label', { for: 'benefits-agency' }, 'Agency'), agency),
        h('div', { class: 'toolbar-field toolbar-search' }, h('label', { for: 'benefits-search' }, 'Search program, form or team'), search),
        h('div', { class: 'button-row' }, h('button', { type: 'submit', class: 'button' }, 'Filter programs'), h('a', { href: '#/benefits' }, 'Clear filters'))),
        h('section', null, h('h2', null, 'Case to work on'),
          h('label', { for: 'benefits-case' }, 'Synthetic case'), caseSelect,
          h('p', { class: 'hint' }, 'Choose a case whose scope fits the work. Adding paperwork does not replace its checks or establish program eligibility.'),
          h('a', { href: '#/cases' }, 'View or create cases')),
        problem,
        ...['ssa', 'va'].map(scope => {
          const programs = result.programs.filter(program => program.agency === scope);
          return programs.length ? h('section', null, h('h2', null, scope === 'ssa' ? 'Social Security Administration' : 'Department of Veterans Affairs'),
            h('div', { class: 'preset-cards' }, programs.map(card))) : null;
        }).filter(Boolean),
        result.programs.length ? null : emptyState('No matching programs.', 'Try another program, team or form number.'),
        h('p', { class: 'hint' }, result.limitation)].filter(Boolean));
    } catch (error) { body.replaceChildren(errorState(error, load)); }
  }
  load();
  return { key: 'benefits', el: h('div', null, pageHeader('Benefits intake', 'SSA and VA paperwork, organized by example intake team. Help reviewers identify missing information and coordinate follow-up.'), body) };
}
