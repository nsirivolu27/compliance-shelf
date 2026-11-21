/**
 * Pure logic for evidence-bound review drafts and the case journey.
 * A reviewed draft describes the note only. Nothing here resolves a finding,
 * verifies evidence, releases a hold, or authorizes destruction.
 * This file imports nothing; computed reports and a hash function are passed in.
 */

export type Row = Record<string, any>;
export type Hash = (text: string) => string;

export type DraftState = "draft" | "submitted" | "changes-requested" | "reviewed";

function invalid(message: string, status = 400, extra: Row = {}): never {
  throw Object.assign(new Error(message), { status, ...extra });
}

function objectOf(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected a JSON object");
  return value as Row;
}

function onlyFields(row: Row, allowed: string[]) {
  for (const key of Object.keys(row)) if (!allowed.includes(key)) invalid(`Unsupported field: ${key}`);
}

function textOf(value: unknown, name: string, max: number, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) invalid(`${name} must contain ${min}–${max} characters`);
  return value.trim();
}

function versionOf(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid("expectedVersion must be a positive integer");
  return value as number;
}

function findingIdsOf(value: unknown, report: Row): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50 || value.some(id => typeof id !== "string")) invalid("findingIds must list 1–50 finding IDs");
  const ids = [...new Set(value as string[])];
  // A draft can only cite findings of its own case. IDs from another case are not found here.
  for (const id of ids) if (!report.findings.some((finding: Row) => finding.id === id)) invalid(`Finding not found in this case: ${id}`, 404);
  return report.findings.filter((finding: Row) => ids.includes(finding.id)).map((finding: Row) => finding.id);
}

/** Recursively sorted keys, so the same snapshot always hashes the same way. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const row = value as Row;
    return `{${Object.keys(row).filter(key => row[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The exact evidence a draft refers to: cited findings, their evidence references,
 * policy sources, related records, and document hashes where a locator carries one.
 * Span references are listed only when a locator names a span; none are invented.
 */
export function evidenceSnapshot(item: Row, report: Row, findingIds: string[]) {
  const findings = report.findings.filter((finding: Row) => findingIds.includes(finding.id));
  const evidenceIds = [...new Set(findings.flatMap((finding: Row) => finding.evidenceIds))];
  const evidence = item.evidence.filter((entry: Row) => evidenceIds.includes(entry.id)).map((entry: Row) => {
    const document = /^document:\/\/([A-Za-z0-9_-]+)#(.*)$/.exec(entry.locator);
    const sha256 = document ? /(?:^|&)sha256=([0-9a-f]{64})(?:&|$)/.exec(document[2])?.[1] ?? null : null;
    const spanId = document ? /^(span-\d+)$/.exec(document[2])?.[1] ?? null : null;
    return { id: entry.id, kind: entry.kind, title: entry.title, locator: entry.locator, verified: entry.verified === true, documentId: document?.[1] ?? null, documentSha256: sha256, spanId };
  });
  const records = report.records
    .filter((record: Row) => findingIds.includes(`${item.id}:record:${record.id}`))
    .map((record: Row) => ({ id: record.id, hold: record.hold, retentionStatus: record.retention.status, canDestroy: false }));
  return {
    caseId: item.id,
    ruleVersion: report.ruleVersion,
    findings: findings.map((finding: Row) => ({ id: finding.id, status: finding.status, evidenceIds: [...finding.evidenceIds], sourceIds: [...finding.sourceIds] })),
    evidence,
    records,
    sourceIds: [...new Set(findings.flatMap((finding: Row) => finding.sourceIds))],
  };
}

export function evidenceHash(snapshot: Row, hash: Hash): string {
  return hash(canonical(snapshot));
}

function contentHash(title: string, text: string, findingIds: string[], hash: Hash): string {
  return hash(canonical({ title, text, findingIds }));
}

