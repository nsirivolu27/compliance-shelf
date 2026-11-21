// Every change to a case goes through one of these actions. Each one opens a form,
// sends the case revision it was based on, and reloads the case afterwards.

import * as api from './api.js';
import { workflowText,  announce, kindsOf, findingStatus, holdStatus, applicabilityLabels, formatDay } from './dom.js';
import { openForm, noteField } from './forms.js';

// A handle keeps the latest loaded copy of one case and tells its view when it changes.
export function createCaseHandle(caseId, onChange) {
  const handle = {
    id: caseId,
    detail: null,
    get revision() { return handle.detail.case.revision; },
    // Workbench rows add what the case detail does not carry: attention, review freshness, and the packet link.
    rows: new Map(),
    // Review drafts for the case, with the identity notice that applies to this server.
    drafts: [],
    draftIdentity: null,
    // Linked passages and sufficiency assessments, with freshness computed by the server.
    evidenceReview: null,
    // While a reload runs, this holds it. A form opened in that moment waits for it, so it starts
    // from the revision the user just saved instead of the one before (which would look like a conflict).
    loading: null,
    load() {
      const run = (async () => {
        const [detail, bench, drafts, review] = await Promise.all([api.getCase(caseId), api.getWorkbench({ caseId, limit: 100 }), api.getDrafts(caseId),
          api.getEvidenceReview(caseId)]);
        handle.detail = detail;
        handle.drafts = drafts.drafts;
        handle.draftIdentity = drafts.identity;
        handle.evidenceReview = review;
        handle.rows = new Map(bench.items.map(row => [row.id, row]));
        await onChange?.(handle.detail);
        return handle.detail;
      })();
      handle.loading = run;
      // Tell assistive technology the page is updating; buttons may move until the reload ends.
      const main = document.getElementById('main');
      main?.setAttribute('aria-busy', 'true');
      const settle = () => {
        if (handle.loading !== run) return;
        handle.loading = null;
        main?.removeAttribute('aria-busy');
      };
      run.then(settle, settle);
      return run;
    },
  };
  return handle;
}

// Put focus back where the form was opened. If another form is already open, leave its focus alone.
function restoreFocus(openerId) {
  if (document.querySelector('dialog.drawer[open]')) return;
  const target = (openerId && document.getElementById(openerId)) || document.getElementById('page-title');
  target?.focus({ preventScroll: true });
}

