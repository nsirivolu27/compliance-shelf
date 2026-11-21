# Social Security demonstration

```powershell
.\demo\start-demo.ps1 -Scenario va-ssa -Port 5217
```

The existing runner prepares both VA and SSA cases and prints a separate URL for each. Open the **SSA case** URL, which lands on Paperwork. This is the existing system-delivery example; no new agency rules or approval system are introduced.

## Short walkthrough

1. Show the case title, **Synthetic SSA system delivery: release 2.1**, and its owner.
2. Open Paperwork. The seeded examples are the senior agency official records report (`PW-SAORM`), records management self-assessment (`PW-RMSA`), electronic records report (`PW-FEREM`), and corrective-action entry (`PW-A50-CAP`).
3. Explain that the stored due dates are demonstration dates entered by the seed, not verified SSA deadlines. Check the source and scope of an item before treating it as a requirement for this case.
4. Open an item, inspect the missing information, and demonstrate saving a note or status through the existing form. A status change is not official submission or approval.
5. Open Audit report and select the SSA case. Explain what remains open and who must review it. Switch to the VA case to show that the two cases retain their own sources and checks.

This scenario starts with paperwork entries, not a complete SSA evidence-document pack. Its undecided checks and policy context remain undecided. Do not claim the platform automatically audits actual SSA files or certifies that the reports are complete.

## Optional existing examples

Check profile also offers an SSA benefit-statement review example. Benefits intake has fictional disability, SSI, retirement, and spouse-survivor worksheets. Those organize information for a reviewer; they do not decide eligibility, tax treatment, or payment. Keep the recording focused on records and audit follow-up unless you have time to explain those limits.