/** Deterministic starting text built only from computed findings. The author edits it before submitting. */
export function prepareDraftText(item: Row, report: Row, findingIds?: string[]) {
  const selected = findingIds ?? report.findings
    .filter((finding: Row) => ["needs-evidence", "needs-review", "blocked"].includes(finding.status))
    .map((finding: Row) => finding.id);
  const ids = findingIdsOf(selected, report);
  const lines = [
    `Review note for ${item.title} (${item.id}). Synthetic case.`,
    `Screening date ${report.asOf}. Rule version ${report.ruleVersion}. Case revision ${item.revision ?? 0}.`,
    "",
  ];
  for (const finding of report.findings.filter((entry: Row) => ids.includes(entry.id))) {
    const supplied = item.evidence.filter((entry: Row) => finding.evidenceIds.includes(entry.id));
    lines.push(`${finding.title}: ${finding.status}.`);
    lines.push(`  ${finding.explanation}`);
    lines.push(`  Next action: ${finding.nextAction}`);
    lines.push(supplied.length
      ? `  Evidence references: ${supplied.map((entry: Row) => `${entry.title} (${entry.verified ? "verified reference" : "unverified reference"})`).join("; ")}.`
      : "  Evidence references: none supplied in this workspace.");
    lines.push(`  Sources: ${finding.sourceIds.join(", ")}.`);
    lines.push("");
  }
  lines.push("This note records a review of the items above. It does not resolve a finding, verify evidence, release a hold, or authorize destruction.");
  return { title: `Review note: ${item.title}`, text: lines.join("\n"), findingIds: ids };
}

type Context = { id: string; now: string; actor: string; trusted: boolean; hash: Hash };

function versionRecord(draft: Row, item: Row, report: Row, fields: { title: string; text: string; findingIds: string[] }, note: string | null, context: Context) {
  const snapshot = evidenceSnapshot(item, report, fields.findingIds);
  return {
    version: draft.versions.length + 1,
    title: fields.title, text: fields.text, findingIds: fields.findingIds,
    contentHash: contentHash(fields.title, fields.text, fields.findingIds, context.hash),
    snapshot, evidenceHash: evidenceHash(snapshot, context.hash),
    caseRevision: item.revision ?? 0, asOf: report.asOf, ruleVersion: report.ruleVersion,
    savedAt: context.now, actor: context.actor, note,
  };
}

const summaryOf = (draft: Row) => {
  const current = draft.versions[draft.versions.length - 1];
  return { state: draft.state, version: draft.version, reviewer: draft.reviewer, contentHash: current.contentHash, evidenceHash: current.evidenceHash };
};

export function createDraft(input: unknown, item: Row, report: Row, context: Context) {
  const row = objectOf(input);
  onlyFields(row, ["expectedRevision", "title", "text", "findingIds", "author", "reviewer", "note"]);
  const draft: Row = {
    id: context.id, caseId: item.id, state: "draft", version: 0,
    // On the local demo the author is a typed name. With a trusted identity it is the signed-in actor.
    author: context.trusted ? context.actor : textOf(row.author, "author", 200),
    authorActor: context.actor, identity: context.trusted ? "verified" : "unverified-local-demo",
    reviewer: row.reviewer == null || row.reviewer === "" ? null : textOf(row.reviewer, "reviewer", 200),
    createdAt: context.now, updatedAt: context.now, versions: [], decisions: [],
  };
  const note = row.note == null || row.note === "" ? null : textOf(row.note, "note", 2000, 10);
  draft.versions.push(versionRecord(draft, item, report, { title: textOf(row.title, "title", 200), text: textOf(row.text, "text", 20000, 10), findingIds: findingIdsOf(row.findingIds, report) }, note, context));
  draft.version = 1;
  return { draft, change: { command: "review-draft-created", note, before: null, after: summaryOf(draft) } };
}

function expectVersion(draft: Row, row: Row) {
  if (versionOf(row.expectedVersion) !== draft.version) {
    invalid("This draft changed since it was loaded. Reload it and review the latest version.", 409, { currentVersion: draft.version });
  }
}

