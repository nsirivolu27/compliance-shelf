# Reviewer walkthrough

All documents and budgets are synthetic.

## Local setup

Install **Node.js 22.18 or newer**; the submission was verified with **22.23.5**. Clone the repository, then start the demo:

```sh
git clone https://github.com/nsirivolu27/compliance-shelf.git
cd compliance-shelf
npm run demo:funding
```

No API key, AWS account, Python setup, or package installation is needed to run the main demo. Wait for `Synthetic funding demonstration` in the terminal, then open **http://127.0.0.1:5717/#/cases**. The terminal also prints a direct link to the completed VA case.

The demo starts eight local services on **5717–5724**. Each start creates a fresh synthetic workspace in the system temporary directory. Stop with **Ctrl+C**; run the command again to reset. Existing saved workspaces are preserved.

If the ports are occupied, choose another free block of eight. In PowerShell:

```powershell
$env:PORT = "5917"
npm run demo:funding
```

For a persistent development workspace instead, run `npm run dev` and open http://127.0.0.1:4317. Keep the local application on loopback; it is not an authenticated production deployment.

## Walkthrough

1. **Cases:** open the VA regional services portal case. In Findings, open “Accessibility evidence covers the delivered build.” Compare DOC-04's earlier evaluation and open keyboard defects with DOC-09 v2.0's final retest. Expand the earlier review to see the preserved “More evidence needed” decision.
2. **Review drafts / Records:** inspect the reviewed note, then the active hold on the delivery records. A completed evidence review does not release that hold.
3. **Review and intake:** inspect the review queue, tasks and entered planning dates. Benefits intake organizes VA/SSA worksheets and follow-up; it does not decide eligibility.
4. **Funding:** select VA and find “Post-release accessibility monitoring.” Inspect its linked case, documents and assessments. Approve $420,000 with the rationale “Baseline documented by the completed review; monitoring fits the remaining budget.” Approved allocations become $920,000 and the remaining budget becomes $280,000.
5. **Overspend check:** try to approve “Full portal redesign” for $900,000 with a rationale. The server refuses it because it exceeds the remaining budget by $620,000. The input is retained; totals do not change. Cancel and discard the unsaved draft.
6. **History:** open the earlier “Duplicate screen-reader retest” decision history. Its $250,000 approval and reversal are both retained. That reversal is already reflected in the starting balance; it is not another refund now.
7. **SSA:** select SSA. Its $800,000 budget, $300,000 approved and $500,000 remaining are separate from VA.
8. **Audit handoff:** return to the VA case and download its case packet. Open Audit report, Activity and Audit export to inspect the supporting trail and download the workspace packet.

The final narrated video is [here](media/compliance-shelf-demo.mp4). It lasts 3 minutes 44.5 seconds and includes the builder's recorded voice. Its captured screens, brief action clips and readable holds are cut to the spoken workflow. Loaded queue, planning and VA benefits views come from a fresh isolated synthetic capture. It includes a title card and no caption overlays.

The recording shows decisions made during its own isolated session; a fresh run correctly starts before those decisions.
