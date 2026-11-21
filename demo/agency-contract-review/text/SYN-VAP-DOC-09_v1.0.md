SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD.

# Remediation Evidence Addendum: Keyboard Retest of Regional Services Portal v1.2

| Field | Value |
|---|---|
| Document ID | SYN-VAP-DOC-09 |
| Version | 1.0 |
| Date | 2026-10-28 |
| Stage | Remediation |
| Classification | Synthetic demonstration material. Fictional. Not an official agency record. |
| Contract | SYN-VA-PORTAL-2026-001 (fictional) |
| Evaluator | SYN-EVAL-06, Synthetic Accessibility Test Unit (fictional) |
| Distribution | SYN-CO-01; SYN-COR-02; SYN-AR-03; SYN-VDL-04 |
| Retest window | 2026-10-20 to 2026-10-23 |
| Responds to | Corrective action CA-01 in SYN-VAP-DOC-08 v1.0 |

## 1. Relationship to the earlier evaluation

1.1 This addendum supplements accessibility evaluation report SYN-VAP-DOC-04 v1.0 (build SYN-BUILD-1.1.0, tested 2026-09-08 to 2026-09-12). It does not replace that report. The earlier report remains the record of results for build SYN-BUILD-1.1.0.

## 2. Build under test

Build evaluated: SYN-BUILD-1.2.0 (Regional Services Portal v1.2).

2.1 The build was installed in the evaluator's test environment on 2026-10-20 from the deployment package listed in transmittal SYN-VAP-DOC-05 v1.0, item 1. SYN-VDL-04 confirmed in writing that no changes had been made to the package since delivery.

## 3. Scope and method

3.1 Scope: the appointment booking flow (date selection, time selection, confirmation dialog) and regression checks on home, service search and office locator. Standard as in SYN-VAP-DOC-04 v1.0 section 2.

3.2 Method: manual keyboard-only traversal with pointing devices disconnected; focus visibility inspection; a generic automated rule scan used as leads only.

## 4. Retest results for earlier defects

| Defect | Description (from SYN-VAP-DOC-04 v1.0) | Success criterion | Severity | Status after retest | Retest note |
|---|---|---|---|---|---|
| KB-01 | Date picker traps keyboard focus | 2.1.2 No Keyboard Trap (related) | High | Fixed and verified | Reworked date picker releases focus on Tab, Shift+Tab and Escape; verified on 2026-10-21 |
| KB-02 | Appointment confirmation dialog cannot be reached or dismissed by keyboard | 2.1.1 Keyboard | High | Open (partially fixed) | Dialog now receives focus on open and its buttons are reachable by Tab; the dialog cannot be dismissed with Escape |

4.1 KB-02 workaround documented: a keyboard user can dismiss the dialog by tabbing to the "Close" button and pressing Enter. The workaround does not meet the expectation that Escape closes a modal dialog, which the evaluator applies as part of keyboard operability for this flow. Severity remains High pending correction.

Unresolved keyboard defects at the close of retesting: KB-02.

## 5. Regression checks

| Ref | Page or flow | Result |
|---|---|---|
| R-01 | Home page | Pass |
| R-02 | Service search, including new office-hours filter | Pass |
| R-03 | Office locator list view | Pass |
| R-04 | Appointment booking: time selection | Pass |

## 6. Limitations

6.1 This addendum covers only build SYN-BUILD-1.2.0 and only the scope in section 3. Help pages and downloadable forms were not retested.

6.2 The evaluator does not decide acceptance and does not assess the vendor declaration.

## 7. Revision history

| Version | Date | Author role | Change |
|---|---|---|---|
| 0.1 | 2026-10-23 | SYN-EVAL-06 | Draft at close of retesting |
| 1.0 | 2026-10-28 | SYN-EVAL-06 | Issued to distribution |

Signature: not applied — synthetic demonstration.
