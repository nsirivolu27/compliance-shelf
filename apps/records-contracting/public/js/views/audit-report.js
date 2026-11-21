// Audit team report: what reviewers have recorded and what is still open, case by case.
// It lists lines and counts them. It gives no rate and no verdict, and reading it changes nothing.
// The download is the exact response the server sent.

import * as api from '../api.js';
import { workflowText,  h, button, pageHeader, loadingState, errorState, dataTable, facts, status, completeness, findingStatus, formatDay, formatTime, announce } from '../dom.js';
import { downloadText, today } from '../csv.js';
import { paperworkStatus, readinessState } from '../paperwork-ui.js';

const none = text => h('p', { class: 'hint' }, text);
const reviewDecision = value => ({ 'sufficient-for-stated-check': 'Enough evidence for this check', insufficient: 'More evidence needed', 'needs-clarification': 'Needs clarification' })[value] || 'Review needed';
const paperworkTitle = line => `${line.formNumber ? `${line.formNumber}: ` : ''}${line.title}`;

function paperworkTable(label, lines) {
  return dataTable({
    label,
    rows: lines,
    columns: [
      { header: 'Paperwork', cell: line => h('div', null, h('p', null, paperworkTitle(line)), line.recordTitle && h('p', { class: 'hint' }, line.recordTitle)) },
      { header: 'Status', cell: line => status(paperworkStatus, line.status) },
      { header: 'Facts on file', cell: line => h('div', null, status(readinessState, line.readinessState), h('p', { class: 'hint' }, line.readiness), line.attention && h('p', null, h('span', { class: 'status status-warn' }, line.attention))) },
      { header: 'Due', cell: line => (line.dueDate ? h('span', { class: 'mono' }, formatDay(line.dueDate)) : h('span', { class: 'missing' }, 'No date entered')) },
    ],
  });
}

function gapTable(label, gaps, withDecision) {
  return dataTable({
    label,
    rows: gaps,
    columns: [
      { header: 'Gap', cell: gap => h('div', null, h('p', null, workflowText(gap.title)), h('p', { class: 'hint wrap' }, workflowText(gap.detail))) },
      { header: 'About', cell: gap => h('span', { class: 'wrap' }, gap.subjectTitle) },
      { header: 'What would clear it', cell: gap => h('span', { class: 'wrap' }, workflowText(gap.toClear)) },
      withDecision && { header: 'Confirmed by', cell: gap => h('div', null, h('p', null, `${gap.decision.actor} · ${formatTime(gap.decision.at)}`), h('p', { class: 'hint wrap' }, gap.decision.note)) },
    ].filter(Boolean),
  });
}

