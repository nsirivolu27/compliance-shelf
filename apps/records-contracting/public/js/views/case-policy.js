// Policy context for one case: which policy versions the checks rest on, and whether
// a reviewer has recorded that each one applies. A citation alone does not establish
// that a requirement applies. Retrieval, review of our reading, and a per-case decision
// are shown as three separate things, and unknown stays unknown.

import * as api from '../api.js';
import { h, button, status, notice, facts, emptyState, dataTable, externalLink, announce, formatDay, formatTime, errorState } from '../dom.js';
import { openForm, noteField } from '../forms.js';

export const policyStatus = {
  confirmed: { label: 'Applicability confirmed', tone: 'ok' },
  unresolved: { label: 'Applicability unresolved', tone: 'review' },
  'requires-reassessment': { label: 'Needs reassessment', tone: 'warn' },
};
export const reviewStatus = {
  'retrieved-not-reviewed': { label: 'Retrieved, not reviewed', tone: 'review' },
  'qualified-review-recorded': { label: 'Qualified review recorded', tone: 'ok' },
};

// The registry is the same for every case, so it is fetched once per page load.
let registry = null;
export function loadPolicyVersions() {
  registry ??= api.getPolicyVersions().catch(error => { registry = null; throw error; });
  return registry;
}

const date = value => (value ? formatDay(value) : h('span', { class: 'missing' }, 'Not stated'));

// One version, with its dates, sources, and open questions.
export function versionFacts(version) {
  return facts([
    ['Version', h('span', null, version.label, ' ', h('span', { class: 'mono' }, `(${version.versionId})`))],
    ['Agency and scope', `${version.agency}. ${version.scope}`],
    ['Provision', version.provision],
    ['Effective', date(version.effectiveOn)],
    ['Published', date(version.publishedOn)],
    ['Our reading', status(reviewStatus, version.reviewStatus)],
    ['Official source', h('ul', { class: 'plain-list' }, version.sources.map(source =>
      h('li', null, externalLink(source.url, source.title), ` Retrieved ${formatDay(source.retrievedOn)}.`)))],
    version.applicabilityConditions.length > 0 && ['Applies when', h('ul', { class: 'plain-list' }, version.applicabilityConditions.map(text => h('li', null, text)))],
    version.unresolvedQuestions.length > 0 && ['Open questions', h('ul', { class: 'plain-list' }, version.unresolvedQuestions.map(text => h('li', null, text)))],
    version.deviatesFrom.length > 0 && ['Deviates from', version.deviatesFrom.join(', ')],
  ].filter(Boolean), true);
}

export function recordPolicyReview(handle, policies) {
  const context = handle.detail.policyContext;
  const relevant = policies.filter(policy => context.entries.some(entry => entry.policyId === policy.policyId));
  const options = relevant.flatMap(policy => policy.versions.map(version => ({ value: version.versionId, label: `${policy.title}: ${version.label}` })));
  const needsDecision = context.entries.find(entry => entry.status !== 'confirmed');
  const suggested = needsDecision?.laterVersionIds[0] || needsDecision?.inEffectVersionIds[0] || options[0]?.value;
  openForm({
    title: 'Record a policy review',
    intro: 'Record whether one policy version applies to this case. The decision is added to the case history. Earlier reviews are kept, and no finding, record, or hold changes. On a synthetic case this is a synthetic entry, never a real agency approval.',
    submitLabel: 'Record review',
    fields: [
      { name: 'versionId', type: 'select', label: 'Policy version', value: suggested, options, required: true },
      { name: 'applicability', type: 'select', label: 'Decision', value: 'unresolved', required: true, options: [
        { value: 'confirmed', label: 'This version applies to the case' },
        { value: 'unresolved', label: 'Still unresolved' }] },
      { name: 'basis', type: 'textarea', label: 'Basis for the decision', required: true, minlength: 10, maxlength: 2000, rows: 4,
        hint: 'What the reviewer relied on. At least 10 characters.' },
      { name: 'reviewer', label: 'Reviewer name', required: true, maxlength: 200, hint: 'Typed, not verified. Use a role or a synthetic name.' },
      noteField(),
    ],
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note, reviewer: values.reviewer,
        decisions: [{ versionId: values.versionId, applicability: values.applicability, basis: values.basis }] };
      return api.recordPolicyReview(handle.id, body, keyFor(body));
    },
    onConflict: () => handle.load(),
    onSuccess: async () => {
      await handle.load();
      announce('Policy review recorded. Findings and holds are unchanged.');
    },
  });
}

