// Document intake: store a text document, let the worker split it into spans, and
// link it to a case as an unverified evidence reference. Text only. No PDF, no OCR.

import * as api from '../api.js';
import {
  h, button, rowButton, status, facts, pageHeader, notice, emptyState, loadingState, errorState, announce,
  evidenceKinds, kindsOf, formatTime,
} from '../dom.js';
import { createList } from '../lists.js';
import { openForm, noteField } from '../forms.js';
import { createInspector } from '../panels.js';

const mediaTypes = [
  { value: 'text/plain', label: 'Plain text (.txt)' },
  { value: 'text/markdown', label: 'Markdown (.md)' },
  { value: 'application/json', label: 'JSON (.json)' },
];
const maxBytes = 256 * 1024;

const extraction = {
  pending: { label: 'Preparing text', tone: 'review' },
  ready: { label: 'Ready to read', tone: 'ok' },
};
const jobLabels = {
  queued: { label: 'Queued', tone: 'review' },
  running: { label: 'Running', tone: 'info' },
  succeeded: { label: 'Finished', tone: 'ok' },
  failed: { label: 'Failed', tone: 'warn' },
};
const eventLabels = {
  'document-received': 'Document received',
  'extraction-dispatched': 'Queued for text preparation',
  'document-extracted': 'Passages prepared',
  'evidence-reference-linked': 'Linked as an evidence reference',
};