function caseSection(section, includeCandidates) {
  const link = `#/cases/${encodeURIComponent(section.caseId)}`;
  return h('section', { class: 'audit-case' },
    h('h2', null, h('a', { href: `${link}/documentation` }, section.caseTitle)),
    h('p', { class: 'hint' }, h('span', { class: 'mono' }, section.caseId), ` · ${section.organization || 'Organization not recorded'}${section.businessUnit ? ` · ${section.businessUnit}` : ''}${section.recordFamily ? ` · ${section.recordFamily}` : ''} · Revision ${section.caseRevision}`),
    h('p', null, h('strong', null, section.statement)),
    h('p', { class: 'completeness-total' }, 'Documentation completeness: ', completeness(section.completeness)),

    h('h3', null, `Gaps a reviewer confirmed (${section.confirmedGaps.length})`),
    section.confirmedGaps.length ? gapTable(`Confirmed gaps for ${section.caseTitle}`, section.confirmedGaps, true) : none('No gap has been confirmed by a reviewer.'),

    // A recorded sufficiency problem is shown even before anyone confirms it as a gap, and labelled as pending.
    h('h3', null, `Evidence issues awaiting a decision (${(section.pendingReviewIssues ?? []).length})`),
    (section.pendingReviewIssues ?? []).length
      ? h('div', null,
        none('These evidence reviews need follow-up. A reviewer has not yet confirmed or dismissed the issues.'),
        dataTable({
          label: `Pending assessment problems for ${section.caseTitle}`,
          rows: section.pendingReviewIssues,
          columns: [
            { header: 'Check', cell: issue => h('div', null, h('p', null, h('a', { href: `${link}/findings/${encodeURIComponent(`${section.caseId}:${issue.subjectId}`)}` }, issue.subjectTitle)), h('p', { class: 'hint wrap' }, issue.title)) },
            { header: 'Latest evidence review', cell: issue => (issue.assessment
              ? h('div', null, h('p', null, `${reviewDecision(issue.assessment.outcome)} · ${issue.assessment.actor} · ${formatTime(issue.assessment.at)}`), h('p', { class: 'hint wrap' }, issue.assessment.rationale))
              : h('span', { class: 'missing' }, 'Not recorded')) },
            { header: 'What would clear it', cell: issue => h('span', { class: 'wrap' }, workflowText(issue.toClear)) },
          ],
        }))
      : none('No evidence issue is waiting for a decision.'),

    h('h3', null, `Checks needing attention (${section.unresolvedFindings.length})`),
    section.unresolvedFindings.length
      ? dataTable({
        label: `Open screening results for ${section.caseTitle}`,
        rows: section.unresolvedFindings,
        columns: [
          { header: 'Check', cell: finding => h('div', null, h('p', null, h('a', { href: `${link}/findings/${encodeURIComponent(finding.id)}` }, finding.title)), h('p', { class: 'hint wrap' }, workflowText(finding.explanation))) },
          { header: 'Status', cell: finding => status(findingStatus, finding.status) },
          { header: 'Next action', cell: finding => h('span', { class: 'wrap' }, workflowText(finding.nextAction)) },
          { header: 'Evidence on file', cell: finding => (finding.evidence.length
            ? h('ul', { class: 'cell-list' }, finding.evidence.map(entry => h('li', { class: 'wrap' }, `${entry.title} (${entry.verified ? 'verified' : 'not verified'})`)))
            : h('span', { class: 'missing' }, 'None')) },
        ],
      })
      : none('No screening result needs evidence or review.'),

    h('h3', null, `Active holds (${section.activeHolds.length})`),
    section.activeHolds.length
      ? dataTable({
        label: `Active holds for ${section.caseTitle}`,
        rows: section.activeHolds,
        columns: [
          { header: 'Record', cell: hold => h('a', { href: `${link}/records/${encodeURIComponent(hold.recordId)}` }, hold.title) },
          { header: 'Hold reference', cell: hold => (hold.reference ? h('span', { class: 'wrap' }, hold.reference) : h('span', { class: 'missing' }, 'No hold review is recorded')) },
          { header: 'Reviewed', cell: hold => (hold.reviewedAt ? `${hold.actor} · ${formatTime(hold.reviewedAt)}` : h('span', { class: 'missing' }, 'Not recorded')) },
          { header: 'Record owner', cell: hold => hold.owner || h('span', { class: 'missing' }, 'Not assigned') },
        ],
      })
      : none('No record is under an active hold.'),

    h('h3', null, `Paperwork past a stored due date (${section.overduePaperwork.length})`),
    section.overduePaperwork.length ? paperworkTable(`Overdue paperwork for ${section.caseTitle}`, section.overduePaperwork) : none('No paperwork is past a due date a person entered.'),

    h('h3', null, `Other open paperwork (${section.openPaperwork.length})`),
    section.openPaperwork.length ? paperworkTable(`Open paperwork for ${section.caseTitle}`, section.openPaperwork) : none('No other paperwork is open.'),

    includeCandidates && h('h3', null, `Candidates nobody has reviewed (${section.candidates.length})`),
    includeCandidates && (section.candidates.length
      ? h('div', null, none('These gaps were found by a rule and no reviewer has confirmed or dismissed them. They are not exceptions.'), gapTable(`Unreviewed candidates for ${section.caseTitle}`, section.candidates, false))
      : none('Every detected gap has been reviewed.')));
}

