/**
 * Pure logic for traceable citations and human sufficiency assessments.
 *
 * Four things stay separate, and none of them establishes legal compliance:
 *   1. material received        (a stored document)
 *   2. passage linked to a check (a citation: exact quote and location in one document version)
 *   3. reference verified        (the existing evidence "verified" flag)
 *   4. assessed as sufficient    (a reviewer's scoped judgment about one finding)
 *
 * An assessment never changes a finding, applicability, a hold, a task, or retention.
 * History is append-only. This file imports nothing; a hash function, the current
 * report, the policy context, and the document state are passed in.
 */

export type Row = Record<string, any>;
export type Hash = (text: string) => string;
export const outcomes = ["sufficient-for-stated-check", "insufficient", "needs-clarification"];
export const freshnessStates = ["current", "needs-review", "cannot-establish"];
export const citationChecks = ["valid", "document-changed", "extraction-changed", "document-missing", "not-checked"];

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function noteOf(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length < 10 || value.length > 2000) invalid(`${name} must be 10 to 2000 characters`);
  return (value as string).trim();
}

function onlyFields(row: Row, allowed: string[]) {
  for (const key of Object.keys(row)) if (!allowed.includes(key)) invalid(`Unsupported field: ${key.slice(0, 40)}`);
}

/** The finding must belong to this case. Evidence-backed checks are the only findings that take citations. */
function findingOf(report: Row, findingId: unknown): Row {
  const finding = typeof findingId === "string" ? report.findings.find((entry: Row) => entry.id === findingId) : null;
  if (!finding) invalid("That finding is not in this case", 404);
  return finding;
}

function checkKindOf(item: Row, finding: Row): string | null {
  const prefix = `${item.id}:`;
  const kind = finding.id.startsWith(prefix) ? finding.id.slice(prefix.length) : "";
  return finding.category === "contracting" && Object.prototype.hasOwnProperty.call(item.applicability ?? {}, kind) ? kind : null;
}

/** What a correction changes. Verification is deliberately left out: it is a separate fact. */
export function evidenceHash(evidence: Row, hash: Hash): string {
  return hash(JSON.stringify([evidence.id, evidence.kind, evidence.title, evidence.locator]));
}

/** Citations that have not been replaced by a later one. */
export function activeCitations(item: Row): Row[] {
  const all: Row[] = item.citations ?? [];
  const replaced = new Set(all.map(citation => citation.replaces).filter(Boolean));
  return all.filter(citation => !replaced.has(citation.id));
}

/**
 * Builds a citation from a request and the stored document span.
 * `stored` is what the document service holds right now: the document's case, digest,
 * extraction time, and the span text. Nothing is trusted from the request except the choice.
 */
