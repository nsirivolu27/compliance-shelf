// Paperwork tab of a case: the forms and reports this case tracks, the facts each one needs,
// a draft worksheet, and candidates read from a saved document reader output.
// Readiness is counted by the server. Nothing on this tab submits, signs, or files anything.

import * as api from '../api.js';
import { h, button, notice, loadingState, errorState, emptyState, dataTable, status, facts, formatDay, formatTime, announce } from '../dom.js';
import { openForm, noteField } from '../forms.js';
import { downloadText } from '../csv.js';
import { paperworkStatus, factState, verificationStatus, originLabels, entryTitle, readinessCell, dueCell } from '../paperwork-ui.js';

const candidateDecision = {
  accepted: { label: 'Accepted', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'muted' },
  undecided: { label: 'Not decided', tone: 'review' },
};
const candidateKinds = { field: 'Form field', 'query-answer': 'Query answer', signature: 'Signature' };

// Rows repeat the same short button text, so each button also carries a name that says which row it acts on.
function named(control, name) {
  control.setAttribute('aria-label', name);
  return control;
}

// After a save this tab redraws once its own requests finish, so the control that opened the form
// comes back a moment later. Wait for it briefly. If it is gone (an accepted candidate has no
// Accept button any more), focus the page heading so keyboard users are not dropped at the top of the page.
async function restoreFocus(openerId) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (document.querySelector('dialog.drawer[open]')) return; // another form is open: leave its focus alone
    const opener = openerId && document.getElementById(openerId);
    if (opener) { opener.focus({ preventScroll: true }); return; }
    await new Promise(done => setTimeout(done, 50));
  }
  document.getElementById('page-title')?.focus({ preventScroll: true });
}

// Every form here sends the case revision it was opened against and reloads the case afterwards.
function caseForm(handle, config, doneMessage) {
  const openerId = document.activeElement?.id;
  openForm({
    ...config,
    waitFor: () => handle.loading,
    getRevision: () => handle.revision,
    onConflict: () => handle.load(),
    onSuccess: async () => { await handle.load(); announce(doneMessage); await restoreFocus(openerId); },
  });
}

// ---------- Forms: paperwork items ----------

function addPaperwork(handle, catalog, preselected) {
  const records = handle.detail.case.records;
  const entryOf = id => catalog.find(entry => entry.id === id);
  caseForm(handle, {
    title: 'Add paperwork to this case',
    intro: 'Adding an item starts tracking it here. Nothing is sent to any agency.',
    submitLabel: 'Add paperwork',
    fields: [
      { name: 'paperworkId', type: 'select', label: 'Paperwork', required: true, value: preselected || catalog[0]?.id,
        options: catalog.map(entry => ({ value: entry.id, label: `${entryTitle(entry)}${entry.mode === 'catalog-only' ? ' (listed only)' : ''}` })) },
      { name: 'recordId', type: 'select', label: 'Record it covers', value: '',
        hint: 'Needed for a transmittal or a disposal notice, which are about one record.',
        options: [{ value: '', label: 'No record' }, ...records.map(record => ({ value: record.id, label: record.title }))] },
      { name: 'dueDate', type: 'date', label: 'Due date', hint: 'Enter the date your office works to. This system computes no deadline.' },
      noteField(),
    ],
    validate: values => (entryOf(values.paperworkId)?.needsRecord && !values.recordId ? { recordId: 'Choose the record this paperwork covers.' } : null),
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, paperworkId: values.paperworkId, note: values.note, ...(values.recordId ? { recordId: values.recordId } : {}), ...(values.dueDate ? { dueDate: values.dueDate } : {}) };
      return api.addPaperwork(handle.id, body, keyFor(body));
    },
  }, 'Paperwork added.');
}

