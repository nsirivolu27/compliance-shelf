/**
 * The audit team report for one case: what a reviewer has recorded and what is still open.
 * It lists lines and counts them. It gives no rate and no verdict, and it changes nothing.
 * A gap is listed as confirmed only while a reviewer's confirmation still describes it.
 * Gaps nobody has decided are "candidates" and stay out unless the reader asks for them.
 * This file imports nothing. The case and its computed parts are passed in.
 */

export type Row = Record<string, any>;
export type AuditInput = { item: Row; score: Row; gaps: Row[]; findings: Row[]; paperwork: Row[] };

/** Documentation-gap rules that describe a recorded sufficiency assessment that still needs attention. */
export const pendingRules = ["assessment-not-sufficient", "assessment-needs-review", "assessment-freshness-unknown"];

const gapLine = (gap: Row) => ({ id: gap.id, ruleId: gap.ruleId, title: gap.title, detail: gap.detail, toClear: gap.toClear, subjectType: gap.subjectType, subjectId: gap.subjectId, subjectTitle: gap.subjectTitle, section: gap.section });

const paperworkLine = (view: Row) => ({
  id: view.id, paperworkId: view.paperworkId, title: view.entry?.title ?? "No longer in the catalog", formNumber: view.entry?.formNumber ?? null,
  status: view.status, dueDate: view.dueDate ?? null, reference: view.reference ?? null, recordTitle: view.recordTitle ?? null,
  readinessState: view.readiness.state, readiness: view.readiness.summary, attention: view.readiness.attention ?? null,
});

export function auditCaseSection(input: AuditInput, options: { asOf: string; includeCandidates: boolean }) {
  const { item, score, gaps, findings, paperwork } = input;

  // Confirmed by a reviewer, and the confirmation still matches the gap as it is now.
  const confirmedGaps = gaps.filter(gap => gap.status === "confirmed").map(gap => ({
    ...gapLine(gap), decision: { note: gap.decision.note, at: gap.decision.at, actor: gap.decision.actor, identity: gap.decision.identity },
  }));
  // Screening results that still need evidence or review. A record blocked by a hold is listed under holds instead.
  const unresolvedFindings = findings.filter(finding => finding.status === "needs-evidence" || finding.status === "needs-review").map(finding => ({
    id: finding.id, category: finding.category, status: finding.status, title: finding.title, explanation: finding.explanation, nextAction: finding.nextAction,
    evidenceIds: finding.evidenceIds ?? [], sourceIds: finding.sourceIds ?? [],
    // The references on file for this check, so the reader can see what was supplied and whether it was verified.
    evidence: (item.evidence ?? []).filter((entry: Row) => (finding.evidenceIds ?? []).includes(entry.id)).map((entry: Row) => ({ id: entry.id, title: entry.title, locator: entry.locator, verified: entry.verified === true })),
  }));
  const activeHolds = (item.records ?? []).filter((record: Row) => record.hold === "active").map((record: Row) => ({
    recordId: record.id, title: record.title, owner: record.owner ?? null,
    reference: record.holdReview?.reference ?? null, note: record.holdReview?.note ?? null, reviewedAt: record.holdReview?.reviewedAt ?? null, actor: record.holdReview?.actor ?? null,
  }));
  // Overdue: a stored due date has passed and no one has recorded that the agency filed it.
  const overduePaperwork = paperwork.filter(view => view.readiness.overdue).map(paperworkLine);
  const openPaperwork = paperwork.filter(view => !view.readiness.overdue && view.status !== "filed-by-agency").map(paperworkLine);
  const candidates = gaps.filter(gap => gap.status === "open").map(gapLine);
  // A sufficiency problem a reviewer recorded but has not yet confirmed as a gap. It is listed by default, marked as pending,
  // so it can never vanish between "reference verified" and "gap confirmed". Confirming or dismissing it moves it out of here.
  const pendingReviewIssues = gaps.filter(gap => gap.status === "open" && pendingRules.includes(gap.ruleId)).map(gap => {
    const assessment = (item.assessments ?? []).filter((entry: Row) => entry.findingId === `${item.id}:${gap.subjectId}`).at(-1) ?? null;
    return {
      ...gapLine(gap), status: "pending-confirmation",
      assessment: assessment ? { id: assessment.id, outcome: assessment.outcome, rationale: assessment.rationale, at: assessment.at, actor: assessment.actor } : null,
    };
  });

  const counts: Row = { confirmedGaps: confirmedGaps.length, pendingReviewIssues: pendingReviewIssues.length, unresolvedFindings: unresolvedFindings.length, activeHolds: activeHolds.length, overduePaperwork: overduePaperwork.length, openPaperwork: openPaperwork.length };
  const lines = Object.values(counts).reduce((sum: number, value) => sum + (value as number), 0);
  if (options.includeCandidates) counts.candidates = candidates.length;

  return {
    caseId: item.id, caseTitle: item.title, organization: item.agency ?? null, businessUnit: item.businessUnit ?? null, recordFamily: item.recordFamily ?? null, caseRevision: item.revision ?? 0,
    completeness: { label: score.label, complete: score.complete, countable: score.countable, percent: score.percent },
    confirmedGaps, pendingReviewIssues, unresolvedFindings, activeHolds, overduePaperwork, openPaperwork,
    ...(options.includeCandidates ? { candidates } : {}),
    counts, nothingRecorded: lines === 0,
    statement: lines === 0
      ? `Nothing is recorded for this case under any section as of ${options.asOf}. That describes what is on file here. It is not a finding that the case is in order.`
      : `${lines} line${lines === 1 ? " is" : "s are"} recorded for this case as of ${options.asOf}.`,
  };
}

/** Adds up the line counts across cases. Counts of lines only. */
export function auditTotals(sections: Row[]) {
  const sum = (key: string) => sections.reduce((total, section) => total + (section.counts[key] ?? 0), 0);
  const totals: Row = { cases: sections.length, confirmedGaps: sum("confirmedGaps"), pendingReviewIssues: sum("pendingReviewIssues"), unresolvedFindings: sum("unresolvedFindings"), activeHolds: sum("activeHolds"), overduePaperwork: sum("overduePaperwork"), openPaperwork: sum("openPaperwork") };
  if (sections.some(section => "candidates" in section.counts)) totals.candidates = sum("candidates");
  return totals;
}
