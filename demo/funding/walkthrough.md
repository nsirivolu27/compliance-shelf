SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD.

# Walkthrough under five minutes: evidence review, records protection, funding, audit handoff

Use individual voice: "I built." This independent prototype is not endorsed by Accenture or an agency. Every case, document, budget and role is fictional. Aim for 4 minutes 45 seconds.

## Prepare

From the repository root, in PowerShell:

```powershell
& ".\.local\tools\node-v22.23.5-win-x64\node.exe" services\funding-demo.mjs
```

With Node 22.18 or newer on PATH, `npm run demo:funding` does the same. It uses ports 5717 to 5724; set `PORT` to another free block of eight if needed. Wait for the line `Synthetic funding demonstration: http://127.0.0.1:5717/#/funding`. The lines after it give the completed VA case address and the data folder for this run, which is new every time and sits under the system temporary directory. Stop with Ctrl+C in the same window. To reset, stop it and start it again: decisions cannot be undone, and every start is a fresh workspace. It never opens a saved workspace.

Have two rationales ready to type (at least 10 characters each):

- "Baseline documented by the completed review; monitoring fits the remaining budget."
- "Trying the redesign request after the monitoring approval."

## Story

| Time | Say | Do and show |
|---|---|---|
| 0:00–0:25 | "I built Compliance Platform to connect a decision to the documents behind it. Everything here is fictional." | Cases. Open "VA regional services portal — accessibility and delivery evidence review". The synthetic-data banner is at the top. |
| 0:25–1:05 | "The first evaluation covered build 1.1, the delivery was 1.2, and two keyboard defects were open. The reviewer recorded that this was not enough, and that review is still here." | Findings tab. Click "Accessibility evidence covers the delivered build". Under "SYN-VAP-DOC-04 v1.0 — Accessibility evaluation report" show the passage "Unresolved keyboard defects at the close of testing: KB-01 and KB-02." Open "Earlier reviews (1)": "More evidence needed". |
| 1:05–1:35 | "The final retest on build 1.2.1 passed both defects. The current decision is enough evidence for this check, and the handoff note has been reviewed." | Same panel: under "SYN-VAP-DOC-09 v2.0 — Final keyboard retest" the passage "KB-01 and KB-02 passed the final retest on SYN-BUILD-1.2.1." and "Enough evidence for this check · Up to date". Close. Review drafts tab: the note reads Reviewed. |
| 1:35–1:55 | "Finishing the review does not release the records. This file stays under its hold, and nothing here can be destroyed." | Records tab: "Release 1.2 delivery records" shows Active hold and "Blocked by active hold". |
| 1:55–2:35 | "Funding is planned the same way. This VA budget has $1,200,000, $500,000 approved, $700,000 remaining. The proposal is a separate next phase: monitoring after release. The completed review documents the baseline it would watch. It does not show that any monitoring was done." | Funding. VA budget figures. Request "Post-release accessibility monitoring": purpose, Rationale, and Supporting documents with the linked case, four verified documents and the assessments. |
| 2:35–3:05 | "I approve it with a reason. Approved is now $920,000 and $280,000 remains. This is a simulated planning decision; no payment is sent." | "Approve allocation". Type the first rationale. "Approve allocation (simulated)". Approved allocations $920,000.00, Remaining budget $280,000.00. |
| 3:05–3:35 | "A $900,000 request now exceeds what is left by $620,000. The server refuses it, nothing changes, and what I typed is kept." | On "Full portal redesign" the note reads "Exceeds the remaining budget by $620,000.00". "Approve allocation", type the second rationale, submit. "Not saved: this would exceed the remaining budget." Totals unchanged. Cancel, then Discard. |
| 3:35–3:55 | "An earlier $250,000 approval was reversed before today. Both the approval and the reversal are kept. That amount was already back in the $700,000 we started with." | On "Duplicate screen-reader retest" open "Decision history": Approved $700,000.00 → $450,000.00, then Reversed $450,000.00 → $700,000.00. Close. |
| 3:55–4:10 | "SSA has its own budget. The two agencies are never added together." | Agency filter: SSA. $800,000.00 available, $300,000.00 approved, $500,000.00 remaining, unchanged by the VA decision. |
| 4:10–4:35 | "The decision travels with the audit handoff: in the case packet and in the audit export." | Cases, the VA case, Case file tab, "Download case packet". Then More tools, Audit export, "Download JSON packet". |
| 4:35–4:45 | "Allocations are simulated planning decisions on synthetic budgets. The shared demo login does not identify an approver, and nothing here decides anyone's benefits." | Stay on Audit export, or return to Funding. |

## Click sequence

1. Cases → "VA regional services portal — accessibility and delivery evidence review".
2. Findings → "Accessibility evidence covers the delivered build" → read the DOC-04 passage → open "Earlier reviews (1)" → read the DOC-09 v2.0 passage and "Enough evidence for this check" → Close.
3. Review drafts (Reviewed) → Records (Active hold, "Blocked by active hold").
4. Funding → "Post-release accessibility monitoring" → "Approve allocation" → type the first rationale → "Approve allocation (simulated)".
5. "Full portal redesign" → "Approve allocation" → type the second rationale → submit → read the refusal → Cancel → Discard.
6. "Duplicate screen-reader retest" → "Decision history" → Close.
7. Agency filter → SSA.
8. Cases → the VA case → Case file → "Download case packet".
9. More tools → Audit export → "Download JSON packet".

## Figures to expect

| Moment | Approved allocations | Remaining budget | "Full portal redesign" ($900,000.00) |
|---|---|---|---|
| As started | $500,000.00 | $700,000.00 | Exceeds the remaining budget by $200,000.00 |
| After approving the $420,000.00 proposal | $920,000.00 | $280,000.00 | Exceeds the remaining budget by $620,000.00 |
| After the refused attempt | $920,000.00 | $280,000.00 | Still Proposed; nothing recorded |

SSA throughout: $800,000.00 available, $300,000.00 approved, $500,000.00 remaining.

## Video

`output/funding-walkthrough/compliance-platform-funding-walkthrough.mp4` (3 minutes 44 seconds) follows this walkthrough. It is an automated, continuous capture of the application's own browser viewport, with captions and no audio. It is not a person operating the application and not a sequence of prepared screenshots; `output/funding-walkthrough/README.md` says exactly how it was made. To record it again, run `node demo/funding/record-walkthrough.mjs` from the repository root (ports 5817 to 5824, about five minutes). For a recording with a person's voice, follow the story above on a fresh instance.

## Do not claim

- That any government payment, obligation or transfer was made. Allocations are simulated planning decisions.
- That an individual approver was identified. The shared demo login records "local-demo-operator".
- That anyone's benefit eligibility was decided, or that any request was found compliant. Supporting documents show what a person relied on; missing support stays listed.
- That the linked evidence proves the monitoring was performed. It documents the delivered baseline only.
- That the earlier narrated video (output/demo-narration) shows Funding. It was made before Funding existed.
