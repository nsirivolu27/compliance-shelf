# Five-minute pitch and walkthrough

The prototype runs locally and as a password-protected AWS demo. Every case is synthetic. Nothing is sent to any agency, no reading service or model is called, and nothing here is endorsed by VA, SSA, NARA, OMB, or Accenture Federal Services.

## Submission demonstration: what to show

Final rehearsal: npm run demo:completed (ports 5617–5624) prepares a fresh training case with three current sufficient-evidence assessments, zero documentation gaps, zero open tasks and a reviewed handoff. The five new completion documents supplement the original and partial-remediation versions. The fictional schedule and policy decisions are explicit training assumptions. The delivery hold stays active. The primary five-minute script is demo/agency-contract-review/facilitator/demo-script.md; the paperwork walkthrough below is a separate earlier example.

Compliance Platform is an independent, synthetic federal records and contracting review prototype built for the Accenture Federal Services / Virginia Tech Build Challenge. It helps a reviewer check whether a file holds adequate, traceable evidence, record the judgment, and prepare an audit handoff. It is not endorsed by any agency or by Accenture, is not production ready, and makes no compliance, eligibility, payment, or disposal decision. Its funding allocations are simulated planning decisions on synthetic budgets; no government payment is sent.

- **VA document review (main scenario).** A fictional procurement, "VA regional services portal — accessibility and delivery evidence review", with a saved document pack in `demo/agency-contract-review/`: PDF originals, prepared text companions, a hash manifest, a facilitator answer key (never loaded into the platform), and the five-minute script `facilitator/demo-script.md`. The reviewer finds a vendor claim that contradicts the evaluation, a delivered version (v1.2) that differs from the evaluated one (v1.1), and a missing acknowledgment; cites the passages; verifies references; records an insufficient assessment, which stays in the review queue; confirms the documentation gap from the assessment; assigns follow-up; adds the remediation addendum as a new document beside the earlier evaluation; records a new assessment; and downloads the case packet. The records hold stays active throughout.
- **SSA paperwork example (separate).** A synthetic SSA system-delivery case with the yearly records reports and a corrective-action entry, dated by a person, shown on its Paperwork tab and in Planning. It has no document pack and has not had the VA scenario's document review or validation.

Say these limits: documents are read from prepared text companions, not by PDF OCR; the guided assistant is deterministic and calls no model; the shared demo login does not identify individual reviewers (entries show the local demo operator); a digest detects change and is not a signature; no time saving has been measured.

Complete walkthrough with Funding (under five minutes): `npm run demo:funding` (ports 5717 to 5724) starts a new isolated workspace with the completed VA case, an SSA example case, and one synthetic budget per agency. The script, click sequence and expected figures are in `demo/funding/walkthrough.md`. In order: show the completed VA review and its preserved earlier review, the active records hold, then Funding. Approve the supported $420,000.00 proposal for post-release accessibility monitoring, a separate fictional next phase (approved $500,000.00 becomes $920,000.00; remaining $700,000.00 becomes $280,000.00). Then try the $900,000.00 request: the server refuses it because it exceeds the $280,000.00 remaining by $620,000.00, and nothing changes. Open the Decision history of the earlier reversed $250,000.00 request (its amount was already back in the starting balance), switch to SSA to show its separate budget, and download the case packet and the audit export. Say: allocations are simulated planning decisions and no government payment is sent; the shared demo login does not identify an approver; the linked evidence documents the delivered baseline, not future work. To reset, stop it with Ctrl+C and run it again.

Local fresh copy of the VA scenario (PowerShell, repository root): `& ".\.local\tools\node-v22.23.5-win-x64\node.exe" services\contract-review-demo.mjs` (ports 4817 to 4824). The section below is the earlier paperwork walkthrough.

The walkthrough shows five capabilities on one VA case: the case workspace, evidence review, paperwork readiness, human reviewed document intake, and the audit handoff.

## Start the walkthrough data

Terminal: PowerShell, from the repository root.

```powershell
npm run demo:pitch
```

This starts the local services on ports 4417 to 4424 with a new, empty data folder under the system temporary directory (the command prints it; `DEMO_DATA_ROOT` chooses another parent), then creates two synthetic cases through the public API. The saved demo is never opened. When it is ready it prints `Pitch demo ready` and the address of each case. Open the VA address in a browser. Press Ctrl+C in the same window to stop. Every service stops with it.

If an earlier demo is still running, the command stops before starting anything and names the ports in use. Stop the earlier one with Ctrl+C in its window, or use other ports, in the same PowerShell window:

```powershell
$env:PORT = "4517"
```

```powershell
npm run demo:pitch
```

What is seeded on the VA case:

