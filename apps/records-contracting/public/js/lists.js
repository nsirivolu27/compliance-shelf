// Searchable, filterable, paginated list backed by a server endpoint.
// Paging reuses the workspace revision returned with the first page, so a list
// never mixes rows from two different workspace states.

import { h, dataTable, emptyState, loadingState, errorState, notice, announce } from './dom.js';
import { toCsv, downloadText, today } from './csv.js';

/*
  options:
    label                    accessible name of the table
    searchLabel              label of the search box (omit to hide search)
    filters                  [{ name, label, options: [{ value, label }] }]
    fixed                    query values that are always sent, such as a case ID
    initial                  { q, filters } to start with, for links that open a filtered list
    pageSize                 rows per page
    load(query)              returns { items, pagination }
    columns                  column definitions for dataTable
    isSelected(row)          marks the open row
    emptyText                shown when the list has no rows at all
    csv                      { filename, columns: [{ header, value(row) }] } adds a CSV download of every matching row
*/
export function createList(options) {
  const pageSize = options.pageSize || 25;
  const state = { q: options.initial?.q || '', filters: { ...options.initial?.filters }, offset: 0, revision: null };
  const idBase = `list-${Math.random().toString(36).slice(2, 8)}`;

  const summary = h('p', { class: 'list-summary', role: 'status' });
  const changed = h('div', { hidden: true });
  const body = h('div', { class: 'list-body' }, loadingState('Loading…'));
  const previous = h('button', { type: 'button', class: 'button', disabled: true }, 'Previous');
  const next = h('button', { type: 'button', class: 'button', disabled: true }, 'Next');
  let lastItems = [];
  let latestRequest = 0;

  const search = options.searchLabel && h('input', { type: 'search', id: `${idBase}-q`, maxlength: '200', autocomplete: 'off' });
  if (search) search.value = state.q;
  const selects = (options.filters || []).map(filter => {
    const select = h('select', { id: `${idBase}-${filter.name}` },
      h('option', { value: '' }, 'All'),
      filter.options.map(option => h('option', { value: option.value }, option.label)));
    if (filter.options.some(option => option.value === state.filters[filter.name])) select.value = state.filters[filter.name];
    else delete state.filters[filter.name];
    select.addEventListener('change', () => {
      state.filters[filter.name] = select.value;
      state.offset = 0;
      fetchPage();
    });
    return { filter, select };
  });

  // Ignore starting filters this list does not offer.
  for (const name of Object.keys(state.filters)) {
    if (!selects.some(({ filter }) => filter.name === name)) delete state.filters[name];
  }

  let searchTimer = null;
  const applySearch = () => {
    clearTimeout(searchTimer);
    if (search.value.trim() === state.q) return;
    state.q = search.value.trim();
    state.offset = 0;
    fetchPage();
  };
  search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 300);
  });

  const toolbar = h('form', { class: 'toolbar', role: 'search' },
    search && h('div', { class: 'toolbar-field toolbar-search' }, h('label', { for: search.id }, options.searchLabel), search),
    selects.map(({ filter, select }) => h('div', { class: 'toolbar-field' }, h('label', { for: select.id }, filter.label), select)));
  toolbar.addEventListener('submit', event => {
    event.preventDefault();
    if (search) applySearch();
  });

  const hasQuery = () => Boolean(state.q) || Object.values(state.filters).some(Boolean);

  function clearQuery() {
    state.q = '';
    state.filters = {};
    state.offset = 0;
    if (search) search.value = '';
    for (const { select } of selects) select.value = '';
    fetchPage();
  }

  function render(result) {
    const { total, offset, nextOffset } = result.pagination;
    lastItems = result.items;
    previous.disabled = offset === 0;
    next.disabled = nextOffset === null;
    if (total === 0) {
      summary.textContent = hasQuery() ? 'No matches.' : '';
      body.replaceChildren(hasQuery()
        ? emptyState('Nothing matches this search.', 'Try a different word or clear the filters.',
            h('button', { type: 'button', class: 'button', onclick: clearQuery }, 'Clear search and filters'))
        : emptyState(options.emptyText || 'Nothing here yet.'));
      return;
    }
    summary.textContent = `Showing ${offset + 1} to ${offset + result.items.length} of ${total}`;
    body.replaceChildren(dataTable({ label: options.label, columns: options.columns, rows: result.items, isSelected: options.isSelected }));
  }

  async function fetchPage({ guard = false } = {}) {
    body.setAttribute('aria-busy', 'true');
    // A slow response to an older search must not overwrite a newer one.
    const requestNumber = ++latestRequest;
    try {
      const result = await options.load({
        q: state.q, ...state.filters, ...options.fixed,
        limit: pageSize, offset: state.offset,
        workspaceRevision: guard ? state.revision : undefined,
      });
      if (requestNumber !== latestRequest) return;
      state.revision = result.pagination.workspaceRevision;
      // A page past the end can happen after rows are removed by a filter change elsewhere.
      if (result.items.length === 0 && result.pagination.total > 0 && state.offset > 0) {
        state.offset = 0;
        return fetchPage();
      }
      render(result);
    } catch (error) {
      if (requestNumber !== latestRequest) return;
      if (error.revisionConflict) {
        // The workspace changed between pages. Start again from the first page of the new state.
        state.offset = 0;
        changed.hidden = false;
        changed.replaceChildren(notice('info', 'The workspace changed while you were paging.', 'The list was reloaded from its first page so it shows one consistent state.'));
        return fetchPage();
      }
      summary.textContent = '';
      body.replaceChildren(errorState(error, () => fetchPage()));
    } finally {
      if (requestNumber === latestRequest) body.removeAttribute('aria-busy');
    }
  }

  previous.addEventListener('click', () => {
    state.offset = Math.max(0, state.offset - pageSize);
    fetchPage({ guard: true });
  });
  next.addEventListener('click', () => {
    state.offset += pageSize;
    fetchPage({ guard: true });
  });

  // Collects every row that matches the current search and filters, 100 at a time.
  // All pages must come from one workspace revision, so a change in between starts over.
  async function allRows(attempt = 0) {
    const rows = [];
    let offset = 0;
    let revision;
    try {
      while (offset !== null) {
        const result = await options.load({ q: state.q, ...state.filters, ...options.fixed, limit: 100, offset, workspaceRevision: revision });
        revision = result.pagination.workspaceRevision;
        rows.push(...result.items);
        offset = result.pagination.nextOffset;
      }
    } catch (error) {
      if (error.revisionConflict && attempt < 2) return allRows(attempt + 1);
      throw error;
    }
    return rows;
  }

  const csvProblem = h('div', { hidden: true });
  const csvButton = options.csv && h('button', { type: 'button', class: 'button' }, 'Download CSV');
  csvButton?.addEventListener('click', async () => {
    csvButton.setAttribute('aria-disabled', 'true');
    csvProblem.hidden = true;
    try {
      const rows = await allRows();
      downloadText(`${options.csv.filename} ${today()}.csv`, toCsv(options.csv.columns, rows));
      announce(`Downloaded ${rows.length} rows as CSV.`);
    } catch (error) {
      csvProblem.hidden = false;
      csvProblem.replaceChildren(notice('error', 'The CSV was not created.', error.offline ? 'The local server could not be reached. Try again once it is running.' : error.message));
    }
    csvButton.removeAttribute('aria-disabled');
  });

  const el = h('div', { class: 'list' },
    (search || selects.length > 0) && toolbar,
    changed,
    body,
    csvProblem,
    h('div', { class: 'list-foot' }, summary, h('div', { class: 'button-row' }, csvButton, previous, next)));

  fetchPage();

  return {
    el,
    // Reloads the current page without a revision guard, used after a save.
    reload: () => fetchPage(),
    // Redraws the rows already loaded, used when only the selected row changed.
    // Fills a filter whose choices are only known after another request finishes.
    setFilterOptions(name, choices) {
      const entry = selects.find(({ filter }) => filter.name === name);
      if (!entry) return;
      const current = entry.select.value;
      entry.select.replaceChildren(h('option', { value: '' }, 'All'), ...choices.map(option => h('option', { value: option.value }, option.label)));
      entry.select.value = choices.some(option => option.value === current) ? current : '';
    },
    redraw: () => { if (lastItems.length) body.replaceChildren(dataTable({ label: options.label, columns: options.columns, rows: lastItems, isSelected: options.isSelected })); },
  };
}