// Shared wiring: reload on conflict, reload and confirm on success, return focus to the opener.
function caseForm(handle, config, doneMessage) {
  const openerId = document.activeElement?.id;
  openForm({
    ...config,
    waitFor: () => handle.loading,
    onConflict: () => handle.load(),
    onSuccess: async result => {
      await handle.load();
      announce(typeof doneMessage === 'function' ? doneMessage(result) : doneMessage);
      restoreFocus(openerId);
    },
  });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Cases ----------

// Optional synthetic contract context. It is reviewer-supplied and never looked up anywhere.
function contractFields(item) {
  return [
    { name: 'contractNumber', label: 'Synthetic contract number', value: item.contractNumber || '', maxlength: 100,
      hint: 'A made-up identifier such as DEMO-2026-001. It is never linked to a real award or vendor.' },
    { name: 'popStart', type: 'date', label: 'Contract work start date', value: item.periodOfPerformance?.start || '' },
    { name: 'popEnd', type: 'date', label: 'Contract work end date', value: item.periodOfPerformance?.end || '' },
  ];
}

function periodErrors(values) {
  if (Boolean(values.popStart) !== Boolean(values.popEnd)) {
    return { [values.popStart ? 'popEnd' : 'popStart']: 'Enter both dates of the period of performance, or leave both empty.' };
  }
  if (values.popStart && values.popStart > values.popEnd) return { popEnd: 'The end date cannot be before the start date.' };
  return null;
}

export function newCase(onCreated) {
  openForm({
    title: 'New case',
    intro: 'Creates a synthetic case. Applicability starts as unknown for every check and no records or policy basis are assumed.',
    submitLabel: 'Create case',
    fields: [
      { name: 'title', label: 'Case title', required: true, maxlength: 200 },
      { name: 'owner', label: 'Case owner', required: true, maxlength: 200, hint: 'Use a role or a synthetic name. Do not enter real personal data.' },
      ...contractFields({}),
      noteField('Reason for creating this case'),
    ],
    validate: periodErrors,
    submit: (values, keyFor) => {
      const body = { title: values.title, owner: values.owner, note: values.note,
        ...(values.contractNumber ? { contractNumber: values.contractNumber } : {}),
        ...(values.popStart ? { periodOfPerformance: { start: values.popStart, end: values.popEnd } } : {}) };
      return api.createCase(body, keyFor(body));
    },
    onSuccess: result => {
      announce('Case created.');
      onCreated(result.case);
    },
  });
}

export function editCase(handle, sources) {
  const item = handle.detail.case;
  const basis = item.policyBasis || { description: '', sourceIds: [] };
  const applicabilityOptions = Object.entries(applicabilityLabels).map(([value, label]) => ({ value, label }));

  const changesFrom = values => {
    const changes = {};
    if (values.title !== item.title) changes.title = values.title;
    if (values.owner !== item.owner) changes.owner = values.owner;
    const applicability = {};
    for (const kind of Object.keys(kindsOf(item))) {
      if (values[`applies-${kind}`] !== item.applicability[kind]) applicability[kind] = values[`applies-${kind}`];
    }
    if (Object.keys(applicability).length) changes.applicability = applicability;
    if (values.contractNumber !== (item.contractNumber || '')) changes.contractNumber = values.contractNumber || null;
    const period = values.popStart && values.popEnd ? { start: values.popStart, end: values.popEnd } : null;
    if (!same(period, item.periodOfPerformance || null)) changes.periodOfPerformance = period;
    if (values.policyChange) {
      changes.policyBasis = { confirmed: values.policyConfirmed, description: values.policyDescription, sourceIds: values.policySources };
    }
    return changes;
  };

  caseForm(handle, {
    title: 'Edit case',
    intro: 'Decide which checks apply to this case. Keep Unknown until a reviewer decides. Missing documents do not make a check irrelevant: choose Applies and request the evidence.',
    fields: [
      { name: 'title', label: 'Case title', value: item.title, required: true, maxlength: 200 },
      { name: 'owner', label: 'Case owner', value: item.owner, required: true, maxlength: 200 },
      ...contractFields(item),
      ...Object.entries(kindsOf(item)).map(([kind, label]) => (
        { name: `applies-${kind}`, type: 'select', label: `Does this check apply? ${label}`, value: item.applicability[kind], options: applicabilityOptions, required: true })),
      { name: 'policyChange', type: 'checkbox', label: 'Update which policies apply', hint: `Currently ${item.policyBasisConfirmed ? 'marked confirmed' : 'not confirmed'}.` },
      { name: 'policyConfirmed', type: 'checkbox', label: 'A reviewer confirmed the governing policy version', value: item.policyBasisConfirmed, when: values => values.policyChange },
      { name: 'policyDescription', type: 'textarea', label: 'Policy basis description', value: basis.description, required: true, minlength: 10, maxlength: 2000, when: values => values.policyChange },
      { name: 'policySources', type: 'checks', label: 'Supporting sources', shortLabel: 'At least one supporting source', value: basis.sourceIds, required: true,
        options: sources.map(source => ({ value: source.id, label: source.title })), when: values => values.policyChange },
      noteField(),
    ],
    validate: values => periodErrors(values)
      || (Object.keys(changesFrom(values)).length ? null : { form: 'No value is different from what is saved. Change something before saving.' }),
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note, ...changesFrom(values) };
      return api.updateContext(handle.id, body, keyFor(body));
    },
  }, 'Case details saved.');
}

// Logs an analysis run. Runs add history and do not change the case revision.
export async function runChecks(handle) {
  const body = { expectedRevision: handle.revision };
  const keyFor = api.createRetryKey();
  await api.analyze(handle.id, body, keyFor(body));
  await handle.load();
  announce('Checks run and logged.');
}