export function newCitation(input: unknown, item: Row, report: Row, stored: Row, context: { id: string; now: string; actor: string; trusted: boolean; hash: Hash }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Expected a JSON object");
  const row = input as Row;
  onlyFields(row, ["expectedRevision", "note", "findingId", "evidenceId", "documentId", "sha256", "spanId", "quote", "replaces"]);
  const note = noteOf(row.note, "note");
  const finding = findingOf(report, row.findingId);
  const kind = checkKindOf(item, finding);
  if (!kind) invalid("Passages can be linked only to evidence checks");
  const evidence = (item.evidence ?? []).find((entry: Row) => entry.id === row.evidenceId);
  if (!evidence) invalid("That evidence reference is not in this case", 404);
  if (evidence.kind !== kind) invalid("That evidence reference supports a different check");
  if (stored.caseId !== item.id) invalid("That document belongs to a different case", 404);
  if (stored.status !== "ready" || !stored.span) invalid("The document has no extracted text for that span", 409);
  // The reviewer names the document version they were looking at. A different stored version is refused, not adopted.
  if (typeof row.sha256 !== "string" || row.sha256 !== stored.sha256) invalid("The stored document is not the version this citation was prepared against. Reload the document and try again.", 409);
  if (typeof row.quote !== "string" || row.quote.length < 3 || row.quote.length > 2000) invalid("Quote 3 to 2000 characters from the passage");
  const first = stored.span.text.indexOf(row.quote);
  if (first < 0) invalid("The quoted passage does not match the stored text of that span");
  if (stored.span.text.indexOf(row.quote, first + 1) >= 0) invalid("The quoted passage appears more than once in that span. Quote a longer passage so its location is exact.");
  const all: Row[] = item.citations ?? [];
  let replaces: string | null = null;
  if (row.replaces !== undefined) {
    const earlier = activeCitations(item).find(citation => citation.id === row.replaces);
    if (!earlier) invalid("The citation being corrected is not a current citation of this case", 404);
    if (earlier.findingId !== finding.id || earlier.evidenceId !== evidence.id) invalid("A correction must stay on the same finding and evidence reference");
    replaces = earlier.id;
  }
  const startOffset = stored.span.startOffset + first;
  const before = stored.span.text.slice(0, first);
  const startLine = stored.span.startLine + (before.match(/\n/g) ?? []).length;
  const endLine = startLine + (row.quote.match(/\n/g) ?? []).length;
  if (all.some(citation => citation.id === context.id)) invalid("Citation ID is already in use", 409);
  return {
    id: context.id, caseId: item.id, findingId: finding.id, evidenceId: evidence.id,
    documentId: stored.documentId, sha256: stored.sha256,
    extraction: { extractedAt: stored.extractedAt ?? null, spanCount: stored.spanCount ?? null },
    // Offsets are UTF-16 code units into the stored, line-ending-normalized text. Plain text has no page numbers.
    location: { spanId: stored.span.id, startOffset, endOffset: startOffset + row.quote.length, startLine, endLine },
    quote: row.quote, quoteHash: context.hash(row.quote),
    createdAt: context.now, actor: context.actor, identity: context.trusted ? "verified" : "unverified-local-demo",
    note, replaces,
  };
}

/** Whether a stored citation still matches the document the service holds. `documents` is null when the service could not be asked. */
export function checkCitation(citation: Row, documents: Row[] | null) {
  if (!documents) return { status: "not-checked", message: "The document service did not answer, so the passage could not be checked against the stored document." };
  const document = documents.find(entry => entry.id === citation.documentId);
  if (!document) return { status: "document-missing", message: "The cited document is no longer held by the document service." };
  if (document.sha256 !== citation.sha256) return { status: "document-changed", message: "The stored document's content digest differs from the version that was cited." };
  if ((document.extractedAt ?? null) !== (citation.extraction?.extractedAt ?? null)) return { status: "extraction-changed", message: "The document was extracted again after this citation was made, so its location may no longer hold." };
  return { status: "valid", message: "The cited document version and extraction are the ones held now." };
}

/** Policies behind one finding: the ones its sources belong to. Only these can make its assessment stale. */
function policyEntriesFor(finding: Row, policy: Row, sources: Row[]): Row[] {
  const versionIds = (finding.sourceIds ?? []).map((id: string) => sources.find(source => source.id === id)?.policyVersionId).filter(Boolean);
  return (policy.entries ?? [])
    .filter((entry: Row) => entry.citedVersionIds.some((id: string) => versionIds.includes(id)))
    .map((entry: Row) => ({ policyId: entry.policyId, status: entry.status, reviewedVersionId: entry.reviewedVersionId, inEffectVersionIds: entry.inEffectVersionIds }));
}

