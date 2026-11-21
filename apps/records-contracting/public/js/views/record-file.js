// Record file: one page that brings a record, its contract case, and its audit trail
// together, so a reviewer can see how the record is being maintained.

import * as api from '../api.js';
import {
  h, button, status, authority, facts, notice, pageHeader, loadingState, errorState, emptyState, dataTable, locator, citations,
  findingStatus, retentionStatus, holdStatus, taskStatus, applicabilityLabels, dispositions, actionLabels, describeEvent,
  formatDay, formatTime, caseSources,
} from '../dom.js';
import { reviewDateText, verificationLabels } from '../panels.js';

const none = text => h('p', { class: 'hint' }, text);
const missing = text => h('span', { class: 'missing' }, text);

// Plain statements of what is and is not in place for this record. Not a score.
function upkeepRows(item, record, computed, detail, events) {
  const reviews = record.holdReviews || [];
  const lastHold = reviews.at(-1);
  const tasks = detail.tasks.filter(task => task.findingId === `${item.id}:record:${record.id}`);
  const openTasks = tasks.filter(task => task.status !== 'done');
  const lastChange = [...events].reverse().find(event => event.details?.change?.after?.id === record.id);
  return [
    { item: 'Records owner', state: record.owner?.trim() ? 'Assigned' : 'Not assigned', detail: record.owner?.trim() || 'Assign an owner so someone is responsible for this record.', open: !record.owner?.trim() },
    { item: 'Retention schedule', state: record.schedule ? (record.schedule.confirmed ? 'Confirmed by a records officer' : 'On file, not confirmed') : 'Unknown',
      detail: record.schedule ? record.schedule.authority : 'The record stays retained until a records officer confirms a schedule.', open: !record.schedule?.confirmed },
    { item: 'Final payment date', state: record.finalPaymentDate ? 'Recorded' : 'Not recorded',
      detail: record.finalPaymentDate ? formatDay(record.finalPaymentDate) : 'Needed before a review date can be computed. An award end date is not a substitute.', open: !record.finalPaymentDate },
    { item: 'Hold status', state: holdStatus[record.hold]?.label || record.hold,
      detail: record.hold === 'active' ? 'The record must stay preserved.' : record.hold === 'unknown' ? 'Holds have not been checked. The record stays retained.' : 'A review found no hold.', open: record.hold !== 'none' },
    { item: 'Last hold review', state: lastHold ? formatTime(lastHold.reviewedAt) : 'None saved',
      detail: lastHold ? `Reviewed as ${holdStatus[lastHold.status]?.label || lastHold.status} by ${lastHold.actor}` : 'No hold review is saved on this record.', open: !lastHold },
    { item: 'Retention review', state: retentionStatus[computed.retention.status]?.label || computed.retention.status, detail: computed.retention.reason, open: computed.retention.status !== 'retain' },
    { item: 'Follow-up tasks', state: openTasks.length ? `${openTasks.length} open` : tasks.length ? 'All done' : 'None',
      detail: openTasks.length ? openTasks.map(task => `${task.title} (${task.owner}${task.dueDate ? `, due ${formatDay(task.dueDate)}` : ''}${task.overdue ? ', overdue' : ''})`).join('; ') : 'No open work is assigned on this record.', open: openTasks.length > 0 },
    { item: 'Last change to this record', state: lastChange ? formatTime(lastChange.at) : 'None logged', detail: lastChange ? `${actionLabels[lastChange.action] || lastChange.action}: ${describeEvent(lastChange).note}` : 'The record is as it was when the case data was loaded.', open: false },
    { item: 'Last logged check run', state: detail.lastRun ? formatTime(detail.lastRun.at) : 'None logged',
      detail: detail.lastRun ? (detail.lastRunStale ? 'The case has changed since that run.' : 'Matches the current case data.') : 'Run checks on the case to log the current findings.', open: !detail.lastRun || detail.lastRunStale },
  ];
}

export function createRecordFile(caseId, recordId, ctx) {
  const root = h('div', null, loadingState('Loading the record file…'));

  async function load() {
    root.replaceChildren(loadingState('Loading the record file…'));
    try {
      const [detail, packetResponse] = await Promise.all([api.getCase(caseId), api.getCasePacket(caseId)]);
      const record = detail.case.records.find(entry => entry.id === recordId);
      const computed = detail.report.records.find(entry => entry.id === recordId);
      if (!record || !computed) {
        root.replaceChildren(pageHeader('Record file'), emptyState('This record is not in the case.', null, h('a', { class: 'button', href: '#/records' }, 'Back to records')));
        return;
      }
      root.replaceChildren(render(detail, record, computed, packetResponse.body, ctx));
    } catch (error) {
      root.replaceChildren(pageHeader('Record file'), error.status === 404
        ? emptyState('This case or record does not exist.', null, h('a', { class: 'button', href: '#/records' }, 'Back to records'))
        : errorState(error, load));
    }
  }

  load();
  return { key: `record-file/${caseId}/${recordId}`, el: root };
}

