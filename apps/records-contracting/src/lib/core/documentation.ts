/**
 * Documentation completeness, detected documentation gaps, and dated documentation needs for one case.
 * Everything here is counted from what is stored. Nothing here decides compliance:
 * a percent says how much of the countable documentation is in place, and a gap is a
 * documentation condition found by a rule, for a person to confirm or dismiss.
 * This file imports nothing. The case, its report, and its evidence review are passed in.
 */

export type Row = Record<string, any>;

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

/** One entry per rule: what it detects and what would clear it. */
export const gapRules: Record<string, { title: string; toClear: string }> = {
  "applicability-undecided": { title: "Applicability not decided", toClear: "A reviewer decides whether the check applies and records why." },
  "evidence-missing": { title: "No evidence reference supplied", toClear: "Add a reference to the evidence, or record why the check does not apply." },
  "reference-unverified": { title: "Evidence reference not verified", toClear: "A reviewer opens the source and verifies the reference." },
  "assessment-missing": { title: "No sufficiency assessment recorded", toClear: "A reviewer records a sufficiency assessment for the check." },
  "assessment-not-sufficient": { title: "Evidence assessed as not sufficient", toClear: "Supply further evidence, then record a new assessment." },
  "assessment-needs-review": { title: "Assessment needs another review", toClear: "Reassess the check against the changed evidence, applicability, or policy." },
  "assessment-freshness-unknown": { title: "Assessment freshness cannot be established", toClear: "Restore the document service or record a new assessment." },
  "policy-basis-unconfirmed": { title: "Policy basis not confirmed", toClear: "A reviewer confirms which policy versions govern the case." },
  "inventory-empty": { title: "No records inventoried", toClear: "List the records this case holds, with an owner for each." },
  "record-type-missing": { title: "Expected record type not inventoried", toClear: "Add a record of this type, or ask a records officer whether it applies here." },
  "record-owner-missing": { title: "Record has no owner", toClear: "Assign a records owner." },
  "record-schedule-unconfirmed": { title: "Record schedule not confirmed", toClear: "A records officer confirms the schedule that covers this record." },
  "record-hold-undecided": { title: "Hold status not decided", toClear: "Record a hold review stating whether a hold applies." },
  "task-overdue": { title: "Follow-up task overdue", toClear: "Complete the task or set a new due date." },
};

export const gapDecisions = ["confirmed", "dismissed"];

/** What is in place for each evidence check and each record, in plain reasons. */
function examine(item: Row, review: Row) {
  const checks = (review.findings ?? []).map((finding: Row) => {
    const kind = finding.findingId.slice(item.id.length + 1);
    const applicability = item.applicability?.[kind] ?? "unknown";
    const evidence = finding.evidence ?? [];
    const verified = evidence.filter((entry: Row) => entry.verified);
    const assessment = finding.currentAssessment ?? null;
    const freshness = assessment?.freshness?.state ?? null;
    const missing: { ruleId: string; detail: string }[] = [];
    if (applicability === "unknown") missing.push({ ruleId: "applicability-undecided", detail: "No one has decided whether this check applies to the case." });
    else if (applicability === "yes") {
      if (!evidence.length) missing.push({ ruleId: "evidence-missing", detail: "The check applies and no evidence reference is on file." });
      else if (!verified.length) missing.push({ ruleId: "reference-unverified", detail: `${evidence.length} reference${evidence.length === 1 ? " is" : "s are"} on file and none has been verified.` });
      else if (!assessment) missing.push({ ruleId: "assessment-missing", detail: "A verified reference is on file and no sufficiency assessment has been recorded." });
      if (assessment && freshness === "needs-review") missing.push({ ruleId: "assessment-needs-review", detail: (assessment.freshness.causes ?? []).map((cause: Row) => cause.message).join(" ") || "Something the assessment relied on has changed." });
      else if (assessment && freshness === "cannot-establish") missing.push({ ruleId: "assessment-freshness-unknown", detail: (assessment.freshness.causes ?? []).map((cause: Row) => cause.message).join(" ") || "The assessment cannot be compared with the current case." });
      else if (assessment && assessment.outcome !== "sufficient-for-stated-check") missing.push({ ruleId: "assessment-not-sufficient", detail: `The current assessment is "${assessment.outcome}".` });
    }
    const complete = applicability === "yes" && missing.length === 0;
    return { id: finding.findingId, kind, title: finding.title, applicability, complete, hasPassage: evidence.some((entry: Row) => entry.passage === "attached"), missing };
  });

  const records = (item.records ?? []).map((record: Row) => {
    const missing: { ruleId: string; detail: string }[] = [];
    if (!record.owner?.trim()) missing.push({ ruleId: "record-owner-missing", detail: "No records owner is assigned." });
    if (!record.schedule?.confirmed) missing.push({ ruleId: "record-schedule-unconfirmed", detail: record.schedule ? "A schedule is on file and a records officer has not confirmed it." : "No schedule is on file for this record." });
    if (record.hold === "unknown") missing.push({ ruleId: "record-hold-undecided", detail: "No hold review has stated whether a hold applies." });
    return { id: record.id, title: record.title, recordType: record.recordType ?? null, hold: record.hold, complete: missing.length === 0, missing };
  });

  const expected = (item.checkSet?.expectedRecords ?? []).map((entry: Row) => ({
    kind: entry.kind, title: entry.title, present: (item.records ?? []).some((record: Row) => record.recordType === entry.kind),
  }));
  return { checks, records, expected };
}