// The Policy tab of a case.
export function policyTab(handle, policies, redraw) {
  const context = handle.detail.policyContext;
  if (!policies) {
    const box = h('div', null, h('p', { class: 'hint' }, 'Loading policy versions…'));
    const load = () => loadPolicyVersions().then(redraw, error => box.replaceChildren(errorState(error, load)));
    load();
    return box;
  }
  const versionOf = id => policies.flatMap(policy => policy.versions).find(version => version.versionId === id);
  const label = id => versionOf(id)?.label || id;
  const list = ids => (ids.length ? h('ul', { class: 'plain-list' }, ids.map(id => h('li', null, label(id)))) : h('span', { class: 'missing' }, 'None'));
  const needs = context.counts.requiresReassessment;

  return h('div', { class: 'stack' },
    needs > 0
      ? notice('warn', `${needs} ${needs === 1 ? 'policy decision needs' : 'policy decisions need'} reassessment.`,
          'A later version of the policy is in effect on the screening date. The earlier review is kept below exactly as recorded. Nothing has been cleared or rewritten.')
      : notice('info', 'A cited source does not by itself establish that a requirement applies to this case.',
          'Each policy stays unresolved until a reviewer records a decision for this case.'),
    h('div', { class: 'tab-bar' },
      h('h2', null, 'Policies behind this case\'s checks'),
      button('Record policy review', () => recordPolicyReview(handle, policies), 'button-primary', 'policy-review-add')),
    context.entries.length === 0
      ? emptyState('No registered policy version is cited by this case\'s checks.', 'Checks from a loaded profile cite their own sources, which carry no version history.')
      : dataTable({
          label: 'Policy context',
          rows: context.entries,
          columns: [
            { header: 'Policy', cell: entry => h('div', null, h('strong', { class: 'wrap' }, entry.title), h('p', { class: 'hint wrap' }, entry.reason)) },
            { header: 'For this case', cell: entry => status(policyStatus, entry.status) },
            { header: 'Version reviewed', cell: entry => (entry.reviewedVersionId
              ? h('div', null, label(entry.reviewedVersionId), h('p', { class: 'hint' }, `Recorded ${formatTime(entry.reviewedAt)}`))
              : h('span', { class: 'missing' }, 'No decision recorded')) },
            { header: 'In effect on the screening date', cell: entry => list(entry.inEffectVersionIds) },
            { header: 'Later version', cell: entry => list(entry.laterVersionIds) },
          ],
        }),
    h('section', null,
      h('h2', null, 'Versions considered'),
      h('p', { class: 'hint' }, 'Every version was retrieved from an official source on the date shown. None has been reviewed by a specialist, and retrieving a document is not approval of how this prototype reads it.'),
      h('div', { class: 'stack' }, context.consideredVersionIds.map(versionOf).filter(Boolean).map(version =>
        h('details', { class: 'policy-version' },
          h('summary', null, version.label, ' · ', version.effectiveOn ? `effective ${formatDay(version.effectiveOn)}` : 'effective date not stated'),
          versionFacts(version))))),
    h('section', null,
      h('h2', null, 'Review history'),
      context.reviews.length === 0
        ? emptyState('No policy review has been recorded on this case.')
        : h('div', { class: 'policy-reviews' }, [...context.reviews].reverse().map(review =>
            h('article', { class: 'policy-review' },
              h('p', null, h('strong', null, review.reviewer), ` · ${formatTime(review.at)} · case revision ${review.caseRevision}`),
              h('p', { class: 'hint' }, review.synthetic
                ? 'Synthetic entry on a synthetic case. Not a real agency approval.'
                : 'Recorded entry.', review.identity === 'verified' ? ' Signed-in identity.' : ' The name was typed and is not verified.'),
              h('ul', { class: 'plain-list' }, review.decisions.map(decision =>
                h('li', null, h('strong', null, decision.applicability === 'confirmed' ? 'Applies: ' : 'Unresolved: '), label(decision.versionId), '. ', decision.basis))),
              h('p', { class: 'hint wrap' }, `Note: ${review.note}`))))),
    h('p', { class: 'hint' }, 'A policy decision never resolves a finding, releases a hold, or authorizes destruction.'));
}
