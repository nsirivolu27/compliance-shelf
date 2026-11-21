# Choose a demonstration

Both routes use the same application and existing service supervisor. Each launch creates its own local data folder. Nothing is written to an existing saved workspace.

| Demo | What to show | Start from the repository root |
|---|---|---|
| VA and SSA paperwork | Switch between two agency cases; inspect missing information, review dates, follow-up work, and the audit report | `.\demo\start-demo.ps1 -Scenario va-ssa -Port 5217` |
| Detailed VA contract audit | Read fictional documents, cite passages, record an evidence review, request corrections, and preserve a records hold | `.\demo\start-demo.ps1 -Scenario va-audit -Port 5117` |
| Completed review with funding | Show the completed VA review and its records hold, approve a supported funding proposal, see a larger request refused, and download the audit handoff | `& ".\.local\tools\node-v22.23.5-win-x64\node.exe" services\funding-demo.mjs` (port 5717) |

The terminal prints the case links after setup finishes. Use those links rather than copying a case ID from a previous run. Each scenario needs eight free ports starting at the chosen port. Stop with Ctrl+C in the same terminal. An occupied port is reported; another preview is never stopped automatically.

The shared PowerShell launcher puts new rehearsal data under `%TEMP%\compliance-platform-demos\<scenario>\<timestamp>` to keep active data files outside the OneDrive-synced source folder. Windows may clear temporary data, so export any results you want to keep. The launcher prints the exact folder and never deletes or moves an earlier workspace. Direct runners (`npm run demo:agencies`, `demo:va`, `demo:completed`, `demo:funding`) now use the same temporary parent by default, with a new folder per run; set `DEMO_DATA_ROOT` to choose another parent folder.

- [VA guide](va/README.md)
- [Social Security guide](ssa/README.md)
- [Detailed VA document pack](agency-contract-review/README.md)
- [Recording script](agency-contract-review/facilitator/demo-script.md)
- [Walkthrough with funding, under five minutes](funding/walkthrough.md)
- [Submission checklist](agency-contract-review/facilitator/submission-checklist.md)

The PowerShell entry point uses the existing portable Node 22.23.5 runtime. With Node 22.18+ already on PATH, the equivalent existing runners are available as `npm run demo:agencies` (default 4417) and `npm run demo:va` (default 4817). Set `PORT` to choose another block. No model key or cloud connection is needed.

These are fictional review examples, not official agency systems. Public awards remain separate context. SSA paperwork examples are not an automatic audit of actual SSA records, and benefits worksheets do not decide eligibility or allocate money. Funding allocations are simulated planning decisions on fictional budgets; no payment is sent.