// ---------- Evidence ----------

const evidenceIntro = 'Record a document title and where to find it. This form does not upload a file. Use fictional details in this demo.';

export function addEvidence(handle, presetKind) {
  caseForm(handle, {
    title: 'Add evidence reference',
    intro: `${evidenceIntro} New references start unverified.`,
    submitLabel: 'Add reference',
    fields: [
      { name: 'kind', type: 'select', label: 'Check it supports', value: presetKind || Object.keys(kindsOf(handle.detail.case))[0], required: true,
        options: Object.entries(kindsOf(handle.detail.case)).map(([value, label]) => ({ value, label })) },
      { name: 'title', label: 'Title', required: true, maxlength: 200 },
      { name: 'locator', label: 'Document location', required: true, maxlength: 1000, hint: 'Where the document lives, such as a system-of-record ID or a link.' },
    ],
    submit: (values, keyFor) => {
      const body = { ...values, expectedRevision: handle.revision };
      return api.addEvidence(handle.id, body, keyFor(body));
    },
  }, 'Evidence reference added as unverified.');
}

export function correctEvidence(handle, evidence) {
  const changesFrom = values => {
    const changes = {};
    for (const key of ['kind', 'title', 'locator']) if (values[key] !== evidence[key]) changes[key] = values[key];
    return changes;
  };
  caseForm(handle, {
    title: 'Correct evidence reference',
    intro: evidence.verified
      ? 'This reference is verified. Saving a correction resets it to unverified, and it must be verified again.'
      : 'Saving a correction keeps the reference unverified.',
    submitLabel: 'Save correction',
    fields: [
      { name: 'kind', type: 'select', label: 'Check it supports', value: evidence.kind, required: true,
        options: Object.entries(kindsOf(handle.detail.case)).map(([value, label]) => ({ value, label })) },
      { name: 'title', label: 'Title', value: evidence.title, required: true, maxlength: 200 },
      { name: 'locator', label: 'Document location', value: evidence.locator, required: true, maxlength: 1000 },
      noteField('Reason for the correction'),
    ],
    validate: values => Object.keys(changesFrom(values)).length ? null : { form: 'No value is different from what is saved. Change something before saving.' },
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note, ...changesFrom(values) };
      return api.correctEvidence(handle.id, evidence.id, body, keyFor(body));
    },
  }, 'Correction saved. The reference is now unverified.');
}

export function verifyEvidence(handle, evidence) {
  caseForm(handle, {
    title: 'Verify evidence reference',
    intro: 'Confirm that you opened the document and checked its location. This does not approve its contents. Demo entries use a shared local operator name.',
    submitLabel: 'Verify reference',
    fields: [
      { type: 'static', name: 'title', label: 'Reference', value: evidence.title },
      { type: 'static', name: 'locator', label: 'Document location', value: evidence.locator },
      noteField('What you checked', 'Describe what you looked at. At least 10 characters.'),
    ],
    submit: (values, keyFor) => {
      const body = { evidenceId: evidence.id, note: values.note, expectedRevision: handle.revision };
      return api.verifyEvidence(handle.id, body, keyFor(body));
    },
  }, 'Reference verified. Run checks to log the updated findings.');
}

// ---------- Review notes ----------

export function addReviewNote(handle, finding) {
  caseForm(handle, {
    title: 'Add review note',
    draftKey: `${handle.id}:${finding.id}:review-note`,
    getRevision: () => handle.revision,
    currentValues: () => {
      const saved = handle.detail.reviews.filter(review => review.findingId === finding.id).at(-1);
      return saved ? { disposition: saved.disposition, note: saved.note, revision: handle.revision } : { note: 'No saved review note', revision: handle.revision };
    },
    intro: 'A note is an annotation for the audit trail. It never closes or hides a finding and is not an official agency action.',
    submitLabel: 'Save note',
    fields: [
      { type: 'static', name: 'finding', label: 'Finding', value: `${finding.title} (${findingStatus[finding.status].label})` },
      { name: 'disposition', type: 'radio', label: 'Disposition', value: 'request-evidence', required: true, options: [
        { value: 'request-evidence', label: 'Request evidence' },
        { value: 'acknowledged', label: 'Acknowledge' },
        { value: 'escalated', label: 'Escalate' },
      ] },
      noteField('Rationale'),
    ],
    submit: (values, keyFor, expectedRevision) => {
      const body = { findingId: finding.id, disposition: values.disposition, note: values.note, expectedRevision };
      return api.addReview(handle.id, body, keyFor(body));
    },
  }, 'Review note saved. The finding is unchanged.');
}