function updatePaperwork(handle, view) {
  caseForm(handle, {
    title: `Update ${entryTitle(view.entry)}`,
    intro: 'Status is set by a person. "Filed by the agency" records that your office filed it somewhere else and needs a reference, such as a receipt number.',
    submitLabel: 'Save update',
    fields: [
      { name: 'status', type: 'select', label: 'Status', required: true, value: view.status, options: Object.entries(paperworkStatus).map(([value, entry]) => ({ value, label: entry.label })) },
      { name: 'reference', label: 'Filing reference', value: view.reference || '', maxlength: 1000, when: values => values.status === 'filed-by-agency',
        validate: value => (value.length < 3 ? 'Enter the reference for the filing, at least 3 characters.' : null) },
      { name: 'dueDate', type: 'date', label: 'Due date', value: view.dueDate || '' },
      noteField(),
    ],
    validate: values => {
      const changed = values.status !== view.status || (values.dueDate || null) !== (view.dueDate || null) || (values.status === 'filed-by-agency' && values.reference !== (view.reference || ''));
      return changed ? null : { form: 'Change the status, the due date, or the reference before saving.' };
    },
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note };
      if (values.status !== view.status) body.status = values.status;
      if ((values.dueDate || null) !== (view.dueDate || null)) body.dueDate = values.dueDate || null;
      if (values.status === 'filed-by-agency' && values.reference !== (view.reference || '')) body.reference = values.reference;
      return api.changePaperwork(handle.id, view.id, body, keyFor(body));
    },
  }, 'Paperwork updated.');
}

// One field per fact a person may enter. The hold fact is never offered: it comes from the hold review.
function enterFacts(handle, view) {
  const evidence = handle.detail.case.evidence;
  const stored = fact => (fact.origin === 'manual' || fact.origin === 'reader' ? fact.value : '');
  const enterable = view.readiness.facts.filter(fact => fact.from !== 'hold');
  const fields = enterable.map(fact => {
    const readHint = fact.state === 'present' && (fact.origin === 'case' || fact.origin === 'record') ? `${originLabels[fact.origin]}: ${fact.value}. Enter a value only to replace it.` : null;
    if (fact.from === 'evidence') {
      return { name: fact.key, type: 'select', label: fact.label, value: stored(fact), hint: 'Counts once a reviewer has verified the reference.',
        options: [{ value: '', label: 'None linked' }, ...evidence.map(entry => ({ value: entry.id, label: `${entry.title}${entry.verified ? '' : ' (not verified)'}` }))] };
    }
    return { name: fact.key, type: fact.type === 'date' ? 'date' : 'text', label: fact.label, value: stored(fact), maxlength: 500, hint: readHint };
  });
  const changes = values => Object.fromEntries(enterable
    .filter(fact => (values[fact.key] || '') !== stored(fact))
    .map(fact => [fact.key, values[fact.key] || null]));
  caseForm(handle, {
    title: `Facts for ${entryTitle(view.entry)}`,
    intro: 'Enter only what the source records show. Clearing a field removes the entered value. Hold status is not here: it comes from the hold review on the record.',
    submitLabel: 'Save facts',
    fields: [...fields, noteField()],
    validate: values => (Object.keys(changes(values)).length ? null : { form: 'Change at least one fact before saving.' }),
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note, facts: changes(values) };
      return api.changePaperwork(handle.id, view.id, body, keyFor(body));
    },
  }, 'Facts saved.');
}

// ---------- Forms: document reader ----------

const syntheticField = { name: 'synthetic', type: 'checkbox', label: 'This document is synthetic. It holds no real personal or agency data.',
  validate: value => (value ? null : 'Only synthetic documents may be imported. Confirm before importing.') };