export function create(route) {
  const body = h('div', { class: 'stack' }, loadingState('Compiling the report…'));
  const caseSelect = h('select', { id: 'audit-case' }, h('option', { value: '' }, 'All cases'));
  const candidatesBox = h('input', { type: 'checkbox', id: 'audit-candidates' });
  // The button stays focusable while a report loads; it simply does nothing until one is ready.
  const download = button('Download report (JSON)', () => {
    if (!reportText) return;
    // The file name says which cases the report covers, so a VA-only file is not mistaken for all cases.
    const scope = reportScope ? reportScope.replace(/[^A-Za-z0-9-]/g, '') : 'all cases';
    downloadText(`Compliance Shelf audit team report ${scope} ${today()}.json`, reportText, 'application/json');
    announce('Report downloaded. Its digest is not a signature or tamper-proof seal.');
  }, '', 'download-audit-report');
  download.setAttribute('aria-disabled', 'true');
  let reportText = '';
  let reportScope = '';
  let wanted = route.query.caseId || '';
  // Each load gets a number. Only the newest one may draw, so a slow earlier answer cannot replace a newer one.
  let latestLoad = 0;

  async function loadCases() {
    try {
      const { cases } = await api.getCases();
      caseSelect.replaceChildren(h('option', { value: '' }, 'All cases'), ...cases.map(item => h('option', { value: item.id }, item.title)));
      caseSelect.value = cases.some(item => item.id === wanted) ? wanted : '';
    } catch { /* the report itself reports a load failure */ }
  }

  async function load() {
    const thisLoad = ++latestLoad;
    body.replaceChildren(loadingState('Compiling the report…'));
    reportText = '';
    download.setAttribute('aria-disabled', 'true');
    let response;
    try {
      response = await api.getAuditReport({ caseId: caseSelect.value || wanted, include: candidatesBox.checked ? 'candidates' : '' });
    } catch (error) {
      if (thisLoad === latestLoad) body.replaceChildren(errorState(error, load));
      return;
    }
    if (thisLoad !== latestLoad) return;
    const report = response.body;
    reportText = response.text;
    reportScope = report.scope?.caseId || '';
    download.removeAttribute('aria-disabled');
    const totals = report.totals;
    body.replaceChildren(
      h('section', null,
        h('h2', null, 'Summary'),
        facts([
          ['Review date', formatDay(report.asOf)],
          ['Compiled', formatTime(report.generatedAt)],
          ['Cases', String(totals.cases)],
          ['Gaps a reviewer confirmed', String(totals.confirmedGaps)],
          ['Evidence issues awaiting a decision', String(totals.pendingReviewIssues ?? 0)],
          ['Checks needing attention', String(totals.unresolvedFindings)],
          ['Active holds', String(totals.activeHolds)],
          ['Paperwork past a stored due date', String(totals.overduePaperwork)],
          ['Other open paperwork', String(totals.openPaperwork)],
          report.includeCandidates && ['Candidates nobody has reviewed', String(totals.candidates)],
        ], true),
        h('p', { class: 'hint' }, report.limitation)),
      ...report.cases.map(section => caseSection(section, report.includeCandidates)),
      h('section', null,
        h('h2', null, 'File integrity check'),
        h('p', { class: 'mono wrap' }, `${report.digest.algorithm} ${report.digest.value}`),
        h('p', { class: 'hint' }, report.digestNotice)));
  }

  caseSelect.addEventListener('change', () => { wanted = caseSelect.value; load(); });
  candidatesBox.addEventListener('change', load);
  loadCases().then(load);

  return {
    key: 'auditreport',
    el: h('div', { class: 'audit-report' },
      pageHeader('Audit team report', 'Review evidence issues, open work, and records holds. This report supports an audit; it does not certify compliance.',
        [download, button('Print or save as PDF', () => window.print(), 'button-primary', 'print-audit-report')]),
      h('form', { class: 'report-controls no-print', onsubmit: event => event.preventDefault() },
        h('div', { class: 'field' }, h('label', { for: 'audit-case', class: 'label' }, 'Case'), caseSelect),
        h('div', { class: 'choice' }, candidatesBox, h('label', { for: 'audit-candidates' }, 'Include candidates nobody has reviewed'))),
      body),
  };
}
