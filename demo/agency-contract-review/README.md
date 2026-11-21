# Agency contract review: synthetic document pack

SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD.

This folder holds a fictional contract file for a local Compliance Platform prototype demonstration: "VA regional services portal — accessibility and delivery evidence review" (contract SYN-VA-PORTAL-2026-001, fictional). The prototype is an independent Accenture Federal Services Build Challenge entry. It was not created, approved, purchased or endorsed by Accenture, VA, or any agency. Every document here is fictional. People appear only as role IDs (SYN-CO-01 to SYN-EVAL-06). There are no real contract numbers, claimant data, signatures, logos or contact details.

Business question: Does the supplied contract file contain adequate, current, traceable evidence for a reviewer to assess the stated delivery and accessibility expectations?

The platform helps a reviewer assess evidence and prepare an accountable audit handoff. It does not certify legal compliance, authorize payment, decide benefits, or authorize record destruction.

## Folder layout

| Path | Contents |
|---|---|
| text/ | Markdown companions, one per document version (SYN-VAP-DOC-XX_vN.N.md). The source of truth; the platform imports and cites these. |
| originals/ | PDF originals rendered from the companions, for human reading. |
| sources/policy-references.md | Real public policy and oversight references, with URLs, status, retrieval time and hashes. |
| sources/snapshots/ | Raw HTML snapshots of the references that were retrieved. |
| scenario.json | Case title, contract, roles, builds, hold and the document list with stage and the check each mainly supports. Contains no exception answers. |
| manifest.json | One entry per document version: metadata, relationship, and SHA-256 and size of the original and companion. |
| facilitator/answer-key.md | Facilitator-only key to the planted exceptions E1 to E4. Not loaded into the application. |
| tools/render.mjs | Converts the companions to HTML and prints PDFs with Chrome headless. No dependencies. |
| tools/manifest.mjs | Computes hashes and writes manifest.json; `--check` verifies them. |

## Documents

| ID | Version | Title | Stage |
|---|---|---|---|
| SYN-VAP-DOC-00 | 1.0 | Engagement brief | initial |
| SYN-VAP-DOC-01 | 1.0 | Statement of work (fictional) | initial |
| SYN-VAP-DOC-02 | 1.0 | Deliverable register | initial |
| SYN-VAP-DOC-03 | 1.0 | Vendor accessibility conformance declaration | initial |
| SYN-VAP-DOC-04 | 1.0 | Accessibility evaluation report | initial |
| SYN-VAP-DOC-05 | 1.0 | Delivery transmittal | initial |
| SYN-VAP-DOC-06 | 1.0 | Acceptance-review memorandum | initial |
| SYN-VAP-DOC-07 | 1.0 | Records inventory and synthetic hold notice | initial |
| SYN-VAP-DOC-08 | 1.0 | Corrective-action plan | initial |
| SYN-VAP-DOC-09 | 1.0 | Remediation evidence addendum | remediation |
| SYN-VAP-DOC-06 | 2.0 | Revised acceptance-review memorandum (v1.0 retained unchanged) | remediation |

## The four-way distinction

1. Public policy or oversight reference: real public material in sources/. Context only, not a term of the fictional contract unless the SOW cites it. The VA OIG report 24-02142-105 is oversight background only.
2. Fictional contractual requirement: what the fictional SOW (SYN-VAP-DOC-01) requires.
3. Synthetic evidence: the fictional documents in text/, cited by document ID, version and passage.
4. Reviewer judgment: conclusions the human reviewer records, with reasons.

## Originals and companions

The PDFs are originals for human reading. The platform cites the Markdown companions by exact quotation. PDF reading is not connected in the platform. Companions are UTF-8 with LF line endings; the platform normalizes CRLF to LF before hashing, so manifest hashes (computed over the LF files as saved) match.

## Regenerating

From this folder:

1. `node tools/render.mjs` (needs Google Chrome; set CHROME_PATH if it is not at C:/Program Files/Google/Chrome/Application/chrome.exe)
2. `node tools/manifest.mjs`
3. Optional: `node tools/manifest.mjs --check`

PDF bytes can differ between renders (Chrome embeds a creation date), so regenerate the manifest after every render.

## Banner rule

The first line of every companion and a fixed header and footer on every PDF page read exactly: SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD. (with an em dash). The PDF footer also shows the document ID and version. No seals or logos are used.

## Completed review stage
Five additive completion documents bring the pack to sixteen versions. Correction build SYN-BUILD-1.2.1 has a final retest, corrected declaration, replacement receipt and reviewer acknowledgment. DOC-10 supplies explicitly invented training records instructions; it is not real disposition authority. Use npm run demo:completed for an isolated, fully reviewed case. Earlier stages remain available, and the delivery hold stays active.