// ---------- Records ----------

// Record types come from the case's own check set. A case without any shows no such field.
function recordTypeField(item, value) {
  const expected = item.checkSet?.expectedRecords ?? [];
  if (!expected.length) return null;
  return { name: 'recordType', type: 'select', label: 'Record type', value: value || '', options: [{ value: '', label: 'Not one of the expected types' }, ...expected.map(entry => ({ value: entry.kind, label: entry.title }))],
    hint: 'The types this case\'s check set lists as expected. Naming one clears the "expected record type not inventoried" gap for that type.' };
}

// A reviewer's decision on one detected gap. It records a judgment and changes nothing else.
// `prefill.note` carries the reviewer's earlier evidence and rationale into the reason box. It is only a starting text:
// the decision itself is never preselected, so nothing is confirmed on the reviewer's behalf.
export function decideGap(caseId, caseRevision, gap, onSaved, onConflict, prefill = {}) {
  openForm({
    title: 'Decide whether follow-up is needed',
    intro: `${workflowText(gap.title)}: ${workflowText(gap.detail)} Confirming or dismissing records your judgment with a note. It does not change a finding, the completeness percent, a hold, or a task, and it is not a finding of noncompliance.`,
    submitLabel: 'Record decision',
    fields: [
      { name: 'decision', type: 'radio', label: 'Decision', required: true, value: gap.decision?.current ? gap.decision.decision : '', options: [
        { value: 'confirmed', label: 'Confirm', hint: ' The gap is real and should be worked.' },
        { value: 'dismissed', label: 'Dismiss', hint: ' The gap does not need work, for the reason in the note.' },
      ] },
      { ...noteField('Reason for this decision', prefill.note ? 'Based on your evidence review. Edit the reason if needed. At least 10 characters.' : undefined), value: prefill.note || '' },
    ],
    submit: (values, keyFor) => {
      const body = { expectedRevision: caseRevision, gapId: gap.id, decision: values.decision, note: values.note };
      return api.decideGap(caseId, body, keyFor(body));
    },
    onConflict: () => onConflict?.(),
    onSuccess: () => onSaved?.(),
  });
}

export function addRecord(handle) {
  caseForm(handle, {
    title: 'Add record',
    intro: 'A new record starts with an unknown hold status and no schedule. Both stay unknown until someone reviews them.',
    submitLabel: 'Add record',
    fields: [
      { name: 'title', label: 'Record title', required: true, maxlength: 200 },
      { name: 'owner', label: 'Records owner', maxlength: 200 },
      recordTypeField(handle.detail.case),
      noteField('Reason for adding this record'),
    ],
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note, title: values.title, ...(values.owner ? { owner: values.owner } : {}), ...(values.recordType ? { recordType: values.recordType } : {}) };
      return api.addRecord(handle.id, body, keyFor(body));
    },
  }, 'Record added.');
}

