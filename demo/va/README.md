# VA demonstration

## Document-led contract audit

```powershell
.\demo\start-demo.ps1 -Scenario va-audit -Port 5117
```

Open the case URL printed in the terminal. Follow the [recording script](../agency-contract-review/facilitator/demo-script.md).

The fictional portal delivery has a vendor statement for release 1.2 and a test report for release 1.1. Read the documents, cite the relevant passages, save an evidence review, assign follow-up, and show the audit report. The later report resolves only part of the issue; the earlier review and active hold remain visible.

Files stay in [agency-contract-review](../agency-contract-review/): eleven PDF versions, matching prepared text, a manifest, and facilitator notes. The initial demo loads nine text companions. The two later documents are added during the walkthrough. The platform does not read the PDFs automatically.

## VA and SSA comparison

```powershell
.\demo\start-demo.ps1 -Scenario va-ssa -Port 5217
```

Open the printed VA case URL. This existing scenario shows a release 4.2 records transfer with missing facts, a separate held record, a corrective-action entry, and saved reader output awaiting human review. Then use the printed SSA link to compare the second case in the same workspace.

All names, dates, schedule examples, decisions, and holds in these cases are demonstration data. Do not present them as an official VA finding or approval.