/** Records an assessment with an exact snapshot of what was considered. */
export function newAssessment(input: unknown, item: Row, report: Row, policy: Row, sources: Row[], context: { id: string; now: string; actor: string; trusted: boolean; hash: Hash; asOf: string }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Expected a JSON object");
  const row = input as Row;
  onlyFields(row, ["expectedRevision", "findingId", "evidenceIds", "outcome", "rationale"]);
  const finding = findingOf(report, row.findingId);
  const kind = checkKindOf(item, finding);
  if (!kind) invalid("Sufficiency is assessed only for evidence checks");
  if (!outcomes.includes(row.outcome)) invalid(`outcome must be one of: ${outcomes.join(", ")}`);
  const rationale = noteOf(row.rationale, "rationale");
  if (!Array.isArray(row.evidenceIds) || row.evidenceIds.length > 50 || new Set(row.evidenceIds).size !== row.evidenceIds.length) invalid("evidenceIds must be a list without repeats");
  if (row.outcome === "sufficient-for-stated-check" && row.evidenceIds.length === 0) invalid("Select the evidence that was assessed as sufficient");
  const evidence = row.evidenceIds.map((id: unknown) => {
    const entry = (item.evidence ?? []).find((candidate: Row) => candidate.id === id);
    if (!entry) invalid("An evidence reference is not in this case", 404);
    if (!finding.evidenceIds.includes(entry.id)) invalid("An evidence reference does not support this finding");
    return entry;
  });
  const citations = activeCitations(item).filter(citation => citation.findingId === finding.id && row.evidenceIds.includes(citation.evidenceId));
  const snapshot = {
    caseRevision: item.revision ?? 0, asOf: context.asOf, ruleVersion: report.ruleVersion,
    // The check's applicability is part of what was assessed. Its status is recorded for the reader only:
    // verification can change a status on its own, so status is never compared for freshness.
    finding: { id: finding.id, title: finding.title, status: finding.status, applicability: item.applicability[kind as string] },
    evidence: evidence.map((entry: Row) => ({ id: entry.id, kind: entry.kind, title: entry.title, locator: entry.locator, verified: entry.verified === true, hash: evidenceHash(entry, context.hash) })),
    citations: citations.map(citation => ({ id: citation.id, evidenceId: citation.evidenceId, documentId: citation.documentId, sha256: citation.sha256, extractedAt: citation.extraction?.extractedAt ?? null, location: citation.location, quoteHash: citation.quoteHash })),
    policy: policyEntriesFor(finding, policy, sources),
  };
  return {
    id: context.id, caseId: item.id, findingId: finding.id, outcome: row.outcome, rationale,
    evidenceIds: evidence.map((entry: Row) => entry.id),
    snapshot, snapshotHash: context.hash(JSON.stringify(snapshot)),
    at: context.now, actor: context.actor, identity: context.trusted ? "verified" : "unverified-local-demo",
    synthetic: item.provenance === "synthetic",
  };
}

/**
 * Whether an assessment still describes what is stored now, with the specific causes when it does not.
 * Only the evidence, citations, and policies in its own snapshot are compared, so unrelated assessments are untouched.
 */
