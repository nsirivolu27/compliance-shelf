/**
 * Pure logic for policy versions and per-case policy context.
 *
 * A citation alone does not establish that a requirement applies to a case.
 * This file keeps three things apart:
 *   - retrieval: an official source was fetched on a date (checkedOn)
 *   - review status of our reading of that source (reviewStatus)
 *   - a per-case applicability decision recorded by a named reviewer
 * Nothing here resolves a finding, releases a hold, or scores a case.
 * This file imports nothing; the source registry is passed in.
 */

export type Row = Record<string, any>;
export type PolicyStatus = "confirmed" | "unresolved" | "requires-reassessment";
export const policyStatuses: PolicyStatus[] = ["confirmed", "unresolved", "requires-reassessment"];
export const reviewStatuses = ["retrieved-not-reviewed", "qualified-review-recorded"];
export const decisionValues = ["confirmed", "unresolved"];

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

/** Groups the source registry into policies and their versions. Version metadata lives on one source per version. */
export function policyRegistry(sources: Row[]) {
  const versions: Row[] = [];
  for (const source of sources) {
    if (!source.policyVersion) continue;
    const linked = sources.filter(other => other.policyVersionId === source.policyVersion.versionId);
    versions.push({
      ...source.policyVersion,
      sources: linked.map(other => ({ id: other.id, title: other.title, url: other.url, locator: other.locator, retrievedOn: other.checkedOn })),
    });
  }
  const policies: Row[] = [];
  for (const version of versions) {
    let policy = policies.find(existing => existing.policyId === version.policyId);
    if (!policy) { policy = { policyId: version.policyId, title: version.policyTitle, versions: [] }; policies.push(policy); }
    policy.versions.push(version);
  }
  return { policies, versions };
}

/**
 * Versions of the same policy that are in effect on the screening date and came after the given one:
 * they name it in deviatesFrom or supersedes, or both effective dates are known and theirs is later.
 * A version with no known effective date is never treated as "later".
 */
export function laterVersions(version: Row, versions: Row[], asOf: string): Row[] {
  return versions.filter(other => {
    if (other.versionId === version.versionId || other.policyId !== version.policyId) return false;
    if (!other.effectiveOn || other.effectiveOn > asOf) return false;
    const namesIt = [...(other.deviatesFrom ?? []), ...(other.supersedes ?? [])].includes(version.versionId);
    return namesIt || Boolean(version.effectiveOn && other.effectiveOn > version.effectiveOn);
  });
}

/** Policy versions the case's checks cite, through the source IDs on its findings. */
export function versionIdsCitedBy(report: Row, sources: Row[]): string[] {
  const cited = new Set<string>();
  for (const finding of report.findings) {
    for (const sourceId of finding.sourceIds ?? []) {
      const source = sources.find(entry => entry.id === sourceId);
      if (source?.policyVersionId) cited.add(source.policyVersionId);
    }
  }
  return [...cited];
}

/** Validates a policy review and returns the record to append. History is never edited. */
export function newPolicyReview(input: unknown, item: Row, sources: Row[], context: { id: string; now: string; actor: string; trusted: boolean }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Expected a JSON object");
  const row = input as Row;
  for (const key of Object.keys(row)) if (!["expectedRevision", "note", "reviewer", "decisions"].includes(key)) invalid("Unsupported field");
  if (typeof row.note !== "string" || row.note.trim().length < 10 || row.note.length > 2000) invalid("Provide a note of 10 to 2000 characters");
  if (typeof row.reviewer !== "string" || !row.reviewer.trim() || row.reviewer.length > 200) invalid("Name the reviewer in 1 to 200 characters");
  if (!Array.isArray(row.decisions) || row.decisions.length < 1 || row.decisions.length > 20) invalid("Provide 1 to 20 decisions");
  const { versions } = policyRegistry(sources);
  const decisions: Row[] = [];
  for (const entry of row.decisions) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) invalid("Each decision must be an object");
    for (const key of Object.keys(entry)) if (!["versionId", "applicability", "basis"].includes(key)) invalid("Unsupported decision field");
    const version = versions.find(candidate => candidate.versionId === entry.versionId);
    if (!version) invalid("A decision names a policy version that is not in the registry", 404);
    if (!decisionValues.includes(entry.applicability)) invalid("applicability must be confirmed or unresolved");
    if (typeof entry.basis !== "string" || entry.basis.trim().length < 10 || entry.basis.length > 2000) invalid("Give each decision a basis of 10 to 2000 characters");
    if (decisions.some(existing => existing.policyId === version.policyId)) invalid("Give one decision per policy");
    decisions.push({ policyId: version.policyId, versionId: version.versionId, applicability: entry.applicability, basis: entry.basis.trim() });
  }
  return {
    id: context.id, caseId: item.id, at: context.now, caseRevision: item.revision ?? 0,
    reviewer: row.reviewer.trim(), actor: context.actor,
    // A typed name in the local demo is not an authenticated person, and never a real agency approval.
    identity: context.trusted ? "verified" : "unverified-local-demo",
    synthetic: item.provenance === "synthetic",
    decisions, note: row.note.trim(),
  };
}

