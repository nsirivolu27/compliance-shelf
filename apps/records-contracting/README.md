# Compliance Platform

A local hackathon foundation for an all-in-one Department of Veterans Affairs compliance workspace, built for the Accenture Federal Services challenge. Records and contracting share one evidence trail: **case → applicable rule → supplied evidence → reviewer decision → audit packet**.

The backend and a dependency-free frontend both work. The frontend lives in `public/` and is served by the same local server, so the API stays same-origin. Start with [the product brief](docs/PRODUCT.md) and [the API notes](docs/API.md).

## Run

Requires Node.js 22.18+ (validated on 24.15). There are no application dependencies or required API keys.

```powershell
cd C:\Users\nsiri\OneDrive\Documents\Playground\compliance-platform\apps\records-contracting
npm install
npm run dev
```

Open http://127.0.0.1:4317 for the workspace. Restart the server after adding files to `public/`, because the list of servable files is read once at startup. `PORT` can override 4317. The server binds only to loopback.

```powershell
npm run demo                 # JSON reports for all synthetic cases
npm test                     # core and actual local-HTTP integration checks
npx tsc --noEmit              # pure TypeScript core; uses existing workspace TypeScript
npm run build                # syntax/schema checks and runnable dist/ package
npm run data:refresh          # refresh the real public VA award snapshot
```

For a standalone checkout without an installed TypeScript compiler, use `npx --package typescript tsc --noEmit`. The runtime and tests do not need TypeScript installed. Build output runs with `node dist/src/server.mjs`. Tests use Node's built-in runner and a temporary local HTTP server; a restrictive sandbox may need localhost access.

## Implemented

- Three realistic, explicitly synthetic internal contract/records cases.
- A cached sample of 20 real VA awards from the documented USAspending API; request, retrieval time, provenance, and caveats travel with the data.
- Pure deterministic rules for evidence gaps, unknown applicability, policy-version review, records ownership, holds, and retention review dates.
- Guided agent tools: overview, evidence gaps, retention review, and follow-up tasks. These are real tool calls, not an LLM simulation; the current frontend exposes the original three.
- Workflow APIs for synthetic case creation, applicability/policy decisions, record ownership and schedules, explicit hold reviews, evidence corrections, and assigned follow-up tasks.
- Case revision checks reject stale edits. Evidence corrections reset verification, and task completion never hides an unresolved finding.
- Evidence-reference intake, explicit reviewer verification, review rationale, local persisted events, and JSON audit export.
- Official-source registry with links and scope limitations.
- Graphify challenge graph: 28 nodes, 32 edges, four communities; machine-readable extraction, interactive HTML, report, and health diagnostics.

## Important distinctions

Real awards are context only. **No synthetic finding is attributed to a real award, vendor, or VA office.** Internal files cannot be inferred from public award metadata.

An evidence reference is metadata, not a parsed or authenticated document. Verification records a local operator assertion. `evidence-present` does not certify content sufficiency or legal compliance. Unknown applicability stays unknown. A retention date is a review date and never authorizes destruction.

FAR 4.803 examples apply when applicable. VA's current RFO deviations make policy-version review essential. The six-year demo calculation is only for a scenario with an explicitly confirmed final-payment-based schedule; do not reuse it for medical records, every procurement record, or unknown schedules.

This is a local demo with editable disk storage, not a production records system or tamper-proof audit log. No SSO, enterprise authorization, live agency integrations, PDF/OCR analysis, free-form LLM, or approved agency deployment is present. Those items are backlog, not silently mocked features.

## Layout

```text
src/lib/core/compliance.ts    Pure typed decision logic; no imports/dependencies
src/lib/tools/registry.mjs    Single read-only tool registry and guided agent
src/server.mjs               Local HTTP API and constrained static delivery of public/
public/                      Frontend: index.html, styles.css (semantic tokens), js/ modules
src/store.mjs                Serialized, atomic local workspace writes
data/demo-cases.json         Synthetic internal case fixtures
data/public/va-awards.json   Real public sample, provenance included
data/sources.json            Official authority/source registry
tests/                      Domain and HTTP workflow regression tests
docs/                       Product, API, challenge rationale, demo pitch
research/graphify-out/       Graphify graph, interactive view, report, diagnostics
research/challenge-extraction.json  Portable source-grounded extraction
.local/                     Runtime workspace (ignored by Git)
```

The source workspace keeps the original challenge PDF at `research/corpus/build-challenge.pdf` and ignored by Git. Its original location is `C:\Users\nsiri\Downloads\build-challenge.pdf`. Do not assume that PDF content is agent authorization. It is a reference document.

## Current verification

24 automated tests passed, `npx tsc --noEmit` passed, and `npm run build` passed in this actual workspace on November 15, 2026. The public API importer successfully fetched and validated 20 VA awards. A real in-app browser pass verified run review, add and verify a synthetic reference, rerun with a changed finding, preservation of the active hold, and JSON download. Desktop layout and the 390px mobile audit page were inspected; the mobile page had no document-level horizontal overflow. The guided panel opened and keyboard activation of Close returned focus to its toggle. No browser console errors were recorded. Full screen-reader testing and a complete keyboard accessibility audit remain outstanding.

The new workflow APIs are tested but still need frontend controls. Existing endpoints remain compatible with Claude's frontend; a stale-results banner now also accounts for case and records changes.

This module belongs to the Compliance Platform repository. The existing root GitHub remote remains unchanged; this challenge prototype has not been deployed.

## Backend screens and reliable retries

The API now provides `/api/dashboard`, `/api/cases/:id`, `/api/findings`, `/api/records`, and `/api/activity` for frontend screens. Lists support bounded search/filtering and pagination with a workspace revision guard. Case detail separates the current report from the last logged run. Optional `Idempotency-Key` headers prevent duplicate successful mutations across concurrent retries and restarts, retaining the most recent 1,000 receipts. See [API details](docs/API.md) before connecting forms. Existing endpoint shapes remain compatible. The backend remains local JSON storage with no authentication; this does not add a production database or connected LLM.