async function importSample(handle, sampleId) {
  let sample;
  try { ({ sample } = await api.getReaderSample(sampleId)); }
  catch (error) { announce(`The sample could not be loaded. ${error.message}`); return; }
  caseForm(handle, {
    title: 'Import the sample reader output',
    intro: h('div', null, notice('info', sample.label, sample.about), h('p', { class: 'drawer-intro' }, 'Importing lists the fields the reader found as candidates. No fact changes until a reviewer accepts a candidate.')),
    submitLabel: 'Import output',
    fields: [{ type: 'static', name: 'title', label: 'Document', value: sample.title }, syntheticField, noteField('Reason for this import')],
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, title: sample.title, service: sample.service, source: sample.source, synthetic: true, note: values.note, output: sample.output, ...(sample.capturedAt ? { capturedAt: sample.capturedAt } : {}) };
      return api.importReaderOutput(handle.id, body, keyFor(body));
    },
  }, 'Reader output imported. Its candidates are listed below.');
}

// A saved output file from the reading service. The file is read in the browser and sent as JSON.
function importFile(handle) {
  let output = null;
  caseForm(handle, {
    title: 'Import a saved reader output',
    intro: 'Choose the JSON file saved from an Amazon Textract AnalyzeDocument call on a synthetic document. This application does not call the service. You run it and import what it returned.',
    submitLabel: 'Import output',
    fields: [
      { name: 'file', type: 'file', label: 'Saved output file (JSON)', accept: '.json,application/json', required: true,
        onFile: async (file, tools) => {
          output = null;
          tools.setError('file', '');
          if (file.size > 900 * 1024) { tools.setError('file', 'The file is larger than 900 KB. Import one page at a time.'); return; }
          try {
            // Windows tools often write a byte order mark first. It is not part of the JSON.
            const parsed = JSON.parse((await file.text()).replace(/^﻿/, ''));
            output = Array.isArray(parsed?.Blocks) ? parsed : parsed?.output;
            if (!Array.isArray(output?.Blocks)) throw new Error('no Blocks list');
            tools.setField('title', file.name.replace(/\.json$/i, ''));
          } catch {
            output = null;
            tools.setError('file', 'This file is not a saved AnalyzeDocument response. It needs a Blocks list.');
          }
        } },
      { name: 'title', label: 'Document title', required: true, maxlength: 200 },
      { name: 'capturedAt', type: 'datetime-local', label: 'When the service produced it', required: true, hint: 'Your local time. It is stored as UTC.' },
      syntheticField,
      noteField('Reason for this import'),
    ],
    validate: values => {
      // File fields are checked here, so the message goes to the top of the form.
      if (!output) return { form: 'Choose a saved AnalyzeDocument output file first.' };
      return Number.isNaN(new Date(values.capturedAt).getTime()) ? { capturedAt: 'Enter the date and time of the capture.' } : null;
    },
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, title: values.title, service: 'amazon-textract', source: 'service-capture', capturedAt: new Date(values.capturedAt).toISOString().replace(/\.\d{3}Z$/, 'Z'), synthetic: true, note: values.note, output };
      return api.importReaderOutput(handle.id, body, keyFor(body));
    },
  }, 'Reader output imported. Its candidates are listed below.');
}

function acceptCandidate(handle, output, candidate, items) {
  // Facts a reader value may fill: everything except hold status and linked evidence.
  const targets = items.flatMap(view => view.readiness.facts
    .filter(fact => fact.from !== 'hold' && fact.from !== 'evidence')
    .map(fact => ({ value: `${view.id}|${fact.key}`, label: `${entryTitle(view.entry)}: ${fact.label}${fact.state === 'present' ? ' (replaces the value on file)' : ''}` })));
  caseForm(handle, {
    title: 'Accept this candidate',
    intro: h('div', null,
      facts([['Label on the page', candidate.label], ['Value read', candidate.value], ['Confidence reported', candidate.confidence === null ? 'Not reported' : String(candidate.confidence)]], true),
      h('p', { class: 'drawer-intro' }, 'Check the value against the document before accepting. Accepting writes it to one fact, marked as accepted from a document reader.')),
    submitLabel: 'Accept for this fact',
    fields: [
      { name: 'target', type: 'select', label: 'Fact to fill', required: true, value: '', options: [{ value: '', label: 'Choose a fact' }, ...targets] },
      noteField('Why this value is right'),
    ],
    submit: (values, keyFor) => {
      const [itemId, factKey] = values.target.split('|');
      const body = { expectedRevision: handle.revision, decision: 'accept', target: { itemId, factKey }, note: values.note };
      return api.decideReaderCandidate(handle.id, output.id, candidate.id, body, keyFor(body));
    },
  }, 'Candidate accepted. The fact now shows the value.');
}

