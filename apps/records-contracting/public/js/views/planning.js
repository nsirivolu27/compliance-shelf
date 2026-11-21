// Planning: dated documentation needs taken from stored data, grouped by month.
// Task due dates, record review dates, and period end dates. No amounts and no advice.

import * as api from '../api.js';
import { h, pageHeader, loadingState, errorState, emptyState, dataTable, formatDay } from '../dom.js';

const typeLabels = { task: 'Follow-up task', 'record-review': 'Record review', 'period-end': 'Period end', paperwork: 'Paperwork' };
const monthOf = date => new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });

export function create() {
  const body = h('div', { class: 'stack' }, loadingState('Loading dated documentation needs…'));

  const caseLink = entry => h('div', null,
    h('p', null, h('a', { href: `#/cases/${encodeURIComponent(entry.caseId)}/${entry.section}`, title: entry.caseId }, entry.caseTitle)),
    h('p', { class: 'hint' }, entry.recordFamily || entry.organization));
  const columns = dated => [
    dated && { header: 'Date', cell: entry => h('span', { class: 'mono' }, formatDay(entry.date)) },
    { header: 'Need', cell: entry => h('div', null, h('p', { class: 'wrap' }, entry.title), h('p', { class: 'hint wrap' }, entry.note)) },
    { header: 'Kind', cell: entry => typeLabels[entry.type] },
    { header: 'Case', cell: caseLink },
    { header: 'Owner', cell: entry => entry.owner?.trim() ? entry.owner : h('span', { class: 'missing' }, 'Not assigned') },
  ].filter(Boolean);

  async function load() {
    let result;
    try {
      result = await api.getPlanning();
    } catch (error) {
      body.replaceChildren(errorState(error, load));
      return;
    }
    const past = result.dated.filter(entry => entry.past);
    const upcoming = result.dated.filter(entry => !entry.past);
    const months = [...new Set(upcoming.map(entry => entry.date.slice(0, 7)))];
    body.replaceChildren(...[
      h('section', null,
        h('h2', null, `Before ${formatDay(result.asOf)}`),
        past.length === 0
          ? h('p', { class: 'hint' }, 'Nothing dated before the screening date is still open.')
          : dataTable({ label: 'Dated needs before the screening date', rows: past, columns: columns(true) })),
      h('section', null,
        h('h2', null, 'Upcoming'),
        upcoming.length === 0 && emptyState('No upcoming dated need is stored.', 'Dates appear here when a task has a due date, a record has a computed review date, or a case has a period end date.'),
        months.map(month => h('div', { class: 'planning-month' },
          h('h3', null, monthOf(`${month}-01`)),
          dataTable({ label: `Dated needs in ${monthOf(`${month}-01`)}`, rows: upcoming.filter(entry => entry.date.startsWith(month)), columns: columns(true) })))),
      h('section', null,
        h('h2', null, 'No date set'),
        result.undated.length === 0
          ? h('p', { class: 'hint' }, 'Every open need has a date.')
          : dataTable({ label: 'Needs with no date', rows: result.undated, columns: columns(false) })),
      h('p', { class: 'hint' }, result.limitation),
    ]);
  }

  load();
  return {
    key: 'planning',
    el: h('div', null,
      pageHeader('Planning', 'What documentation work has a date, and what does not, across every synthetic case. Dates come only from stored task due dates, record review dates, period end dates, and paperwork due dates a person entered.'),
      body),
  };
}