export function editRecord(handle, record) {
  const asOf = handle.detail.report.asOf;
  const hadItemNumber = record.schedule && 'itemNumber' in record.schedule;
  const scheduleFrom = values => values.scheduleMode === 'final-payment'
    ? { authority: values.authority, years: values.years, trigger: 'final-payment', confirmed: values.confirmed,
      // Sent only when there is a value to save or an existing one to clear.
      ...(values.itemNumber || hadItemNumber ? { itemNumber: values.itemNumber || null } : {}) }
    : null;
  const changesFrom = values => {
    const changes = {};
    if (values.title !== record.title) changes.title = values.title;
    if ((values.owner || null) !== (record.owner || null)) changes.owner = values.owner || null;
    if (!same(scheduleFrom(values), record.schedule)) changes.schedule = scheduleFrom(values);
    if (values.recordType !== undefined && (values.recordType || null) !== (record.recordType || null)) changes.recordType = values.recordType || null;
    if ((values.finalPaymentDate || null) !== (record.finalPaymentDate || null)) changes.finalPaymentDate = values.finalPaymentDate || null;
    return changes;
  };
  const withSchedule = values => values.scheduleMode === 'final-payment';

  caseForm(handle, {
    title: 'Edit record',
    intro: 'Hold status is not edited here. Use a hold review for that. A schedule and a final payment date only produce a review date, never an authorization to destroy.',
    fields: [
      { name: 'title', label: 'Record title', value: record.title, required: true, maxlength: 200 },
      { name: 'owner', label: 'Records owner', value: record.owner || '', maxlength: 200, hint: 'Leave empty if no owner is assigned yet.' },
      recordTypeField(handle.detail.case, record.recordType),
      { name: 'scheduleMode', type: 'select', label: 'Retention schedule', value: record.schedule ? 'final-payment' : 'unknown', required: true, options: [
        { value: 'unknown', label: 'Unknown. Keep the record retained.' },
        { value: 'final-payment', label: 'Period counted from final payment' },
      ], hint: 'Only schedules counted from final payment are supported in this prototype.' },
      { name: 'authority', label: 'Schedule authority', value: record.schedule?.authority || '', required: true, maxlength: 1000, when: withSchedule },
      { name: 'itemNumber', label: 'Schedule item number', value: record.schedule?.itemNumber || '', maxlength: 100, when: withSchedule,
        hint: 'A synthetic reference such as DEMO-010. It does not change the retention calculation.' },
      { name: 'years', type: 'number', label: 'Retention period in years', value: record.schedule?.years ?? '', required: true, min: 1, max: 100, when: withSchedule },
      { name: 'confirmed', type: 'checkbox', label: 'A records officer confirmed this schedule applies', value: record.schedule?.confirmed, when: withSchedule },
      { name: 'finalPaymentDate', type: 'date', label: 'Verified final payment date', value: record.finalPaymentDate || '', max: asOf,
        hint: `An award end date is not a substitute. Cannot be later than the screening date, ${formatDay(asOf)}.`,
        validate: value => value && value > asOf ? `Final payment cannot be later than the screening date, ${formatDay(asOf)}.` : null },
      noteField(),
    ],
    validate: values => Object.keys(changesFrom(values)).length ? null : { form: 'No value is different from what is saved. Change something before saving.' },
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note, ...changesFrom(values) };
      return api.updateRecord(handle.id, record.id, body, keyFor(body));
    },
  }, 'Record saved.');
}

export function reviewHold(handle, record) {
  const leavingActive = values => record.hold === 'active' && values.status !== 'active';
  caseForm(handle, {
    title: 'Record a hold review',
    intro: 'A hold review records your assertion about litigation, investigation, protest, or other holds. It does not perform an official release, and nothing in this workspace authorizes destruction.',
    submitLabel: 'Save hold review',
    fields: [
      { type: 'static', name: 'record', label: 'Record', value: record.title },
      { type: 'static', name: 'current', label: 'Current hold status', value: holdStatus[record.hold].label },
      { name: 'status', type: 'radio', label: 'Hold status after this review', value: record.hold, required: true, options: [
        { value: 'active', label: 'Active hold', hint: 'The record must stay preserved.' },
        { value: 'none', label: 'No hold', hint: 'A review found no hold on this record.' },
        { value: 'unknown', label: 'Unknown', hint: 'Not yet determined. The record stays retained.' },
      ] },
      { name: 'reference', label: 'Hold review reference', required: true, minlength: 3, maxlength: 1000, hint: 'Where this review is documented, such as a matter number or locator.' },
      { name: 'releaseReference', label: 'Release authorization reference', required: true, minlength: 3, maxlength: 1000, when: leavingActive,
        hint: 'Required to move a record off an active hold. Cite the document that authorizes the release.' },
      noteField('Rationale'),
    ],
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note, status: values.status, reference: values.reference,
        ...(values.releaseReference ? { releaseReference: values.releaseReference } : {}) };
      return api.reviewHold(handle.id, record.id, body, keyFor(body));
    },
  }, 'Hold review saved.');
}

