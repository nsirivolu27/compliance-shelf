# Submission checklist — November 20, 2026

## Ready to use

- Public demo: https://d3b53nnmc6778q.cloudfront.net. Username `reviewer`; copy the password from the ignored `.local/aws-demo-access/compliance-demo-public.json` file. Share credentials privately with intended reviewers, not in the recording or repository.
- Cloud VA case: https://d3b53nnmc6778q.cloudfront.net/#/cases/DEMO-aca14a5b-5107-4819-a65f-e599bc06c664/findings
- Cloud SSA paperwork example: https://d3b53nnmc6778q.cloudfront.net/#/cases/DEMO-4ca0f32d-56e5-4d5c-8c27-b578aa76dbd0/paperwork
- The AWS server is scheduled to stop November 21 at approximately 3:59 AM Eastern. A recording is the durable submission artifact; do not promise the live link will remain available for later judging. NAT and storage still consume credits after the server stops until cleanup.
- Fresh demo: http://127.0.0.1:5017/#/cases/DEMO-30549210-a5fe-4fb9-8c59-a6a5191f59a3/findings
- Completed rehearsal report: http://127.0.0.1:4917/#/auditreport?caseId=DEMO-d560ef70-0daa-4b8b-99ed-9ca2ef09c023
- Script: [Five-minute pitch](demo-script.md), target 4:45.
- Document pack: sixteen fictional PDFs in `../originals`, with matching prepared text in `../text`.
- Fresh runs start with nine documents and no reviewer judgments. Two partial-remediation documents and five final completion documents follow. The new npm run demo:completed runner records the full training journey.
- These localhost addresses work on this computer only. Do not use them as external demo links in the submission form.

## Finish tonight

1. Record the walkthrough. Use the fresh case for the first review, and clearly identify the completed rehearsal when showing the prepared follow-up. Do not imply the software discovered the planted issues automatically.
2. Play the recording back. Check readable text, understandable audio, no private tabs or credentials, and that the completed evidence decisions, earlier adverse history, and active hold remain visible.
3. Upload the video to a destination you choose. Check that a reviewer can view the shared link without your account. No upload or publishing has been performed by Codex.
4. Open the submission form from Elham's email. Complete its required fields, include the working video link, and review the answers yourself before submitting. The reminder says November 20 at 11:59 PM; verify the applicable timezone if the form specifies it.
5. Keep the submission confirmation. Nothing has been submitted yet.

## Compact project description (individual voice)

I built Compliance Platform to help federal contracting and records teams review whether a contract file contains enough evidence for a delivery decision. The prototype connects documents, cited passages, reviewer decisions, follow-up tasks, and records holds in one workspace. My demonstration uses a fictional VA portal delivery: the vendor statement and test report do not support the same release, and the final correction build arrives with a matching retest, receipt and reviewer acknowledgment. All three stated evidence checks finish with current reviewer decisions, a completed follow-up and a reviewed handoff. Earlier evidence and the active hold remain visible. A separate public awards page uses a saved USAspending VA dataset for procurement context. All internal cases and contract documents are fictional; the platform supports a human review and does not certify compliance.

## Technical description, if asked

Node.js 22 and TypeScript application, dependency-free browser UI, eight services running together on a private AWS EC2 server, encrypted file-backed demo storage, version checks, retry receipts, event history, and a case export with a SHA-256 file fingerprint. CloudFront provides HTTPS and shared-password access. Development was assisted by Claude and Codex. The guided assistant is rule-based, with no connected model. There is no agency system connection. Individual identity, agency authorization, approved production hosting/storage, and automatic PDF reading remain future work.

## Demonstrated and checked

The isolated rehearsal includes document upload, passage linking, reference verification, two evidence reviews, an explicit documentation-gap decision, an assigned task, and an audit report. The new retest document was uploaded through the browser; the revised acceptance memo was added through the API as rehearsal setup. Both original and revised documents remain on file. The exported packet's digest was independently recomputed and matched. See CODEX-023 and `.local/submission` for actual final verification results.

## Limits to describe honestly

- No user study or measured time saving; browser checks are engineering verification.
- The platform reads prepared text, not the supplied PDFs. No OCR or live model call.
- Decisions are saved under a shared demo operator; they do not prove a person's identity.
- File fingerprints detect accidental change, not tampering by someone controlling the system.
- Public award data is a nonrepresentative top-20 sample retrieved November 15, 2026. No real vendor is linked to the fictional findings.
- One fresh startup returned a generic save error and left a temporary workspace file; it shut down and a second fresh startup succeeded. Cause was not proven. Existing previews and saved workspaces were preserved.
- This pass did not verify a screen reader, true 200% browser zoom, or a complete Tab-only journey. Enter and Space activation and the key review workflow were exercised.