function rejectCandidate(handle, output, candidate) {
  caseForm(handle, {
    title: 'Reject this candidate',
    intro: `${candidate.label}${candidate.value ? `: "${candidate.value}${/[.!?]$/.test(candidate.value) ? '' : '.'}"` : '.'} Rejecting records that this was looked at and not used. It writes no fact.`,
    submitLabel: 'Reject candidate',
    fields: [noteField('Reason for rejecting')],
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, decision: 'reject', note: values.note };
      return api.decideReaderCandidate(handle.id, output.id, candidate.id, body, keyFor(body));
    },
  }, 'Candidate rejected. No fact changed.');
}

// ---------- Sections ----------

function worksheetSection(handle, view) {
  const download = button('Download worksheet (JSON)', async () => {
    try {
      const response = await api.getWorksheet(handle.id, view.id);
      downloadText(`Compliance Shelf draft worksheet ${view.paperworkId}.json`, response.text, 'application/json');
      announce('Draft worksheet downloaded. It is not an official form and was not submitted.');
    } catch (error) { announce(`The worksheet could not be downloaded. ${error.message}`); }
  }, '', 'download-worksheet');
  const enterable = view.readiness.facts.some(fact => fact.from !== 'hold');
  return h('section', { class: 'worksheet' },
    h('h2', { id: 'worksheet-title', tabindex: '-1' }, `Draft worksheet: ${entryTitle(view.entry)}`),
    notice('info', 'Draft worksheet. Not an official form. Not submitted.', 'It gathers the facts recorded here so a person can complete the official form. Check every line against the current form and the source records.'),
    view.entry?.verification === 'candidate' && notice('warn', 'This catalog entry was not confirmed against an agency source.', 'Treat the form name and its use as unverified until someone checks them.'),
    facts([
      ['Status', status(paperworkStatus, view.status)],
      ['Record', view.recordTitle || 'No record linked'],
      ['Due date', view.dueDate ? formatDay(view.dueDate) : 'No date entered'],
      view.reference && ['Filing reference', view.reference],
      ['Facts on file', view.readiness.summary],
    ], true),
    view.readiness.facts.length === 0
      ? h('p', { class: 'hint' }, 'This entry is listed only. No facts are counted for it. You can still track its status and due date.')
      : dataTable({
        label: 'Required facts',
        rows: view.readiness.facts,
        columns: [
          { header: 'Fact', cell: fact => fact.label },
          { header: 'Value', cell: fact => (fact.value ? h('span', { class: 'wrap' }, fact.type === 'date' ? formatDay(fact.value) : fact.value) : h('span', { class: 'missing' }, 'Nothing on file')) },
          { header: 'State', cell: fact => h('div', null, status(factState, fact.state), fact.detail && h('p', { class: 'hint wrap' }, fact.detail)) },
          { header: 'Where it came from', cell: fact => (fact.origin
            ? h('div', null, h('p', null, originLabels[fact.origin] || fact.origin), fact.at && h('p', { class: 'hint' }, `${fact.by} · ${formatTime(fact.at)}`))
            : h('span', { class: 'missing' }, 'Not applicable')) },
        ],
      }),
    h('p', { class: 'button-row no-print' },
      enterable && button('Enter facts', () => enterFacts(handle, view), 'button-primary', 'enter-facts'),
      button('Update status or date', () => updatePaperwork(handle, view), '', 'update-paperwork'),
      download,
      button('Print worksheet', () => window.print(), '', 'print-worksheet')));
}