/**
 * Documentation completeness for one case.
 * Countable items: checks whose applicability is "yes", inventoried records, and expected record types.
 * Undecided and not applicable checks are left out of the percent and reported beside it.
 * With nothing countable the percent is null. It is never shown as 0 or 100.
 */
export function documentationScore(item: Row, review: Row) {
  const { checks, records, expected } = examine(item, review);
  const applicable = checks.filter((check: Row) => check.applicability === "yes");
  const missingTypes = expected.filter((entry: Row) => !entry.present);
  const part = (complete: number, countable: number) => ({ complete, countable, percent: countable ? Math.floor((100 * complete) / countable) : null });
  const checkPart = part(applicable.filter((check: Row) => check.complete).length, applicable.length);
  // An expected record type that is not inventoried counts as one incomplete record item.
  const recordPart = part(records.filter((record: Row) => record.complete).length, records.length + missingTypes.length);
  const overall = part(checkPart.complete + recordPart.complete, checkPart.countable + recordPart.countable);
  return {
    label: "Documentation completeness",
    ...overall,
    checks: { ...checkPart, undecided: checks.filter((check: Row) => check.applicability === "unknown").length, notApplicable: checks.filter((check: Row) => check.applicability === "no").length, withPassage: applicable.filter((check: Row) => check.hasPassage).length },
    records: { ...recordPart, inventoried: records.length, expectedTypes: expected.length, expectedTypesMissing: missingTypes.length, activeHolds: records.filter((record: Row) => record.hold === "active").length },
    items: [
      ...checks.map((check: Row) => ({ type: "check", id: check.id, title: check.title, counted: check.applicability === "yes", complete: check.complete, reasons: check.missing.map((entry: Row) => gapRules[entry.ruleId].title) })),
      ...records.map((record: Row) => ({ type: "record", id: record.id, title: record.title, counted: true, complete: record.complete, reasons: record.missing.map((entry: Row) => gapRules[entry.ruleId].title) })),
      ...missingTypes.map((entry: Row) => ({ type: "record-type", id: entry.kind, title: entry.title, counted: true, complete: false, reasons: [gapRules["record-type-missing"].title] })),
    ],
    limitation: "Documentation completeness counts what is on file: a verified reference with a current sufficient assessment for each check that applies, and an owner, a confirmed schedule, and a decided hold status for each record. It is not a compliance rating and does not show that any requirement is met. Undecided checks are not counted until a reviewer decides them.",
  };
}

/**
 * Detected documentation gaps for one case. Each gap names its rule, what was found, and what would clear it.
 * `state` is a short description of the condition; a recorded decision is out of date once it differs.
 */
