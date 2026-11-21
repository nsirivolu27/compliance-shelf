# Product brief

## Problem and audience

Records staff, development teams, reviewers, and auditors inside an agency need to see which evidence supports a records, delivery, or audit expectation, which checks still need evidence, who must review them, and what must be preserved. Today that trail is usually spread across email, tickets, and spreadsheets.

**Promise:** move from a question about a case to a source-linked, reviewable evidence packet in one workspace.

The product is an internal evidence and review workspace. It supports agency work. It is not a regulator, a certification authority, or an audit opinion, and it does not decide compliance, eligibility, tax treatment, or retention.

## Scope today

The starting agencies are the Department of Veterans Affairs (VA) and the Social Security Administration (SSA). Everything runs on synthetic cases.

Record families with a shipped example:

- **Contracting (VA, built-in example).** Contract file screening with records inventory, schedule, and holds.
- **System delivery (VA and SSA example presets).** A review aid for one release of one made-up system: requirements, design, change approval, test, release, and security and privacy plan evidence.
- **General public sector records (example preset).** A starting point for documenting and scheduling records in any public sector office: inventory, custodian, schedule reference, and hold review evidence, with three expected record types drawn from two government-wide schedules.
- **Benefit statement review (SSA example preset).** One check: is a benefit statement expected for a made-up beneficiary-year, and is a reference on file. Applicability is a reviewer's decision. Nothing calculates tax.

Tax records are one family among several. Benefits intake now has seven synthetic worksheet examples: SSA disability, SSI, retirement, spouse survivors; VA compensation, Veterans Pension and survivors. The worksheets organize reader candidates and reviewer follow-up, not claim adjudication. Other benefits, health records, personnel, payroll, and vendor tax reporting are not covered. Patient clinical compliance, cybersecurity certification, and legal determinations are outside the product.

An example preset is a configurable review aid. It is not a list of artifacts every release must produce and not a statement that any schedule or rule applies to a case. A missing artifact never makes a check not applicable: a relevant check with no evidence reads "needs evidence", a check a reviewer places outside scope with a rationale reads "not applicable", and an undecided check stays "needs review".

## Shipped capabilities

- Workspace check profile, four example presets, and custom profile loading. Selecting a preset only fills the editor; loading needs an explicit submit with a note; creating a case is a separate action.
- Case-specific checks and sources. A case keeps the checks and sources it was created with through any later profile change, reset, or restart.
- Applicability per check (yes, no, unknown), evidence references, explicit verification, document intake for plain text, Markdown, and JSON, passage citations, and sufficiency assessments that flag later change.
- Policy versions and per-case policy context for the built-in sources.
- Record inventory, confirmed final-payment schedules, and holds. An active hold always blocks. Nothing permits destruction.
- Documentation completeness: a percent with the counts behind it, per case and for the workspace. It counts verified, currently sufficient evidence for checks that apply, and an owner, confirmed schedule, and decided hold status for records. Undecided checks are left out and shown beside it. With nothing to count there is no percent.
- Gap register: documentation gaps found by fixed rules across all cases, each with what was found and what would clear it. A reviewer can confirm or dismiss a gap with a note; that changes nothing else.
- Expected record types on a check set, so a record type that should be listed and is not shows up as a gap.
- Planning: dated documentation needs from stored task due dates, record review dates, period end dates, and paperwork due dates a person entered. Dates only.
- Agency paperwork: a catalog of 24 forms and reports, each marked as read on an agency page or not confirmed. A case tracks the items it needs. The SF 135 transmittal, NA Form 13001 disposal notice, corrective action entry and seven benefits intake worksheets count facts on file. Benefits worksheets count internal intake fields, not official application completeness. Existing record/hold protections remain in place. Status is set by people, and recording that the agency filed something needs a reference. A draft worksheet can be printed. Nothing is submitted.
- Benefits intake: a searchable SSA/VA directory grouped by example intake teams, with official form links, purpose, tracked worksheets and missing-field counts. Teams are descriptive examples, not permissions or official agency organization. A person chooses the case and form; there is no automatic program assignment, need ranking, eligibility test, benefit amount, individual award or payment. Seven hand-authored reader samples exercise acceptance into the existing audited paperwork workflow. PDF/image OCR is not connected. Existing cases and checks are not migrated by adding paperwork.
- Funding (FUNDING-001): synthetic VA and SSA program and project budgets with allocation requests that move through Draft, Proposed, Approved, Rejected and Reversed by explicit, recorded decisions. Totals are money in whole cents: available funds, proposed allocations (shown apart; they never consume funds), approved allocations, and remaining budget, per agency and fiscal year and never combined across agencies. The server refuses an approval that would exceed the remaining budget, including two sent at once. An approved amount changes only through a recorded reversal and a replacement request, and the history keeps every decision with its before and after values, rationale, actor and time. A request cites a case's documents and assessments, and what is missing stays listed. Decisions are simulated: no government payment is sent, no Treasury, VA or SSA financial system is connected, and no individual benefit eligibility is decided.
- Reader output intake: saved output from Amazon Textract, run by a person on a synthetic document, is imported and becomes candidate fields. A reviewer accepts a candidate for one fact or rejects it. The application calls no reading service. The shipped sample is labelled as a sample that the service did not produce.
- Audit team report: a read only compilation of gaps a reviewer confirmed, screening results still open, active holds, and paperwork that is open or past an entered due date, with a digest. It counts lines and gives no rate or verdict.
- Follow-up tasks, review notes and drafts, activity history, a case packet with a digest, and a deterministic guided assistant.