function readerSection(handle, reader, samples, items) {
  const canAccept = items.some(view => view.readiness.facts.some(fact => fact.from !== 'hold' && fact.from !== 'evidence'));
  return h('section', { class: 'no-print' },
    h('h2', null, 'Document reader'),
    h('p', { class: 'hint' }, 'This application calls no reading service. A person runs Amazon Textract on a synthetic document and imports the saved output here. Each field it found becomes a candidate that a reviewer accepts for one fact or rejects.'),
    h('ul', { class: 'pick-list' },
      samples.samples.map(sample => h('li', null,
        button('Import this output', () => importSample(handle, sample.id), 'button-small', `import-sample-${sample.id}`),
        h('span', { class: 'wrap' }, `${sample.title}. ${sample.label}`))),
      h('li', null, button('Import a saved output file', () => importFile(handle), 'button-small', 'import-reader-file'), h('span', { class: 'wrap' }, 'A JSON file you saved from the reading service.'))),
    samples.unreadable.length > 0 && notice('warn', 'Some sample files could not be read.', samples.unreadable.map(entry => `${entry.file}: ${entry.reason}`).join(' ')),
    reader.outputs.length === 0 && emptyState('No reader output has been imported for this case.', 'Import the sample to see how candidates work.'),
    reader.outputs.map(output => h('div', { class: 'reader-output' },
      h('h3', null, output.title),
      h('p', null, h('span', { class: `status status-${output.source === 'shape-sample' ? 'warn' : 'info'}` }, output.label)),
      facts([
        ['Imported', `${formatTime(output.importedAt)} by ${output.importedBy}`],
        output.capturedAt && ['Captured', formatTime(output.capturedAt)],
        ['Found', `${output.counts.fields} form fields, ${output.counts.queryAnswers} query answers, ${output.counts.signatures} signatures on ${output.pages} ${output.pages === 1 ? 'page' : 'pages'}`],
        ['Not offered', `${output.counts.tableCells} table cells, ${output.counts.emptyFields} empty fields, ${output.counts.skipped} over long values, ${output.counts.ignored} unknown blocks`],
        ['Decisions', `${output.decided.accepted} accepted, ${output.decided.rejected} rejected, ${output.decided.undecided} not decided`],
      ], true),
      dataTable({
        label: `Candidates from ${output.title}`,
        rows: output.candidates,
        columns: [
          { header: 'Label on the page', cell: candidate => h('div', null, h('p', { class: 'wrap' }, candidate.label), h('p', { class: 'hint' }, `${candidateKinds[candidate.kind] || candidate.kind} · page ${candidate.page}`)) },
          { header: 'Value read', cell: candidate => (candidate.value ? h('span', { class: 'wrap' }, candidate.value) : h('span', { class: 'missing' }, 'No text')) },
          { header: 'Confidence reported', class: 'num', cell: candidate => (candidate.confidence === null ? 'Not reported' : String(candidate.confidence)) },
          { header: 'Decision', cell: candidate => {
            const decision = candidate.decision;
            const target = decision?.target && items.find(view => view.id === decision.target.itemId);
            const fact = target?.readiness.facts.find(entry => entry.key === decision.target.factKey);
            return h('div', null, status(candidateDecision, decision?.decision || 'undecided'),
              decision && h('p', { class: 'hint wrap' }, `${decision.by} · ${formatTime(decision.at)}${fact ? ` · filled ${fact.label}` : ''}`));
          } },
          { header: 'Action', cell: candidate => (candidate.decision ? h('span', { class: 'hint' }, 'Decided') : h('span', { class: 'button-row' },
            candidate.kind !== 'signature' && canAccept && named(button('Accept', () => acceptCandidate(handle, output, candidate, items), 'button-small', `accept-${output.id}-${candidate.id}`), `Accept ${candidate.label}`),
            named(button('Reject', () => rejectCandidate(handle, output, candidate), 'button-small', `reject-${output.id}-${candidate.id}`), `Reject ${candidate.label}`))) },
        ],
      }))),
    !canAccept && reader.outputs.length > 0 && h('p', { class: 'hint' }, 'Add a paperwork item that counts facts, such as a transmittal, before accepting a candidate.'),
    h('p', { class: 'hint' }, reader.limitation));
}