export function detectGaps(item: Row, review: Row, tasks: Row[]) {
  const { checks, records, expected } = examine(item, review);
  const gaps: Row[] = [];
  const add = (ruleId: string, subjectType: string, subjectId: string, subjectTitle: string, detail: string, section: string) => gaps.push({
    id: `${item.id}:${ruleId}:${subjectId}`, ruleId, caseId: item.id, subjectType, subjectId, subjectTitle,
    title: gapRules[ruleId].title, detail, toClear: gapRules[ruleId].toClear, section, state: `${ruleId}|${detail}`,
  });
  for (const check of checks) for (const entry of check.missing) add(entry.ruleId, "check", check.kind, check.title, entry.detail, "findings");
  if (!item.policyBasisConfirmed) add("policy-basis-unconfirmed", "case", "policy-basis", "Applicable policy version", "The governing policy versions have not been confirmed for this case.", "policy");
  if (!(item.records ?? []).length) add("inventory-empty", "case", "inventory", "Records inventory", "No record is listed for this case.", "records");
  for (const entry of expected) if (!entry.present) add("record-type-missing", "record-type", entry.kind, entry.title, "The check set this case was created with lists this record type as expected, and no inventoried record names it. Whether it must be kept is for a records officer.", "records");
  for (const record of records) for (const entry of record.missing) add(entry.ruleId, "record", record.id, record.title, entry.detail, "records");
  for (const task of tasks) if (task.overdue) add("task-overdue", "task", task.id, task.title, `Due ${task.dueDate}; owner ${task.owner}.`, "tasks");
  return gaps;
}

/** Attaches the latest recorded decision to each gap and says whether it still describes the gap. */
export function withDecisions(gaps: Row[], item: Row) {
  return gaps.map(gap => {
    const decisions = (item.gapDecisions ?? []).filter((entry: Row) => entry.gapId === gap.id);
    const latest = decisions[decisions.length - 1] ?? null;
    const current = Boolean(latest) && latest.state === gap.state;
    return { ...gap, decision: latest ? { id: latest.id, decision: latest.decision, note: latest.note, at: latest.at, actor: latest.actor, identity: latest.identity, current } : null, status: current ? latest.decision : "open" };
  });
}

/** Validates a reviewer's decision on one detected gap. It is appended; nothing else on the case changes. */
export function newGapDecision(input: unknown, gaps: Row[], context: { id: string; now: string; actor: string; trusted: boolean }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Expected a JSON object");
  const row = input as Row;
  for (const key of Object.keys(row)) if (!["expectedRevision", "gapId", "decision", "note"].includes(key)) invalid(`Unsupported field: ${key.slice(0, 40)}`);
  if (!gapDecisions.includes(row.decision)) invalid("decision must be confirmed or dismissed");
  if (typeof row.note !== "string" || row.note.trim().length < 10 || row.note.length > 2000) invalid("Provide a note of 10 to 2000 characters");
  const gap = gaps.find(entry => entry.id === row.gapId);
  if (!gap) invalid("That gap is not currently detected on this case", 404);
  return {
    id: context.id, gapId: gap.id, ruleId: gap.ruleId, decision: row.decision as string, note: row.note.trim(), state: gap.state,
    at: context.now, actor: context.actor, identity: context.trusted ? "verified" : "local-operator", synthetic: true,
  };
}

/**
 * Dated documentation needs for one case, taken only from stored dates:
 * follow-up task due dates, record review dates, and the end of the period of performance.
 * Undated needs are open tasks with no due date and records whose review date cannot be computed.
 */
export function planningItems(item: Row, report: Row, tasks: Row[]) {
  const dated: Row[] = [];
  const undated: Row[] = [];
  const base = { caseId: item.id, caseTitle: item.title, organization: item.agency, recordFamily: item.recordFamily ?? null };
  for (const task of tasks) {
    if (task.status === "done") continue;
    const entry = { ...base, type: "task", id: `${item.id}:task:${task.id}`, title: task.title, owner: task.owner, section: "tasks" };
    if (task.dueDate) dated.push({ ...entry, date: task.dueDate, note: task.overdue ? "Overdue follow-up task." : "Follow-up task due." });
    else undated.push({ ...entry, note: "Open follow-up task with no due date." });
  }
  for (const record of report.records ?? []) {
    const entry = { ...base, type: "record-review", id: `${item.id}:record:${record.id}`, title: record.title, owner: record.owner ?? null, section: "records" };
    if (record.retention.status === "blocked") undated.push({ ...entry, note: "Active hold. The record is preserved and no review date applies." });
    else if (record.retention.reviewDate) dated.push({ ...entry, date: record.retention.reviewDate, note: "Record review date. A records officer looks at the record then. It is not a disposal date." });
    else undated.push({ ...entry, note: "No review date can be computed until the schedule, trigger date, and hold status are confirmed." });
  }
  if (item.periodOfPerformance?.end) dated.push({ ...base, type: "period-end", id: `${item.id}:period-end`, title: "Period of performance ends", owner: item.owner, section: "findings", date: item.periodOfPerformance.end, note: "End date recorded on the case." });
  return { dated, undated };
}