## Proposed, not built

These are designed in `docs/collaboration/research/` and are not part of the product today:

- Descriptive record status with rationale and history; independent schedule references; editable period, project, system, and release fields.
- Evidence requests with rejection reasons and resubmission versions; recorded exceptions.
- Control design and operating effectiveness tests with a period, population, and selection.
- Authored audit observations, management responses, retests, and explicit closure.
- Retention triggers other than final payment; source version and status for profile sources.
- A compliance measure built from reviewer determinations (designed in `docs/collaboration/AUDIT-001_DESIGN.md`, awaiting a rule decision). The audit team report shows no rate today.
- A live adapter that calls a document reading service, Bedrock Data Automation blueprints, and any AWS deployment. The AWS package is a template.
- Tax record flags. The user has chosen the wording "suspected fraud" for that later feature; it is not built, and no current feature labels anything fraud.
- Financial planning beyond the shipped synthetic funding workflow. The separate Planning view shows entered dates only.
- Identity, roles, separation of duties, isolation between organizations, and approved storage.

A sufficiency assessment says the evidence is enough for one check on one case. It is not a conclusion about control design or operating effectiveness.

## Demo loop

1. On Check profile, choose an example preset, review it, and load it with a note.
2. Create a synthetic case. Every check starts undecided.
3. Decide applicability with a rationale.
4. Add and verify an evidence reference; optionally take in a synthetic text document and link a passage.
5. Record a sufficiency assessment. Change the evidence or applicability and see the assessment flagged.
6. Switch profiles and confirm the earlier case still shows its own checks and sources.
7. Export the case packet.

Public award exploration is separate. It shows real public award data and never attaches synthetic findings to a real vendor or award.

## Information model

`ComplianceCase` owns applicability decisions, references, record inventory, and, when created under a profile, its own check set and sources plus optional `businessUnit` and `recordFamily`. A `Finding` has a stable ID, status, explanation, source IDs, evidence IDs, and next action. Evidence checks carry the internal category `contracting` on every case because citations, assessments, and the guided tools recognize them by it; a case with its own check set displays "Evidence check". A `RecordItem` carries ownership, a confirmed schedule, a final-payment trigger, and hold state.

Statuses are precise: evidence-present, needs-evidence, needs-review, not-applicable, blocked. There is no probability and no compliance score. The one percent the product shows is documentation completeness, which counts what is on file and says nothing about whether a requirement is met.

## Limits

- Synthetic data only. One local operator; typed reviewer names are not authenticated identities.
- The event history is an editable local file. It is not immutable. The packet digest detects accidental change; it is not a signature.
- Loading a profile is not isolation between organizations.
- Funding allocations are simulated planning decisions on synthetic budgets. They are not obligations, payments or agency approvals, and the shared demo login does not identify an approver.
- A working demo is not production authorization. A reviewed packet is not an audit opinion.
- A gap is a documentation condition detected by a rule. It is not a finding of noncompliance, and the gap rules have not been validated against real cases.
- User time savings, usability, and detection accuracy have not been measured. No pilot has been run.

## Next milestones

1. Record status, schedule references, and scope fields (PROFILE-002). Until schedule references exist, a record whose schedule is not a final-payment schedule cannot be marked as having a confirmed schedule, so it stays incomplete in the completeness count.
2. Verification freshness (EVID-003).
3. Evidence requests, then observations and closure.
4. Before any real agency use: authenticated roles, secure storage, retained event history, access review, and approved integrations.
