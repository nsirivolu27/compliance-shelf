# Facilitator answer key: planted exceptions E1 to E4

FOR THE FACILITATOR ONLY. This file is NOT loaded into the application. The platform does not discover these exceptions by itself; it organizes the evidence and records the reviewer's findings. Use this key to check that a reviewer, working in the platform, can locate and cite each exception.

All documents are fictional. Contract SYN-VA-PORTAL-2026-001 (fictional).

## E1. Declaration contradicts independent test results

| Field | Detail |
|---|---|
| Exception | The vendor declaration states there are no known keyboard defects, while the independent evaluation reports two open High keyboard defects. Its known-limitations table does not mention keyboard issues. |
| Primary document | SYN-VAP-DOC-03 v1.0, section 4.1 |
| Verbatim passage | "Release 1.2 is ready for acceptance and has no known keyboard accessibility defects." |
| Contradicting document | SYN-VAP-DOC-04 v1.0, section 5: "Unresolved keyboard defects at the close of testing: KB-01 and KB-02." |
| Supporting passage | SYN-VAP-DOC-03 v1.0 section 3.1 lists the independent evaluation SYN-VAP-DOC-04 v1.0 as part of its testing approach, and that report was distributed to SYN-VDL-04. |
| Why it matters | SOW SYN-VAP-DOC-01 v1.0 §6 criterion D-02(c) requires known defects to be disclosed consistent with independent results. A reviewer cannot rely on the declaration as evidence of keyboard operability. |
| What would resolve or clarify it | A corrected declaration for build SYN-BUILD-1.2.0 (corrective action CA-02 in SYN-VAP-DOC-08 v1.0). As of SYN-VAP-DOC-06 v2.0 section 5.2 it has not been received, so E1 remains open in the remediation stage. |

## E2. Evaluated build does not match delivered build

| Field | Detail |
|---|---|
| Exception | The only independent evaluation in the initial file tested v1.1; the artifact submitted for acceptance is v1.2. |
| Primary documents | SYN-VAP-DOC-05 v1.0, section 1.1, and SYN-VAP-DOC-04 v1.0, section 1 |
| Verbatim passages | "Artifact submitted for acceptance: Regional Services Portal v1.2 (build SYN-BUILD-1.2.0)." and "Build evaluated: SYN-BUILD-1.1.0 (Regional Services Portal v1.1)." |
| Supporting passages | SYN-VAP-DOC-05 v1.0 section 2.1 states the only accessibility evidence enclosed is SYN-VAP-DOC-03 v1.0; section 3 shows the date picker and confirmation dialog were changed in v1.2. SYN-VAP-DOC-04 v1.0 section 6.1 states results do not carry over to later builds. |
| Why it matters | SOW SYN-VAP-DOC-01 v1.0 §5.3 and §6 criterion D-03(b) require the evaluation to cover the exact delivered build. The evidence is not current for what was delivered. |
| What would resolve or clarify it | An evaluation of build SYN-BUILD-1.2.0 (CA-01). SYN-VAP-DOC-09 v1.0 now supplies one ("Build evaluated: SYN-BUILD-1.2.0 (Regional Services Portal v1.2).") for a limited scope, which addresses E2 for that scope but shows KB-02 still open ("Unresolved keyboard defects at the close of retesting: KB-02."). |

## E3. Required reviewer acknowledgment missing

| Field | Detail |
|---|---|
| Exception | SOW §7.3 requires a written acknowledgment by SYN-AR-03 in the acceptance-review memorandum before acceptance; the memorandum records none. |
| Primary document | SYN-VAP-DOC-06 v1.0, section 4 |
| Verbatim passages | "Acknowledgment: not provided." and, in section 7, "Recommendation: acceptance pending; see open items." |
| Requirement | SYN-VAP-DOC-01 v1.0 §7.3 |
| Why it matters | Acceptance of D-03 cannot proceed under the fictional contract without it. A missing signature-equivalent control is a traceability gap for the audit handoff. |
| What would resolve or clarify it | The acknowledgment (CA-03). SYN-VAP-DOC-06 v2.0 section 3 records: "Acknowledgment: provided by SYN-AR-03 for build SYN-BUILD-1.2.0, limited to the scope of SYN-VAP-DOC-09." The reviewer should note the scope limit; v1.0 remains in the file unchanged as the record of the earlier gap. |

## E4. Active records hold

| Field | Detail |
|---|---|
| Exception | Delivery records for Release 1.2 are under an active synthetic hold; no disposition action is permitted. |
| Primary document | SYN-VAP-DOC-07 v1.0, section 3 |
| Verbatim passage | "Hold SYN-HOLD-2026-07 is active and covers Release 1.2 delivery records. No disposition action may be taken while it is active." |
| Supporting passages | SYN-VAP-DOC-07 v1.0 section 3.2: correcting accessibility evidence does not release the hold; only a hold review can. Section 2: schedules are "to be confirmed by the records officer". The Release 1.1 test working files have no hold, but that does not authorize disposition (section 3.3). |
| Why it matters | Any handoff must record that the hold is active and must not suggest disposition. Remediation evidence filed in the Release 1.2 acceptance file falls under the hold. |
| What would resolve or clarify it | Only a hold review by SYN-RO-05. SYN-VAP-DOC-06 v2.0 section 5.3 and its recommendation ("no records action is authorized while the hold is active") confirm the hold remains active at the end of the scenario. |

## Expected state at the end of the remediation stage

| Exception | Initial stage | After SYN-VAP-DOC-09 v1.0 and SYN-VAP-DOC-06 v2.0 |
|---|---|---|
| E1 | Open | Open (CA-02 not received) |
| E2 | Open | Addressed for the retested scope; KB-02 still open |
| E3 | Open | Addressed, limited to the scope of SYN-VAP-DOC-09 |
| E4 | Active hold | Active hold (unchanged) |

Facilitator prompts: ask the reviewer to cite document ID, version and the exact line for each finding; check that the reviewer does not treat completion of CA-01 or CA-03 as resolving a finding by itself (SYN-VAP-DOC-08 v1.0 section 3.1); check that the reviewer keeps SYN-VAP-DOC-06 v1.0 in view after v2.0 arrives.