/** Saves a new version. Any revision returns the draft to the draft state, so earlier decisions no longer apply. */
export function reviseDraft(existing: Row, input: unknown, item: Row, report: Row, context: Context) {
  const row = objectOf(input);
  onlyFields(row, ["expectedRevision", "expectedVersion", "title", "text", "findingIds", "reviewer", "refreshSnapshot", "note"]);
  expectVersion(existing, row);
  const draft: Row = JSON.parse(JSON.stringify(existing));
  const before = summaryOf(draft);
  const current = draft.versions[draft.versions.length - 1];
  if (!["title", "text", "findingIds", "reviewer"].some(key => key in row) && row.refreshSnapshot !== true) invalid("Provide a draft change or set refreshSnapshot to true");
  const fields = {
    title: "title" in row ? textOf(row.title, "title", 200) : current.title,
    text: "text" in row ? textOf(row.text, "text", 20000, 10) : current.text,
    findingIds: "findingIds" in row ? findingIdsOf(row.findingIds, report) : findingIdsOf(current.findingIds.filter((id: string) => report.findings.some((finding: Row) => finding.id === id)), report),
  };
  if ("reviewer" in row) draft.reviewer = row.reviewer == null || row.reviewer === "" ? null : textOf(row.reviewer, "reviewer", 200);
  const note = textOf(row.note, "note", 2000, 10);
  draft.versions.push(versionRecord(draft, item, report, fields, note, context));
  draft.version = draft.versions.length;
  draft.state = "draft";
  draft.updatedAt = context.now;
  return { draft, change: { command: "review-draft-revised", note, before, after: summaryOf(draft) } };
}

function requireCurrentEvidence(draft: Row, item: Row, report: Row, hash: Hash) {
  const current = draft.versions[draft.versions.length - 1];
  const stillPresent = current.findingIds.every((id: string) => report.findings.some((finding: Row) => finding.id === id));
  if (!stillPresent || evidenceHash(evidenceSnapshot(item, report, current.findingIds), hash) !== current.evidenceHash) {
    invalid("The evidence this draft refers to has changed since this version was saved. Refresh the draft against the current evidence before continuing.", 409, { currentVersion: draft.version });
  }
  return current;
}

export function submitDraft(existing: Row, input: unknown, item: Row, report: Row, context: Context) {
  const row = objectOf(input);
  onlyFields(row, ["expectedRevision", "expectedVersion", "reviewer", "note"]);
  expectVersion(existing, row);
  if (existing.state !== "draft") invalid("Only a draft can be submitted. Save a new version first if changes were requested.", 409, { currentVersion: existing.version });
  const draft: Row = JSON.parse(JSON.stringify(existing));
  const before = summaryOf(draft);
  const current = requireCurrentEvidence(draft, item, report, context.hash);
  if ("reviewer" in row && row.reviewer != null && row.reviewer !== "") draft.reviewer = textOf(row.reviewer, "reviewer", 200);
  if (!draft.reviewer) invalid("Name the reviewer this draft is routed to");
  if (draft.reviewer.toLowerCase() === String(draft.author).toLowerCase()) invalid("Route the draft to someone other than its author");
  const note = row.note == null || row.note === "" ? null : textOf(row.note, "note", 2000, 10);
  draft.decisions.push({ id: context.id, type: "submitted", version: current.version, contentHash: current.contentHash, evidenceHash: current.evidenceHash, reviewer: draft.reviewer, actor: context.actor, identity: context.trusted ? "verified" : "unverified-local-demo", note, at: context.now });
  draft.state = "submitted";
  draft.updatedAt = context.now;
  return { draft, change: { command: "review-draft-submitted", note, before, after: summaryOf(draft) } };
}