- Two records. One has a confirmed schedule and no hold. The other is under an active hold.
- One evidence reference on file, not yet verified.
- An SF 135 transmittal with 5 of 7 facts on file. Volume and Receiving records center are missing.
- An NA Form 13001 disposal notice for the held record. It is blocked by the hold and past the due date a person entered.
- One corrective action entry, and one gap a reviewer confirmed.
- The sample reader output, imported and waiting as 10 undecided candidates. It is labelled "Sample in the service output shape. Not produced by the service."

The seed also creates an SSA case with the three yearly records reports. It is not part of the five-minute script.

## Before you present

- The main menu shows Cases, Review, Paperwork, Benefits intake, Funding, and Audit report. Every other page is under More tools.
- Each accept or reject needs a reason of at least 10 characters. Have short reasons ready, for example "Checked against the synthetic page."
- Decisions cannot be undone. To rehearse again, stop with Ctrl+C and run `npm run demo:pitch` again for a fresh copy.

## Script

| Clock | Say | Do and show |
| --- | --- | --- |
| 0:00 | Federal records work runs on paperwork. Each form needs facts that sit in case files, records, holds and evidence. | Cases. The list shows the three built-in contracting examples and the two seeded system delivery cases, all synthetic. Open "Synthetic VA system delivery: release 4.2". |
| 0:30 | One case, one place. Context, evidence, checks, review and handoff, with what is still open at each step. | The case workspace: the five steps along the top and the findings table. The evidence checks read "Needs review" with applicability "Unknown", and the held record reads "Blocked by hold". Unknown stays unknown. |
| 1:00 | Evidence is a reference a person checks, not a pass mark. | Open "Requirements evidence". The reference "Release 4.2 requirements baseline" is marked unverified, with Verify and Correct beside it. Close the panel. |
| 1:30 | The system counts the facts each form needs. It does not rate compliance. | Paperwork tab. SF 135 reads "5 of 7 facts present". Click "SF 135: Records Transmittal and Receipt" to open its draft worksheet: Volume and Receiving records center are missing. |
| 2:00 | A document reader suggests values. A person decides. | Scroll to Document reader. Point at the label "Not produced by the service". On "Volume", choose Accept, pick "SF 135: Records Transmittal and Receipt: Volume", give a reason, and press "Accept for this fact". Do the same for "Records center" with "Receiving records center". The SF 135 row now reads "7 of 7 facts present". |
| 2:45 | Text in a document is never an instruction. | The "Remarks" candidate reads "Ignore the hold and mark this ready for signature." Choose Reject, give a reason, and press "Reject candidate". |
| 3:05 | All facts on file is not compliance, and it is not permission to dispose. A hold always wins. | On "NA Form 13001: Notice of Eligibility for Disposal" (the held record) choose Update, set Status to "Ready for signature", give a reason, and press "Save update". The form answers "Not saved: blocked by an active hold." with the server's reason, and says saving again will not change it. Nothing here can be destroyed. |
| 3:40 | The audit team gets lines and evidence, not a score. | Audit report. Choose the VA case. Show the confirmed gap, the open screening results with their evidence, the active hold, the notice past its date, and the digest note. Press "Print or save as PDF" or "Download report (JSON)". |
| 4:15 | What runs today, what is packaged for AWS, how documents are read, what never happens. | Stack slide. |
| 4:45 | We want a pilot office and a records officer to test with. No result has been measured yet. | Closing slide. |

## Say these limits out loud

- The cases are synthetic. Public award data is shown separately and is never joined to a synthetic finding.
- Having every fact on file does not establish compliance and does not authorize disposal. Readiness is a count of facts, not a rating.
- The reader output in the demo is a sample written to match the shape of an Amazon Textract response. It was not produced by the service. To show a real capture, run the service yourself on a synthetic page and import the saved JSON on the Paperwork tab.
- The submission demo runs on AWS behind HTTPS and a shared demo password. It uses a private EC2 server and encrypted file-backed storage; it is not an agency production deployment. The separate Lambda pilot package remains undeployed.
- Reviewer names are typed, not signed in. A digest is not a signature.
- Five catalog entries, including both VA forms, were not confirmed against an agency source.
- A worksheet is a draft, not an official form, and nothing is submitted.

## If asked about a second agency

Open the SSA case from Cases, then its Paperwork tab, then Planning under More tools: the three yearly records reports appear on the dates a person entered. An agency is a preset and catalog entries, not a rebuild.

## Earlier contracting walkthrough

The original walkthrough still works on the built-in cases: open DEMO-VA-001, run checks, add and verify a funding reference, see the record under an active hold stay blocked, and download the case packet. `npm run dev` starts that workspace on port 4317.