// ---------- Follow-up tasks ----------

const taskStatusOptions = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

export function createTask(handle, finding) {
  const findings = handle.detail.report.findings;
  caseForm(handle, {
    title: 'New follow-up task',
    intro: 'A task tracks work on a finding. Finishing the task does not change the finding.',
    submitLabel: 'Create task',
    fields: [
      finding
        ? { type: 'static', name: 'findingLabel', label: 'Finding', value: `${finding.title} (${findingStatus[finding.status].label})` }
        : { name: 'findingId', type: 'select', label: 'Finding', required: true, value: findings[0]?.id,
          options: findings.map(entry => ({ value: entry.id, label: `${entry.title} (${findingStatus[entry.status].label})` })) },
      { name: 'title', label: 'Task', required: true, maxlength: 200 },
      { name: 'owner', label: 'Assigned to', required: true, maxlength: 200, hint: 'Use a role or a synthetic name.' },
      { name: 'dueDate', type: 'date', label: 'Due date' },
      noteField('Reason for this task'),
    ],
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note, findingId: finding ? finding.id : values.findingId,
        title: values.title, owner: values.owner, ...(values.dueDate ? { dueDate: values.dueDate } : {}) };
      return api.createTask(handle.id, body, keyFor(body));
    },
  }, 'Task created.');
}

export function editTask(handle, task) {
  const changesFrom = values => {
    const changes = {};
    if (values.title !== task.title) changes.title = values.title;
    if (values.owner !== task.owner) changes.owner = values.owner;
    if ((values.dueDate || null) !== (task.dueDate || null)) changes.dueDate = values.dueDate || null;
    if (values.status !== task.status) changes.status = values.status;
    return changes;
  };
  caseForm(handle, {
    title: 'Update task',
    fields: [
      { name: 'title', label: 'Task', value: task.title, required: true, maxlength: 200 },
      { name: 'owner', label: 'Assigned to', value: task.owner, required: true, maxlength: 200 },
      { name: 'dueDate', type: 'date', label: 'Due date', value: task.dueDate || '' },
      { name: 'status', type: 'select', label: 'Status', value: task.status, options: taskStatusOptions, required: true,
        hint: 'Marking a task done does not clear its finding. The finding changes only when the evidence or record data changes.' },
      noteField(),
    ],
    validate: values => Object.keys(changesFrom(values)).length ? null : { form: 'No value is different from what is saved. Change something before saving.' },
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, note: values.note, ...changesFrom(values) };
      return api.updateTask(handle.id, task.id, body, keyFor(body));
    },
  }, result => {
    const saved = result.change.after;
    const open = handle.detail.tasks.find(entry => entry.id === saved.id)?.needsFollowUp;
    return saved.status === 'done' && open ? 'Task marked done. Its finding is still open.' : 'Task saved.';
  });
}

// ---------- Review drafts ----------

const draftIntro = 'A review note describes what was looked at. Marking it reviewed never resolves a finding, verifies evidence, releases a hold, or authorizes destruction.';
const latestDraft = (handle, draft) => handle.drafts.find(entry => entry.id === draft.id) || draft;

