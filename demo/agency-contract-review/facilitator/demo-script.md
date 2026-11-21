SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD.

# Five-minute pitch: from an evidence problem to a completed review

Use individual voice: “I built.” This independent prototype is not endorsed by Accenture or an agency. All documents and reviewer roles are fictional. Aim for 4 minutes 45 seconds.

## Prepare

Run `npm run demo:completed` from the repository root with Node 22.18 or newer. Or use the portable runtime:

```powershell
& ".\.local\tools\node-v22.23.5-win-x64\node.exe" services\completed-contract-review-demo.mjs
```

Default ports: 5617–5624. Each run creates its own workspace, records the initial adverse review, then adds final documents and scripted decisions through the normal API. It never opens the saved workspace. Set PORT to another free eight-port block when needed. Ctrl+C stops only this run.

The original `npm run demo:contract-review` remains available for a fresh, unreviewed file. The initial and partial-remediation document sets are unchanged. The new completion stage finishes the exercise. Run dates must be 2026-11-20 or later.

## Story

| Time | Say | Show |
|---|---|---|
| 0:00–0:30 | “I built Compliance Platform to help federal review teams connect a decision to the documents that support it.” | VA case and synthetic-data banner. |
| 0:30–1:00 | “This file brings together the contract requirement, vendor statement, test report, delivery receipt and records instructions.” | Document register and original evaluation. Prepared text companions are what the app reads. |
| 1:00–1:45 | “The first report tests build 1.1, but the delivery was 1.2. The reviewer records why that is not enough evidence and assigns a follow-up.” | Earlier insufficient review, exact passage and task history. These were prepared for the rehearsal, not discovered automatically. |
| 1:45–2:45 | “The final submission contains correction build 1.2.1, a matching retest and receipt, and a corrected vendor statement. The reviewer can compare them with the earlier versions.” | DOC-09 v2.0, DOC-03 v2.0, DOC-02 v2.0. Both keyboard defects pass within the named six-flow test scope. |
| 2:45–3:30 | “All three stated evidence checks now have current sufficient-evidence decisions. The follow-up is done and the review note has been reviewed.” | Current assessments, zero open tasks, reviewed draft. Historical adverse reviews remain. |
| 3:30–4:00 | “The completed review does not remove records protection. This delivery file remains preserved under its active hold.” | Records and hold. DOC-10 supplies explicitly invented training schedule and payment assumptions; no actual disposition authority is claimed. |
| 4:00–4:30 | “The handoff contains the documents, exact passages, decisions, task history and preservation instructions.” | Download the case packet. Its digest detects accidental change, not tampering. |
| 4:30–4:45 | “The result is a complete evidence-review trail that another reviewer can inspect and continue.” | Final reviewed note. Mention SSA only as a separate paperwork example if time permits. |

## Completed-state checks

- Three current sufficient-evidence assessments, zero documentation gaps, zero open follow-up tasks.
- Reviewed draft bound to current evidence; earlier insufficient assessments and original document versions retained.
- Active delivery hold unchanged; canDestroy remains false for every record.
- Policy and retention metadata are explicit fictional training decisions, not real agency determinations.
- No claims of official acceptance, legal certification, measured time savings, independent reviewer authentication, OCR, benefit approval or a real funding allocation (the separate Funding page records simulated allocations only).

The optional narrated MP4 is a prepared sequence of actual application screenshots with generated Windows speech. It is not an uncut recording. Public AWS hosting uses shared demo access; the local rehearsal has separate data.
