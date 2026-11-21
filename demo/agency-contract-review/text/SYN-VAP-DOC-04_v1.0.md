SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD.

# Accessibility Evaluation Report: Regional Services Portal

| Field | Value |
|---|---|
| Document ID | SYN-VAP-DOC-04 |
| Version | 1.0 |
| Date | 2026-09-15 |
| Classification | Synthetic demonstration material. Fictional. Not an official agency record. |
| Contract | SYN-VA-PORTAL-2026-001 (fictional) |
| Evaluator | SYN-EVAL-06, Synthetic Accessibility Test Unit (fictional) |
| Distribution | SYN-COR-02; SYN-AR-03; SYN-VDL-04 |
| Testing window | 2026-09-08 to 2026-09-12 |

## 1. Build under test

Build evaluated: SYN-BUILD-1.1.0 (Regional Services Portal v1.1).

1.1 The build was installed in the evaluator's test environment on 2026-09-08 from the package supplied by SYN-VDL-04. No other build was tested in this window.

## 2. Scope and standard

2.1 Standard: the referenced standard in SOW SYN-VAP-DOC-01 v1.0 §5.1, the Revised Section 508 Standards (36 CFR Part 1194), which incorporate WCAG 2.0 Level AA by reference. This evaluation focused on keyboard operability (success criteria 2.1.1 Keyboard and 2.1.2 No Keyboard Trap) and focus visibility.

2.2 Pages and flows tested: home page; service search; office locator; appointment booking (date selection, time selection, confirmation dialog); help pages.

## 3. Method

| Step | Method | Notes |
|---|---|---|
| 1 | Manual keyboard-only traversal | Tab, Shift+Tab, Enter, Space, arrow keys and Escape on each flow; pointing devices disconnected |
| 2 | Focus visibility inspection | Visual check that focus is visible at every stop |
| 3 | Automated rule scan | A generic automated accessibility rule checker run on each page; results used as leads only |
| 4 | Screen-reader smoke test | A generic desktop screen reader on the booking flow to confirm names and roles of controls |
| 5 | Defect logging | Each defect given an ID, success criterion, severity (High, Medium, Low) and status |

## 4. Observations

| Ref | Page or flow | Observation | Result |
|---|---|---|---|
| O-01 | Home page | All links and menus reachable in logical order; focus visible | Pass |
| O-02 | Service search | Search field, filters and results reachable; Enter submits | Pass |
| O-03 | Office locator | List view operable by keyboard; map is supplementary | Pass |
| O-04 | Appointment booking: date selection | Focus enters the date picker and cannot leave by Tab, Shift+Tab or Escape | Fail (KB-01) |
| O-05 | Appointment booking: time selection | Time slots reachable and selectable by arrow keys | Pass |
| O-06 | Appointment booking: confirmation | Confirmation dialog opens but cannot be reached or dismissed by keyboard | Fail (KB-02) |
| O-07 | Help pages | Headings and links operable; one skip link missing on help index | Pass with note (Low, KB-03, closed in test window) |

## 5. Open defects

| Defect | Description | Success criterion | Severity | Status |
|---|---|---|---|---|
| KB-01 | Date picker traps keyboard focus; the user cannot move past the date field without a pointing device | 2.1.2 No Keyboard Trap (related) | High | Open |
| KB-02 | Appointment confirmation dialog cannot be reached or dismissed by keyboard | 2.1.1 Keyboard | High | Open |

Unresolved keyboard defects at the close of testing: KB-01 and KB-02.

5.1 KB-03 (missing skip link on the help index, Low) was corrected by the contractor and verified on 2026-09-11 within the same build; it is closed.

5.2 Because KB-01 and KB-02 block completion of the appointment booking flow by keyboard, the booking flow is not keyboard operable in the build evaluated.

## 6. Limitations

6.1 This report applies only to the build stated in section 1. Results do not carry over to later builds; any later build requires its own evaluation.

6.2 Automated scanning detects only some keyboard issues; results in section 4 rest on manual traversal.

6.3 Screen-reader testing was a smoke test, not a full assessment.

6.4 The evaluator does not decide acceptance. Acceptance is a decision of the Contracting Officer under SOW §6.

## 7. Cross-references

SOW SYN-VAP-DOC-01 v1.0 §5 and §6; deliverable register SYN-VAP-DOC-02.

## 8. Revision history

| Version | Date | Author role | Change |
|---|---|---|---|
| 0.1 | 2026-09-12 | SYN-EVAL-06 | Draft at close of testing |
| 1.0 | 2026-09-15 | SYN-EVAL-06 | Issued to distribution |

Signature: not applied — synthetic demonstration.
