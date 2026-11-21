/** Pure screening logic. Findings describe supplied evidence, never legal certification. */
export type Applicability = "yes" | "no" | "unknown";
export type EvidenceKind = "signed-award" | "funding" | "market-research" | "records-plan";
/** A named list of evidence checks. A case without one uses the built-in example checks. */
export type CheckSet = { id: string; name: string; checks: { kind: string; title: string; sourceIds: string[] }[]; policySourceIds: string[]; recordsSourceIds: string[]; expectedRecords?: { kind: string; title: string; sourceIds: string[] }[]; paperwork?: string[]; sources?: { id: string; title: string; url: string; locator: string; scope: string; checkedOn: string }[] };
export type Evidence = {
  id: string;
  kind: EvidenceKind;
  title: string;
  locator: string;
  verified: boolean;
  provenance: "synthetic" | "user-supplied";
};
export type RecordItem = {
  id: string;
  title: string;
  owner: string | null;
  schedule: { authority: string; years: number; trigger: "final-payment"; confirmed: boolean; itemNumber?: string | null } | null;
  finalPaymentDate: string | null;
  /** One of the case's expected record types, when the case has any. Absent on records that name none. */
  recordType?: string | null;
  hold: "active" | "none" | "unknown";
  holdReview?: HoldReview;
  holdReviews?: HoldReview[];
};
export type HoldReview = { status: RecordItem['hold']; reference: string; releaseReference: string | null; note: string; reviewedAt: string; actor: string };
export type ComplianceCase = {
  id: string;
  title: string;
  agency: string;
  /** Copied from the loaded profile when the case was created. Absent on cases created without them. */
  businessUnit?: string;
  recordFamily?: string;
  provenance: "synthetic";
  owner: string;
  contractNumber?: string | null;
  periodOfPerformance?: { start: string; end: string } | null;
  policyBasisConfirmed: boolean;
  applicability: Record<EvidenceKind, Applicability>;
  evidence: Evidence[];
  records: RecordItem[];
  revision?: number;
  policyBasis?: { description: string; sourceIds: string[] };
  tasks?: FollowUpTask[];
  checkSet?: CheckSet;
  /** Paperwork items tracked on the case. Their rules live in paperwork.ts. */
  paperwork?: Record<string, unknown>[];
};
export type FollowUpTask = {
  id: string;
  findingId: string;
  title: string;
  owner: string;
  dueDate: string | null;
  status: "open" | "in-progress" | "done";
};
export type Finding = {
  id: string;
  caseId: string;
  category: "contracting" | "records" | "policy";
  status: "evidence-present" | "needs-evidence" | "needs-review" | "not-applicable" | "blocked";
  title: string;
  explanation: string;
  nextAction: string;
  sourceIds: string[];
  evidenceIds: string[];
};
export type RetentionResult = { status: "blocked" | "unknown" | "retain" | "review-due"; reviewDate: string | null; reason: string; canDestroy: false };

