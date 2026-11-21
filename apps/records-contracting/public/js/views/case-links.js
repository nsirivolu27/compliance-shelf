// Source and relationship inspector for one case:
// Case, Finding, Evidence reference, Document and span, Policy source,
// with the related record, hold, tasks, and reviews. Every link shown here comes
// from a stored ID. Where a link does not exist, the panel says so.

import * as api from '../api.js';
import {
  h, rowButton, status, authority, facts, citations, locator, dataTable, findingStatus, holdStatus, retentionStatus, taskStatus, button,
  applicabilityLabels, dispositions, categoryLabels, areaLabel, caseSources, formatDay, formatTime,
} from '../dom.js';
import { verificationLabels, draftStanding } from '../panels.js';

const missing = text => h('span', { class: 'missing' }, text);
const documentIdOf = entry => /^document:\/\/([A-Za-z0-9_-]+)#/.exec(entry.locator)?.[1] || null;
const verificationOf = entry => (entry.verified && entry.locator.trim() ? 'verified-reference' : 'unverified-reference');

// Loads stored document metadata for the case once. The document service only exists in the full local stack.
export function loadDocumentIndex(caseId, onReady) {
  const index = { status: 'loading', items: new Map() };
  const load = () => api.getDocuments({ caseId, limit: 100 }).then(result => {
    index.status = 'available';
    for (const item of result.items) index.items.set(item.id, item);
  }).catch(error => {
    index.status = error.status === 404 ? 'not-running' : 'unreachable';
  }).finally(onReady);
  index.retry = load;
  load();
  return index;
}

function linksFor(handle, finding) {
  const item = handle.detail.case;
  const evidence = item.evidence.filter(entry => finding.evidenceIds.includes(entry.id));
  const record = finding.category === 'records' ? handle.detail.report.records.find(entry => `${item.id}:record:${entry.id}` === finding.id) || null : null;
  return {
    evidence, record,
    tasks: handle.detail.tasks.filter(task => task.findingId === finding.id),
    reviews: handle.detail.reviews.filter(review => review.findingId === finding.id),
    drafts: handle.drafts.filter(draft => draft.findingIds.includes(finding.id)),
  };
}

export function linksTab(handle, ctx, selected, select) {
  const item = handle.detail.case;
  return h('div', null,
    h('p', { class: 'hint' }, 'How each finding connects to evidence references, stored documents, policy sources, records, tasks, and reviews. Only stored links are shown. Open a row to see what each link does and does not establish.'),
    dataTable({
      label: 'Relationships by finding',
      rows: handle.detail.report.findings,
      isSelected: finding => finding.id === selected,
      columns: [
        { header: 'Finding', cell: finding => rowButton(finding.title, () => select(finding.id), finding.id === selected, `open-${finding.id}`) },
        { header: 'Status', cell: finding => status(findingStatus, finding.status) },
        { header: 'Evidence references', cell: finding => {
          const { evidence } = linksFor(handle, finding);
          if (finding.category !== 'contracting') return missing('Not used by this check');
          if (evidence.length === 0) return missing('None supplied');
          return `${evidence.filter(entry => verificationOf(entry) === 'verified-reference').length} verified of ${evidence.length}`;
        } },
        { header: 'Stored documents', cell: finding => {
          const { evidence } = linksFor(handle, finding);
          const count = evidence.filter(documentIdOf).length;
          return count ? String(count) : missing('None');
        } },
        { header: 'Policy source', cell: finding => authority(finding.sourceIds, caseSources(ctx, item)) },
        { header: 'Record and hold', cell: finding => {
          const { record } = linksFor(handle, finding);
          return record ? status(holdStatus, record.hold) : '';
        } },
        { header: 'Tasks', class: 'num', cell: finding => String(linksFor(handle, finding).tasks.length) },
        { header: 'Reviews', class: 'num', cell: finding => {
          const links = linksFor(handle, finding);
          return String(links.reviews.length + links.drafts.length);
        } },
      ],
    }),
    h('p', { class: 'hint' }, `Case ${item.id} is synthetic. Evidence IDs are scoped to this case and are never joined to another case or to a public award.`));
}

// One step in the chain: what it is, what was stored, and what it does not show.
const step = (label, meaning, ...content) => h('li', { class: 'chain-step' },
  h('p', { class: 'chain-label' }, label),
  h('p', { class: 'hint' }, meaning),
  content);

function documentStep(entry, documents) {
  const documentId = documentIdOf(entry);
  if (!documentId) {
    return step('Document content', 'Whether the text of the document is stored here.',
      h('p', null, missing('Not available.'), ' The locator is a reference to something outside this workspace, so its content cannot be shown.'));
  }
  if (documents.status === 'loading') return step('Document content', 'Whether the text of the document is stored here.', h('p', { class: 'hint' }, 'Checking the document service…'));
  if (documents.status !== 'available') {
    return step('Document content', 'Whether the text of the document is stored here.',
      h('p', null, missing('Cannot be shown right now.'), documents.status === 'not-running'
        ? ' The reference points at a stored document, but the document service is not running in this mode.'
        : ' The reference points at a stored document, but the document service did not respond.'), button('Try again', documents.retry));
  }
  const stored = documents.items.get(documentId);
  if (!stored) {
    return step('Document content', 'Whether the text of the document is stored here.',
      h('p', null, missing('Not found.'), ' The reference names a stored document that is not in this case\'s document list.'));
  }
  const hashInLocator = /sha256=([0-9a-f]{64})/.exec(entry.locator)?.[1];
  return step('Document content', 'Whether the text of the document is stored here. Stored text is untrusted source material.',
    facts([
      ['Document', h('a', { href: `#/documents/${encodeURIComponent(stored.id)}` }, stored.title)],
      ['Document status', stored.status === 'ready' ? `Text extracted into ${stored.spanCount} spans` : 'Preparing text'],
      ['Stored hash', h('span', { class: 'mono wrap' }, stored.sha256)],
      ['Matches the reference', hashInLocator ? (hashInLocator === stored.sha256 ? 'Yes, the reference carries the same hash' : h('strong', null, 'No, the reference carries a different hash')) : 'The reference carries no hash'],
    ]));
}