/** Records a reviewer decision bound to the exact content and evidence hashes that were submitted. */
export function decideDraft(existing: Row, input: unknown, item: Row, report: Row, context: Context) {
  const row = objectOf(input);
  onlyFields(row, ["expectedRevision", "expectedVersion", "decision", "reviewer", "note"]);
  expectVersion(existing, row);
  if (!["reviewed", "changes-requested"].includes(row.decision)) invalid("decision must be reviewed or changes-requested");
  if (existing.state !== "submitted") invalid("Only a submitted draft can receive a decision.", 409, { currentVersion: existing.version });
  const draft: Row = JSON.parse(JSON.stringify(existing));
  const before = summaryOf(draft);
  const current = requireCurrentEvidence(draft, item, report, context.hash);
  let reviewer: string;
  if (context.trusted) {
    // A verified identity cannot review its own note.
    if (context.actor === draft.authorActor) invalid("The author of a draft cannot record its review decision", 403);
    reviewer = context.actor;
  } else {
    reviewer = textOf(row.reviewer, "reviewer", 200);
    if (reviewer.toLowerCase() === String(draft.author).toLowerCase()) invalid("The reviewer must be someone other than the author. Names are typed in this local demo and are not verified.");
  }
  const note = textOf(row.note, "note", 2000, 10);
  draft.decisions.push({ id: context.id, type: row.decision, version: current.version, contentHash: current.contentHash, evidenceHash: current.evidenceHash, reviewer, actor: context.actor, identity: context.trusted ? "verified" : "unverified-local-demo", note, at: context.now });
  draft.state = row.decision;
  draft.updatedAt = context.now;
  return { draft, change: { command: "review-draft-decided", note, before, after: summaryOf(draft) } };
}

/**
 * Adds what can only be known now: whether the evidence has changed since the latest
 * version was saved, and which recorded decisions no longer match the current draft.
 */
export function draftView(draft: Row, item: Row, report: Row, hash: Hash) {
  const current = draft.versions[draft.versions.length - 1];
  const stillPresent = current.findingIds.every((id: string) => report.findings.some((finding: Row) => finding.id === id));
  const currentEvidenceHash = stillPresent ? evidenceHash(evidenceSnapshot(item, report, current.findingIds), hash) : null;
  const evidenceChanged = currentEvidenceHash !== current.evidenceHash;
  const decisions = draft.decisions.map((decision: Row) => {
    const staleReasons = [
      ...(decision.contentHash !== current.contentHash ? ["draft-text-changed"] : []),
      ...(decision.evidenceHash !== currentEvidenceHash ? ["evidence-changed"] : []),
    ];
    return { ...decision, stale: staleReasons.length > 0, staleReasons };
  });
  const latestDecision = decisions[decisions.length - 1] ?? null;
  const awaitingOrDecided = draft.state !== "draft";
  return {
    ...draft, decisions,
    title: current.title, text: current.text, findingIds: current.findingIds,
    contentHash: current.contentHash, evidenceHash: current.evidenceHash,
    currentEvidenceHash, evidenceChanged,
    // True when a submission or decision was made against something that has since changed.
    needsFreshReview: awaitingOrDecided && (evidenceChanged || Boolean(latestDecision?.stale)),
    reviewCurrent: draft.state === "reviewed" && !evidenceChanged && latestDecision !== null && !latestDecision.stale,
  };
}

/**
 * Context, Evidence, Checks, Review, Handoff. Each stage reports what is actually
 * recorded and what is still open. No stage produces a percentage or a score.
 */
