// Public awards: real USAspending metadata, shown as background and kept apart from the cases.

import * as api from '../api.js';
import { h, pageHeader, notice, emptyState, loadingState, errorState, facts, externalLink, formatDay, formatMoney, formatTime } from '../dom.js';

const sorters = {
  amount: (a, b) => (b['Award Amount'] || 0) - (a['Award Amount'] || 0),
  recipient: (a, b) => String(a['Recipient Name']).localeCompare(String(b['Recipient Name'])),
  start: (a, b) => String(b['Start Date']).localeCompare(String(a['Start Date'])),
};

export function create() {
  const body = h('div', null, loadingState('Loading the public award sample…'));

  async function load() {
    body.replaceChildren(loadingState('Loading the public award sample…'));
    try {
      const data = await api.getAwards();
      body.replaceChildren(data.provenance === 'unavailable' || !Array.isArray(data.results) ? unavailable(data) : explorer(data));
    } catch (error) {
      body.replaceChildren(errorState(error, load));
    }
  }

  load();
  return {
    key: 'awards',
    el: h('div', { class: 'public-context' },
      h('p', { class: 'context-label' }, 'Real public data'),
      pageHeader('Public awards', 'Department of Veterans Affairs award metadata from USAspending, shown as background only.'),
      notice('public', 'Context only, kept apart from the compliance cases',
        'Nothing in this workspace alleges anything about the awards or vendors listed here. The compliance cases are synthetic and are not linked to any of them. Public award metadata cannot show what is in an agency contract file.'),
      body),
  };
}

function unavailable(data) {
  return emptyState('The public award sample is unavailable.',
    data.message || 'No readable snapshot was found. The synthetic cases remain usable.');
}

function explorer(data) {
  const search = h('input', { id: 'award-search', type: 'search', autocomplete: 'off' });
  const sort = h('select', { id: 'award-sort' },
    h('option', { value: 'amount' }, 'Award amount, highest first'),
    h('option', { value: 'recipient' }, 'Recipient, A to Z'),
    h('option', { value: 'start' }, 'Start date, newest first'));
  const tbody = h('tbody');
  const count = h('p', { class: 'list-summary', role: 'status' });

  function draw() {
    const term = search.value.trim().toLowerCase();
    const rows = data.results
      .filter(award => !term || ['Award ID', 'Recipient Name', 'Description'].some(key => String(award[key] || '').toLowerCase().includes(term)))
      .sort(sorters[sort.value]);
    count.textContent = `Showing ${rows.length} of ${data.results.length} awards in the sample`;
    tbody.replaceChildren(...(rows.length ? rows.map(awardRow) : [
      h('tr', null, h('td', { colspan: '5' }, 'No awards in the sample match that search.')),
    ]));
  }

  search.addEventListener('input', draw);
  sort.addEventListener('change', draw);
  draw();

  const request = data.request || {};
  const period = request.filters?.time_period?.[0];

  return h('div', { class: 'stack' },
    h('section', null,
      h('h2', null, 'Where this data comes from'),
      facts([
        ['Source', data.source ? externalLink(data.source, data.source) : 'Not recorded'],
        ['Retrieved', data.retrievedAt ? formatTime(data.retrievedAt) : 'Not recorded'],
        ['Awarding agency filter', request.filters?.agencies?.[0]?.name || 'Not recorded'],
        ['Action date filter', period ? `${formatDay(period.start_date)} to ${formatDay(period.end_date)}` : 'Not recorded'],
        ['Selection', request.limit ? `Top ${request.limit} by ${String(request.sort || 'award amount').toLowerCase()}. Not a representative sample.` : 'Not recorded'],
        ['Caveat', data.caveat || 'Award metadata is not evidence of compliance.'],
      ], true)),
    h('section', null,
      h('h2', null, 'Awards in the sample'),
      h('form', { class: 'toolbar', role: 'search', onsubmit: event => event.preventDefault() },
        h('div', { class: 'toolbar-field toolbar-search' }, h('label', { for: 'award-search' }, 'Search award ID, recipient, or description'), search),
        h('div', { class: 'toolbar-field' }, h('label', { for: 'award-sort' }, 'Sort by'), sort)),
      h('div', { class: 'table-wrap' },
        h('table', { 'aria-label': 'Public awards' },
          h('thead', null, h('tr', null,
            ['Award ID', 'Recipient', 'Description', 'Award amount', 'Period'].map((text, index) => h('th', { scope: 'col', class: index === 3 ? 'num' : null }, text)))),
          tbody)),
      h('div', { class: 'list-foot' }, count)));
}

function awardRow(award) {
  const id = award['Award ID'] || 'Unknown ID';
  const page = award.generated_internal_id
    ? externalLink(`https://www.usaspending.gov/award/${encodeURIComponent(award.generated_internal_id)}`, id)
    : id;
  return h('tr', null,
    h('th', { scope: 'row', class: 'mono' }, page),
    h('td', null, award['Recipient Name'] || 'Not reported'),
    h('td', { class: 'wrap' }, award['Description'] || 'Not reported'),
    h('td', { class: 'num' }, formatMoney(award['Award Amount'])),
    h('td', null, `${formatDay(award['Start Date'])} to ${formatDay(award['End Date'])}`));
}