function render(detail, record, computed, packet, ctx) {
  const item = detail.case;
  const findingId = `${item.id}:record:${record.id}`;
  const contracting = detail.report.findings.filter(finding => finding.category !== 'records');
  const upkeep = upkeepRows(item, record, computed, detail, packet.events);
  const recordEvents = [...packet.events].reverse().filter(event => event.details?.change?.after?.id === record.id
    || event.details?.findingId === findingId || event.details?.change?.after?.findingId === findingId);
  const reviews = detail.reviews.filter(review => review.findingId === findingId);
  const holdReviews = record.holdReviews || [];
  // The record's own finding names the sources that apply to it: the built-in pair for the example, the case's own otherwise.
  const recordSourceIds = detail.report.findings.find(finding => finding.id === findingId)?.sourceIds ?? [];
  const sourceIds = [...new Set([...recordSourceIds, ...contracting.flatMap(finding => finding.sourceIds)])];

  return h('div', { class: 'case-file' },
    h('p', { class: 'breadcrumb' }, h('a', { href: '#/records' }, 'Records'), ' / ', record.title),
    pageHeader(record.title,
      h('span', null, 'Record file · ', h('span', { class: 'mono' }, record.id), ' · Synthetic case data · Prepared ', formatTime(new Date().toISOString())),
      [h('a', { class: 'button', href: `#/records/${encodeURIComponent(item.id)}/${encodeURIComponent(record.id)}` }, 'Edit in Records'),
        button('Print or save as PDF', () => window.print(), 'button-primary', 'print-record-file')]),

    computed.retention.status === 'blocked' && notice('error', 'Active hold. Preserve this record.', 'The hold applies even though the retention interval may have elapsed. Nothing in this workspace authorizes destruction.'),
    computed.retention.status === 'review-due' && notice('warn', 'The review date has been reached.', 'That calls for a records officer review. It does not authorize destruction.'),

    h('div', { class: 'stack' },
      h('section', null,
        h('h2', null, 'How this record is being maintained'),
        dataTable({
          label: 'Record upkeep',
          rows: upkeep,
          columns: [
            { header: 'Item', cell: row => row.item },
            { header: 'Where it stands', cell: row => row.open ? h('strong', null, row.state) : row.state },
            { header: 'Detail', cell: row => h('span', { class: 'wrap' }, row.detail) },
          ],
        }),
        none('These lines describe what is recorded in this workspace. They are not a score, and they do not certify compliance.')),

      h('div', { class: 'dashboard' },
        h('section', null,
          h('h2', null, 'Record'),
          facts([
            ['Records owner', record.owner?.trim() ? record.owner : missing('Not assigned')],
            ['Schedule authority', record.schedule ? record.schedule.authority : missing('Unknown. Keep retained.')],
            ['Schedule item number', record.schedule?.itemNumber || missing('None recorded')],
            ['Retention period', record.schedule ? `${record.schedule.years} years after final payment` : missing('Unknown')],
            ['Verified final payment', record.finalPaymentDate ? formatDay(record.finalPaymentDate) : missing('Not recorded')],
            ['Hold', status(holdStatus, record.hold)],
            ['Retention', status(retentionStatus, computed.retention.status)],
            ['Review date', reviewDateText(computed.retention)],
          ], true),
          none('A review date is not a disposal date.')),
        h('section', null,
          h('h2', null, 'Contract'),
          facts([
            ['Case', h('a', { href: `#/cases/${encodeURIComponent(item.id)}` }, item.title)],
            ['Case ID', h('span', { class: 'mono' }, item.id)],
            ['Synthetic contract number', item.contractNumber || missing('None recorded')],
            ['Period of performance', item.periodOfPerformance ? `${formatDay(item.periodOfPerformance.start)} to ${formatDay(item.periodOfPerformance.end)}` : missing('None recorded')],
            ['Case owner', item.owner],
            ['Policy basis', item.policyBasisConfirmed ? 'Marked confirmed by a reviewer' : missing('Not confirmed')],
            ['Case revision', String(item.revision)],
          ], true),
          none('The case is synthetic. It is not linked to a real award or vendor.'))),

      h('section', null,
        h('h2', null, 'Contract file checks on this case'),
        dataTable({
          label: 'Contract file checks',
          rows: contracting,
          columns: [
            { header: 'Check', cell: finding => h('a', { href: `#/workbench/${encodeURIComponent(finding.id)}` }, finding.title) },
            { header: 'Authority', cell: finding => authority(finding.sourceIds, caseSources(ctx, item)) },
            { header: 'Does this check apply?', cell: finding => finding.category === 'contracting' ? applicabilityLabels[item.applicability[finding.id.slice(item.id.length + 1)]] : '' },
            { header: 'Status', cell: finding => status(findingStatus, finding.status) },
            { header: 'Evidence references', cell: finding => {
              const supplied = item.evidence.filter(entry => finding.evidenceIds.includes(entry.id));
              if (finding.category !== 'contracting') return '';
              if (supplied.length === 0) return missing('None supplied');
              return h('ul', { class: 'cell-list' }, supplied.map(entry => h('li', { class: 'wrap' }, entry.title, ' ',
                h('span', { class: 'hint' }, verificationLabels[entry.verified && entry.locator.trim() ? 'verified-reference' : 'unverified-reference'].label))));
            } },
          ],
        }),
        none('A verified reference means a reviewer confirmed the reference exists. A missing reference means none was supplied to this workspace.')),

      h('section', null,
        h('h2', null, 'Hold reviews'),
        holdReviews.length === 0
          ? none('No hold review is saved on this record.')
          : dataTable({
              label: 'Hold reviews',
              rows: [...holdReviews].reverse(),
              columns: [
                { header: 'When', cell: review => formatTime(review.reviewedAt) },
                { header: 'Reviewed as', cell: review => holdStatus[review.status]?.label || review.status },
                { header: 'Review reference', cell: review => locator(String(review.reference)) },
                { header: 'Release authorization', cell: review => review.releaseReference ? locator(String(review.releaseReference)) : 'None' },
                { header: 'Rationale', cell: review => h('span', { class: 'wrap' }, review.note) },
                { header: 'Recorded by', cell: review => review.actor },
              ],
            })),

      h('section', null,
        h('h2', null, 'Review notes and tasks on this record'),
        reviews.length === 0 && detail.tasks.every(task => task.findingId !== findingId)
          ? none('No review notes or follow-up tasks have been recorded for this record.')
          : [
              reviews.length > 0 && dataTable({ label: 'Review notes', rows: reviews, columns: [
                { header: 'Disposition', cell: review => dispositions[review.disposition] || review.disposition },
                { header: 'Rationale', cell: review => h('span', { class: 'wrap' }, review.note) },
                { header: 'When', cell: review => formatTime(review.at) },
              ] }),
              detail.tasks.some(task => task.findingId === findingId) && dataTable({ label: 'Follow-up tasks', rows: detail.tasks.filter(task => task.findingId === findingId), columns: [
                { header: 'Task', cell: task => task.title },
                { header: 'Assigned to', cell: task => task.owner },
                { header: 'Due', cell: task => task.dueDate ? `${formatDay(task.dueDate)}${task.overdue ? ' (overdue)' : ''}` : 'No date' },
                { header: 'Task status', cell: task => status(taskStatus, task.status) },
              ] }),
            ]),

      h('section', null,
        h('h2', null, 'Audit trail for this record'),
        recordEvents.length === 0
          ? none('No change to this record has been logged. The full case trail is in the case file.')
          : dataTable({
              label: 'Audit trail for this record',
              rows: recordEvents,
              columns: [
                { header: 'When', cell: event => formatTime(event.at) },
                { header: 'Action', cell: event => actionLabels[event.action] || event.action },
                { header: 'Reason given', cell: event => h('span', { class: 'wrap' }, describeEvent(event).note) },
                { header: 'Recorded by', cell: event => event.actor },
                { header: 'Case revision', class: 'num', cell: event => event.caseRevision === null || event.caseRevision === undefined ? '' : String(event.caseRevision) },
              ],
            }),
        none('Taken from the full saved trail of the case. In this local demo the operator is not authenticated and the history is editable on disk. It is not a tamper-proof log.'),
        h('p', { class: 'no-print' }, h('a', { href: `#/cases/${encodeURIComponent(item.id)}/file` }, 'Open the full case file and packet'))),

      h('section', null, h('h2', null, 'Authorities cited'), citations(sourceIds, caseSources(ctx, item)))));
}