export function caseJourney(input: { item: Row; report: Row; tasks: Row[]; reviews: Row[]; drafts: Row[]; lastRun: Row | null; lastRunStale: boolean | null }) {
  const { item, report, tasks, drafts, lastRun, lastRunStale } = input;
  const base = `#/cases/${encodeURIComponent(item.id)}`;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const unknownChecks = Object.values(item.applicability).filter(value => value === "unknown").length;
  const gaps = report.findings.filter((finding: Row) => finding.status === "needs-evidence");
  const unverified = item.evidence.filter((entry: Row) => !entry.verified);
  const holds = report.records.filter((record: Row) => record.hold === "active");
  // An active hold is a preservation requirement, not a second unresolved evidence review.
  // Other blocked findings still require follow-up and remain in this list.
  const holdFindings = new Set(holds.map((record: Row) => `${item.id}:record:${record.id}`));
  const unresolved = report.findings.filter((finding: Row) => !["evidence-present", "not-applicable"].includes(finding.status)
    && !(finding.status === "blocked" && holdFindings.has(finding.id)));
  const openTasks = tasks.filter(task => task.status !== "done");
  const overdue = openTasks.filter(task => task.overdue);

  const context: string[] = [];
  if (unknownChecks) context.push(`${count(unknownChecks, "check has", "checks have")} unknown applicability`);
  if (!item.policyBasisConfirmed) context.push("Policy basis is not confirmed");
  if (!item.records.length) context.push("No records are in the inventory");

  const evidence: string[] = [];
  if (gaps.length) evidence.push(`${count(gaps.length, "check has", "checks have")} no evidence reference`);
  if (unverified.length) evidence.push(`${count(unverified.length, "reference is", "references are")} unverified`);

  const checks: string[] = [];
  if (!lastRun) checks.push("No check run has been logged");
  else if (lastRunStale) checks.push("The case changed after the last logged run");
  if (holds.length) checks.push(`${count(holds.length, "record is", "records are")} on an active hold and must stay preserved`);
  if (overdue.length) checks.push(`${count(overdue.length, "follow-up task is", "follow-up tasks are")} overdue`);

  const latest = drafts.length ? [...drafts].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] : null;
  const review: string[] = [];
  let reviewState = "No review note has been prepared";
  if (latest) {
    if (latest.needsFreshReview) { reviewState = "Review is out of date"; review.push("The draft or its evidence changed after it was submitted or reviewed"); }
    else if (latest.state === "reviewed") reviewState = "Review note reviewed";
    else if (latest.state === "submitted") { reviewState = "Waiting for the reviewer"; review.push(`Routed to ${latest.reviewer}`); }
    else if (latest.state === "changes-requested") { reviewState = "Changes requested"; review.push("The reviewer asked for changes"); }
    else { reviewState = "Draft in progress"; review.push("The draft has not been submitted"); }
  }

  const handoff: string[] = [];
  if (unresolved.length) handoff.push(`${count(unresolved.length, "finding is", "findings are")} unresolved and will appear as unresolved in the packet`);
  if (holds.length) handoff.push(`${count(holds.length, "active hold", "active holds")} will appear in the packet`);

  return [
    { id: "context", label: "Context", state: context.length ? "Open items" : "Recorded", responsible: item.owner, outstanding: context,
      nextAction: context.length ? "Edit the case to record applicability and the policy basis." : "No action needed unless the acquisition context changes.", link: `${base}/findings` },
    { id: "evidence", label: "Evidence", state: evidence.length ? "Open items" : item.evidence.length ? "References verified" : "No references", responsible: item.owner, outstanding: evidence,
      nextAction: gaps.length ? "Add a reference for each check that has none." : unverified.length ? "Verify the unverified references after checking them." : "No action needed unless a reference is corrected.", link: `${base}/evidence` },
    { id: "checks", label: "Checks", state: !lastRun ? "Not run" : lastRunStale ? "Run is out of date" : "Run is current", responsible: item.owner, outstanding: checks,
      nextAction: !lastRun || lastRunStale ? "Run checks to log the current findings." : unresolved.length || openTasks.length ? "Follow up on the open findings and tasks." : holds.length ? "Keep the held records preserved. The logged checks are current." : "No action needed unless the case changes.", link: `${base}/findings` },
    { id: "review", label: "Review", state: reviewState, responsible: latest?.reviewer ?? null, outstanding: review,
      nextAction: !latest ? "Prepare a review note from the current findings." : latest.needsFreshReview ? "Save a new version against the current evidence and submit it again." : latest.state === "draft" ? "Submit the draft to a named reviewer." : latest.state === "submitted" ? "The reviewer records a decision." : latest.state === "changes-requested" ? "Revise the draft and submit it again." : "No action needed unless the evidence changes.", link: `${base}/drafts` },
    { id: "handoff", label: "Handoff", state: "Packet available", responsible: item.owner, outstanding: handoff,
      nextAction: "Download the case packet. It is a handoff record, not proof of compliance.", link: `${base}/file` },
  ];
}
