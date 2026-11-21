SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD.

# Vendor Accessibility Conformance Declaration: Regional Services Portal Release 1.2

| Field | Value |
|---|---|
| Document ID | SYN-VAP-DOC-03 |
| Version | 1.0 |
| Date | 2026-09-29 |
| Classification | Synthetic demonstration material. Fictional. Not an official agency record. |
| Contract | SYN-VA-PORTAL-2026-001 (fictional) |
| Deliverable | D-02 under SOW SYN-VAP-DOC-01 v1.0 §4 |
| Submitted by | SYN-VDL-04, Vendor Delivery Lead, Larkspur Digital Services, LLC (fictional) |
| Submitted to | SYN-COR-02, Contracting Officer's Representative |

## 1. Purpose

1.1 Larkspur Digital Services, LLC (fictional) submits this declaration as deliverable D-02 for Release 1.2 of the Regional Services Portal, delivered with transmittal SYN-VAP-DOC-05 v1.0.

## 2. Standard declared against

2.1 The contractor declares against the standard referenced in SOW §5.1: the Revised Section 508 Standards (36 CFR Part 1194), which incorporate WCAG 2.0 Level AA by reference.

## 3. Testing approach

3.1 Accessibility was addressed throughout development using the approach below.

| Activity | Description | Builds covered | Performed by |
|---|---|---|---|
| Automated rule checks | Automated page scanning in the build pipeline on every merge | Release 1.1 and Release 1.2 development builds | Contractor development team |
| Design review | Review of color, headings and form labels in design files | Release 1.x designs | Contractor design team |
| Manual spot checks | Screen-reader and keyboard spot checks on selected pages | Release 1.2 release candidate pages: home, search, help | Contractor quality team |
| Independent evaluation | Evaluation by Synthetic Accessibility Test Unit, report SYN-VAP-DOC-04 v1.0 | As stated in that report | SYN-EVAL-06 |

3.2 Contractor findings from automated checks were triaged weekly. Items rated High were corrected before the release candidate was cut.

## 4. Conformance statement

4.1 Based on the activities in section 3, the contractor states:

Release 1.2 is ready for acceptance and has no known keyboard accessibility defects.

4.2 The contractor considers Release 1.2 to support the success criteria of WCAG 2.0 Level AA, subject to the known limitations in section 5.

## 5. Known limitations

| Ref | Area | Limitation | Planned correction |
|---|---|---|---|
| L-01 | Downloadable forms | Two downloadable PDF forms in the help section are not yet tagged for assistive technology | Release 1.3 |
| L-02 | Office map | Map tooltip text on the office locator has a color contrast ratio below 4.5:1 on hover | Release 1.3 |
| L-03 | Help video | Captions for the "Booking an appointment" help video are machine-generated and not yet reviewed | Within 30 days of acceptance |

## 6. Cross-references

6.1 Statement of work: SYN-VAP-DOC-01 v1.0 (§4 D-02, §5, §6). 6.2 Independent evaluation: SYN-VAP-DOC-04 v1.0. 6.3 Delivery transmittal: SYN-VAP-DOC-05 v1.0.

## 7. Revision history

| Version | Date | Author role | Change |
|---|---|---|---|
| 0.1 | 2026-09-22 | SYN-VDL-04 | Draft prepared from development test records |
| 1.0 | 2026-09-29 | SYN-VDL-04 | Issued for submission with Release 1.2 |

Signature: not applied — synthetic demonstration.
