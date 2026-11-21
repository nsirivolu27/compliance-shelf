// Case file: one read-only page that lays out everything about a case in the order
// an auditor reads it. It prints cleanly, so it can be saved as a PDF from the browser.

import * as api from '../api.js';
import {
  h, button, status, authority, facts, notice, emptyState, errorState, dataTable, locator, externalLink,
  findingStatus, retentionStatus, holdStatus, taskStatus, applicabilityLabels, evidenceKinds, dispositions,
  categoryLabels, areaLabel, caseSources, actionLabels, describeEvent, formatDay, formatTime, shortId, announce,
} from '../dom.js';
import { downloadText } from '../csv.js';
import { reviewDateText, draftStanding } from '../panels.js';

const none = text => h('p', { class: 'hint' }, text);

export function caseFile(detail, ctx, drafts = []) {
  const item = detail.case;
  const report = detail.report;
  const kindOf = finding => finding.category === 'contracting' ? finding.id.slice(item.id.length + 1) : null;
  const usedSourceIds = [...new Set(report.findings.flatMap(finding => finding.sourceIds))];
  const trail = h('div', null, none('Loading the audit trail…'));
  const download = h('button', { type: 'button', class: 'button', id: 'download-packet', disabled: true }, 'Download case packet');

  // The server's case packet carries the full event trail and the hold reviews saved on each record.
  const loadPacket = () => api.getCasePacket(item.id).then(response => {
    const packet = response.body;
    const recordTitle = id => item.records.find(record => record.id === id)?.title || id;
    download.disabled = false;
    download.addEventListener('click', () => {
      const stamp = String(packet.exportedAt).replace(/[:.]/g, '-');
      downloadText(`Compliance Shelf case packet ${shortId(item.id).replace('…', '')} ${stamp}.json`, response.text, 'application/json');
      announce('Case packet downloaded. Its digest detects accidental change only. It is not a tamper-proof seal.');
    });
    const events = [...packet.events].reverse();
    trail.replaceChildren(
      h('section', null,
        h('h2', null, 'Hold reviews'),
        packet.holdReviews.length === 0
          ? none('No hold review is saved on the records of this case.')
          : dataTable({
              label: 'Hold reviews',
              rows: packet.holdReviews,
              columns: [
                { header: 'Record', cell: review => recordTitle(review.recordId) },
                { header: 'Reviewed as', cell: review => holdStatus[review.status]?.label || review.status },
                { header: 'Review reference', cell: review => locator(String(review.reference)) },
                { header: 'Release authorization', cell: review => review.releaseReference ? locator(String(review.releaseReference)) : 'None' },
                { header: 'Rationale', cell: review => h('span', { class: 'wrap' }, review.note) },
                { header: 'When', cell: review => formatTime(review.reviewedAt) },
                { header: 'Recorded by', cell: review => review.actor },
              ],
            })),
      h('section', null,
        h('h2', null, 'Audit trail'),
        events.length === 0
          ? none('Nothing has been logged for this case yet.')
          : dataTable({
              label: 'Audit trail',
              rows: events,
              columns: [
                { header: 'When', cell: event => formatTime(event.at) },
                { header: 'Action', cell: event => actionLabels[event.action] || event.action },
                { header: 'Subject', cell: event => h('span', { class: 'wrap' }, describeEvent(event).subject) },
                { header: 'Reason given', cell: event => h('span', { class: 'wrap' }, describeEvent(event).note) },
                { header: 'Case revision', class: 'num', cell: event => event.caseRevision === null || event.caseRevision === undefined ? '' : String(event.caseRevision) },
              ],
            }),
        none(`All ${events.length} entries for this case, newest first. In this local demo the operator is not authenticated, and the history is editable on disk. It is not a tamper-proof log.`)),
      h('section', null,
        h('h2', null, 'Packet digest'),
        facts([
          ['Algorithm', packet.digest.algorithm],
          ['Value', h('span', { class: 'mono wrap' }, packet.digest.value)],
          ['Packet built', formatTime(packet.exportedAt)],
        ], true),
        none(`${packet.digestNotice} Each download is built fresh, so its digest differs from the one shown here.`)));
  }).catch(error => trail.replaceChildren(errorState(error, loadPacket)));
  loadPacket();

  return h('div', { class: 'case-file stack' },
    h('div', { class: 'tab-bar no-print' },
      h('p', { class: 'hint' }, 'A read-only summary of this case for review or audit. Use the browser print dialog to save it as a PDF.'),
      h('span', { class: 'button-row' }, download, button('Print or save as PDF', () => window.print(), 'button-primary', 'print-case-file'))),

    h('section', null,
      h('h2', null, 'Case'),
      facts([
        ['Case', item.title],
        ['Case ID', h('span', { class: 'mono' }, item.id)],
        ['Data type', 'Synthetic case. It does not describe a real award, vendor, or office.'],
        ['Agency', item.agency],
        ['Business unit', item.businessUnit || h('span', { class: 'missing' }, 'Not recorded')],
        ['Record family', item.recordFamily || h('span', { class: 'missing' }, 'Not recorded')],
        ['Synthetic contract number', item.contractNumber || h('span', { class: 'missing' }, 'None recorded')],
        ['Period of performance', item.periodOfPerformance ? `${formatDay(item.periodOfPerformance.start)} to ${formatDay(item.periodOfPerformance.end)}` : h('span', { class: 'missing' }, 'None recorded')],
        ['Case owner', item.owner],
        ['Case revision', String(item.revision)],
        ['Review date', formatDay(report.asOf)],
        ['Rule version', report.ruleVersion],
        ['Last logged run', detail.lastRun
          ? `${formatTime(detail.lastRun.at)} at revision ${detail.lastRun.details.revision}${detail.lastRunStale ? '. The case has changed since that run.' : '. Matches the findings below.'}`
          : 'No run has been logged. The findings below are computed from the current data.'],
        ['Prepared', formatTime(new Date().toISOString())],
      ], true)),

    notice('info', 'What this file does and does not show',
      `${report.limitation} A missing reference means it was not supplied to this workspace. "Evidence present" means a reviewer confirmed that a reference exists. Review dates never authorize destruction.`),

    h('section', null,
      h('h2', null, 'Policy basis'),
      facts([
        ['Governing policy version', item.policyBasisConfirmed ? 'Marked confirmed by a reviewer' : h('span', { class: 'missing' }, 'Not confirmed')],
        ['Description', item.policyBasis?.description || h('span', { class: 'missing' }, 'None recorded')],
        ['Sources cited', item.policyBasis?.sourceIds?.length ? authority(item.policyBasis.sourceIds, caseSources(ctx, item)) : h('span', { class: 'missing' }, 'None recorded')],
      ], true)),

    h('section', null,
      h('h2', null, 'Checks'),
      dataTable({
        label: 'Checks',
        rows: report.findings,
        columns: [
          { header: 'Check', cell: finding => finding.title },
          { header: 'Area', cell: finding => areaLabel(finding, item) },
          { header: 'Authority', cell: finding => authority(finding.sourceIds, caseSources(ctx, item)) },
          { header: 'Does this check apply?', cell: finding => kindOf(finding) ? applicabilityLabels[item.applicability[kindOf(finding)]] : '' },
          { header: 'Status', cell: finding => status(findingStatus, finding.status) },
          { header: 'Explanation', cell: finding => h('span', { class: 'wrap' }, finding.explanation) },
        ],
      })),

    h('section', null,
      h('h2', null, 'Evidence references'),
      item.evidence.length === 0
        ? none('No evidence references have been supplied to this workspace.')
        : dataTable({
            label: 'Evidence references',
            rows: item.evidence,
            columns: [
              { header: 'Reference', cell: entry => h('span', { class: 'wrap' }, entry.title) },
              { header: 'Supports', cell: entry => evidenceKinds[entry.kind] || entry.kind },
              { header: 'Document location', cell: entry => locator(entry.locator) },
              { header: 'Origin', cell: entry => entry.provenance === 'synthetic' ? 'Synthetic fixture' : 'Added in this workspace' },
              { header: 'Verification', cell: entry => entry.verified ? 'Reference checked' : 'Reference not checked' },
            ],
          }),
      none('References are titles and locators only. No document contents are stored or validated here.')),

    h('section', null,
      h('h2', null, 'Records'),
      report.records.length === 0
        ? none('No records are in this case inventory.')
        : dataTable({
            label: 'Records',
            rows: report.records,
            columns: [
              { header: 'Record', cell: record => record.title },
              { header: 'Owner', cell: record => record.owner?.trim() ? record.owner : h('span', { class: 'missing' }, 'Not assigned') },
              { header: 'Schedule authority', cell: record => record.schedule
                ? h('span', { class: 'wrap' }, `${record.schedule.authority}${record.schedule.itemNumber ? `, item ${record.schedule.itemNumber}` : ''} (${record.schedule.years} years after final payment${record.schedule.confirmed ? ', confirmed' : ', not confirmed'})`)
                : h('span', { class: 'missing' }, 'Unknown') },
              { header: 'Final payment', cell: record => record.finalPaymentDate ? formatDay(record.finalPaymentDate) : h('span', { class: 'missing' }, 'Not recorded') },
              { header: 'Hold', cell: record => status(holdStatus, record.hold) },
              { header: 'Retention', cell: record => status(retentionStatus, record.retention.status) },
              { header: 'Review date', cell: record => reviewDateText(record.retention) },
            ],
          }),
      none('A review date prompts a records officer review. It is not a disposal date, and an active hold always comes first.')),

    h('section', null,
      h('h2', null, 'Review notes'),
      detail.reviews.length === 0
        ? none('No review notes have been recorded.')
        : dataTable({
            label: 'Review notes',
            rows: detail.reviews,
            columns: [
              { header: 'Finding', cell: review => review.findingSnapshot?.title || review.findingId },
              { header: 'Disposition', cell: review => dispositions[review.disposition] || review.disposition },
              { header: 'Rationale', cell: review => h('span', { class: 'wrap' }, review.note) },
              { header: 'When', cell: review => formatTime(review.at) },
            ],
          })),

    // This printable summary does not list linked passages or sufficiency assessments.
    // It says so, with counts, and points to the JSON packet, which carries the full history.
    h('section', null,
      h('h2', null, 'Passages and sufficiency assessments'),
      h('p', null, `${(item.citations || []).length} linked ${(item.citations || []).length === 1 ? 'passage' : 'passages'} and ${(item.assessments || []).length} sufficiency ${(item.assessments || []).length === 1 ? 'assessment' : 'assessments'} are stored for this case, including earlier and replaced entries.`),
      h('p', { class: 'hint' }, 'They are not listed in this summary. The JSON case packet holds each passage with its document version and location, and each assessment with its snapshot and whether it still needs review. Download it from the case page. None of these entries establishes legal compliance.')),

    h('section', null,
      h('h2', null, 'Review drafts'),
      drafts.length === 0
        ? none('No review note has been drafted for this case.')
        : dataTable({
            label: 'Review drafts',
            rows: drafts,
            columns: [
              { header: 'Review note', cell: draft => draft.title },
              { header: 'Standing', cell: draft => draftStanding(draft) },
              { header: 'Version', class: 'num', cell: draft => String(draft.version) },
              { header: 'Author', cell: draft => draft.author },
              { header: 'Reviewer', cell: draft => draft.reviewer || 'None named' },
              { header: 'Decisions recorded', class: 'num', cell: draft => String(draft.decisions.length) },
            ],
          }),
      none('A reviewed note describes the note only. It does not resolve a finding, verify evidence, release a hold, or authorize destruction. Names are typed and not verified in this local demo. The full text and decision history are in the case packet.')),

    h('section', null,
      h('h2', null, 'Follow-up tasks'),
      detail.tasks.length === 0
        ? none('No follow-up tasks have been created.')
        : dataTable({
            label: 'Follow-up tasks',
            rows: detail.tasks,
            columns: [
              { header: 'Task', cell: task => task.title },
              { header: 'Assigned to', cell: task => task.owner },
              { header: 'Due', cell: task => task.dueDate ? `${formatDay(task.dueDate)}${task.overdue ? ' (overdue)' : ''}` : 'No date' },
              { header: 'Task status', cell: task => status(taskStatus, task.status) },
              { header: 'Finding now', cell: task => status(findingStatus, task.findingStatus) },
            ],
          }),
      none('A finished task does not clear its finding.')),

    trail,

    h('section', null,
      h('h2', null, 'Authorities cited'),
      usedSourceIds.length === 0
        ? emptyState('No sources are cited by this case.')
        : h('ul', { class: 'plain-list' }, usedSourceIds.map(id => {
            const source = caseSources(ctx, item).find(entry => entry.id === id);
            if (!source) return h('li', null, id);
            return h('li', null, externalLink(source.url, source.title), `. ${source.locator}. Last checked ${formatDay(source.checkedOn)}. `, h('span', { class: 'hint' }, source.scope));
          }))));
}