export function assessmentFreshness(assessment: Row, item: Row, report: Row, policy: Row, sources: Row[], documents: Row[] | null, hash: Hash) {
  if (!assessment.snapshot) {
    return { state: "cannot-establish", causes: [{ code: "no-snapshot", message: "This assessment was recorded without a snapshot, so there is no baseline to compare against." }] };
  }
  const causes: Row[] = [];
  const snapshot = assessment.snapshot;
  for (const before of snapshot.evidence) {
    const now = (item.evidence ?? []).find((entry: Row) => entry.id === before.id);
    if (!now) causes.push({ code: "evidence-removed", evidenceId: before.id, message: `Evidence reference "${before.title}" is no longer on the case.` });
    else if (evidenceHash(now, hash) !== before.hash) causes.push({ code: "evidence-corrected", evidenceId: before.id, message: `Evidence reference "${before.title}" was corrected after this assessment.` });
  }
  const current = activeCitations(item).filter(citation => citation.findingId === assessment.findingId && assessment.evidenceIds.includes(citation.evidenceId));
  for (const before of snapshot.citations) {
    if (!current.some(citation => citation.id === before.id)) causes.push({ code: "citation-replaced", citationId: before.id, message: "A cited passage was corrected or replaced after this assessment." });
  }
  for (const citation of current) {
    if (!snapshot.citations.some((before: Row) => before.id === citation.id) && !citation.replaces) causes.push({ code: "citation-added", citationId: citation.id, message: "A passage was linked to this evidence after this assessment." });
  }
  let unchecked = false;
  for (const before of snapshot.citations) {
    const stored = (item.citations ?? []).find((citation: Row) => citation.id === before.id);
    if (!stored) continue;
    const check = checkCitation(stored, documents);
    if (check.status === "not-checked") unchecked = true;
    else if (check.status === "document-changed") causes.push({ code: "document-changed", citationId: before.id, documentId: before.documentId, message: check.message });
    else if (check.status !== "valid") causes.push({ code: "citation-invalid", citationId: before.id, documentId: before.documentId, message: check.message });
  }
  const finding = report.findings.find((entry: Row) => entry.id === assessment.findingId);
  // The scope of the check: was it decided to apply, not apply, or left unknown, and is that still so?
  const kind = finding ? checkKindOf(item, finding) : null;
  const applicabilityThen = snapshot.finding?.applicability;
  const applicabilityNow = kind ? item.applicability[kind] : undefined;
  let noApplicabilityBaseline = false;
  if (!kind) causes.push({ code: "check-removed", message: "The check this assessment was recorded for is no longer part of the case." });
  else if (applicabilityThen === undefined) noApplicabilityBaseline = true;
  else if (applicabilityNow !== applicabilityThen) causes.push({ code: "applicability-changed", from: applicabilityThen, to: applicabilityNow, message: `The check's applicability changed from "${applicabilityThen}" to "${applicabilityNow}" after this assessment.` });
  const policyNow = finding ? policyEntriesFor(finding, policy, sources) : [];
  for (const before of snapshot.policy ?? []) {
    const now = policyNow.find(entry => entry.policyId === before.policyId);
    if (!now) continue;
    if (now.status === "requires-reassessment" && before.status !== "requires-reassessment") causes.push({ code: "policy-requires-reassessment", policyId: before.policyId, message: "The policy decision this assessment relied on now requires reassessment." });
    else if (now.status !== before.status || now.reviewedVersionId !== before.reviewedVersionId) causes.push({ code: "policy-context-changed", policyId: before.policyId, message: "The recorded policy decision for this check changed after this assessment." });
    else if (JSON.stringify(now.inEffectVersionIds) !== JSON.stringify(before.inEffectVersionIds)) causes.push({ code: "policy-context-changed", policyId: before.policyId, message: "A different policy version is in effect than when this assessment was recorded." });
  }
  if (causes.length > 0) return { state: "needs-review", causes };
  // An older snapshot did not record applicability. No baseline is invented for it.
  if (noApplicabilityBaseline) return { state: "cannot-establish", causes: [{ code: "no-applicability-baseline", message: "This assessment's snapshot does not record the check's applicability, so a later change to it cannot be ruled out. Nothing else has changed." }] };
  if (unchecked) return { state: "cannot-establish", causes: [{ code: "documents-unavailable", message: "The document service did not answer, so the cited passages could not be checked. Nothing else has changed." }] };
  return { state: "current", causes: [] };
}

/** The review picture for one case: per evidence check, its evidence, passages, and assessments. */
export function evidenceReview(item: Row, report: Row, policy: Row, sources: Row[], documents: Row[] | null, hash: Hash) {
  const active = activeCitations(item);
  const findings = report.findings.filter((finding: Row) => checkKindOf(item, finding)).map((finding: Row) => {
    const evidence = (item.evidence ?? []).filter((entry: Row) => finding.evidenceIds.includes(entry.id)).map((entry: Row) => {
      const citations = (item.citations ?? []).filter((citation: Row) => citation.findingId === finding.id && citation.evidenceId === entry.id)
        .map((citation: Row) => ({ ...citation, state: active.includes(citation) ? "active" : "replaced", check: checkCitation(citation, documents) }));
      return {
        id: entry.id, kind: entry.kind, title: entry.title, locator: entry.locator, verified: entry.verified === true,
        // A reference with no passage is still valid evidence. It simply has nothing quoted behind it.
        passage: citations.some((citation: Row) => citation.state === "active") ? "attached" : "none",
        citations,
      };
    });
    const assessments = (item.assessments ?? []).filter((assessment: Row) => assessment.findingId === finding.id)
      .map((assessment: Row) => ({ ...assessment, freshness: assessmentFreshness(assessment, item, report, policy, sources, documents, hash) }));
    return { findingId: finding.id, title: finding.title, status: finding.status, evidence, currentAssessment: assessments[assessments.length - 1] ?? null, assessments };
  });
  return { caseId: item.id, caseRevision: item.revision ?? 0, findings };
}
