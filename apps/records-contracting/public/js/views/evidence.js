// Evidence library: every evidence reference across the cases, with the findings it supports.

import * as api from '../api.js';
import { h, button, rowButton, status, pageHeader, notice, loadingState, errorState, evidenceKinds, findingStatus } from '../dom.js';
import { createList } from '../lists.js';
import { openForm } from '../forms.js';
import { createInspector, evidencePanel, missingPanel, verificationLabels } from '../panels.js';
import { createCaseHandle } from '../case-actions.js';
import * as actions from '../case-actions.js';

const options = map => Object.entries(map).map(([value, entry]) => ({ value, label: entry.label || entry }));

export function create(route, ctx) {
  const body = h('div', null, loadingState('Loading evidence references…'));
  const problem = h('div');
  // Evidence IDs are unique only inside a case, so a selection is a case ID plus an evidence ID.
  let selected = route.parts[1] ? { caseId: route.parts[0], evidenceId: route.parts[1] } : null;
  let handle = null;
  let list = null;
  let cases = [];
  const isSelected = row => Boolean(selected) && row.caseId === selected.caseId && row.id === selected.evidenceId;

  const inspector = createInspector(() => {
    selected = null;
    handle = null;
    history.replaceState(null, '', '#/evidence');
    list?.redraw();
  });

  function showPanel(focus) {
    const panel = evidencePanel(handle, selected.evidenceId, ctx) || missingPanel();
    inspector.show(panel.title, panel.node, { focus });
  }

  async function open(caseId, evidenceId, focus = true) {
    selected = { caseId, evidenceId };
    history.replaceState(null, '', `#/evidence/${encodeURIComponent(caseId)}/${encodeURIComponent(evidenceId)}`);
    list?.redraw();
    let firstLoad = true;
    const current = createCaseHandle(caseId, () => {
      if (handle !== current) return;
      showPanel(firstLoad && focus);
      if (!firstLoad) list.reload();
      firstLoad = false;
    });
    handle = current;
    inspector.show('Loading…', loadingState('Loading reference…'), { focus });
    try {
      await current.load();
    } catch (error) {
      if (handle === current) inspector.show('Reference', errorState(error, () => open(caseId, evidenceId)), { focus: false });
    }
  }

  // A reference belongs to one case, so adding one starts by choosing the case.
  function addReference() {
    problem.replaceChildren();
    if (cases.length === 0) {
      problem.replaceChildren(notice('info', 'There are no cases yet.', 'Create a case before adding evidence references.'));
      return;
    }
    openForm({
      title: 'Add evidence reference',
      intro: 'Choose the case first. The next step asks for the reference.',
      submitLabel: 'Continue',
      fields: [{ name: 'caseId', type: 'select', label: 'Case', required: true, value: cases[0].id, options: cases.map(item => ({ value: item.id, label: item.title })) }],
      submit: async values => values.caseId,
      onSuccess: async caseId => {
        const target = createCaseHandle(caseId, () => { if (target.ready) list.reload(); });
        try {
          await target.load();
          target.ready = true;
          document.getElementById('add-reference')?.focus();
          actions.addEvidence(target);
        } catch (error) {
          problem.replaceChildren(errorState(error, addReference));
        }
      },
    });
  }

  async function start() {
    try {
      ({ cases } = await api.getCases());
      list = createList({
        label: 'Evidence references',
        searchLabel: 'Search title, locator, case, or case owner',
        initial: { filters: route.query },
        load: api.getEvidence,
        emptyText: 'No evidence references have been added to any case yet.',
        filters: [
          { name: 'verificationStatus', label: 'Verification', options: options(verificationLabels) },
          { name: 'kind', label: 'Kind', options: options(evidenceKinds) },
          { name: 'caseId', label: 'Case', options: cases.map(item => ({ value: item.id, label: item.title })) },
        ],
        csv: {
          filename: 'Compliance Shelf evidence references',
          columns: [
            { header: 'Evidence ID', value: row => row.id },
            { header: 'Reference', value: row => row.title },
            { header: 'Kind', value: row => evidenceKinds[row.kind] || row.kind },
            { header: 'Document location', value: row => row.locator },
            { header: 'Verification (reference only, not content approval)', value: row => verificationLabels[row.verificationStatus]?.label || row.verificationStatus },
            { header: 'Origin', value: row => row.provenance === 'synthetic' ? 'Synthetic fixture' : 'Added in this workspace' },
            { header: 'Case ID', value: row => row.caseId },
            { header: 'Case', value: row => row.caseTitle },
            { header: 'Case data type', value: row => row.caseProvenance },
            { header: 'Case owner', value: row => row.caseOwner },
            { header: 'Linked findings', value: row => row.linkedFindings.map(finding => `${finding.title} (${findingStatus[finding.status]?.label || finding.status})`).join('; ') },
          ],
        },
        isSelected,
        columns: [
          { header: 'Reference', cell: row => rowButton(row.title, () => open(row.caseId, row.id), isSelected(row), `open-${row.caseId}-${row.id}`) },
          { header: 'Kind', cell: row => evidenceKinds[row.kind] || row.kind },
          { header: 'Case', cell: row => h('a', { href: `#/cases/${encodeURIComponent(row.caseId)}/evidence`, title: row.caseId }, row.caseTitle) },
          { header: 'Verification', cell: row => status(verificationLabels, row.verificationStatus) },
          { header: 'Linked findings', cell: row => row.linkedFindings.length === 0
            ? h('span', { class: 'missing' }, 'None')
            : h('ul', { class: 'cell-list' }, row.linkedFindings.map(finding => h('li', null,
                h('a', { href: `#/workbench/${encodeURIComponent(finding.id)}` }, finding.title), ' ', h('span', { class: 'hint' }, findingStatus[finding.status]?.label || finding.status)))) },
        ],
      });
      body.replaceChildren(h('div', { class: 'split' }, h('div', { class: 'split-main' }, list.el), inspector.el));
      if (selected) open(selected.caseId, selected.evidenceId, false);
    } catch (error) {
      body.replaceChildren(errorState(error, start));
    }
  }

  start();
  return {
    key: 'evidence',
    el: h('div', null,
      pageHeader('Evidence library', 'Every evidence reference on the synthetic cases. A reference is a title and a locator. "Verified reference" means a reviewer confirmed the reference exists. It does not mean the document was approved or that anything is certified compliant.',
        button('Add reference', addReference, 'button-primary', 'add-reference')),
      problem,
      body),
  };
}