/**
 * The policy picture for one case on a screening date.
 * Unknown stays unknown: a policy with no recorded decision is "unresolved".
 * A confirmed decision is never rewritten. When a later version is in effect,
 * the entry reads "requires-reassessment" and still points at the earlier review.
 */
export function policyContext(item: Row, report: Row, sources: Row[], asOf: string) {
  const { policies, versions } = policyRegistry(sources);
  const reviews: Row[] = item.policyReviews ?? [];
  const citedVersionIds = versionIdsCitedBy(report, sources);
  const decidedVersionIds = reviews.flatMap(review => review.decisions.map((decision: Row) => decision.versionId));
  const relevantPolicyIds = new Set<string>();
  for (const versionId of [...citedVersionIds, ...decidedVersionIds]) {
    const version = versions.find(candidate => candidate.versionId === versionId);
    if (version) relevantPolicyIds.add(version.policyId);
  }

  const entries = policies.filter(policy => relevantPolicyIds.has(policy.policyId)).map(policy => {
    // The latest decision for this policy, if any. Reviews are stored oldest first.
    let latest: { review: Row; decision: Row } | null = null;
    for (const review of reviews) {
      const decision = review.decisions.find((candidate: Row) => candidate.policyId === policy.policyId);
      if (decision) latest = { review, decision };
    }
    const inEffect = policy.versions.filter((version: Row) => version.effectiveOn && version.effectiveOn <= asOf);
    const reviewed = latest ? policy.versions.find((version: Row) => version.versionId === latest!.decision.versionId) ?? null : null;
    const later = reviewed ? laterVersions(reviewed, policy.versions, asOf) : [];
    let status: PolicyStatus = "unresolved";
    let reason = "No applicability decision has been recorded for this policy on this case.";
    if (latest && latest.decision.applicability === "unresolved") {
      reason = "The latest recorded decision left applicability unresolved.";
    } else if (latest && later.length > 0) {
      status = "requires-reassessment";
      reason = "A later version of this policy is in effect on the screening date. The earlier review is kept and needs a fresh decision.";
    } else if (latest) {
      status = "confirmed";
      reason = "A reviewer recorded that this version applies, and no later version is in effect on the screening date.";
    }
    return {
      policyId: policy.policyId, title: policy.title, status, reason,
      citedVersionIds: policy.versions.map((version: Row) => version.versionId).filter((id: string) => citedVersionIds.includes(id)),
      inEffectVersionIds: inEffect.map((version: Row) => version.versionId),
      effectiveDateUnknownVersionIds: policy.versions.filter((version: Row) => !version.effectiveOn).map((version: Row) => version.versionId),
      reviewedVersionId: latest ? latest.decision.versionId : null,
      reviewId: latest ? latest.review.id : null,
      reviewedAt: latest ? latest.review.at : null,
      laterVersionIds: later.map((version: Row) => version.versionId),
      unresolvedQuestions: [...new Set(policy.versions.filter((version: Row) => citedVersionIds.includes(version.versionId) || inEffect.includes(version)).flatMap((version: Row) => version.unresolvedQuestions ?? []))],
    };
  });

  const count = (status: PolicyStatus) => entries.filter(entry => entry.status === status).length;
  return {
    caseId: item.id, asOf, caseRevision: item.revision ?? 0,
    consideredVersionIds: [...new Set([...citedVersionIds, ...entries.flatMap(entry => entry.inEffectVersionIds)])],
    entries,
    counts: { confirmed: count("confirmed"), unresolved: count("unresolved"), requiresReassessment: count("requires-reassessment") },
    reviews,
  };
}

/** Cases with at least one policy entry that requires reassessment. Nothing is changed by asking. */
export function reassessmentQueue(cases: Row[], reports: Row[], sources: Row[], asOf: string) {
  const affected: Row[] = [];
  for (const item of cases) {
    const report = reports.find(candidate => candidate.caseId === item.id);
    if (!report) continue;
    const context = policyContext(item, report, sources, asOf);
    const entries = context.entries.filter(entry => entry.status === "requires-reassessment");
    if (entries.length > 0) affected.push({ caseId: item.id, title: item.title, owner: item.owner, caseRevision: item.revision ?? 0, entries });
  }
  return affected;
}