// Step one picks the findings. Step two opens the prepared text for editing.
export function prepareDraft(handle) {
  const openerId = document.activeElement?.id;
  const findings = handle.detail.report.findings;
  const open = findings.filter(finding => !['evidence-present', 'not-applicable'].includes(finding.status)).map(finding => finding.id);
  openForm({
    waitFor: () => handle.loading,
    title: 'Prepare a review note',
    intro: 'Choose the findings this note covers. The next step shows a starting text built from those findings, which you can edit.',
    submitLabel: 'Continue',
    fields: [{ name: 'findingIds', type: 'checks', label: 'Findings to cite', shortLabel: 'At least one finding', required: true, value: open.length ? open : findings.map(finding => finding.id),
      options: findings.map(finding => ({ value: finding.id, label: `${finding.title} (${findingStatus[finding.status].label})` })) }],
    submit: values => api.prepareDraft(handle.id, values.findingIds),
    onSuccess: prepared => {
      const trusted = handle.draftIdentity?.trusted;
      openForm({
        waitFor: () => handle.loading,
        title: 'Review note draft',
        intro: `${draftIntro} The draft is saved with a snapshot of the evidence it cites. ${handle.draftIdentity?.notice || ''}`,
        submitLabel: 'Save draft',
        fields: [
          { name: 'title', label: 'Title', value: prepared.title, required: true, maxlength: 200 },
          { name: 'text', type: 'textarea', label: 'Note text', value: prepared.text, required: true, minlength: 10, maxlength: 20000, rows: 14 },
          !trusted && { name: 'author', label: 'Author name', required: true, maxlength: 200, hint: 'Typed, not verified. Use a role or a synthetic name.' },
          { name: 'reviewer', label: 'Route to reviewer', maxlength: 200, hint: 'The person asked to review this note. It can be set later, before submitting.' },
        ],
        submit: (values, keyFor) => {
          const body = { expectedRevision: handle.revision, title: values.title, text: values.text, findingIds: prepared.findingIds,
            ...(trusted ? {} : { author: values.author }), ...(values.reviewer ? { reviewer: values.reviewer } : {}) };
          return api.createDraft(handle.id, body, keyFor(body));
        },
        onConflict: () => handle.load(),
        onSuccess: async result => {
          await handle.load();
          announce('Draft saved. It has not been submitted for review.');
          handle.onDraftSaved?.(result.draft.id);
          restoreFocus(openerId);
        },
      });
    },
  });
}

export function editDraft(handle, draft) {
  const findings = handle.detail.report.findings;
  const changesFrom = values => {
    const changes = {};
    if (values.title !== draft.title) changes.title = values.title;
    if (values.text !== draft.text) changes.text = values.text;
    if (!same([...values.findingIds].sort(), [...draft.findingIds].sort())) changes.findingIds = values.findingIds;
    if ((values.reviewer || null) !== (draft.reviewer || null)) changes.reviewer = values.reviewer || null;
    return changes;
  };
  caseForm(handle, {
    title: 'Edit review note',
    draftKey: `${handle.id}:${draft.id}:edit-note`,
    getRevision: () => handle.revision,
    currentValues: () => {
      const saved = handle.drafts.find(entry => entry.id === draft.id);
      return saved && { title: saved.title, text: saved.text, findingIds: saved.findingIds, reviewer: saved.reviewer, version: saved.version };
    },
    intro: draft.state === 'draft'
      ? 'Saving creates a new version with a fresh snapshot of the cited evidence.'
      : 'Saving creates a new version and returns the note to draft. Earlier submissions and decisions stay in the history, marked as made against the older version.',
    submitLabel: 'Save new version',
    fields: [
      { name: 'title', label: 'Title', value: draft.title, required: true, maxlength: 200 },
      { name: 'text', type: 'textarea', label: 'Note text', value: draft.text, required: true, minlength: 10, maxlength: 20000, rows: 14 },
      { name: 'findingIds', type: 'checks', label: 'Findings cited', shortLabel: 'At least one finding', required: true, value: draft.findingIds,
        options: findings.map(finding => ({ value: finding.id, label: `${finding.title} (${findingStatus[finding.status].label})` })) },
      { name: 'reviewer', label: 'Route to reviewer', value: draft.reviewer || '', maxlength: 200 },
      noteField('What changed in this version'),
    ],
    validate: values => Object.keys(changesFrom(values)).length ? null : { form: 'Nothing is different from the saved version. Change something before saving.' },
    submit: (values, keyFor, expectedRevision) => {
      const body = { expectedRevision, expectedVersion: latestDraft(handle, draft).version, note: values.note, ...changesFrom(values) };
      return api.reviseDraft(handle.id, draft.id, body, keyFor(body));
    },
  }, 'New version saved. The note is back in draft.');
}

