// Audit export: a preview of GET /api/export and a download of that exact response.

import * as api from '../api.js';
import { h, pageHeader, notice, emptyState, loadingState, errorState, facts, dataTable, externalLink, dispositions, formatDay, formatTime, shortId } from '../dom.js';

export function create() {
  const body = h('div', null, loadingState('Building the audit packet…'));
  const download = h('button', { type: 'button', class: 'button button-primary', disabled: true }, 'Download JSON packet');
  const reload = h('button', { type: 'button', class: 'button' }, 'Refresh preview');
  let packetText = null;
  let packet = null;

  async function load() {
    download.disabled = true;
    body.replaceChildren(loadingState('Building the audit packet…'));
    try {
      const response = await api.getExport();
      packet = response.body;
      packetText = response.text;
      body.replaceChildren(preview(packet));
      download.disabled = false;
    } catch (error) {
      body.replaceChildren(errorState(error, load));
    }
  }

  // Saves the exact text returned by the server, with nothing added or removed.
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([packetText], { type: 'application/json' }));
    const stamp = String(packet.exportedAt).replace(/[:.]/g, '-');
    const link = h('a', { href: url, download: `compliance-platform-audit-packet-${stamp}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
  reload.addEventListener('click', load);

  load();
  return {
    key: 'export',
    el: h('div', null,
      pageHeader('Audit export', 'The packet holds the cases, sources, computed reports, review notes, and the full event trail with before and after values. The download is the same response previewed here.', [reload, download]),
      body),
  };
}

function preview(packet) {
  const titleOf = id => packet.cases.find(item => item.id === id)?.title || shortId(id);
  return h('div', { class: 'stack' },
    notice('warn', 'Limits of this packet', packet.limitation),

    h('section', null,
      h('h2', null, 'Contents'),
      facts([
        ['Exported', formatTime(packet.exportedAt)],
        ['Review date', formatDay(packet.asOf)],
        ['Workspace revision', String(packet.revision)],
        ['Cases', String(packet.cases.length)],
        ['Review notes', String(packet.reviews.length)],
        ['Logged events', String(packet.events.length)],
        ['Official sources', String(packet.sources.length)],
      ], true)),

    h('section', null,
      h('h2', null, 'Computed reports'),
      dataTable({
        label: 'Computed reports',
        rows: packet.reports,
        columns: [
          { header: 'Case', cell: report => titleOf(report.caseId) },
          { header: 'Revision', class: 'num', cell: report => String(report.revision) },
          { header: 'Checks', class: 'num', cell: report => String(report.summary.total) },
          { header: 'Reference checked', class: 'num', cell: report => String(report.summary.evidencePresent) },
          { header: 'Needs evidence', class: 'num', cell: report => String(report.summary.needsEvidence) },
          { header: 'Needs review', class: 'num', cell: report => String(report.summary.needsReview) },
          { header: 'Blocked by hold', class: 'num', cell: report => String(report.summary.blocked) },
        ],
      })),

    h('section', null,
      h('h2', null, 'Review notes'),
      packet.reviews.length === 0
        ? emptyState('No review notes yet.')
        : dataTable({
            label: 'Review notes',
            rows: packet.reviews,
            columns: [
              { header: 'Finding', cell: review => review.findingSnapshot?.title || review.findingId },
              { header: 'Case', cell: review => titleOf(review.caseId) },
              { header: 'Disposition', cell: review => dispositions[review.disposition] || review.disposition },
              { header: 'Rationale', cell: review => h('span', { class: 'wrap' }, review.note) },
              { header: 'When', cell: review => formatTime(review.at) },
            ],
          })),

    h('section', null,
      h('h2', null, 'Sources cited'),
      h('ul', { class: 'plain-list' }, packet.sources.map(source =>
        h('li', null, externalLink(source.url, source.title), h('span', { class: 'hint' }, ` ${source.locator}`))))),

    h('p', { class: 'hint' }, `The event trail has ${packet.events.length} entries. Browse it in `, h('a', { href: '#/activity' }, 'Activity'), ' or read it in the downloaded file.'),

    h('details', { class: 'raw' },
      h('summary', null, 'Raw JSON'),
      h('pre', { tabindex: '0' }, JSON.stringify(packet, null, 2))));
}