// ---------- The tab ----------

export function paperworkTab(handle, { basePath, selected }) {
  const box = h('div', { class: 'stack' }, loadingState('Loading paperwork…'));

  async function fill() {
    let paperwork, reader, samples, catalog;
    try {
      [paperwork, reader, samples, { catalog }] = await Promise.all([api.getCasePaperwork(handle.id), api.getReaderOutputs(handle.id), api.getReaderSamples(), api.getPaperworkCatalog()]);
    } catch (error) {
      box.replaceChildren(errorState(error, fill));
      return;
    }
    const { items, summary, suggested } = paperwork;
    const open = selected ? items.find(view => view.id === selected) : null;

    box.replaceChildren(...[
      h('section', { class: open ? 'no-print' : null },
        h('h2', null, `Paperwork on this case (${items.length})`),
        h('p', { class: 'hint' }, `${summary.blocked} blocked by a hold, ${summary.incomplete} with facts missing, ${summary.factsComplete} with all facts on file, ${summary.overdue} past a due date, ${summary.filed} filed by the agency.`),
        h('p', { class: 'button-row' }, button('Add paperwork', () => addPaperwork(handle, catalog), 'button-primary', 'add-paperwork')),
        suggested.length > 0 && h('div', null,
          h('p', { class: 'hint' }, 'Suggested by the check set this case was created with. These are examples, not a list of what an office must file.'),
          h('ul', { class: 'pick-list' }, suggested.map(entry => h('li', null,
            button('Add', () => addPaperwork(handle, catalog, entry.id), 'button-small', `suggest-${entry.id}`),
            h('span', { class: 'wrap' }, entryTitle(entry)))))),
        items.length === 0
          ? emptyState('No paperwork is tracked on this case.', 'Add a transmittal, a disposal notice, a corrective action entry, or a reporting item to see which facts are on file.')
          : dataTable({
            label: 'Paperwork on this case',
            rows: items,
            isSelected: view => view.id === selected,
            columns: [
              { header: 'Paperwork', cell: view => h('div', null,
                h('p', null, h('a', { href: `${basePath}/paperwork/${encodeURIComponent(view.id)}`, id: `paperwork-${view.id}` }, entryTitle(view.entry))),
                view.entry?.verification === 'candidate' && h('p', null, status(verificationStatus, 'candidate'))) },
              { header: 'Record', cell: view => view.recordTitle || h('span', { class: 'missing' }, 'None') },
              { header: 'Status', cell: view => h('div', null, status(paperworkStatus, view.status), view.reference && h('p', { class: 'hint wrap' }, view.reference)) },
              { header: 'Facts on file', cell: view => readinessCell(view.readiness) },
              { header: 'Due', cell: dueCell },
              { header: 'Action', cell: view => named(button('Update', () => updatePaperwork(handle, view), 'button-small', `update-${view.id}`), `Update ${entryTitle(view.entry)}`) },
            ],
          })),
      selected && !open && notice('warn', 'That paperwork item is not on this case.', h('p', null, h('a', { href: `${basePath}/paperwork` }, 'Show all paperwork on this case'))),
      open && worksheetSection(handle, open),
      readerSection(handle, reader, samples, items),
      h('p', { class: 'hint' }, paperwork.limitation),
    ].filter(Boolean));
  }

  fill();
  return box;
}