export function refreshDraft(handle, draft) {
  caseForm(handle, {
    title: 'Refresh against current evidence',
    intro: 'The evidence this note cites has changed since this version was saved. This saves a new version with the same text and a snapshot of the evidence as it stands now. Read the note first and edit it instead if the text no longer fits.',
    submitLabel: 'Save refreshed version',
    fields: [
      { type: 'static', name: 'draft', label: 'Review note', value: draft.title },
      noteField('Why the same text still applies'),
    ],
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, expectedVersion: latestDraft(handle, draft).version, refreshSnapshot: true, note: values.note };
      return api.reviseDraft(handle.id, draft.id, body, keyFor(body));
    },
  }, 'Refreshed version saved. It needs to be submitted and reviewed again.');
}

export function submitDraft(handle, draft) {
  caseForm(handle, {
    title: 'Submit for review',
    intro: `The reviewer's decision will be bound to this exact text and evidence snapshot. ${handle.draftIdentity?.notice || ''}`,
    submitLabel: 'Submit for review',
    fields: [
      { type: 'static', name: 'draft', label: 'Review note', value: `${draft.title} (version ${draft.version})` },
      { type: 'static', name: 'author', label: 'Author', value: draft.author },
      { name: 'reviewer', label: 'Route to reviewer', value: draft.reviewer || '', required: true, maxlength: 200,
        validate: value => value.toLowerCase() === String(draft.author).toLowerCase() ? 'Route the note to someone other than its author.' : null },
      { name: 'note', type: 'textarea', label: 'Message to the reviewer', rows: 2, maxlength: 2000,
        validate: value => value && value.length < 10 ? 'Write at least 10 characters, or leave this empty.' : null },
    ],
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, expectedVersion: latestDraft(handle, draft).version, reviewer: values.reviewer, ...(values.note ? { note: values.note } : {}) };
      return api.submitDraft(handle.id, draft.id, body, keyFor(body));
    },
  }, 'Submitted for review.');
}

export function decideDraft(handle, draft) {
  const trusted = handle.draftIdentity?.trusted;
  caseForm(handle, {
    title: 'Record the review decision',
    intro: `${draftIntro} ${handle.draftIdentity?.notice || ''}`,
    submitLabel: 'Record decision',
    fields: [
      { type: 'static', name: 'draft', label: 'Review note', value: `${draft.title} (version ${draft.version})` },
      { type: 'static', name: 'author', label: 'Author', value: draft.author },
      { name: 'decision', type: 'radio', label: 'Decision', value: 'reviewed', required: true, options: [
        { value: 'reviewed', label: 'Reviewed', hint: 'The note accurately describes the cited findings and evidence.' },
        { value: 'changes-requested', label: 'Request changes', hint: 'The author needs to revise the note.' },
      ] },
      !trusted && { name: 'reviewer', label: 'Reviewer name', value: draft.reviewer || '', required: true, maxlength: 200, hint: 'Typed, not verified.',
        validate: value => value.toLowerCase() === String(draft.author).toLowerCase() ? 'The reviewer must be someone other than the author.' : null },
      noteField('Reviewer comment'),
    ],
    submit: (values, keyFor) => {
      const body = { expectedRevision: handle.revision, expectedVersion: latestDraft(handle, draft).version, decision: values.decision, note: values.note, ...(trusted ? {} : { reviewer: values.reviewer }) };
      return api.decideDraft(handle.id, draft.id, body, keyFor(body));
    },
  }, result => (result.draft.state === 'reviewed' ? 'Note marked reviewed. Findings, evidence, and holds are unchanged.' : 'Changes requested.'));
}