const size = bytes => (bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KiB`);
const section = (heading, ...content) => h('section', { class: 'panel-section' }, h('h3', null, heading), content);

export function create(route) {
  const body = h('div', null, loadingState('Checking the document service…'));
  const problem = h('div');
  const addButton = button('Add text document', () => addDocument(), 'button-primary', 'add-document');
  addButton.disabled = true;
  let selectedId = route.parts[0] || null;
  let list = null;
  let cases = [];
  let pollTimer = null;
  let spanQuery = { q: '', offset: 0 };

  const caseTitle = id => cases.find(item => item.id === id)?.title || id;

  const inspector = createInspector(() => {
    selectedId = null;
    clearTimeout(pollTimer);
    history.replaceState(null, '', '#/documents');
    list?.redraw();
  });

  // ---------- Intake form ----------

  function addDocument() {
    problem.replaceChildren();
    if (cases.length === 0) {
      problem.replaceChildren(notice('info', 'There are no cases yet.', 'Create a case before adding documents.'));
      return;
    }
    openForm({
      title: 'Add text document',
      intro: 'Plain text, Markdown, or JSON only, up to 256 KiB. PDF files and scans are not supported and nothing is read by OCR. The text is stored as source material. Nothing is concluded from it. Use synthetic content in this demo.',
      submitLabel: 'Store document',
      fields: [
        { name: 'caseId', type: 'select', label: 'Case', required: true, value: cases[0].id, options: cases.map(item => ({ value: item.id, label: item.title })) },
        { name: 'file', type: 'file', label: 'Choose a text file', accept: '.txt,.md,.markdown,.json,text/plain,text/markdown,application/json',
          hint: 'Optional. The file is read in your browser and fills the fields below. You can also paste text.',
          onFile: async (file, tools) => {
            tools.setError('content', null);
            if (file.size > maxBytes) {
              tools.setError('content', `That file is ${size(file.size)}. The limit is 256 KiB.`);
              return;
            }
            const text = await file.text();
            tools.setField('content', text);
            tools.setField('filename', file.name);
            tools.setField('title', file.name.replace(/\.[^.]+$/, ''));
            tools.setField('mediaType', /\.json$/i.test(file.name) ? 'application/json' : /\.(md|markdown)$/i.test(file.name) ? 'text/markdown' : 'text/plain');
          } },
        { name: 'title', label: 'Title', required: true, maxlength: 200 },
        { name: 'filename', label: 'File name', required: true, maxlength: 160, hint: 'A display name only, such as funding-memo.txt.',
          validate: value => /[\\/]/.test(value) ? 'Enter a file name without folders or slashes.' : null },
        { name: 'mediaType', type: 'select', label: 'Type', required: true, value: 'text/plain', options: mediaTypes },
        { name: 'content', type: 'textarea', label: 'Text content', required: true, rows: 8, raw: true,
          validate: (value, values) => {
            if (new Blob([value]).size > maxBytes) return 'The text is larger than 256 KiB.';
            if (values.mediaType === 'application/json') {
              try { JSON.parse(value); } catch { return 'This is not valid JSON. Fix it or choose a different type.'; }
            }
            return null;
          } },
        noteField('Reason for adding this document'),
      ],
      submit: (values, keyFor) => api.createDocument(values, keyFor(values)),
      onSuccess: async result => {
        announce('Document stored. Extraction is queued.');
        await list.reload();
        open(result.document.id);
      },
    });
  }

  // ---------- Detail panel ----------

  async function open(documentId, focus = true) {
    selectedId = documentId;
    spanQuery = { q: '', offset: 0 };
    history.replaceState(null, '', `#/documents/${encodeURIComponent(documentId)}`);
    list?.redraw();
    inspector.show('Loading…', loadingState('Loading document…'), { focus });
    await refresh(focus);
  }

  async function refresh(focus = false) {
    const documentId = selectedId;
    clearTimeout(pollTimer);
    try {
      const [detail, jobs] = await Promise.all([api.getDocument(documentId), api.getJobs({ documentId })]);
      if (selectedId !== documentId) return;
      const job = jobs.items[0] || null;
      inspector.show(detail.document.title, panel(detail.document, detail.events, job), { focus });
      // Extraction runs in the background, so keep checking until it settles.
      if (detail.document.status === 'pending' && job?.status !== 'failed') {
        pollTimer = setTimeout(async () => { await refresh(); list.reload(); }, 1500);
      }
    } catch (error) {
      if (selectedId !== documentId) return;
      inspector.show('Document', error.status === 404
        ? notice('info', 'This document does not exist.', 'Close the panel and pick another row.')
        : errorState(error, () => refresh()), { focus: false });
    }
  }

  function spansBlock(document) {
    const box = h('div', null, loadingState('Loading passages…'));
    const search = h('input', { type: 'search', id: 'span-search', autocomplete: 'off', maxlength: '200' });
    search.value = spanQuery.q;
    let latest = 0;

    async function load() {
      const requestNumber = ++latest;
      try {
        const result = await api.getDocumentSpans(document.id, { q: spanQuery.q, limit: 3, offset: spanQuery.offset });
        if (requestNumber !== latest) return;
        const { total, offset, nextOffset } = result.pagination;
        box.replaceChildren(
          h('p', { class: 'list-summary', role: 'status' }, total === 0 ? 'No passage contains that text.' : `Showing ${offset + 1} to ${offset + result.items.length} of ${total} passages`),
          h('ul', { class: 'item-list' }, result.items.map(span => h('li', null,
            h('p', { class: 'hint' }, `Lines ${span.startLine} to ${span.endLine} · characters ${span.startOffset} to ${span.endOffset} · `, h('code', null, span.id)),
            h('pre', { class: 'span-text', tabindex: '0' }, span.text)))),
          h('div', { class: 'button-row' },
            h('button', { type: 'button', class: 'button button-small', disabled: offset === 0, onclick: () => { spanQuery.offset = Math.max(0, offset - 3); load(); } }, 'Previous passages'),
            h('button', { type: 'button', class: 'button button-small', disabled: nextOffset === null, onclick: () => { spanQuery.offset = nextOffset; load(); } }, 'Next passages')));
      } catch (error) {
        if (requestNumber !== latest) return;
        box.replaceChildren(errorState(error, load));
      }
    }

    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { spanQuery = { q: search.value.trim(), offset: 0 }; load(); }, 300);
    });
    load();
    return [h('div', { class: 'field' }, h('label', { for: 'span-search', class: 'label' }, 'Search this document'), search), box];
  }

  function linkEvidence(document) {
    let revision = null;
    let kinds = {};
    const loadRevision = async () => {
      const detail = await api.getCase(document.caseId);
      revision = detail.case.revision;
      kinds = kindsOf(detail.case);
    };
    const openerId = 'document-link';
    loadRevision().then(() => {
      openForm({
        title: 'Link as evidence reference',
        intro: 'Adds a reference to this document on its case. The reference starts unverified. Extracted text is not a compliance determination, and verifying the reference later is a separate, explicit step.',
        submitLabel: 'Add reference',
        fields: [
          { type: 'static', name: 'document', label: 'Document', value: document.title },
          { type: 'static', name: 'case', label: 'Case', value: caseTitle(document.caseId) },
          { name: 'kind', type: 'select', label: 'Check it supports', required: true, value: Object.keys(kinds)[0], options: Object.entries(kinds).map(([value, label]) => ({ value, label })) },
          noteField('Why this document supports the check'),
        ],
        submit: (values, keyFor) => {
          const payload = { kind: values.kind, expectedRevision: revision, note: values.note };
          return api.linkDocumentEvidence(document.id, payload, keyFor(payload));
        },
        // On a conflict, pick up the case's new revision. The form stays open with its input.
        onConflict: loadRevision,
        onSuccess: async () => {
          announce('Reference added as unverified. Verify it from the evidence library when you have checked it.');
          await refresh();
          list.reload();
          globalThis.document.getElementById(openerId)?.focus();
        },
      });
    }).catch(error => {
      problem.replaceChildren(errorState(error, () => linkEvidence(document)));
    });
  }

  function retryExtraction(job) {
    openForm({
      title: 'Retry extraction',
      intro: 'Puts the failed extraction job back in the queue.',
      submitLabel: 'Retry',
      fields: [noteField('Reason for retrying')],
      submit: (values, keyFor) => api.retryJob(job.id, { note: values.note }, keyFor(values)),
      onSuccess: async () => {
        announce('Extraction queued again.');
        await refresh();
      },
    });
  }

  function panel(document, events, job) {
    const ready = document.status === 'ready';
    return h('div', null,
      h('p', { class: 'hint' }, h('a', { href: `#/cases/${encodeURIComponent(document.caseId)}` }, caseTitle(document.caseId)), ' · Synthetic case'),
      h('p', { class: 'panel-status' }, status(extraction, document.status)),
      !ready && job?.status !== 'failed' && h('p', { class: 'hint' }, 'Extraction runs in the background. This panel checks again every couple of seconds.'),
      job?.status === 'failed' && notice('warn', 'Extraction failed.', job.error || 'The worker could not finish.',
        h('p', null, button('Retry extraction', () => retryExtraction(job), 'button-small', 'document-retry'))),
      facts([
        ['File name', document.filename],
        ['Type', mediaTypes.find(type => type.value === document.mediaType)?.label || document.mediaType],
        ['Size', size(document.bytes)],
        ['File fingerprint (SHA-256)', h('span', { class: 'mono wrap' }, document.sha256)],
        ['Received', formatTime(document.createdAt)],
        document.extractedAt && ['Prepared', formatTime(document.extractedAt)],
        ['Passages', String(document.spanCount)],
        job && ['Text preparation', h('span', null, status(jobLabels, job.status), ` · attempt ${job.attempts} of ${job.maxAttempts}`)],
      ]),
      h('p', { class: 'hint' }, 'The file fingerprint identifies this stored text version. You decide what the document proves; the platform does not decide for you.'),

      section('Use as evidence',
        document.linkedEvidence.length === 0
          ? h('p', { class: 'hint' }, 'Not linked to any evidence reference yet.')
          : h('ul', { class: 'item-list' }, document.linkedEvidence.map(evidenceId => h('li', null,
              h('a', { href: `#/evidence/${encodeURIComponent(document.caseId)}/${encodeURIComponent(evidenceId)}` }, 'Open the linked reference in the evidence library'),
              h('p', { class: 'hint' }, 'Linked references start unverified. Verify them there after you have checked the document.')))),
        h('p', null, h('button', { type: 'button', class: 'button button-small', id: 'document-link', disabled: !ready, onclick: () => linkEvidence(document) }, 'Link as evidence reference')),
        !ready && h('p', { class: 'hint' }, 'Available once the text has been extracted.')),

      ready && section('Document text', spansBlock(document)),

      section('Document history',
        h('ul', { class: 'item-list' }, [...events].reverse().map(event => h('li', null,
          h('p', null, eventLabels[event.action] || event.action),
          event.details?.note && h('p', { class: 'hint wrap' }, event.details.note),
          h('p', { class: 'hint' }, `${formatTime(event.at)} · ${event.actor}`))))));
  }

  // ---------- Start ----------

  async function start() {
    try {
      // The document, job, and worker services exist only in the full local stack.
      let services;
      try {
        services = await api.getServices();
      } catch (error) {
        if (error.status !== 404) throw error;
        body.replaceChildren(notice('info', 'Documents are not available in this mode.',
          'The standalone server has no document service. Stop it and start the full local services with "npm run dev" from the repository root. Everything else in the workspace works without it.'));
        return;
      }
      const down = services.services.filter(service => ['documents', 'jobs', 'worker'].includes(service.name) && service.status !== 'ok').map(service => service.name);
      ({ cases } = await api.getCases());
      addButton.disabled = false;
      list = createList({
        label: 'Documents',
        searchLabel: 'Search title, file name, or document ID',
        // This service pages by offset only, so the revision guard is not sent.
        load: ({ workspaceRevision, ...query }) => api.getDocuments(query),
        emptyText: 'No documents have been added yet. Add a text document to extract its spans and link it to a case.',
        filters: [{ name: 'caseId', label: 'Case', options: cases.map(item => ({ value: item.id, label: item.title })) }],
        isSelected: row => row.id === selectedId,
        columns: [
          { header: 'Document', cell: row => rowButton(row.title, () => open(row.id), row.id === selectedId, `open-${row.id}`) },
          { header: 'File name', cell: row => h('span', { class: 'wrap' }, row.filename) },
          { header: 'Case', cell: row => h('a', { href: `#/cases/${encodeURIComponent(row.caseId)}`, title: row.caseId }, caseTitle(row.caseId)) },
          { header: 'Size', class: 'num', cell: row => size(row.bytes) },
          { header: 'Document status', cell: row => status(extraction, row.status) },
          { header: 'Passages', class: 'num', cell: row => String(row.spanCount) },
          { header: 'Linked references', class: 'num', cell: row => String(row.linkedEvidence.length) },
        ],
      });
      body.replaceChildren(...[
        down.length > 0 && notice('warn', 'Part of document processing is not responding.', `Not responding: ${down.join(', ')}. Documents you add are saved and will be processed when the services are back.`),
        h('div', { class: 'split' }, h('div', { class: 'split-main' }, list.el), inspector.el),
      ].filter(Boolean));
      if (selectedId) open(selectedId, false);
    } catch (error) {
      body.replaceChildren(errorState(error, start));
    }
  }

  start();
  return {
    key: 'documents',
    el: h('div', null,
      pageHeader('Documents', 'Add text documents, read passages, and link evidence to a case. PDFs and scans are not read automatically.', addButton),
      problem,
      body),
  };
}