export const ruleVersion = "2026-11-15.demo.2";

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function retention(record: RecordItem, asOf: string): RetentionResult {
  if (!validDate(asOf)) throw new Error("asOf must be a real YYYY-MM-DD date");
  const result = (status: RetentionResult["status"], reason: string, reviewDate: string | null = null): RetentionResult => ({ status, reason, reviewDate, canDestroy: false });
  if (record.hold === "active") return result("blocked", "An active hold blocks disposition review regardless of elapsed retention.");
  if (record.hold !== "none") return result("unknown", "Confirm litigation, investigation, protest, and other holds before disposition review.");
  const schedule = record.schedule;
  if (!schedule?.confirmed || !schedule.authority.trim() || !Number.isInteger(schedule.years) || schedule.years < 1 || schedule.years > 100 || schedule.trigger !== "final-payment") {
    return result("unknown", "A records officer must confirm the applicable schedule, authority, and trigger. Retain unscheduled records.");
  }
  if (!validDate(record.finalPaymentDate) || record.finalPaymentDate > asOf) return result("unknown", "A verified final-payment date is required; an award end date is not a substitute.");
  const [year, month, day] = record.finalPaymentDate.split("-").map(Number);
  const targetYear = year + schedule.years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const reviewDate = `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  return asOf >= reviewDate
    ? result("review-due", "Retention interval elapsed. Records-officer review is required; this tool never authorizes destruction.", reviewDate)
    : result("retain", "Retain until the calculated review date, subject to the confirmed schedule and any later hold.", reviewDate);
}

const documentChecks: { kind: EvidenceKind; title: string; sourceIds: string[] }[] = [
  { kind: "signed-award", title: "Signed award evidence", sourceIds: ["far-4.803"] },
  { kind: "funding", title: "Availability of funds evidence", sourceIds: ["far-4.803"] },
  { kind: "market-research", title: "Market research evidence", sourceIds: ["far-4.803"] },
  { kind: "records-plan", title: "Contractor records management obligations", sourceIds: ["va-6300"] },
];

/** The built-in example: federal contract file checks with one agency's records directive. */
export const defaultCheckSet: CheckSet = { id: "federal-contract-file-example", name: "Federal contract file example", checks: documentChecks, policySourceIds: ["va-rfo"], recordsSourceIds: ["far-4.805", "va-6300"] };

/** The checks a case is screened against: its own stored check set, or the built-in example. */
export function checksOf(item: { checkSet?: CheckSet }) {
  return item.checkSet?.checks ?? documentChecks;
}

export function analyzeCase(item: ComplianceCase, asOf: string) {
  if (!validDate(asOf)) throw new Error("asOf must be a real YYYY-MM-DD date");
  const findings: Finding[] = [];
  const custom = item.checkSet ?? null;
  for (const check of checksOf(item)) {
    const applies = (item.applicability as Record<string, Applicability>)[check.kind];
    const supplied = item.evidence.filter(e => e.kind === check.kind);
    const verified = supplied.filter(e => e.verified && e.locator.trim());
    let status: Finding["status"];
    let explanation: string;
    let nextAction: string;
    if (applies === "no") {
      status = "not-applicable"; explanation = "The scenario marks this check not applicable; retain the reviewer's rationale."; nextAction = custom ? "Confirm the applicability decision against the recorded scope of this case." : "Confirm the applicability decision against the acquisition context.";
    } else if (applies !== "yes") {
      status = "needs-review"; explanation = "Applicability has not been established. This is not a finding of noncompliance."; nextAction = custom ? "Ask the responsible reviewer whether this check applies to this case." : "Ask the contracting officer whether this evidence is applicable.";
    } else if (verified.length) {
      status = "evidence-present"; explanation = "Reviewer-confirmed evidence references are supplied. Content sufficiency and legal compliance are not certified."; nextAction = "Review evidence content and applicable policy before closing the check.";
    } else if (supplied.length) {
      status = "needs-review"; explanation = "Evidence metadata is present but has not been verified with a usable locator."; nextAction = "Open the source record and verify the evidence reference.";
    } else {
      status = "needs-evidence"; explanation = "No matching evidence was supplied in this workspace. Absence here does not prove absence in the agency's files."; nextAction = "Request the evidence or its official system-of-record locator.";
    }
    findings.push({ id: `${item.id}:${check.kind}`, caseId: item.id, category: "contracting", title: check.title, status, explanation, nextAction, sourceIds: check.sourceIds, evidenceIds: supplied.map(e => e.id) });
  }
  findings.push({ id: `${item.id}:policy-basis`, caseId: item.id, category: "policy", title: "Applicable policy version", status: item.policyBasisConfirmed ? "evidence-present" : "needs-review", explanation: item.policyBasisConfirmed ? "Policy basis is marked confirmed for this synthetic scenario." : custom ? "Confirm which policy versions and deviations govern this case before treating screening rules as requirements." : "Confirm the acquisition's governing FAR/VAAR versions and applicable deviations before treating screening rules as requirements.", nextAction: custom ? "Review the governing policy versions and case-specific applicability." : "Review VA's RFO deviations and contract-specific applicability.", sourceIds: custom ? custom.policySourceIds : ["va-rfo"], evidenceIds: [] });
  const recordResults = item.records.map(record => ({ ...record, retention: retention(record, asOf) }));
  for (const record of recordResults) {
    findings.push({ id: `${item.id}:record:${record.id}`, caseId: item.id, category: "records", title: record.title, status: record.retention.status === "blocked" ? "blocked" : !record.owner?.trim() || ["unknown", "review-due"].includes(record.retention.status) ? "needs-review" : "evidence-present", explanation: `${record.owner?.trim() ? "" : "Assign a records owner. "}${record.retention.reason}`, nextAction: record.retention.status === "blocked" ? "Preserve the record and consult the hold owner." : "Confirm ownership, schedule, trigger evidence, and hold status with the records officer.", sourceIds: custom ? custom.recordsSourceIds : ["far-4.805", "va-6300"], evidenceIds: [] });
  }
  if (!item.records.length) findings.push({ id: `${item.id}:inventory`, caseId: item.id, category: "records", title: "Records inventory", status: "needs-evidence", explanation: "No record inventory was supplied.", nextAction: "Identify records, custodians, and schedule authorities.", sourceIds: custom ? custom.recordsSourceIds : ["va-6300"], evidenceIds: [] });
  return { caseId: item.id, revision: item.revision ?? 0, asOf, ruleVersion, provenance: item.provenance, findings, records: recordResults, summary: { total: findings.length, evidencePresent: findings.filter(f => f.status === "evidence-present").length, needsEvidence: findings.filter(f => f.status === "needs-evidence").length, needsReview: findings.filter(f => f.status === "needs-review").length, blocked: findings.filter(f => f.status === "blocked").length }, limitation: "Prototype screening of supplied evidence; not a compliance certification. All internal cases are synthetic." };
}

/** Boundary validation is independent of the server and rejects unrecognized input. */
export function parseEvidence(value: unknown, item?: { checkSet?: CheckSet }): Evidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Evidence must be an object");
  const row = value as Record<string, unknown>;
  const string = (key: string, max: number) => {
    const v = row[key];
    if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error(`Invalid evidence ${key}`);
    return v.trim();
  };
  const kind = string("kind", 40);
  if (!checksOf(item ?? {}).some(c => c.kind === kind)) throw new Error("Unsupported evidence kind");
  // Verification cannot be claimed by the upload request.
  return { id: string("id", 100), kind: kind as EvidenceKind, title: string("title", 200), locator: string("locator", 1000), verified: false, provenance: "user-supplied" };
}

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected a JSON object");
  return value as Record<string, unknown>;
}

function fields(row: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(row)) if (!allowed.includes(key)) invalid(`Unsupported field: ${key}`);
}

function text(value: unknown, name: string, max = 200, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) invalid(`${name} must contain ${min}–${max} characters`);
  return value.trim();
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") invalid(`${name} must be boolean`);
  return value;
}

export function expectedRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid("expectedRevision must be a nonnegative integer");
  return value as number;
}

function noteOf(row: Record<string, unknown>) { return text(row.note, "note", 2000, 10); }

function identifier(value: unknown, name: string): string | null {
  if (value === null) return null;
  const result = text(value, name, 100);
  if (/[\u0000-\u001f\u007f]/.test(value as string)) invalid(`${name} cannot contain control characters`);
  return result;
}

function caseMetadata(row: Record<string, unknown>): Pick<ComplianceCase, 'contractNumber' | 'periodOfPerformance'> {
  const result: Pick<ComplianceCase, 'contractNumber' | 'periodOfPerformance'> = {};
  if ('contractNumber' in row) result.contractNumber = identifier(row.contractNumber, 'contractNumber');
  if ('periodOfPerformance' in row) {
    if (row.periodOfPerformance === null) result.periodOfPerformance = null;
    else {
      const period = object(row.periodOfPerformance);
      fields(period, ['start', 'end']);
      if (!validDate(period.start) || !validDate(period.end) || period.start > period.end) invalid('periodOfPerformance requires real start/end dates with start on or before end');
      result.periodOfPerformance = { start: period.start, end: period.end };
    }
  }
  return result;
}

/** A record type must be one the case's own check set lists as expected. */
function recordTypeOf(value: unknown, item: ComplianceCase): string {
  const kinds = (item.checkSet?.expectedRecords ?? []).map(entry => entry.kind);
  if (!kinds.length) invalid("This case lists no expected record types");
  if (typeof value !== "string" || !kinds.includes(value)) invalid("recordType must be one of this case's expected record types");
  return value;
}

function existingMetadata(item: ComplianceCase) {
  return { ...(Object.hasOwn(item, 'contractNumber') ? { contractNumber: item.contractNumber } : {}), ...(Object.hasOwn(item, 'periodOfPerformance') ? { periodOfPerformance: item.periodOfPerformance } : {}) };
}

export function createDemoCase(value: unknown, id: string, options: { organization?: string; checkSet?: CheckSet; businessUnit?: string; recordFamily?: string } = {}): { item: ComplianceCase; note: string } {
  const row = object(value);
  fields(row, ["title", "owner", "note", "contractNumber", "periodOfPerformance"]);
  return { item: { id, title: text(row.title, "title"), owner: text(row.owner, "owner"), agency: options.organization ?? "Department of Veterans Affairs", provenance: "synthetic", policyBasisConfirmed: false, applicability: Object.fromEntries(checksOf(options).map(check => [check.kind, "unknown"])) as ComplianceCase["applicability"], evidence: [], records: [], tasks: [], revision: 0, ...caseMetadata(row), ...(options.checkSet ? { checkSet: options.checkSet } : {}), ...(options.businessUnit ? { businessUnit: options.businessUnit } : {}), ...(options.recordFamily ? { recordFamily: options.recordFamily } : {}) }, note: noteOf(row) };
}

/** All workflow changes are explicit reviewer assertions, with a durable rationale. */
export function applyCaseChange(item: ComplianceCase, command: string, value: unknown, context: { id: string; targetId?: string; asOf: string; sourceIds: string[]; reviewedAt?: string; actor?: string }) {
  const row = object(value);
  expectedRevision(row.expectedRevision);
  const note = noteOf(row);
  if (!validDate(context.asOf)) invalid("Invalid screening date");
  const next: ComplianceCase = JSON.parse(JSON.stringify(item));
  const common = ["expectedRevision", "note"];
  let before: unknown = null;
  let after: unknown = null;
  if (command === "context") {
    fields(row, [...common, "title", "owner", "applicability", "policyBasis", "contractNumber", "periodOfPerformance"]);
    if (!["title", "owner", "applicability", "policyBasis", "contractNumber", "periodOfPerformance"].some(key => key in row)) invalid("Provide a context change");
    before = { title: next.title, owner: next.owner, applicability: { ...next.applicability }, policyBasisConfirmed: next.policyBasisConfirmed, policyBasis: next.policyBasis ?? null, ...existingMetadata(next) };
    Object.assign(next, caseMetadata(row));
    if ("title" in row) next.title = text(row.title, "title");
    if ("owner" in row) next.owner = text(row.owner, "owner");
    if ("applicability" in row) {
      const applicability = object(row.applicability);
      fields(applicability, checksOf(next).map(check => check.kind));
      if (!Object.keys(applicability).length) invalid("Provide at least one applicability decision");
      for (const [kind, applies] of Object.entries(applicability)) {
        if (!["yes", "no", "unknown"].includes(applies as string)) invalid("Applicability must be yes, no, or unknown");
        next.applicability[kind as EvidenceKind] = applies as Applicability;
      }
    }
    if ("policyBasis" in row) {
      const basis = object(row.policyBasis);
      fields(basis, ["confirmed", "description", "sourceIds"]);
      next.policyBasisConfirmed = boolean(basis.confirmed, "confirmed");
      if (!Array.isArray(basis.sourceIds) || !basis.sourceIds.length || !basis.sourceIds.every(id => typeof id === "string" && context.sourceIds.includes(id))) invalid("Policy basis must reference known source IDs");
      next.policyBasis = { description: text(basis.description, "description", 2000, 10), sourceIds: [...new Set(basis.sourceIds as string[])] };
    }
    after = { title: next.title, owner: next.owner, applicability: next.applicability, policyBasisConfirmed: next.policyBasisConfirmed, policyBasis: next.policyBasis ?? null, ...existingMetadata(next) };
  } else if (command === "record-create") {
    fields(row, [...common, "title", "owner", "recordType"]);
    const record: RecordItem = { id: context.id, title: text(row.title, "title"), owner: row.owner == null ? null : text(row.owner, "owner"), schedule: null, finalPaymentDate: null, hold: "unknown", ...(row.recordType == null ? {} : { recordType: recordTypeOf(row.recordType, next) }) };
    next.records.push(record); after = record;
  } else if (command === "record-update" || command === "record-hold") {
    const record = next.records.find(r => r.id === context.targetId);
    if (!record) invalid("Record not found", 404);
    before = JSON.parse(JSON.stringify(record));
    if (command === "record-hold") {
      fields(row, [...common, "status", "reference", "releaseReference"]);
      if (!["active", "none", "unknown"].includes(row.status as string)) invalid("Hold status must be active, none, or unknown");
      const reference = text(row.reference, "hold review reference", 1000, 3);
      if (record.hold === "active" && row.status !== "active") text(row.releaseReference, "releaseReference", 1000, 3);
      const releaseReference = row.releaseReference == null ? null : text(row.releaseReference, "releaseReference", 1000, 3);
      if (typeof context.reviewedAt !== 'string' || !Number.isFinite(Date.parse(context.reviewedAt)) || new Date(context.reviewedAt).toISOString() !== context.reviewedAt) invalid('A valid server review timestamp is required');
      const actor = text(context.actor, 'review actor', 200);
      record.hold = row.status as RecordItem["hold"];
      const review: HoldReview = { status: record.hold, reference, releaseReference, note, reviewedAt: context.reviewedAt, actor };
      record.holdReview = review;
      record.holdReviews = [...(record.holdReviews ?? []), review];
    } else {
      fields(row, [...common, "title", "owner", "schedule", "finalPaymentDate", "recordType"]);
      if (!["title", "owner", "schedule", "finalPaymentDate", "recordType"].some(key => key in row)) invalid("Provide a record change");
      if ("recordType" in row) record.recordType = row.recordType === null ? null : recordTypeOf(row.recordType, next);
      if ("title" in row) record.title = text(row.title, "title");
      if ("owner" in row) record.owner = row.owner === null ? null : text(row.owner, "owner");
      if ("schedule" in row) {
        if (row.schedule === null) record.schedule = null;
        else {
          const schedule = object(row.schedule);
          fields(schedule, ["authority", "years", "trigger", "confirmed", "itemNumber"]);
          if (!Number.isInteger(schedule.years) || (schedule.years as number) < 1 || (schedule.years as number) > 100) invalid("Schedule years must be an integer from 1 to 100");
          if (schedule.trigger !== "final-payment") invalid("Only final-payment schedules are supported by this prototype");
          const itemNumber = Object.hasOwn(schedule, 'itemNumber') ? { itemNumber: identifier(schedule.itemNumber, 'itemNumber') } : record.schedule && Object.hasOwn(record.schedule, 'itemNumber') ? { itemNumber: record.schedule.itemNumber } : {};
          record.schedule = { authority: text(schedule.authority, "schedule authority", 1000), years: schedule.years as number, trigger: "final-payment", confirmed: boolean(schedule.confirmed, "schedule confirmed"), ...itemNumber };
        }
      }
      if ("finalPaymentDate" in row) {
        if (row.finalPaymentDate === null) record.finalPaymentDate = null;
        else {
          if (!validDate(row.finalPaymentDate) || row.finalPaymentDate > context.asOf) invalid("Final payment must be a real date on or before asOf");
          record.finalPaymentDate = row.finalPaymentDate;
        }
      }
    }
    after = record;
  } else if (command === "evidence-update") {
    fields(row, [...common, "title", "kind", "locator"]);
    const index = next.evidence.findIndex(e => e.id === context.targetId);
    if (index < 0) invalid("Evidence not found", 404);
    if (!["title", "kind", "locator"].some(key => key in row)) invalid("Provide an evidence change");
    before = next.evidence[index];
    try { next.evidence[index] = parseEvidence({ ...next.evidence[index], ...row, id: context.targetId }, next); }
    catch (error) { invalid((error as Error).message); }
    after = next.evidence[index];
  } else if (command === "task-create" || command === "task-update") {
    fields(row, [...common, ...(command === "task-create" ? ["findingId"] : ["status"]), "title", "owner", "dueDate"]);
    next.tasks ??= [];
    let task: FollowUpTask;
    if (command === "task-create") {
      const findingId = text(row.findingId, "findingId");
      if (!analyzeCase(next, context.asOf).findings.some(f => f.id === findingId)) invalid("Finding not found", 404);
      task = { id: context.id, findingId, title: text(row.title, "title"), owner: text(row.owner, "owner"), dueDate: null, status: "open" };
      next.tasks.push(task);
    } else {
      const existing = next.tasks.find(t => t.id === context.targetId);
      if (!existing) invalid("Task not found", 404);
      if (!["title", "owner", "dueDate", "status"].some(key => key in row)) invalid("Provide a task change");
      task = existing; before = { ...task };
    }
    if ("title" in row) task.title = text(row.title, "title");
    if ("owner" in row) task.owner = text(row.owner, "owner");
    if ("dueDate" in row) {
      if (row.dueDate !== null && !validDate(row.dueDate)) invalid("dueDate must be a real YYYY-MM-DD date or null");
      task.dueDate = row.dueDate as string | null;
    }
    if ("status" in row) {
      if (!["open", "in-progress", "done"].includes(row.status as string)) invalid("Task status must be open, in-progress, or done");
      // Completing an action is not the same as resolving its compliance finding.
      task.status = row.status as FollowUpTask["status"];
    }
    after = task;
  } else invalid("Unsupported workflow command");
  return { item: next, change: { command, note, before, after, ...(command === "record-hold" ? { reference: row.reference, releaseReference: row.releaseReference ?? null } : {}) } };
}

export function taskQueue(cases: ComplianceCase[], asOf: string) {
  if (!validDate(asOf)) invalid("Invalid screening date");
  return cases.flatMap(item => {
    const report = analyzeCase(item, asOf);
    return (item.tasks ?? []).map(task => {
      const finding = report.findings.find(f => f.id === task.findingId);
      const needsFollowUp = !finding || !["evidence-present", "not-applicable"].includes(finding.status);
      return { ...task, caseId: item.id, caseTitle: item.title, caseRevision: item.revision ?? 0, findingStatus: finding?.status ?? "unavailable", sourceIds: finding?.sourceIds ?? [], needsFollowUp, overdue: task.status !== "done" && task.dueDate !== null && task.dueDate < asOf };
    });
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || a.id.localeCompare(b.id));
}

export function caseSummary(item: ComplianceCase, asOf: string) {
  const { summary } = analyzeCase(item, asOf);
  return { needsEvidence: summary.needsEvidence, needsReview: summary.needsReview, blocked: summary.blocked, evidencePresent: summary.evidencePresent, openTasks: (item.tasks ?? []).filter(t => t.status !== 'done').length, activeHolds: item.records.filter(r => r.hold === 'active').length };
}

export function recordNeedsReview(record: { owner: string | null; retention: RetentionResult }) {
  return !record.owner?.trim() || ['unknown', 'review-due'].includes(record.retention.status);
}

export function findingSearchRows<T extends Finding>(cases: ComplianceCase[], findings: T[]) {
  return findings.map(finding => {
    const item = cases.find(c => c.id === finding.caseId);
    return { ...finding, evidenceSearch: (item?.evidence ?? []).filter(e => finding.evidenceIds.includes(e.id)).map(e => `${e.title}\n${e.locator}`).join('\n'), hasOpenTask: (item?.tasks ?? []).some(t => t.findingId === finding.id && t.status !== 'done') };
  });
}

export function casePacket(item: ComplianceCase, asOf: string, exportedAt: string, reviews: { caseId: string }[], events: { caseId: string }[], sources: { id: string }[]) {
  const report = analyzeCase(item, asOf);
  const packet = {
    case: item, report, reviews: reviews.filter(review => review.caseId === item.id), tasks: taskQueue([item], asOf),
    holdReviews: item.records.flatMap(record => (record.holdReviews ?? []).map(review => ({ recordId: record.id, ...review }))),
    events: events.filter(event => event.caseId === item.id), exportedAt, asOf,
    digestNotice: 'The digest detects accidental change only. It is not a tamper-proof seal, signature, or proof of authenticity.',
  };
  const cited = new Set<string>();
  function collect(value: unknown) {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'sourceIds' && Array.isArray(child)) child.forEach(id => { if (typeof id === 'string') cited.add(id); });
      else collect(child);
    }
  }
  collect(packet);
  return { ...packet, sources: sources.filter(source => cited.has(source.id)) };
}

/** One computed snapshot for list screens; counts are not a compliance score. */
export function workspaceScreening(cases: ComplianceCase[], asOf: string) {
  const reports = cases.map(item => analyzeCase(item, asOf));
  const findings = reports.flatMap((report, index) => report.findings.map(finding => ({ ...finding, caseTitle: cases[index].title, owner: cases[index].owner, caseRevision: report.revision })));
  const records = reports.flatMap((report, index) => report.records.map(record => ({ ...record, caseId: report.caseId, caseTitle: cases[index].title, caseRevision: report.revision, status: record.retention.status })));
  const tasks = taskQueue(cases, asOf);
  const counts = {
    cases: cases.length,
    evidenceGaps: findings.filter(f => f.status === 'needs-evidence').length,
    pendingReviews: findings.filter(f => f.status === 'needs-review').length,
    activeHolds: records.filter(r => r.hold === 'active').length,
    recordsNeedingReview: records.filter(recordNeedsReview).length,
    openTasks: tasks.filter(t => t.status !== 'done').length,
    overdueTasks: tasks.filter(t => t.overdue).length,
    tasksNeedingFollowUp: tasks.filter(t => t.needsFollowUp).length,
  };
  return { asOf, ruleVersion, counts, findings, records, tasks, reports };
}

/** Operational views reuse screening results; task state never substitutes for a finding. */
// `assessmentIssues` (by finding ID) are recorded sufficiency problems the caller detected: not sufficient, needing another
// review, or of unknown freshness. They keep a finding actionable even when its reference is verified.
export function reviewWorkbench(cases: ComplianceCase[], asOf: string, reviews: { id?: string; caseId: string; findingId: string; caseRevisionAtReview?: number }[], events: { caseId: string; action: string; caseRevision?: number; details?: { id?: string } }[] = [], assessmentIssues: Record<string, { ruleId: string; gapStatus: string; [key: string]: unknown }> = {}) {
  const snapshot = workspaceScreening(cases, asOf);
  const order = { 'preserve-record': 0, 'overdue-task': 1, 'resolve-assessment': 2, 'assign-follow-up': 3, 'follow-up': 4, monitor: 5 };
  const rows = snapshot.findings.map(finding => {
    const item = cases.find(item => item.id === finding.caseId)!;
    const record = snapshot.records.find(record => record.caseId === item.id && finding.id === `${item.id}:record:${record.id}`) ?? null;
    const tasks = snapshot.tasks.filter(task => task.caseId === item.id && task.findingId === finding.id);
    const openTasks = tasks.filter(task => task.status !== 'done');
    const needsFollowUp = !['evidence-present', 'not-applicable'].includes(finding.status);
    const overdue = openTasks.some(task => task.overdue);
    const assessmentIssue = assessmentIssues[finding.id] ?? null;
    const attention: keyof typeof order = finding.status === 'blocked' ? 'preserve-record' : overdue ? 'overdue-task' : assessmentIssue ? 'resolve-assessment' : needsFollowUp ? openTasks.length ? 'follow-up' : 'assign-follow-up' : 'monitor';
    const reasons = {
      'preserve-record': 'An active hold blocks review; preserve the record and consult the hold owner.',
      'overdue-task': 'An incomplete follow-up task is past its due date.',
      'resolve-assessment': assessmentIssue?.ruleId === 'assessment-not-sufficient'
        ? `The current assessment says the evidence is not sufficient for this check, even though a reference is on file. ${{ confirmed: 'A reviewer confirmed it as a documentation gap.', dismissed: 'A reviewer dismissed the documentation gap, but the assessment itself still says not sufficient.' }[assessmentIssue.gapStatus] ?? 'It has not been confirmed as a documentation gap yet.'} Request further evidence, then record a new assessment.`
        : 'The current assessment needs another review: something it relied on has changed or cannot be checked. Reassess before relying on it.',
      'assign-follow-up': 'The finding needs attention and has no incomplete follow-up task.',
      'follow-up': 'The finding needs attention and has an assigned incomplete task.',
      monitor: 'No unresolved finding or overdue task is indicated by current screening; this is not a compliance approval.',
    };
    const lastReview = reviews.filter(review => review.caseId === item.id && review.findingId === finding.id).at(-1) ?? null;
    // Review writes increment the case revision; compare against the committed event.
    const reviewEvent = lastReview?.id ? events.filter(event => event.caseId === item.id && event.action === 'finding-reviewed' && event.details?.id === lastReview.id).at(-1) : undefined;
    return {
      ...finding, owner: record ? record.owner : item.owner, caseOwner: item.owner,
      evidence: item.evidence.filter(evidence => finding.evidenceIds.includes(evidence.id)), record, tasks,
      taskOwners: [...new Set(openTasks.map(task => task.owner))],
      earliestDueDate: openTasks.flatMap(task => task.dueDate ? [task.dueDate] : []).sort()[0] ?? null,
      hasOpenTask: openTasks.length > 0, overdue, needsFollowUp, attention, attentionReason: reasons[attention], assessmentIssue,
      lastReview, lastReviewStale: typeof reviewEvent?.caseRevision !== 'number' ? null : reviewEvent.caseRevision !== (item.revision ?? 0),
      casePacketUrl: `/api/cases/${encodeURIComponent(item.id)}/packet?asOf=${asOf}`,
    };
  });
  return rows.sort((a, b) => order[a.attention] - order[b.attention] || (a.earliestDueDate ?? '9999-12-31').localeCompare(b.earliestDueDate ?? '9999-12-31') || a.id.localeCompare(b.id));
}

export function evidenceLibrary(cases: ComplianceCase[], asOf: string) {
  return cases.flatMap(item => {
    const report = analyzeCase(item, asOf);
    return item.evidence.map(evidence => {
      const linked = report.findings.filter(finding => finding.evidenceIds.includes(evidence.id));
      return {
        ...evidence, caseId: item.id, caseTitle: item.title, caseOwner: item.owner, caseRevision: item.revision ?? 0, caseProvenance: item.provenance,
        verificationStatus: evidence.verified && evidence.locator.trim() ? 'verified-reference' : 'unverified-reference',
        linkedFindings: linked.map(({ id, title, status }) => ({ id, title, status })),
        sourceIds: [...new Set(linked.flatMap(finding => finding.sourceIds))],
      };
    });
  });
}
