// Paperwork: every item tracked across the workspace, and the catalog of forms and reports.
// The catalog says which entries were read on an agency page and which were not confirmed.

import * as api from '../api.js';
import { h, pageHeader, loadingState, errorState, emptyState, dataTable, status, externalLink, formatDay } from '../dom.js';
import { paperworkStatus, verificationStatus, familyLabels, scopeLabels, entryTitle, readinessCell, dueCell } from '../paperwork-ui.js';

const cadenceLabels = { 'per-transfer': 'Each transfer', 'per-notice': 'Each notice', 'per-schedule': 'Each schedule', 'per-request': 'Each request', 'per-recommendation': 'Each recommendation', 'per-system': 'Each system', annual: 'Yearly' };

export function create() {
  const body = h('div', { class: 'stack' }, loadingState('Loading paperwork…'));

  async function load() {
    let tracked, catalog;
    try {
      [tracked, { catalog }] = await Promise.all([api.getPaperworkItems(), api.getPaperworkCatalog()]);
    } catch (error) {
      body.replaceChildren(errorState(error, load));
      return;
    }
    const { items, summary } = tracked;
    body.replaceChildren(
      h('section', null,
        h('h2', null, `Tracked across cases (${items.length})`),
        h('p', { class: 'hint' }, `${summary.blocked} blocked by a hold, ${summary.incomplete} with facts missing, ${summary.factsComplete} with all facts on file, ${summary.notTracked} listed only, ${summary.overdue} past a due date, ${summary.filed} filed by the agency.`),
        items.length === 0
          ? emptyState('No paperwork is tracked yet.', 'Open a case and use its Paperwork tab to add a transmittal, a disposal notice, a corrective action entry, or a reporting item.', h('a', { class: 'button', href: '#/cases' }, 'Go to cases'))
          : dataTable({
            label: 'Paperwork tracked across cases',
            rows: items,
            columns: [
              { header: 'Paperwork', cell: view => h('a', { href: `#/cases/${encodeURIComponent(view.caseId)}/paperwork/${encodeURIComponent(view.id)}` }, entryTitle(view.entry)) },
              { header: 'Case', cell: view => h('div', null, h('p', null, h('a', { href: `#/cases/${encodeURIComponent(view.caseId)}/paperwork`, title: view.caseId }, view.caseTitle)), h('p', { class: 'hint' }, view.recordFamily || view.organization)) },
              { header: 'Record', cell: view => view.recordTitle || h('span', { class: 'missing' }, 'None') },
              { header: 'Status', cell: view => status(paperworkStatus, view.status) },
              { header: 'Facts on file', cell: view => readinessCell(view.readiness) },
              { header: 'Due', cell: dueCell },
            ],
          })),
      h('section', null,
        h('h2', null, `Catalog (${catalog.length})`),
        h('p', { class: 'hint' }, 'Forms and reports this workspace knows about. "Source read" means the entry was read on the page it links to. "Not confirmed" means it was not, so treat it as unverified. Facts are counted for three entries. The rest are listed so a case can track a status and a date.'),
        dataTable({
          label: 'Paperwork catalog',
          rows: catalog,
          columns: [
            { header: 'Paperwork', cell: entry => h('div', null, h('p', null, entryTitle(entry)), h('p', { class: 'hint wrap' }, entry.note)) },
            { header: 'Kind', cell: entry => h('div', null, h('p', null, familyLabels[entry.family] || entry.family), h('p', { class: 'hint' }, `${scopeLabels[entry.scope] || entry.scope} · ${cadenceLabels[entry.cadence] || entry.cadence}`)) },
            { header: 'Prepared by and received by', cell: entry => h('div', null, h('p', { class: 'wrap' }, entry.preparedBy), h('p', { class: 'hint wrap' }, `To: ${entry.receivedBy}`)) },
            { header: 'Facts counted', class: 'num', cell: entry => (entry.requiredFacts.length ? String(entry.requiredFacts.length) : 'Listed only') },
            { header: 'Checked', cell: entry => h('div', null, status(verificationStatus, entry.verification),
              h('p', { class: 'hint' }, formatDay(entry.checkedOn)),
              entry.sourceUrl && h('p', null, externalLink(entry.sourceUrl, 'Source page'))) },
          ],
        })),
      h('p', { class: 'hint' }, tracked.limitation));
  }

  load();
  return {
    key: 'paperwork',
    el: h('div', null,
      pageHeader('Paperwork', 'The forms and reports an office prepares, and which of the facts each one needs are on file. Readiness is a count of facts, not a compliance rating. Nothing here is submitted to any agency.'),
      body),
  };
}