export function linkPanel(handle, findingId, ctx, documents) {
  const finding = handle.detail.report.findings.find(entry => entry.id === findingId);
  if (!finding) return null;
  const item = handle.detail.case;
  const base = `#/cases/${encodeURIComponent(item.id)}`;
  const kind = finding.category === 'contracting' ? finding.id.slice(item.id.length + 1) : null;
  const links = linksFor(handle, finding);

  const evidenceSteps = !kind
    ? [step('Evidence reference', 'A title and locator saying where a supporting document lives.', h('p', null, missing('Not used.'), ' This check is not based on evidence references.'))]
    : links.evidence.length === 0
      ? [step('Evidence reference', 'A title and locator saying where a supporting document lives.',
          h('p', null, missing('None supplied in this workspace.'), ' That does not show the document is missing from agency files.'))]
      : links.evidence.flatMap(entry => [
          step('Evidence reference', 'A title and locator saying where a supporting document lives.',
            facts([
              ['Reference', h('a', { href: `#/evidence/${encodeURIComponent(item.id)}/${encodeURIComponent(entry.id)}` }, entry.title)],
              ['Document location', locator(entry.locator)],
              ['Evidence ID', h('span', { class: 'mono' }, entry.id)],
            ])),
          step('Reference checks', 'A reviewer\'s assertion that the reference exists. It is not approval of the content.',
            h('p', null, status(verificationLabels, verificationOf(entry)))),
          documentStep(entry, documents),
          step('Extracted span', 'A numbered passage of stored text that a reference can point at.',
            h('p', null, missing('No span is linked.'), ' This reference points at a whole document or an outside locator, not at a passage.')),
        ]);

  const node = h('div', null,
    h('p', { class: 'panel-status' }, status(findingStatus, finding.status), ` · ${areaLabel(finding, item)}`),
    h('ol', { class: 'chain' },
      step('Case', 'The synthetic case this finding belongs to.',
        facts([['Case', item.title], ['Case ID', h('span', { class: 'mono' }, item.id)], ['Revision', String(item.revision)]])),
      step('Finding', `Computed by rule version ${handle.detail.report.ruleVersion} from the case data. It describes supplied evidence, not a legal conclusion.`,
        facts([
          ['Finding', finding.title],
          ['Finding ID', h('span', { class: 'mono wrap' }, finding.id)],
          kind && ['Does this check apply?', applicabilityLabels[item.applicability[kind]]],
        ]),
        h('p', null, finding.explanation)),
      evidenceSteps,
      step('Policy source', 'A published authority the check cites. Citing it does not decide how it applies to this case.',
        citations(finding.sourceIds, caseSources(ctx, item))),
      step('Reviewer judgment', 'What people recorded about this finding. Notes and reviewed drafts never change the finding.',
        links.reviews.length === 0 && links.drafts.length === 0
          ? h('p', null, missing('None recorded.'))
          : h('ul', { class: 'item-list' },
              links.reviews.map(review => h('li', null,
                h('p', null, `Review note: ${dispositions[review.disposition] || review.disposition}`),
                h('p', { class: 'hint wrap' }, `${review.note} · ${formatTime(review.at)}`))),
              links.drafts.map(draft => h('li', null,
                h('p', null, h('a', { href: `${base}/drafts/${encodeURIComponent(draft.id)}` }, draft.title)),
                h('p', { class: 'hint' }, `Review draft · ${draftStanding(draft)} · version ${draft.version}`)))))),

    h('section', { class: 'panel-section' },
      h('h3', null, 'Related record and hold'),
      links.record
        ? facts([
            ['Record', h('a', { href: `#/records/${encodeURIComponent(item.id)}/${encodeURIComponent(links.record.id)}/file` }, links.record.title)],
            ['Hold', status(holdStatus, links.record.hold)],
            ['Retention', status(retentionStatus, links.record.retention.status)],
            ['Hold reviews saved', String((item.records.find(entry => entry.id === links.record.id)?.holdReviews || []).length)],
          ])
        : h('p', { class: 'hint' }, 'This finding is not about a record.')),

    h('section', { class: 'panel-section' },
      h('h3', null, 'Related tasks'),
      links.tasks.length === 0
        ? h('p', { class: 'hint' }, 'No follow-up tasks are linked to this finding.')
        : h('ul', { class: 'item-list' }, links.tasks.map(task => h('li', null,
            h('div', { class: 'line' }, h('span', null, task.title), status(taskStatus, task.status)),
            h('p', { class: 'hint' }, `Assigned to ${task.owner} · ${task.dueDate ? `due ${formatDay(task.dueDate)}` : 'no due date'}`)))),
      h('p', null, h('a', { href: `#/workbench/${encodeURIComponent(finding.id)}` }, 'Work on this finding in the workbench'))));

  return { title: finding.title, node };
}
