# Local API

Base: `http://127.0.0.1:4317`. No authentication is implemented; this is a loopback-only demo. All POST requests require `Content-Type: application/json`. Request bodies are limited to 64 KB. Cross-origin requests are rejected. Run one process per workspace file.

All routes accept `?asOf=YYYY-MM-DD` for reproducible screening. Invalid calendar dates return 400. Default is today's UTC date.

| Method | Route | Result |
|---|---|---|
| GET | `/api/health` | Status and demo mode |
| GET | `/api/workspace` | Cases, reviews, events, source registry, tool descriptors |
| GET | `/api/awards` | Cached public sample or `{provenance:"unavailable",results:[],message}` |
| GET | `/api/cases/:id/report` | Current deterministic findings, summary, records results |
| GET | `/api/cases/:id/packet` | Complete per-case export and accidental-change digest |
| POST | `/api/cases/:id/analyze` | Same report, with an analysis event persisted; body `{}` |
| POST | `/api/cases/:id/agent` | Guided intent result and tool trace |
| POST | `/api/cases/:id/evidence` | New unverified evidence reference (201) |
| POST | `/api/cases/:id/verify-evidence` | Explicit operator verification and event |
| POST | `/api/cases/:id/reviews` | Reviewer rationale and event (201) |
| GET | `/api/export` | Timestamped cases, sources, reports, reviews, and events |

## Request examples

Agent:
```json
{"intent":"evidence"}
```
Allowed intents: `overview`, `evidence`, `retention`, `tasks`. No free-form model is connected. The registry is `src/lib/tools/registry.mjs`.

Evidence:
```json
{"kind":"funding","title":"Demo funding certification","locator":"demo://case/funding"}
```
Allowed kinds: `signed-award`, `funding`, `market-research`, `records-plan`. The server generates the ID, sets provenance to `user-supplied`, and always starts it unverified. This route stores metadata only, not document bytes. Synthetic fixture locators are illustrative and do not point to real documents.

Verification:
```json
{"evidenceId":"returned-id","note":"Reviewed the synthetic evidence reference."}
```
Notes must contain 10–2000 characters. Verification records an operator assertion, not automated document validation.

Review:
```json
{"findingId":"DEMO-VA-001:funding","disposition":"request-evidence","note":"Request the supporting funds certification."}
```
Allowed dispositions: `acknowledged`, `request-evidence`, `escalated`. Reviews do not suppress findings or perform an official agency action. They are local prototype workflow annotations.

## Status handling

400 invalid input, 403 disallowed host/origin, 404 unknown case/evidence/finding/route, 405 unsupported method, 409 revision or retry-key conflict, 413 oversized body, 415 incorrect content type, 500 local persistence failure. Errors use `{ "error": "message" }`; revision conflicts also include `currentRevision`.

Retention statuses are `blocked`, `unknown`, `retain`, `review-due`. Every retention result includes `canDestroy: false`. Do not turn `review-due` into a Delete button. Store failures preserve previous in-memory and saved state; writes are serialized and replaced atomically within a single process.

Exports are JSON. A future UI can use a Blob download; escape all user-supplied text and do not follow arbitrary locator schemes. File deletion, provider credentials, remote actions, and file-content upload APIs are intentionally absent.

## Case workflow API

These endpoints extend the original API without changing its response shapes. All internal cases remain synthetic. New operations are available to frontend clients; the current UI does not yet expose their editing controls.

| Method | Route | Operation |
|---|---|---|
| GET | `/api/cases` | Legacy `{cases}`; optional search/pagination adds `pagination` and each case's `summary` |
| POST | `/api/cases` | Create a synthetic case from `{title, owner, note}`, optionally `contractNumber` and `periodOfPerformance`; unknown applicability, no inferred policy or records |
| POST | `/api/cases/:id/context` | Update title, owner, applicability decisions, policy basis, contract number, or performance dates |
| POST | `/api/cases/:id/records` | Add a record with title and optional owner; unknown hold and schedule |
| POST | `/api/cases/:id/records/:recordId` | Update title, owner, schedule, or finalPaymentDate; cannot change a hold |
| POST | `/api/cases/:id/records/:recordId/hold` | Explicit hold review, including reference and release rationale |
| POST | `/api/cases/:id/evidence/:evidenceId` | Correct kind, title, or locator; resets verification |
| POST | `/api/cases/:id/tasks` | Create a follow-up task linked to a finding in the same case |
| POST | `/api/cases/:id/tasks/:taskId` | Update task title, owner, due date, or status |
| GET | `/api/tasks` | Legacy `{asOf,tasks}`; optional search/filters/pagination adds `pagination` |

Every workflow update to an existing case requires `expectedRevision` and a `note` of 10–2000 characters. Read the revision from `/api/workspace`, `/api/cases`, or the case report. Successful workflow writes return `{case, change}` with the new case revision and before/after details. Creation starts at revision 1. A stale edit returns HTTP 409 with `{error, currentRevision}` and does not modify the case or audit trail. Reload before retrying. Original evidence/verification/review/analyze routes accept an optional expectedRevision, so existing clients continue to work.

Context example:
```json
{"expectedRevision":0,"note":"Reviewed applicability for this synthetic acquisition.","applicability":{"funding":"yes","market-research":"unknown"},"policyBasis":{"confirmed":true,"description":"Synthetic scenario reviewed against the applicable VA deviation.","sourceIds":["va-rfo"]}}
```

Policy basis source IDs must exist in the registry. Confirmation remains a reviewer assertion; the engine cannot establish governing law from this metadata.

Record schedule example:
```json
{"expectedRevision":1,"note":"Confirmed the schedule and final-payment reference for this demo.","owner":"Demo records officer","schedule":{"authority":"Synthetic confirmed contract-file schedule","years":6,"trigger":"final-payment","confirmed":true},"finalPaymentDate":"2018-10-31"}
```
Schedule or finalPaymentDate may be null. Only final-payment-based schedules are currently supported; unsupported triggers fail validation. Unknown schedules are retained as unknown. Final payment cannot be later than the selected asOf date.

Hold-review example:
```json
{"expectedRevision":2,"note":"Recorded the synthetic hold release authorization.","status":"none","reference":"demo://hold-review","releaseReference":"demo://release-authorization"}
```
Status is active, none, or unknown. A review reference is required for every transition; leaving active status additionally requires a releaseReference. Ordinary record edits cannot alter hold status. A reviewer assertion does not perform an official release, and no endpoint authorizes destruction.

After each successful hold review, the record includes `holdReview` (latest) and `holdReviews` (all persisted reviews, oldest first). Each review contains exactly:

| Field | Type / meaning |
|---|---|
| `status` | `active`, `none`, or `unknown` |
| `reference` | Trimmed review reference, 3–1000 characters |
| `releaseReference` | Trimmed reference, 3–1000 characters, or null when omitted; required when leaving `active` |
| `note` | Trimmed rationale, 10–2000 characters |
| `reviewedAt` | Server-recorded UTC ISO timestamp, independent of the screening `asOf` date |
| `actor` | Server-recorded actor (`local-demo-operator` locally, verified subject in the AWS adapter) |

Clients cannot supply `actor`, `reviewedAt`, `holdReview`, or `holdReviews`. These fields return 400 if sent in the hold-review body. Retrying a successful `Idempotency-Key` returns the same timestamp and history without appending another review. A stale `expectedRevision` returns 409 with `currentRevision` and changes nothing. Both the previous and updated record, including any existing hold-review history, appear in `change.before` / `change.after` and the audit event. Ordinary record updates preserve this history.

Example response excerpt for the hold-review request above (HTTP 200):
```json
{"case":{"revision":3,"records":[{"id":"REC-001","hold":"none","holdReview":{"status":"none","reference":"demo://hold-review","releaseReference":"demo://release-authorization","note":"Recorded the synthetic hold release authorization.","reviewedAt":"2026-11-15T12:00:00.000Z","actor":"local-demo-operator"},"holdReviews":[{"status":"none","reference":"demo://hold-review","releaseReference":"demo://release-authorization","note":"Recorded the synthetic hold release authorization.","reviewedAt":"2026-11-15T12:00:00.000Z","actor":"local-demo-operator"}]}]}}
```
Existing records without persisted reviews load without either new property. There is no fabricated historical review or automatic backfill from old events. Earlier hold events remain available in activity and the full export trail. The UI can read these new fields from case detail, workspace, record lists, reports, and exports instead of reconstructing recent history.

Task example:
```json
{"expectedRevision":3,"note":"Assigned the evidence request to the demo reviewer.","findingId":"DEMO-VA-001:funding","title":"Obtain funding certification reference","owner":"Demo contracting officer","dueDate":"2026-11-20"}
```
Task status is open, in-progress, or done. The due date is nullable. Completing an action does not resolve its finding: `needsFollowUp` stays true for evidence gaps, unknowns, blocked records, or unavailable findings. Overdue means an incomplete task with a due date earlier than asOf. The guided agent also supports `{intent:"tasks"}` through `list_follow_up_tasks`.

Workspace and case revisions, rationale, before/after values, and source IDs are included in exports. Review notes now preserve the finding snapshot and case revision at review time. Existing version-1 workspaces gain revision/task defaults in memory and are saved only on the next successful mutation. Analysis runs add history without changing case-input revisions. Local history remains editable, not immutable evidence.

## Optional video service

`GET /api/video/tasks` returns `{status, tasks, message}`. Status is `disabled`, `unavailable`, or `connected`; connected responses include `docsUrl`. Tasks contain only `id`, `filename`, `status`, and `updatedAt`. Configure `VIDEO_API_URL` as an HTTP loopback origin at startup. The adapter reads the existing Python service's `GET /tasks`, rejects redirects, and times out after 2.5 seconds. It does not expose disk paths, mutate records, import detections, or verify evidence. The Python service and web app keep separate stores.

## Backend list and detail APIs

These are additive endpoints. Without new list parameters, task and case-list response shapes are unchanged. Optional saved metadata is carried through workspace and detail responses. All computed screens use the same deterministic rules. No broad compliance score is produced.

| GET route | Response |
|---|---|
| `/api/dashboard` | `asOf`, `ruleVersion`, `workspaceRevision`, `counts`, `recentEvents` (newest 10), `mode` |
| `/api/cases/:id` | `case`, current `report`, computed `tasks`, `reviews`, `recentEvents` (newest 20 for this case), `lastRun`, `lastRunStale`, applicable `sources`, `workspaceRevision` |
| `/api/findings` | `asOf`, `items`, `pagination`; findings include case title, owner, and case revision |
| `/api/records` | `asOf`, `items`, `pagination`; records include case title/revision, retention, and top-level retention `status` |
| `/api/activity` | `asOf`, `items`, `pagination`; committed events in newest-first order |

Dashboard counts: `cases`, `evidenceGaps`, `pendingReviews`, `activeHolds`, `recordsNeedingReview`, `openTasks`, `overdueTasks`, and `tasksNeedingFollowUp`. Counts have distinct meanings and may overlap. Completing a task does not remove its unresolved finding. Counts cover the whole workspace. `asOf` controls current screening, not a historical reconstruction of saved state.

Case detail returns the current computed report separately from `lastRun` (the last logged analysis event). `lastRunStale` is null when no run exists, false for a run of the current case revision, and true otherwise. Full history remains available through filtered activity and export. List/search calls do not log audit events or change revisions.

### Search and pagination

Findings, records, and activity support:

- `q`: trimmed, case-insensitive substring search, at most 200 characters after trimming. Findings search ID, title, case title, owner, and the titles/locators of evidence referenced by that finding's `evidenceIds` in the same case. Unrelated evidence and document contents are not searched. Records search ID, title, case title, and owner; activity searches action, case ID, and actor.
- `limit`: 1–100, default 50; `offset`: nonnegative integer, default 0.
- `workspaceRevision`: optional snapshot guard. Reuse the returned revision when fetching subsequent pages. A changed workspace returns 409 with `currentRevision`; reload from offset 0. Without the guard, each request reads the latest state.
- `asOf`: usual screening date. Keep it consistent across pages.

Exact filters: findings accept `caseId`, `owner`, `category` (`contracting`, `records`, `policy`), finding `status` (`evidence-present`, `needs-evidence`, `needs-review`, `not-applicable`, `blocked`), and `hasOpenTask` (`true` or `false`). A finding has an open task when any task in its case references its ID and has status `open` or `in-progress`; `done` tasks do not count. Records accept `caseId`, `owner`, `hold` (`active`, `none`, `unknown`), retention `status` (`blocked`, `unknown`, `retain`, `review-due`), and `needsReview` (`true` or `false`). Activity accepts `caseId` and `action`. Filters combine with AND before pagination. Unknown, repeated, or invalid parameters return 400. Dashboard and case detail accept only `asOf`.

`needsReview=true` selects a record with no nonblank owner OR retention status `unknown` or `review-due`. It uses the dashboard's identical predicate: with the same `asOf` and workspace revision and no other filters, `pagination.total` equals `dashboard.counts.recordsNeedingReview`. An ownerless record under an active hold is included, but still has `status:"blocked"` and `retention.canDestroy:false`. `needsReview=false` selects the complement. The filters `needsReview` and `hasOpenTask` do not add corresponding fields to the returned rows; existing finding/record row shapes are preserved.

`pagination` contains `total` (matching rows), `offset`, `limit`, `nextOffset` (null at the end), and `workspaceRevision`. Finding/record order follows case inventory order; activity is newest first. Empty matches return 200 and an empty `items` array.

Example: `GET /api/findings?status=needs-evidence&limit=20&offset=0&asOf=2026-11-15`.

On a fresh seeded workspace, `GET /api/records?needsReview=true&asOf=2026-11-15` returns the following excerpt (other existing record fields omitted):
```json
{"asOf":"2026-11-15","items":[{"id":"REC-002","status":"unknown"},{"id":"REC-003","status":"review-due"}],"pagination":{"total":2,"offset":0,"limit":50,"nextOffset":null,"workspaceRevision":0}}
```

Evidence search example: `GET /api/findings?q=demo%3A%2F%2FDEMO-VA-002%2Ffunding&hasOpenTask=false&asOf=2026-11-15` returns this excerpt on a fresh workspace:
```json
{"asOf":"2026-11-15","items":[{"id":"DEMO-VA-002:funding","status":"needs-review","evidenceIds":["EV-003"]}],"pagination":{"total":1,"offset":0,"limit":50,"nextOffset":null,"workspaceRevision":0}}
```

### Opt-in case lists and summaries

`GET /api/cases` and `/api/cases?asOf=2026-11-15` continue to return exactly `{cases}` with no pagination or computed summary. Sending any of `q`, `limit`, `offset`, or `workspaceRevision` enables the extended list response `{cases,pagination}`. An empty `q=` enables this mode without restricting the search.

- `q` searches case `title`, `id`, and `owner`, using the same substring rules above.
- `limit`, `offset`, `workspaceRevision`, and `asOf` have the same meanings, defaults, validation, and 409 behavior as findings. Case inventory order is preserved.
- In this extended mode, each returned case gains `summary` with integer counts `needsEvidence`, `needsReview`, `blocked`, `evidencePresent`, `openTasks`, and `activeHolds`. The first four count current findings through the same rules as the case report. `openTasks` counts tasks whose status is not `done`; `activeHolds` counts records whose hold is `active`. These are counts, not a score. Not-applicable findings are not included in the four finding counts.
- Extended-mode parameters must be unique and drawn from the list above; unknown/repeated/invalid parameters return 400. Old requests without an opt-in parameter retain their legacy query behavior.

Example: `GET /api/cases?q=DEMO-VA-001&limit=10&offset=0&workspaceRevision=0&asOf=2026-11-15` on a fresh workspace returns this excerpt; all existing case fields remain present:
```json
{"cases":[{"id":"DEMO-VA-001","summary":{"needsEvidence":3,"needsReview":1,"blocked":1,"evidencePresent":1,"openTasks":0,"activeHolds":1}}],"pagination":{"total":1,"offset":0,"limit":10,"nextOffset":null,"workspaceRevision":0}}
```

### Opt-in task lists

`GET /api/tasks` and requests containing only `asOf` still return exactly `{asOf,tasks}` with the full computed queue. Sending any of `q`, `owner`, `status`, `overdue`, `needsFollowUp`, `limit`, `offset`, or `workspaceRevision` enables `{asOf,tasks,pagination}`. Empty `q=` enables this mode without restricting the search.

| Parameter | Accepted values / behavior |
|---|---|
| `q` | Trimmed, case-insensitive substring up to 200 characters; searches task `id`, `title`, `owner`, `caseId`, `caseTitle`, and `findingId` |
| `owner` | Nonblank, exact case-sensitive match |
| `status` | `open`, `in-progress`, or `done` |
| `overdue` | Literal `true` or `false`; incomplete task whose non-null `dueDate` is before `asOf` |
| `needsFollowUp` | Literal `true` or `false`; current finding is unresolved/unavailable, independently of task completion |
| `limit` / `offset` | Integers; 1–100 (default 50) / nonnegative (default 0) |
| `workspaceRevision` | Nonnegative integer snapshot guard, just as findings |
| `asOf` | Real `YYYY-MM-DD` screening date; keep fixed across pages |

Filters combine with AND before pagination, preserving the existing queue order (overdue first, then due date, then ID). Task fields are unchanged. Extended-mode parameters must be unique and known; invalid enums, boolean spellings, empty owners, or invalid bounds return 400. A changed workspace returns HTTP 409 with `{error,currentRevision}` and no partial page. Old requests without an opt-in parameter retain their legacy query behavior.

Example: `GET /api/tasks?q=certification&owner=Demo%20reviewer&status=open&overdue=true&needsFollowUp=true&limit=20&offset=0&asOf=2026-11-15`. After creating an overdue funding follow-up task in revision 1, a response excerpt is:
```json
{"asOf":"2026-11-15","tasks":[{"id":"generated-task-id","findingId":"DEMO-VA-001:funding","title":"Obtain funding certification","owner":"Demo reviewer","dueDate":"2026-11-01","status":"open","caseId":"DEMO-VA-001","caseTitle":"Records digitization services","caseRevision":1,"findingStatus":"needs-evidence","needsFollowUp":true,"overdue":true}],"pagination":{"total":1,"offset":0,"limit":20,"nextOffset":null,"workspaceRevision":1}}
```
The existing `sourceIds` array is also returned on each task. A subsequent request with `workspaceRevision=1` after another mutation returns, for example, HTTP 409:
```json
{"error":"Workspace changed. Reload the list from its first page.","currentRevision":2}
```

### Per-case packet

`GET /api/cases/:id/packet` accepts only optional `asOf`. It reads one workspace snapshot without logging an event or changing revisions. Unknown cases return 404; unsupported methods return 405; invalid dates, repeated `asOf`, or other query parameters return 400. This new read-only endpoint has no revision precondition or mutation receipt. Failed/conflicting writes never enter its trail. The existing `/api/export` response is unchanged.

The response contains:

| Field | Meaning |
|---|---|
| `case` | Complete synthetic case, including saved metadata, record reviews, and case revision |
| `report` | Current deterministic report at `asOf`, not the most recent logged run |
| `reviews` | All saved finding reviews for this case, in stored order |
| `tasks` | Current computed tasks for this case, in queue order |
| `holdReviews` | Persisted record hold histories flattened as `{recordId,status,reference,releaseReference,note,reviewedAt,actor}`; record inventory order, then oldest review first |
| `events` | Full saved case event trail in commit order, without the 20/100-event UI limits |
| `sources` | Registry entries cited via `sourceIds` anywhere in the case, report, reviews, tasks, or historical event details; registry order |
| `exportedAt` | Server UTC ISO timestamp |
| `asOf` | Screening date |
| `digestNotice` | Explicit accidental-change-only limitation |
| `digest` | Object described below |

Legacy hold events remain in `events`; absent historical record reviews are not reconstructed or invented. No public award/vendor is included or assigned a finding. All retention outputs still contain `canDestroy:false`.

`digest` is `{algorithm:"SHA-256",value:"<64 lowercase hex characters>",canonicalization:"sorted-keys-json-v1",excludedFields:["digest"]}`. To verify it, remove only the top-level `digest`, serialize the remaining JSON body with recursively lexicographically sorted object keys (JavaScript UTF-16 ordering), preserve array order, use normal JSON string/number escaping with no indentation or extra whitespace, encode as UTF-8 without a BOM, and compute SHA-256. Numeric-looking object keys must also follow lexicographic order. The hash includes `exportedAt`, `asOf`, and `digestNotice`, so separate downloads may have different hashes even with unchanged case inputs. `src/lib/core/canonical.ts` implements the exact algorithm. This is not RFC 8785 or a digital signature. Anyone able to edit the body can recompute the digest.

Example request: `GET /api/cases/DEMO-VA-001/packet?asOf=2026-11-15`. Abbreviated response, with placeholders for full objects and the generated digest:
```json
{"case":{"id":"DEMO-VA-001","provenance":"synthetic"},"report":{"caseId":"DEMO-VA-001"},"reviews":[],"tasks":[],"holdReviews":[],"events":[],"sources":[{"id":"far-4.803"}],"exportedAt":"2026-11-15T12:00:00.000Z","asOf":"2026-11-15","digestNotice":"The digest detects accidental change only. It is not a tamper-proof seal, signature, or proof of authenticity.","digest":{"algorithm":"SHA-256","value":"<computed SHA-256 hex>","canonicalization":"sorted-keys-json-v1","excludedFields":["digest"]}}
```

### Optional synthetic contract context

`POST /api/cases` and `POST /api/cases/:id/context` accept `contractNumber` and `periodOfPerformance`. Record updates (`POST /api/cases/:id/records/:recordId`) accept `schedule.itemNumber` inside the existing schedule object.

| Field | Validation |
|---|---|
| `contractNumber` | Trimmed string of 1–100 characters, no ASCII control characters (U+0000–U+001F or U+007F), or null to clear |
| `periodOfPerformance` | Object with exactly `start` and `end`, both real `YYYY-MM-DD` dates, `start <= end`; or null to clear. Future dates are allowed. |
| `schedule.itemNumber` | Same string/null validation as `contractNumber`; existing schedule authority, years, trigger, and confirmation validation still applies |

Omitting case metadata preserves it on updates and adds no property on creation. A schedule update that omits `itemNumber` preserves the existing item number; if none existed, no property is added. Explicit null clears a value; `schedule:null` still clears the entire schedule. Old records/cases load without new null/default properties. `change.before` and `change.after` contain any present optional metadata, including explicit nulls. Creation has `before:null` and the complete created case in `after`.

Use synthetic identifiers such as `DEMO-VA-2026-001` and `DEMO-010`. These values are reviewer-supplied demo context, never a lookup/link to a real public award or vendor. Case provenance stays `synthetic`; the server does not infer applicability, schedule authority, hold clearance, or compliance from a contract number, date range, or item number. Schedule item numbers do not change the retention calculation.

Example context request (header `Idempotency-Key: context-demo-1`):
```http
POST /api/cases/DEMO-VA-001/context
Content-Type: application/json
```
```json
{"expectedRevision":0,"note":"Recorded synthetic contract context for the demo.","contractNumber":"DEMO-VA-2026-001","periodOfPerformance":{"start":"2026-01-01","end":"2027-01-01"}}
```
HTTP 200 response excerpt:
```json
{"case":{"id":"DEMO-VA-001","revision":1,"provenance":"synthetic","contractNumber":"DEMO-VA-2026-001","periodOfPerformance":{"start":"2026-01-01","end":"2027-01-01"}},"change":{"command":"context","before":{"title":"Records digitization services"},"after":{"contractNumber":"DEMO-VA-2026-001","periodOfPerformance":{"start":"2026-01-01","end":"2027-01-01"}}}}
```
The full before/after context retains its existing title, owner, applicability, and policy fields. New case creation uses `{title,owner,note,contractNumber,periodOfPerformance}` with the same metadata validation and returns HTTP 201; creation has no existing-case revision precondition.

Example schedule request after that context update (header `Idempotency-Key: schedule-demo-1`), to `POST /api/cases/DEMO-VA-001/records/REC-001`:
```json
{"expectedRevision":1,"note":"Recorded the synthetic schedule item reference.","schedule":{"authority":"Synthetic confirmed contract-file schedule","years":6,"trigger":"final-payment","confirmed":true,"itemNumber":"DEMO-010"}}
```
The existing `{case,change}` response includes `case.revision:2` and `change.after.schedule.itemNumber:"DEMO-010"`, while the record's active hold still blocks retention review. All these updates retain revision conflicts (409 with `currentRevision`), keyed retry receipts, and before/after audit events. Invalid optional values return 400 without saving anything or reserving a retry key.

## Review workbench and evidence library

These two additive GET endpoints assemble existing synthetic case data. They do not create new controls, infer legal obligations, send requests to other people, or change findings. Existing mutation routes remain the only way to assign tasks, supply/verify evidence, annotate findings, or review holds. Existing list and detail shapes are unchanged.

Both endpoints return `{asOf,ruleVersion,items,pagination,sources,limitation}`. `sources` contains registry entries cited by the returned page only, in registry order. The usual `q` (trimmed case-insensitive substring, max 200 characters), `limit` (1–100, default 50), `offset` (nonnegative, default 0), `workspaceRevision` snapshot guard, and real `asOf` date apply. Filters combine with AND before pagination. Unknown/repeated/invalid parameters return 400; stale revisions return 409 with `currentRevision`; non-GET methods return 405. Empty matches return 200. Reads never create events or modify revisions.

### GET /api/workbench

Returns one row per current finding, with its existing finding fields (`id`, `caseId`, `category`, `title`, `status`, `explanation`, `nextAction`, `sourceIds`, `evidenceIds`) plus:

| Field | Meaning |
|---|---|
| `caseTitle`, `caseRevision`, `caseOwner` | Current case context |
| `owner` | Record owner for record-specific findings (may be null); case owner otherwise. This is not the task assignee. |
| `evidence` | Current evidence references named by this finding, within the same case |
| `record` | Matching computed record including retention and any saved hold history, or null |
| `tasks` | All existing computed tasks linked to this finding, including completed tasks; existing queue order |
| `taskOwners` | Distinct owners of incomplete tasks, in queue order |
| `earliestDueDate` | Earliest non-null due date of incomplete tasks, or null |
| `hasOpenTask`, `overdue` | Whether any linked task is incomplete / incomplete and past due |
| `needsFollowUp` | Finding status is neither `evidence-present` nor `not-applicable`; independent of task completion |
| `attention`, `attentionReason` | Operational ordering category and its plain-language explanation |
| `lastReview` | Latest saved annotation for this finding in commit order, or null |
| `lastReviewStale` | False when the matching review event's committed case revision is current; true after any later case revision; null when no review or committed revision is available. Conservative freshness, not an approval decision. The review itself increments the revision, so its committed event is used instead of its pre-write snapshot. |
| `casePacketUrl` | Relative URL to this case's packet with the same `asOf` |

`attention` categories and ordering, evaluated top to bottom:

1. `preserve-record`: finding is blocked by an active hold, even if tasks are overdue or completed.
2. `overdue-task`: any linked incomplete task is overdue, even if evidence is now present.
3. `assign-follow-up`: finding needs follow-up but has no incomplete task.
4. `follow-up`: finding needs follow-up and has an incomplete task.
5. `monitor`: all other rows. This is not an audit approval or certification.

Within each category, rows sort by earliest incomplete-task due date (null last), then finding ID. This ordering is a work queue, not a compliance score, risk severity, or legal deadline.

Exact filters: `caseId`, `owner`, `category` (`contracting`, `records`, `policy`), `status` (the existing five finding statuses), `attention` (the five values above), and literal `true`/`false` for `hasOpenTask`, `overdue`, and `needsFollowUp`. `q` searches finding ID/title, case ID/title, owner, case owner, linked evidence titles/locators, and linked task titles/owners. It does not search arbitrary document contents or review notes. Filters do not change saved state. `owner` never silently falls back from an ownerless record to the case owner.

Example: `GET /api/workbench?attention=preserve-record&limit=10&asOf=2026-11-15` on a fresh workspace returns this excerpt:
```json
{"asOf":"2026-11-15","items":[{"id":"DEMO-VA-001:record:REC-001","status":"blocked","owner":"Demo records officer","caseOwner":"Demo contracting officer","attention":"preserve-record","needsFollowUp":true,"hasOpenTask":false,"overdue":false,"tasks":[],"taskOwners":[],"earliestDueDate":null,"lastReview":null,"lastReviewStale":null,"record":{"id":"REC-001","hold":"active","retention":{"status":"blocked","canDestroy":false}},"casePacketUrl":"/api/cases/DEMO-VA-001/packet?asOf=2026-11-15"}],"pagination":{"total":1,"offset":0,"limit":10,"nextOffset":null,"workspaceRevision":0}}
```
Full responses include the remaining finding fields, `ruleVersion`, `sources`, and `limitation`. To act on a row, use the existing case task/evidence/review/hold endpoints with the current `caseRevision` as `expectedRevision` and a fresh `Idempotency-Key`, then reload. Completing a task or adding an acknowledgement never closes the finding.

### GET /api/evidence

Central index of existing evidence references. Rows keep `id`, `kind`, `title`, `locator`, `verified`, and evidence `provenance`, adding `caseId`, `caseTitle`, `caseOwner`, `caseRevision`, `caseProvenance`, `verificationStatus`, `linkedFindings`, and `sourceIds`.

- `verificationStatus` is `verified-reference` only when the saved verification flag is true and the locator is nonblank; otherwise `unverified-reference`. This is not evidence-content approval.
- `linkedFindings` contains `{id,title,status}` for current findings in the same case that actually reference this evidence ID. Unknown applicability remains `needs-review` even when the reference is verified. Equal evidence IDs in different cases are not joined.
- `sourceIds` is the deduplicated union of those findings' cited source IDs. `caseProvenance` remains `synthetic`. Evidence itself retains its existing `synthetic` or `user-supplied` provenance.
- `caseOwner` is explicitly case ownership. No evidence owner, renewal date, or automatic freshness conclusion is invented from this field.
- Exact filters: `caseId`, `kind` (`signed-award`, `funding`, `market-research`, `records-plan`), `verificationStatus` (the two values above).
- `q` searches evidence ID/title/locator, case ID/title, and case owner. Ordering follows case inventory, then evidence inventory.

Example: `GET /api/evidence?kind=funding&verificationStatus=unverified-reference&asOf=2026-11-15` returns this excerpt on a fresh workspace:
```json
{"asOf":"2026-11-15","items":[{"id":"EV-003","caseId":"DEMO-VA-002","kind":"funding","title":"Unverified funding reference","locator":"demo://DEMO-VA-002/funding","verified":false,"verificationStatus":"unverified-reference","caseProvenance":"synthetic","linkedFindings":[{"id":"DEMO-VA-002:funding","title":"Availability of funds evidence","status":"needs-review"}],"sourceIds":["far-4.803"]}],"pagination":{"total":1,"offset":0,"limit":50,"nextOffset":null,"workspaceRevision":0}}
```

These workflow choices draw on publicly documented evidence-request tracking in [Vanta](https://help.vanta.com/en/articles/12293647-managing-an-information-request-list-irl), evidence-to-control mapping and distinct ownership in [Drata](https://help.drata.com/en/articles/13404035-evidence-overview), remediation separated from reassessment in [ServiceNow](https://www.servicenow.com/docs/r/governance-risk-compliance/policy-and-compliance-management/remediate-issue.html), and hold visibility/history in [OpenText](https://www.opentext.com/products/core-legal-hold), reviewed November 15, 2026. These are product-workflow references, not legal authorities, integrations, copied proprietary implementations, or new entries in the policy source registry.

## Retry-safe mutations

Every mutating POST can optionally send `Idempotency-Key`, a unique client-generated value of 1–128 letters, digits, dots, underscores, colons, or hyphens. Generate one key per intended action; reuse it only to retry that action after a connection failure. Keys are scoped to this local workspace across all mutation routes.

A successful request and its response receipt are saved atomically. Repeating the same key, path, JSON body, and explicit `asOf` value returns the original result without another mutation, revision increment, or audit event, including after restart. JSON object field order does not affect request identity. If `asOf` was omitted, a later retry returns the original result even after the UTC date changes. The original HTTP success status is retained by the endpoint.

A key reused with different content returns 409. Validation failures do not reserve a key. Revision checks still protect new edits, but a successful retry replays its original result before checking the now-advanced case revision. Reload case detail after replay if current state is needed. Read-only guided-agent requests do not create receipts.

The most recent 1,000 successful keyed mutations are retained; older keys can execute again after eviction. This is bounded local retry protection, not indefinite deduplication. Receipts are stored in the workspace file but omitted from workspace and export responses. They are not credentials or immutable audit evidence. Continue to run one server process per workspace file.

## Optional AWS adapter

The existing local server remains loopback-only and unauthenticated. The separately packaged AWS backend puts the same API behind Cognito and API Gateway. `GET /api/session` returns `{mode, authenticated, actor, roles}`; mode is `local-demo` locally and `aws-pilot` in Lambda. Cloud requests use an access token in the Authorization header. Cloud user groups control mutations: reviewer for case/evidence/task workflows, records-officer for record and hold changes, admin for either, and reader for GET/read-only guided-agent calls. Groups can be combined.

Cloud idempotency keys are scoped to the verified user. S3 concurrency conflicts return 409 with an instruction to reload; unlike case revision conflicts, they may not contain `currentRevision`. Retry with the same key after an uncertain outcome. Cloud audit actors are verified Cognito subjects; actor headers and JSON fields cannot override them. The video adapter is disabled in Lambda. The pilot stores one shared workspace limited to 4 MiB and is not deployed. See `../../../infra/aws/README.md` for the architecture and remaining deployment/authentication work.

## Document intake, jobs, and service status

These routes exist only in the full local stack started with `npm run dev` at the repository root. The gateway on port 4317 forwards them to the documents and jobs services. The standalone server (`npm run dev:standalone`) does not serve them and returns 404, and the frontend then shows that document intake is not running. None of these routes take `asOf`. PDF parsing and OCR are not connected. Document text is untrusted source material: it is never treated as an instruction and nothing is concluded from it.

| Method | Route | Result |
|---|---|---|
| GET | `/api/services` | `{mode:"local-microservices",status,services:[{name,status}]}`; status is `ok` or `degraded` |
| GET | `/api/documents` | `{items,pagination}` of document metadata; optional `q`, `caseId`, `limit`, `offset` |
| POST | `/api/documents` | Store a text document and queue extraction (202 `{document}`) |
| GET | `/api/documents/:id` | `{document,events}` |
| GET | `/api/documents/:id/content` | `{documentId,sha256,mediaType,content,normalization}` |
| GET | `/api/documents/:id/spans` | `{documentId,sha256,items,pagination}`; optional `q`, `limit`, `offset`; 409 while extraction is pending |
| POST | `/api/documents/:id/evidence` | Link the extracted document as an unverified evidence reference (201 `{evidence,note}`) |
| GET | `/api/jobs` | `{items,pagination}`; optional `status` (`queued`, `running`, `succeeded`, `failed`), `documentId`, `limit`, `offset` |
| GET | `/api/jobs/:id` | `{job,events}` |
| POST | `/api/jobs/:id/retry` | Requeue a failed job; body `{note}` of 10 to 2000 characters |

Every POST in this section requires an `Idempotency-Key` header (1 to 128 letters, digits, dots, underscores, colons, or hyphens). Repeating a key with the same content returns the original result; a key reused with different content returns 409.

`POST /api/documents` accepts exactly `{caseId,title,filename,mediaType,content,note}`. `mediaType` is `text/plain`, `text/markdown`, or `application/json` (other types return 415). `content` is nonempty text up to 256 KiB without NUL bytes; JSON content must parse. `filename` is a display name without slashes. `note` has 10 to 2000 characters. The case must exist. Line endings are converted to LF before the SHA-256 is computed.

Document metadata contains `id`, `caseId`, `title`, `filename`, `mediaType`, `note`, `sha256`, `bytes`, `provenance` (`user-supplied`), `status` (`pending` or `ready`), `jobId`, `dispatchPending`, `createdAt`, `extractedAt` (once ready), `linkedEvidence` (evidence IDs), and `spanCount`. Content and spans are returned only by their own routes. A span is `{id,startOffset,endOffset,startLine,endLine,text,locator}`; offsets are UTF-16 code units and spans are at most 1200 characters, split at line breaks where possible.

`POST /api/documents/:id/evidence` accepts `{kind,expectedRevision,note}`. `kind` is one of the four evidence kinds, `expectedRevision` is the current case revision, and `note` has 10 to 2000 characters. The document must be `ready` (409 otherwise). The reference is created through the normal evidence route with title equal to the document title and locator `document://<documentId>#sha256=<hash>`. It always starts unverified; verification remains the separate, explicit `verify-evidence` step. A stale `expectedRevision` returns 409 with `currentRevision` through the document service and the gateway, and no workflow event or link is recorded.

Jobs contain `id`, `documentId`, `type` (`extract-text`), `status`, `attempts`, `maxAttempts`, `availableAt`, `leaseUntil`, `createdAt`, `updatedAt`, `error`, and `result`. A job is retried automatically up to `maxAttempts`; only a `failed` job can be requeued by hand.

Pagination in this section is `{total,limit,offset,nextOffset}` with `limit` 1 to 100 (default 50). There is no `workspaceRevision` guard on these lists. Documents and jobs are stored by their own services, separately from the workflow workspace, so a case packet and a document snapshot can have different capture revisions.

## Case journey, review drafts, and relationships

All of this is additive. Requests that do not use these routes or fields behave as before.

### Case journey

`GET /api/cases/:id` now also returns `journey`: five stages in order, `context`, `evidence`, `checks`, `review`, `handoff`. Each stage is `{id,label,state,responsible,outstanding,nextAction,link}`. `state` is a short description of what is stored, `outstanding` is a list of plain statements, and `link` is the case section that holds the work. There are no percentages or scores. The handoff stage describes the packet as a handoff artifact. It never states that a case is compliant.

### Review drafts

Journey wording: active record holds appear as preservation instructions. The handoff does not count the same held record again as an unresolved evidence review. Other unresolved findings, including blocked findings unrelated to those active holds, remain listed. This changes descriptive text only: findings retain `blocked`, holds remain active, and `canDestroy` remains false. A completed evidence review with one active hold has one handoff notice: `"1 active hold will appear in the packet"`.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/cases/:id/drafts` | `{asOf,ruleVersion,caseRevision,drafts,identity,limitation}` |
| GET | `/api/cases/:id/drafts/prepare?findingIds=a,b` | Suggested `{title,text,findingIds}` built from the deterministic findings, with `snapshot` and `evidenceHash`. Nothing is saved. Without `findingIds` the open findings are cited. |
| GET | `/api/cases/:id/drafts/:draftId` | `{draft,asOf,identity,limitation}` |
| POST | `/api/cases/:id/drafts` | 201 `{draft,change,limitation}`. Body: `expectedRevision`, `title`, `text`, `findingIds`, optional `author`, `reviewer`, `note`. |
| POST | `/api/cases/:id/drafts/:draftId` | Saves a new version. Body: `expectedRevision`, `expectedVersion`, `note`, and at least one of `title`, `text`, `findingIds`, `reviewer`, or `refreshSnapshot:true` to take a new evidence snapshot without changing the text. |
| POST | `/api/cases/:id/drafts/:draftId/submit` | Body: `expectedRevision`, `expectedVersion`, optional `reviewer`, `note`. |
| POST | `/api/cases/:id/drafts/:draftId/decision` | Body: `expectedRevision`, `expectedVersion`, `decision` (`reviewed` or `changes-requested`), `reviewer`, `note`. |

A draft is `{id,caseId,state,version,author,authorActor,identity,reviewer,createdAt,updatedAt,versions,decisions}`. `state` is `draft`, `submitted`, `changes-requested`, or `reviewed`. `reviewer` is routing metadata only.

Each entry in `versions` is the exact saved content: `version`, `title`, `text`, `findingIds`, `contentHash`, `snapshot`, `evidenceHash`, `caseRevision`, `asOf`, `ruleVersion`, `savedAt`, `actor`, `note`. The snapshot lists the cited finding IDs with their status, the evidence items behind them with reference and verification state, the source IDs, and document hashes and span references where a link is stored. Both hashes are SHA-256 values computed by the server. Clients never supply them.

Each entry in `decisions` is `{id,type,version,contentHash,evidenceHash,reviewer,actor,identity,note,at}` with `type` of `submitted`, `changes-requested`, or `reviewed`. A decision is bound to the content and evidence hashes of the version it was made against. History is never rewritten.

Reads add computed fields: `currentEvidenceHash`, `evidenceChanged`, `needsFreshReview`, `reviewCurrent`, and on every decision `stale` with `staleReasons` (`draft-text-changed`, `evidence-changed`). A later edit to the note, or a change to cited evidence, leaves the earlier decision in place and marks it stale.

Rules:

- Saving a new version returns the draft to `draft`.
- Submitting or deciding against evidence that changed since the version was saved returns 409 with `currentVersion`. Save a new version first.
- `expectedVersion` that is not the current draft version returns 409 with `currentVersion`. `expectedRevision` still returns 409 with `currentRevision` as elsewhere.
- A finding ID that belongs to another case returns 404.
- The typed reviewer cannot be the typed author (400). With a signed-in identity the author cannot record the decision on their own draft (403).
- `Idempotency-Key` works as on other mutations. A retried submission replays its original response and does not overwrite a newer version.
- Draft mutations do not change the case revision, findings, evidence, tasks, records, or holds. A `reviewed` draft never resolves a finding, verifies evidence, releases a hold, or authorizes destruction. `limitation` states this on every response.
- Events `review-draft-created`, `review-draft-revised`, `review-draft-submitted`, and `review-draft-decided` carry `{draft, change:{command,note,before,after}}`.

`identity` is `{trusted,notice}`. In the local demo `trusted` is false: names are typed, are stored as `unverified-local-demo`, and a recorded decision does not prove an independent review. Behind the authenticated adapter the signed-in actor is used and stored as `verified`.

Drafts are stored in the workspace under `drafts`. The key appears in the workspace and its export only after the first draft is created.

### Packet

`GET /api/cases/:id/packet` includes `reviewDrafts` (the draft views above, including stale decisions) and `reviewDraftNotice` once the case has at least one draft. Both are inside the digest. A case with no drafts returns the earlier packet shape unchanged. The digest still detects accidental change only. It is not a signature or a tamper-proof seal.

### Guided assistant

`POST /api/cases/:id/agent` accepts four more intents and optional `findingId`, `destination`, and `query`. It remains read-only and deterministic. No model is called.

| Intent | Tool | Needs | Result |
| --- | --- | --- | --- |
| `explain-finding` | `explain_finding` | `findingId` | `{finding,applicability,record,tasks,limitation}` |
| `finding-evidence` | `evidence_for_finding` | `findingId` | `{findingId,title,status,usesEvidence,supporting,unverified,missing,sourceIds}` |
| `handoff` | `preview_handoff` | none | `{caseId,title,asOf,unresolvedFindings,activeHolds,openTasks,evidence,packetUrl,note}`; every active hold carries `canDestroy:false` |
| `navigate` | `navigate` | `destination` or `query` | `{matched:true,destination:{id,label,hash}}`, or `{matched:false,message,destinations}` listing the fixed choices |

A `findingId` from another case returns 400. Destinations come from one fixed list in `src/lib/tools/registry.mjs`: `workbench`, `overview`, `cases`, `evidence-library`, `documents`, `records`, `tasks`, `activity`, `export`, `status`, `sources`, `awards`, `case-findings`, `case-evidence`, `case-records`, `case-tasks`, `case-drafts`, `case-links`, `case-history`, `case-file`. The result is a hash route, never a free-form URL. Each trace step is `{step,tool,caseId,asOf}` plus `findingId` for the two finding tools. An unknown intent returns 400 with the list of supported intents.

### Relationships

The relationship view in the interface is built only from links that are already stored: finding to evidence, evidence to document and span, finding to source, and case to records, holds, tasks, and review events. It adds no endpoint and infers nothing. A missing link is shown as missing.

## Check profile

The workspace can be used by any agency or company. A profile says who the workspace belongs to and which evidence checks new cases are screened against. Everything here is additive: with no profile loaded, every earlier request and response is unchanged.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/profile` | `{profile,builtIn,workspaceRevision,limitation}`. `builtIn` is true until a profile is loaded, and `profile` is then the built-in example. |
| POST | `/api/profile` | Body `{profile,note}` loads a profile. Body `{reset:true,note}` restores the built-in example. Optional `expectedWorkspaceRevision` returns 409 with `currentRevision` when the workspace has changed. Returns `{profile,builtIn,change,workspaceRevision,limitation}`. |

A profile is `{organization:{name,kind},checkSet:{id,name,checks,policySourceIds,recordsSourceIds},sources}`.

- `organization.kind` is `agency`, `company`, or `other`.
- `checks` holds 1 to 20 entries of `{kind,title,sourceIds}`. `kind` and the IDs are 2 to 40 lowercase letters, digits, or hyphens, starting with a letter.
- `sources` holds up to 50 entries of `{id,title,url,locator,scope,checkedOn}`. The URL must be https. A source ID cannot reuse a built-in ID.
- Every cited source ID must be a built-in source or one defined in the same profile.
- Unknown fields are rejected with 400. A profile cannot carry scores, thresholds, or outcomes. It names checks and cites sources only.

Effects:

- A new case takes `agency` from the organization name, stores the check set and its sources on the case as `checkSet`, and starts every applicability as `unknown`. Its ID starts with `DEMO-` instead of `DEMO-VA-`.
- Existing cases are never changed. A case without `checkSet` keeps the built-in example checks.
- Evidence kinds and applicability keys are validated against the checks of the case they belong to.
- Check findings behave exactly as before: unknown applicability gives `needs-review`, an unverified reference gives `needs-review`, and no reference gives `needs-evidence`. Holds, retention, and `canDestroy:false` are not affected by a profile.
- Source lists in `/api/workspace`, `/api/export`, the workbench, and the evidence library are workspace discovery lists: built-in sources, then the loaded profile's, then sources stored with a case, one entry per ID. They do not decide what a case shows. Case-specific responses resolve sources per case; see "Example presets and case-specific sources" below.
- `/api/workspace` and `/api/export` include `profile` only while one is loaded.
- Events `profile-loaded` and `profile-reset` carry `{profile,builtIn,change:{note,before,after}}` with a null `caseId`.
- The guided assistant gained the destination `profile`.

Limits: the separate policies service still serves only the packaged source registry, and an existing case cannot yet be moved to a different check set.

## Service operations

Additive changes to the local services. Earlier fields and status codes are unchanged.

- `GET /api/services` adds `checkedAt`, and `responseMs` on every service (null when it did not answer). The worker entry adds `detail`: `{busy,lastCycleAt,lastError,completed,failed}`, counted since the worker started.
- `GET /api/jobs/summary` returns `{total,counts:{queued,running,succeeded,failed},oldestQueuedAt}`. It carries no job content.
- `GET /api/policies` adds `profileSources`: `{status,builtIn,sources}` with the sources a loaded check profile defines. `sources` and `snapshotId` still describe only the packaged registry. `GET /api/policies/:id` also resolves a profile source and marks it with `origin: "check-profile"`. If the workflow service does not answer, `profileSources.status` is `unavailable` and the packaged registry is still served.
- `GET /api/audit/cases/:id` adds `reviewDrafts` and `reviewDraftNotice` to the packet once the case has at least one draft. These are the stored drafts with their versions and decisions; the computed stale markers are on `GET /api/cases/:id/packet`.
- The worker waits longer between attempts while a service it depends on is down (1, 2, 4, then 8 seconds) and returns to its normal interval after the first success. Queued jobs stay saved throughout.

## Policy versions and per-case policy context

A source citation does not establish that a requirement applies to a case. These additions keep three things apart: an official source was retrieved on a date, our reading of it has or has not been reviewed by a specialist, and a reviewer recorded an applicability decision for one case. Everything is additive. No existing field, status code, or default query behavior changed.

### Registry fields

`data/sources.json` stays the single registry. A source may carry two optional fields:

- `policyVersionId`: the version this source belongs to.
- `policyVersion`: the version's metadata, held on exactly one source per version:
  `{policyId,policyTitle,versionId,label,agency,scope,provision,issuedOn,publishedOn,effectiveOn,reviewStatus,applicabilityConditions,unresolvedQuestions,deviatesFrom,supersedes}`.

Dates are `YYYY-MM-DD` or `null` when the source does not give one. `reviewStatus` is `retrieved-not-reviewed` or `qualified-review-recorded`; every registered version is currently `retrieved-not-reviewed`. `deviatesFrom` and `supersedes` list version IDs of the same policy and are filled only when the source supports the relationship. No supersession is recorded today.

Registered versions:

| `versionId` | Effective | Sources |
| --- | --- | --- |
| `far-part-4@codified` | not recorded | `far-4.803`, `far-4.805` |
| `far-part-4@va-class-deviation-2025-11-03` | 2025-11-03 | `va-far-part-4-deviation`, `va-flash-26-03` |
| `vaar@codified` | 2024-03-20, as stated on the index page | `vaar-codified` |
| `vaar@va-rfo-class-deviations-2026-10-01` | 2026-10-01 | `va-rfo`, `va-flash-27-02` |
| `va-directive-6300@registered-2026-11-15` | not recorded | `va-6300` |

The four new source IDs appear wherever sources are listed.

### Routes

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/policy-versions` | `{policies,enums,limitation}`. Each policy is `{policyId,title,versions}`; each version is the metadata above plus `sources:[{id,title,url,locator,retrievedOn}]`. |
| GET | `/api/cases/:id/policy-context` | `{caseId,asOf,caseRevision,consideredVersionIds,entries,counts,reviews,limitation}` |
| POST | `/api/cases/:id/policy-reviews` | 201 `{review,case,policyContext,change,limitation}` |
| GET | `/api/policy-reassessment` | `{asOf,workspaceRevision,total,cases,limitation}`; each case is `{caseId,title,owner,caseRevision,entries}` with only the entries that require reassessment. |

`GET /api/cases/:id` also returns `policyContext` (the same object without `limitation`). `GET /api/cases/:id/packet` adds `policyContext` and `policyContextNotice` once the case has at least one policy review; a case with none keeps the earlier packet shape.

### Policy context

One entry per policy that the case's findings cite or that a review has decided:

```json
{
  "policyId": "vaar",
  "title": "VA Acquisition Regulation (VAAR)",
  "status": "requires-reassessment",
  "reason": "A later version of this policy is in effect on the screening date. The earlier review is kept and needs a fresh decision.",
  "citedVersionIds": ["vaar@va-rfo-class-deviations-2026-10-01"],
  "inEffectVersionIds": ["vaar@va-rfo-class-deviations-2026-10-01", "vaar@codified"],
  "effectiveDateUnknownVersionIds": [],
  "reviewedVersionId": "vaar@codified",
  "reviewId": "DEMO-POLICY-REVIEW-001",
  "reviewedAt": "2026-09-10T15:00:00.000Z",
  "laterVersionIds": ["vaar@va-rfo-class-deviations-2026-10-01"],
  "unresolvedQuestions": ["..."]
}
```

`status` is one of:

- `unresolved`: no decision is recorded for the policy on this case, or the latest decision left it unresolved.
- `confirmed`: the latest decision confirmed a version, and no later version of that policy is in effect on the screening date.
- `requires-reassessment`: the latest decision confirmed a version, and a later version is in effect on the screening date.

A later version is one of the same policy with a known `effectiveOn` on or before `asOf` that either names the reviewed version in `deviatesFrom` or `supersedes`, or has a later effective date than a known effective date on the reviewed version. A version with no effective date is never treated as later. `counts` is `{confirmed,unresolved,requiresReassessment}`. `consideredVersionIds` lists the exact versions behind the picture.

The policy context never changes a finding. The existing `policy-basis` finding and `policyBasisConfirmed` behave as before.

### Recording a review

```json
POST /api/cases/DEMO-VA-001/policy-reviews
Idempotency-Key: policy-1
{
  "expectedRevision": 0,
  "reviewer": "Synthetic demo reviewer",
  "note": "Recorded for the synthetic demo.",
  "decisions": [
    { "versionId": "far-part-4@va-class-deviation-2025-11-03", "applicability": "confirmed", "basis": "Synthetic basis text for the demonstration." }
  ]
}
```

- `decisions` holds 1 to 20 entries with one decision per policy. `applicability` is `confirmed` or `unresolved`. `basis` and `note` are 10 to 2000 characters. `reviewer` is 1 to 200 characters. Unknown fields return 400. An unknown `versionId` returns 404.
- `expectedRevision` is required. A stale value returns 409 with `currentRevision`. `Idempotency-Key` replays the original response and a different body under the same key returns 409.
- The stored review is `{id,caseId,at,caseRevision,reviewer,actor,identity,synthetic,decisions,note}`. `identity` is `unverified-local-demo` in the local demo and `verified` behind the authenticated adapter. `synthetic` is true on a synthetic case. A review is never a real agency approval.
- Reviews are appended to `case.policyReviews` and never edited. The case revision increases by one. Findings, evidence, records, holds, and tasks do not change.
- Event `policy-review-recorded` carries `{review,case,change:{command,note,before,after}}`, where `before` and `after` list `{policyId,status,reviewedVersionId}` per policy.

### Policy changes

A policy change is a new version in the registry. Nothing stored is rewritten when one is added. Cases whose latest confirmation is now behind a later version read `requires-reassessment`, keep the earlier review and its version reference, and appear in `GET /api/policy-reassessment`. Use `asOf` to see the picture on an earlier date.

### Synthetic demo

- `DEMO-VA-001` and `DEMO-VA-002` have no policy review: every entry is `unresolved`.
- `DEMO-VA-003` carries one seeded review dated 2026-09-10, labelled synthetic, that confirms the FAR Part 4 class deviation and the VAAR as then published. On a screening date before 2026-10-01 both read `confirmed`. From 2026-10-01 the VAAR entry reads `requires-reassessment` and the review is still listed unchanged.

The guided assistant gained the destination `case-policy`.

## Evidence traceability and sufficiency assessments

A reviewer can answer: what material supports this check, where does it say that, who assessed it, and has anything changed since. Four facts stay separate and none establishes legal compliance: material received (a stored document), a passage linked to a check (a citation), a reference verified (the existing `verified` flag), and material assessed as sufficient for a stated check (an assessment). Everything is additive. Existing evidence references, verification, review notes, and drafts behave as before.

### Routes

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/cases/:id/evidence-review` | `{caseId,asOf,caseRevision,documents,findings,enums,identity,limitation}` |
| POST | `/api/cases/:id/citations` | 201 `{citation,case,change,limitation}` |
| POST | `/api/cases/:id/assessments` | 201 `{assessment,case,change,freshness,identity,limitation}` |

Both mutations require `expectedRevision`, return 409 with `currentRevision` when it is stale, honor `Idempotency-Key`, and write a before/after audit event (`citation-linked`, `citation-corrected`, `sufficiency-assessed`). Each increases the case revision by one. Unknown fields return 400.

`documents` is `{status,message}` with `status` of `available`, `unavailable` (the document service did not answer), or `not-configured` (standalone mode). `identity` is `{trusted,notice}`. Entries are attributed to the server's actor. A typed reviewer name is not accepted on these routes.

### Citations

```json
POST /api/cases/DEMO-VA-001/citations
Idempotency-Key: cite-1
{
  "expectedRevision": 1,
  "note": "The line names a funding reference for this synthetic case.",
  "findingId": "DEMO-VA-001:funding",
  "evidenceId": "<evidence id on this case>",
  "documentId": "<document id>",
  "sha256": "<content digest of the document version being cited>",
  "spanId": "span-1",
  "quote": "Funding reference FY26-SYN-001 certifies availability of funds."
}
```

Optional `replaces` names a current citation on the same finding and evidence to correct it. The earlier citation is kept and reads `replaced`.

The stored citation is `{id,caseId,findingId,evidenceId,documentId,sha256,extraction:{extractedAt,spanCount},location:{spanId,startOffset,endOffset,startLine,endLine},quote,quoteHash,createdAt,actor,identity,note,replaces}`. Offsets are UTF-16 code units into the stored, line-ending-normalized text, the same offsets the extractor produces. There are no page numbers, because supported formats are plain text, Markdown, and JSON. PDF and OCR are still not connected.

Validation, all checked by the server against the document service:

- The finding must belong to the case and be an evidence check. Record and policy findings take no citations (400). A finding from another case is 404.
- The evidence must be on the case (404) and support that check (400).
- The document must belong to the same case (404) and be extracted (409).
- `sha256` must equal the stored document's digest (409). A different stored version is refused, never adopted.
- `quote` is 3 to 2000 characters and must appear exactly once in the named span. No match is 400. More than one match is 400 and asks for a longer quote. The server computes the offsets and lines.
- With no document service the route returns 503 and stores nothing.

### Assessments

```json
POST /api/cases/DEMO-VA-001/assessments
Idempotency-Key: assess-1
{
  "expectedRevision": 2,
  "findingId": "DEMO-VA-001:funding",
  "evidenceIds": ["<evidence id>"],
  "outcome": "sufficient-for-stated-check",
  "rationale": "The quoted line names a funding reference. Assessed for the funds check only."
}
```

`outcome` is `sufficient-for-stated-check`, `insufficient`, or `needs-clarification`. `rationale` is 10 to 2000 characters. `evidenceIds` must be evidence that supports the finding, and cannot be empty for `sufficient-for-stated-check`. Reference-only evidence can be assessed.

The stored assessment is `{id,caseId,findingId,outcome,rationale,evidenceIds,snapshot,snapshotHash,at,actor,identity,synthetic}`. `snapshot` is `{caseRevision,asOf,ruleVersion,finding:{id,title,status,applicability},evidence:[{id,kind,title,locator,verified,hash}],citations:[{id,evidenceId,documentId,sha256,extractedAt,location,quoteHash}],policy:[{policyId,status,reviewedVersionId,inEffectVersionIds}]}`. `policy` holds only the policies behind the finding's own sources. `finding.applicability` is the assessed check's applicability (`yes`, `no`, or `unknown`) and is compared for freshness. `finding.status` is recorded for the reader and is never compared, because verification can change a status on its own. `identity` is `unverified-local-demo` or `verified`.

Assessments are appended to `case.assessments` and never edited. An assessment never changes a finding's status, verifies a reference, confirms applicability, completes a task, releases a hold, or affects `canDestroy`.

### Freshness

Every assessment in a read carries `freshness: {state,causes}`. `state` is `current`, `needs-review`, or `cannot-establish`. Each cause is `{code,message}` plus the ID it concerns.

| Code | Meaning |
| --- | --- |
| `evidence-corrected` | The title, check, or locator of assessed evidence changed |
| `evidence-removed` | Assessed evidence is no longer on the case |
| `citation-replaced` | A passage in the snapshot was corrected |
| `citation-added` | A new passage was linked to assessed evidence |
| `document-changed` | The stored document's digest differs from the cited version |
| `citation-invalid` | The document is no longer held, or was extracted again |
| `applicability-changed` | The assessed check's applicability changed; the cause carries `from` and `to` |
| `check-removed` | The assessed check is no longer part of the case |
| `policy-requires-reassessment` | A policy decision behind this check now requires reassessment |
| `policy-context-changed` | The decision or the version in effect for that policy changed |
| `no-snapshot` | Recorded without a snapshot; no baseline is invented (`cannot-establish`) |
| `no-applicability-baseline` | The snapshot predates recording applicability and nothing else changed; no baseline is invented (`cannot-establish`) |
| `documents-unavailable` | Nothing else changed but passages could not be checked (`cannot-establish`) |

Only the evidence, passages, and policies in an assessment's own snapshot are compared, so unrelated assessments stay current. Verifying a reference does not make an assessment stale: verification is a separate fact, shown beside it.

A `sufficient-for-stated-check` assessment may be recorded over an unverified reference. The snapshot records `verified:false`, the finding keeps its status, and nothing is resolved. Changing another check's applicability leaves an assessment current.

Known limit: `POST /api/cases/:id/evidence/:evidenceId` clears `verified` on every correction, including one that resubmits the same title, check, and locator. Such a correction changes nothing that is hashed, so the assessment still reads `current` even though the reference is unverified again. The current verification state is always shown beside the assessment.

### Read model

Each entry in `findings` is `{findingId,title,status,evidence,currentAssessment,assessments}` for evidence checks only. Each evidence entry is `{id,kind,title,locator,verified,passage,citations}` where `passage` is `attached` or `none`. Each citation adds `state` (`active` or `replaced`) and `check: {status,message}` with `status` of `valid`, `document-changed`, `extraction-changed`, `document-missing`, or `not-checked`.

### Packet and exports

`GET /api/cases/:id/packet` adds `evidenceReview` (the read model above, with snapshots and freshness) and `evidenceReviewNotice` once the case has a citation or an assessment. Both are inside the digest, which still detects accidental change only.

The packet is an export snapshot, not a stable identity for the stored case. Each citation's `check` and each assessment's `freshness` are live observations made when the packet is produced. If the document service answers for one download and not for another, the two packets differ (`valid` and `current` in one, `not-checked` and `cannot-establish` in the other) and so do their digests, in addition to the differences `exportedAt` and `asOf` already cause. Each digest is correct for its own body: remove only `digest` and hash the sorted-keys JSON. `evidenceReview.documents.status` says which observation a packet holds. Producing a packet changes no case and writes no audit event. `/api/export`, `/api/workspace`, and `/api/audit/cases/:id` carry the stored `citations` and `assessments` on the case.

Lists from the document service are paged at 100 items. The interface follows `pagination.nextOffset` for documents and spans, so a passage in a later part of a long document, or a document beyond the first 100 on a case, can be chosen and shown in context. It stops after 50 pages and says so.

The document service gained one internal route, `GET /internal/documents/:id/spans/:spanId`, which the gateway does not expose.

## Example presets and case-specific sources

### Source resolution is per case

For one case, sources are the built-in registry plus the sources stored with that case in `case.checkSet.sources`. The loaded profile and other cases are never consulted. This applies to `GET /api/cases/:id` (`sources`, `policyContext`), `GET /api/cases/:id/packet`, `GET /api/cases/:id/evidence-review`, `POST /api/cases/:id/assessments` (the snapshot and freshness), `GET /api/cases/:id/policy-context`, `POST /api/cases/:id/policy-reviews`, the source IDs a `policyBasis` may cite in `POST /api/cases/:id/context`, and `GET /api/audit/cases/:id` in the audit service.

This corrects earlier behavior. Before, one workspace list resolved every case and the first entry per ID won, so a later profile that reused a custom source ID with different content changed the source shown and exported for an older case. Now two cases created under profiles that reuse an ID each resolve their own stored source, through profile switches, reset, and restart. Stored cases, snapshots, and events are not rewritten. A custom ID still cannot reuse a built-in ID. A source a case cites but does not hold stays unresolved (it is absent from `sources`); nothing is borrowed from another profile. A `policyBasis` on a case can cite only built-in IDs and that case's own IDs; any other ID returns 400.

Workspace-wide responses keep their shapes:

- `GET /api/workspace` and `GET /api/export`: `sources` is the discovery list described above. `GET /api/workspace` adds `builtInSourceIds`, the IDs of the packaged registry.
- `GET /api/workbench` and `GET /api/evidence`: `sources` is unchanged. A new optional key `caseSources` maps a case ID to the stored sources its rows on this page cite, and is present only when a returned row belongs to a case with stored sources. Use it, not `sources`, to describe such a row.
- `GET /api/policy-versions` and `GET /api/policy-reassessment` use the built-in registry, which is the only place version metadata exists.
- `GET /api/policies` and `/api/policies/:id` in the policies service still report the loaded profile's sources as `profileSources`. That is a view of the active profile, not of any case.

Packets from two reads differ by `exportedAt`, by `asOf`, and by live document observations. Compare them with those held fixed.

### Preset routes

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/profile-presets` | `{presets,limitation}`. Each preset is `{id,name,description,organization,businessUnit,family,checkCount,sourceCount,example:true}`. |
| GET | `/api/profile-presets/:id` | `{preset,profile,limitation}`. `preset` is the same summary. `profile` is a validated body for `POST /api/profile`. |

Unknown ID returns 404. Any other method returns 405. Reading presets writes nothing: no revision, no event, no profile change, no case. Presets are validated when the server starts; a broken preset file stops startup. Shipped IDs: `va-system-delivery` (6 checks, 3 sources), `ssa-system-delivery` (6 checks, 3 sources), `ssa-benefit-statement` (1 check, 2 sources), and `public-sector-records` (4 checks, 5 sources). Preset source IDs are prefixed `va-sd-`, `ssa-sd-`, `ssa-bs-`, and `ps-`. `description` is an addition to the summary named in the task brief.

Loading a preset is the existing `POST /api/profile` with `profile` and `note`, with the same `expectedWorkspaceRevision` conflict (409 with `currentRevision`) and `Idempotency-Key` replay. No case is created; `POST /api/cases` stays a separate call. Custom profile JSON and `reset` work as before.

Example, abbreviated to one preset: `GET /api/profile-presets`

```json
{"presets":[{"id":"ssa-benefit-statement","name":"SSA benefit statement review (example)","description":"One check for one made-up beneficiary-year: is a benefit statement expected, and is a reference to it on file. Applicability is decided per case by a reviewer. Nothing here calculates tax or decides tax treatment or eligibility.","organization":"Social Security Administration (synthetic example)","businessUnit":"Example benefit payment office (synthetic)","family":"Tax and financial","checkCount":1,"sourceCount":2,"example":true}],"limitation":"Example presets use made-up offices and public sources. Each check list is a configurable review aid, not a list of mandatory artifacts and not a statement that any schedule or rule applies to a case. Selecting a preset only fills the editor. Nothing is loaded until you submit it with a note, and no case is created."}
```

`GET /api/profile-presets/ssa-benefit-statement`, with one source and the scope text shortened:

```json
{"preset":{"id":"ssa-benefit-statement"},"profile":{"organization":{"name":"Social Security Administration (synthetic example)","kind":"agency"},"checkSet":{"id":"ssa-benefit-statement","name":"SSA benefit statement review (example)","checks":[{"kind":"benefit-statement","title":"Benefit statement evidence","sourceIds":["ssa-bs-ssa-tax-form"]}],"policySourceIds":["ssa-bs-ssa-tax-form"],"recordsSourceIds":["ssa-bs-36-cfr-1222"]},"sources":[{"id":"ssa-bs-ssa-tax-form","title":"SSA - Get tax form (1099/1042S)","url":"https://www.ssa.gov/manage-benefits/get-tax-form-10991042s","locator":"Whole page, as modified 2026-08-06","scope":"...","checkedOn":"2026-11-18"}],"businessUnit":"Example benefit payment office (synthetic)","family":"Tax and financial"}}
```

### Profile and case metadata

A profile may carry two optional top-level fields: `businessUnit` (1 to 120 characters) and `family` (1 to 80 characters). Values are trimmed. Omitted or `null` means absent, and the validated profile has no such key. A whitespace-only string, an over-long string, or a non-string returns 400. Loading a profile replaces the previous one whole, so a field left out is not carried over.

`POST /api/cases` copies them to optional `case.businessUnit` and `case.recordFamily` when the loaded profile has them. Cases created earlier, or under a profile without them, have neither key. A later profile change never alters them. They cannot be edited through `/context` in this version.

### Applicability and wording

Every check on a new case starts `unknown`. Nothing sets applicability from whether evidence exists. With `yes` and no reference the finding is `needs-evidence`; with `no` it is `not-applicable`; with `unknown` it is `needs-review`. Record the reason in the `note` of the `/context` request.

Findings from evidence checks keep `category: "contracting"`, their IDs, and their statuses on every case. The interface shows "Evidence check" for a case that has its own `checkSet` and "Contracting" for the built-in example. Two `nextAction` strings differ for cases with their own `checkSet`: for `not-applicable`, "Confirm the applicability decision against the recorded scope of this case." and for undecided applicability, "Ask the responsible reviewer whether this check applies to this case." Custom-profile cases created before this change now return these strings too. Built-in cases are unchanged.

### Unchanged

Retention is not changed: a record without a confirmed schedule reads `unknown`, a confirmed final-payment schedule computes as before, any other trigger is refused with 400, an active hold blocks, and `canDestroy` is false. Document intake is not changed: unsupported media types return 415 and malformed JSON returns 400 at intake. Freshness precedence is not changed: a known change reads `needs-review`, then an unresolved check or baseline reads `cannot-establish`, then `current`.

## Documentation completeness, gap register, expected record types, and planning

These are read models computed from stored cases, plus one write. They follow a user decision of 2026-11-19 that allows a documentation completeness percent. No route returns a compliance score, rating, or grade, and none labels anything noncompliant.

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/documentation` | `{asOf,workspaceRevision,workspace,cases,limitation}`. One entry per case with its `score` summary and `openGaps`. |
| GET | `/api/cases/:id/documentation` | `{caseId,asOf,caseRevision,score,gaps,decisions,enums,identity,limitation}` |
| GET | `/api/gaps` | Paged register `{asOf,items,pagination,rules,limitation}`. Filters: `caseId`, `ruleId`, `status` (`open`, `confirmed`, `dismissed`), `subjectType` (`check`, `record`, `record-type`, `case`, `task`), plus `q`, `limit`, `offset` as on other lists. |
| POST | `/api/cases/:id/gap-decisions` | 201 `{decision,case,change,identity,limitation}`. Body: `expectedRevision`, `gapId`, `decision` (`confirmed` or `dismissed`), `note` (10 to 2000 characters). |
| GET | `/api/planning` | `{asOf,workspaceRevision,dated,undated,limitation}`. Optional `caseId`. |

Reads write nothing: no revision, no event. Unknown case 404. Wrong method 405. Unknown query parameter or filter value 400. When the document service is running, these reads ask it about each case's stored documents, as the evidence review does.

### Completeness

`score` is `{label:"Documentation completeness",complete,countable,percent,checks,records,items,limitation}`.

- Countable items are: evidence checks whose applicability is `yes`; inventoried records; expected record types that are not inventoried.
- A check is complete when it has a verified reference and its current assessment is `sufficient-for-stated-check` with freshness `current`. An assessment that reads `needs-review` or `cannot-establish` does not count.
- A record is complete when it has an owner, a confirmed schedule, and a hold status of `active` or `none`.
- Checks whose applicability is `unknown` or `no` are not counted. They are reported as `checks.undecided` and `checks.notApplicable`.
- `percent` is `floor(100 * complete / countable)`, so it is 100 only when every countable item is complete. With nothing countable it is `null`, never 0 or 100.
- An active hold is reported in `records.activeHolds` and does not lower the percent.
- `checks.withPassage` counts applicable checks that have a linked passage. A passage is not required for completeness.
- The workspace figure sums `complete` and `countable` over all cases.

Limit to know: a record under a profile whose schedule is not a final-payment schedule cannot have a confirmed schedule recorded yet, so such a record stays incomplete and is reported by the `record-schedule-unconfirmed` rule.

Example, one case shown: `GET /api/documentation?asOf=2026-11-15`

```json
{"asOf":"2026-11-15","workspaceRevision":0,"workspace":{"label":"Documentation completeness","complete":2,"countable":12,"percent":16,"undecidedChecks":2},"cases":[{"caseId":"DEMO-VA-001","caseTitle":"Records digitization services","organization":"Department of Veterans Affairs","recordFamily":null,"caseRevision":0,"score":{"label":"Documentation completeness","complete":1,"countable":5,"percent":20,"checks":{"complete":0,"countable":4,"percent":0,"undecided":0,"notApplicable":0,"withPassage":0},"records":{"complete":1,"countable":1,"percent":100,"inventoried":1,"expectedTypes":0,"expectedTypesMissing":0,"activeHolds":1}},"openGaps":5}],"limitation":"..."}
```

### Gaps

A gap is `{id,ruleId,caseId,subjectType,subjectId,subjectTitle,title,detail,toClear,section,decision,status}`; register rows add `caseTitle`, `organization`, `recordFamily`, `caseRevision`. `id` is `caseId:ruleId:subjectId`. `section` is the case tab where the work is done. Rules, listed in `rules` on `/api/gaps`:

`applicability-undecided`, `evidence-missing`, `reference-unverified`, `assessment-missing`, `assessment-not-sufficient`, `assessment-needs-review`, `assessment-freshness-unknown`, `policy-basis-unconfirmed`, `inventory-empty`, `record-type-missing`, `record-owner-missing`, `record-schedule-unconfirmed`, `record-hold-undecided`, `task-overdue`.

A check that does not apply raises nothing. An active hold is not a gap. Gaps are recomputed on every read; when the data changes, a gap disappears or changes on its own.

`POST /api/cases/:id/gap-decisions` appends a reviewer's decision to `case.gapDecisions`. It needs the current `expectedRevision` (409 with `currentRevision` otherwise), supports `Idempotency-Key` replay, and writes a `gap-decision-recorded` event with before and after. `gapId` must be a gap detected now, else 404. Unknown fields, a missing note, or another decision value return 400. A decision changes no finding, percent, hold, or task. Each stored decision keeps `state`, a short description of the gap as it was; when the gap's current description differs, the gap's `status` returns to `open` and `decision.current` is `false`. Decisions are attributed to the local operator unless a signed-in identity is configured.

Example request (header `Idempotency-Key: doc-example-1`): `POST /api/cases/DEMO-VA-001/gap-decisions`

```json
{"expectedRevision":0,"gapId":"DEMO-VA-001:evidence-missing:funding","decision":"dismissed","note":"Synthetic: judged not relevant to this demonstration."}
```

Response 201, abbreviated:

```json
{"decision":{"id":"<uuid>","gapId":"DEMO-VA-001:evidence-missing:funding","ruleId":"evidence-missing","decision":"dismissed","note":"Synthetic: judged not relevant to this demonstration.","state":"evidence-missing|The check applies and no evidence reference is on file.","at":"<time>","actor":"local-demo-operator","identity":"local-operator","synthetic":true},"change":{"command":"gap-decision-recorded","note":"Synthetic: judged not relevant to this demonstration.","before":null,"after":{"id":"<uuid>","gapId":"DEMO-VA-001:evidence-missing:funding","decision":"dismissed"}}}
```

A second request still sending `expectedRevision: 0` returns 409 `{"error":"Case changed since it was loaded. Reload the case and retry.","currentRevision":1}`.

### Expected record types

A profile's `checkSet` may carry `expectedRecords`: up to 20 entries of `{kind,title,sourceIds}`. `kind` follows the same rule as a check kind and must be unique; every source ID must be defined. Omitted or empty means the key is absent. New cases copy the list inside their stored `checkSet`; existing cases are not changed.

`POST /api/cases/:id/records` and `POST /api/cases/:id/records/:recordId` accept optional `recordType`. It must be one of the case's own expected kinds; on a case with none, any value returns 400. `null` on update clears it. A record without the key names no type. An expected kind that no inventoried record names is reported by the `record-type-missing` rule and counted as one incomplete item. That is a documentation condition; whether the record must be kept is for a records officer.

A fourth example preset, `public-sector-records` (4 checks, 5 sources, 3 expected record types, source IDs prefixed `ps-`), is listed by `/api/profile-presets`. The two system delivery presets now list two expected record types each. The benefit statement preset lists none.

### Planning

`dated` entries are `{caseId,caseTitle,organization,recordFamily,type,id,title,owner,section,date,note,past}`, sorted by date; `undated` entries have no `date` or `past`. `type` is `task` (an open follow-up task), `record-review` (a record's computed review date), or `period-end` (the case's period of performance end). Undated entries are open tasks with no due date, records under an active hold, and records whose review date cannot be computed. Nothing is estimated. The response holds no amounts and is not financial, tax, or legal advice. A review date never authorizes destruction; `canDestroy` stays false.

### Interface

Two routes were added to the fixed route list and to the guided assistant's destinations: `gaps` (Gap register) and `planning` (Planning). Case pages have a Documentation tab. The assistant itself is unchanged and calls no model.

## Agency paperwork, the audit team report, and reader output intake

All routes below are additive. No earlier response changed shape. Nothing here submits, signs, or files anything, calls an outside service, or changes a record, hold, finding, or task. `canDestroy` stays `false` everywhere.

### Paperwork catalog

`data/paperwork-catalog.json` lists 24 forms and reports and is validated at startup. `GET /api/paperwork` returns `{catalog,enums,limitation}`. Each entry is `{id,title,formNumber,family,scope,preparedBy,receivedBy,cadence,requiredFacts,sourceUrl,verification,checkedOn,note,mode,needsRecord}`. The seven benefits intake entries also carry optional `benefit` metadata documented below. Legacy entries have no new property.

- `verification` is `seen` (read on the page in `sourceUrl` on `checkedOn`) or `candidate` (not confirmed against an agency source). Five entries are candidates: `PW-SF115`, `PW-SF258`, `PW-VA7468`, `PW-VA0244`, `PW-VA-AFR`.
- `mode` is `readiness` when the entry has `requiredFacts` (`PW-SF135`, `PW-NA13001`, `PW-A50-CAP`, and the seven benefits intake worksheets) and `catalog-only` otherwise. Benefits counts describe four project-defined intake fields, not all official application requirements.
- A required fact is `{key,label,from,type}`. `from` says where its value comes from: `case`, `record`, `hold`, `evidence`, or `manual`. `type` is `text` or `date`.

A profile's `checkSet` may carry `paperwork`: up to 20 catalog IDs, no repeats. It is a suggestion list only. Shipped presets are checked against the catalog at startup.

### Paperwork on a case

| Route | Purpose |
| --- | --- |
| `GET /api/cases/:id/paperwork` | `{caseId,asOf,caseRevision,items,summary,suggested,enums,identity,limitation}` |
| `POST /api/cases/:id/paperwork` | Add an item: `{expectedRevision,paperworkId,recordId?,dueDate?,note}`. 201. |
| `GET /api/cases/:id/paperwork/:itemId` | One item with its readiness. |
| `POST /api/cases/:id/paperwork/:itemId` | Change it: `{expectedRevision,note,status?,reference?,dueDate?,facts?}`. 200. |
| `GET /api/cases/:id/paperwork/:itemId/worksheet` | A draft worksheet for printing. |
| `GET /api/paperwork/items` | Every item across cases, with `caseId` and `caseTitle`. |

An item view is the stored item plus `entry`, `recordTitle`, and `readiness`:

```json
{"state":"incomplete","present":5,"required":7,"summary":"5 of 7 facts present","overdue":false,
 "facts":[{"key":"volume","label":"Volume","from":"manual","type":"text","state":"missing","value":null,"origin":null,"by":null,"at":null,"detail":"Not entered yet."}]}
```

Rules, all enforced by the server:

- A fact is `present`, `missing`, or `blocked`. Readiness is `blocked` if any fact is blocked, else `incomplete` if any is missing, else `facts-complete`. Catalog-only items are `not-tracked`. It is a count of facts, never a rating.
- A value a person entered (`origin: manual`) or accepted from a reader (`origin: reader`) wins over one read from the case or record.
- The hold fact is read only from the linked record: `none` is present, `unknown` is missing, `active` is blocked. Sending it in `facts` returns 400.
- A schedule that no records officer confirmed is not a disposal authority, so that fact is missing.
- An evidence fact holds an evidence ID from the same case and is present only once that reference is verified.
- `status` is one of `not-started`, `drafting`, `ready-for-signature`, `filed-by-agency`, set by a person. `ready-for-signature` returns 409 while a fact is missing. Both `ready-for-signature` and `filed-by-agency` return 409 while an active hold blocks the item. `filed-by-agency` needs a `reference` of 3 to 1000 characters, or returns 400.
- `overdue` is true when a stored `dueDate` is before the screening date and the status is not `filed-by-agency`. No deadline is computed.
- Items needing a record (`needsRecord`) return 400 without `recordId`. A case holds at most 50 items.
- Writes use `expectedRevision` and accept `Idempotency-Key`, and log `paperwork-added` or `paperwork-changed` with before and after values.

The worksheet carries the label `Draft worksheet. Not an official form. Not submitted.`

`GET /api/planning` now also lists paperwork that is not yet filed: `type: "paperwork"`, dated by the due date a person entered, or undated when none was entered.

### Audit team report

`GET /api/audit-report?caseId=&include=candidates` is read only. Any other query parameter returns 400.

```json
{"asOf":"2026-11-15","workspaceRevision":12,"scope":{"caseId":null},"includeCandidates":false,
 "totals":{"cases":3,"confirmedGaps":1,"unresolvedFindings":9,"activeHolds":1,"overduePaperwork":1,"openPaperwork":2},
 "cases":[{"caseId":"…","caseTitle":"…","completeness":{"label":"Documentation completeness","complete":2,"countable":6,"percent":33},
   "confirmedGaps":[],"unresolvedFindings":[],"activeHolds":[],"overduePaperwork":[],"openPaperwork":[],
   "counts":{},"nothingRecorded":false,"statement":"…"}],
 "limitation":"…","digestNotice":"…","generatedAt":"<time>","digest":{"algorithm":"SHA-256","value":"<hex>","canonicalization":"sorted-keys-json-v1","excludedFields":["digest","generatedAt"]}}
```

- `confirmedGaps` holds only gaps whose latest reviewer decision is `confirmed` and still describes the gap. A dismissed gap is never listed.
- `unresolvedFindings` are screening results with status `needs-evidence` or `needs-review`. They are not determinations. Completing a task does not remove one.
- A record blocked by a hold is listed once, under `activeHolds`.
- `candidates` (gaps nobody has decided) appear only with `include=candidates`.
- A case with nothing under any section says so in `statement` and sets `nothingRecorded`.
- Each unresolved finding carries `evidence`: the references on file for that check as `{id,title,locator,verified}`.
- `readiness.attention` on a paperwork item, and `attention` on a report line, is a sentence when a status set earlier no longer matches the facts, for example a hold placed after the item was marked ready. Otherwise it is `null`. The paperwork `summary` counts these as `needsAttention`.
- Paperwork and reader read routes return 400 for any query parameter other than `asOf`.
- There is no rate, grade, or verdict in the response.

### Reader output intake

This application calls no document reading service. A person runs the service on a synthetic document and imports the saved output. The only shape understood is an Amazon Textract AnalyzeDocument response (a `Blocks` list).

| Route | Purpose |
| --- | --- |
| `GET /api/reader-samples` | Sample outputs shipped in `data/reader-samples`, plus any file that could not be read. |
| `GET /api/reader-samples/:id` | One sample with its `output`. Reading it changes nothing. |
| `GET /api/cases/:id/reader-outputs` | Imported outputs with their candidates and decisions. |
| `POST /api/cases/:id/reader-outputs` | Import: `{expectedRevision,title,service,source,capturedAt?,synthetic,note,output}`. 201. |
| `POST /api/cases/:id/reader-outputs/:outputId/candidates/:candidateId` | Decide: `{expectedRevision,decision,target?,note}`. 200. |

- `service` is `amazon-textract`. `source` is `shape-sample` (labelled "Sample in the service output shape. Not produced by the service.", no `capturedAt`) or `service-capture` (labelled "Captured from Amazon Textract on a synthetic document.", `capturedAt` required as a UTC time).
- `synthetic` must be `true`, or the import returns 400.
- This route accepts a body up to 1 MiB. Every other route keeps its 64 KB limit.
- Stored per output: its candidates, counts, and a SHA-256 of the output. The raw output is not kept.
- Candidates are form fields with a value, answered queries, and detected signatures: `{id,kind,label,value,confidence,labelConfidence,page,decision}`. Confidence is the number the service reported. Table cells, empty fields, values over 500 characters, and unknown block types are counted and not offered. More than 5000 blocks returns 413.
- `decision` is `accept` with `target: {itemId,factKey}`, or `reject` with no target. A candidate is decided once (409 after that). An accepted value goes through the same checks as a typed one and is stored with `origin: reader`. The hold fact and evidence facts cannot be filled this way, and a signature candidate cannot be accepted.
- Importing writes no fact. Text inside a document is stored and shown as text and is never acted on.
- Writes log `reader-output-imported` and `reader-candidate-decided`.

### Interface

Two routes were added to the fixed route list: `paperwork` and `auditreport`. Case pages have a Paperwork tab with the worksheet and the document reader section.

### Pitch walkthrough data

`npm run demo:pitch` starts the local services on a new data folder (under the system temporary directory by default; see "Local persistence and diagnostics") on ports 4417 to 4424 and seeds two synthetic cases through the public API. It never opens the saved demo and refuses to seed a workspace that already holds work.

## Benefits intake directory (BENEFITS-001)

`GET /api/benefits` is read only. Optional query parameters: `agency=ssa|va`, `q` (up to 200 characters, trimmed case-insensitive substring across program, team, purpose, form number and title), and the existing `asOf=YYYY-MM-DD`. Unknown/repeated parameters, invalid agency/date or oversized q return 400. Unsupported methods return 405. No match returns 200 with an empty programs array. No read creates a revision or event.

Response: `{asOf,workspaceRevision,programs,limitation}`. A program is `{programId,program,team,purpose,sourceId,sampleId,guidanceUrl,agency,paperwork,items,counts,eligibility,fundingDecision}`. `paperwork` is the full catalog entry. `items` uses existing paperwork item views plus `caseId,caseTitle,organization,caseRevision`. Counts are `{tracked,missingIntakeFacts,blocked,overdue}` using the same paperwork readiness rules, never an applicant priority or compliance rating. `eligibility` is always `not-assessed`; `fundingDecision` is always `not-performed`, even when every intake field is present.

Catalog additions: `family=benefits-intake`, `cadence=per-claim`, and optional `benefit: {programId,program,team,purpose,sourceId,sampleId,guidanceUrl}`. No legacy catalog entry receives a default benefit value. The case item `entry` summary carries `benefit` and `note` only for these new entries. Metadata identifiers are lowercase letters/digits/hyphens, start with a letter, length 2–80; program IDs are unique. Program/team strings are trimmed, 1–120 characters; purpose is trimmed, 1–1000. Metadata is allowed only on benefits-intake with scope ssa or va; that family requires it. guidanceUrl is an official https://www.ssa.gov/ or https://www.va.gov/ URL, without whitespace. Unknown metadata fields fail startup validation. This metadata is shipped reference data, not a new write API.

| programId | paperwork.id | Form | Example team |
| --- | --- | --- | --- |
| ssa-disability | PW-SSA-DISABILITY | SSA-16 | Disability intake team |
| ssa-ssi | PW-SSA-SSI | SSA-8000-BK | Income support intake team |
| ssa-retirement | PW-SSA-RETIREMENT | SSA-1 | Retirement intake team |
| ssa-survivors | PW-SSA-SURVIVORS | SSA-10 | Survivor support intake team |
| va-disability | PW-VA-DISABILITY | 21-526EZ | Compensation intake team |
| va-pension | PW-VA-PENSION | 21P-527EZ | Pension intake team |
| va-survivors | PW-VA-SURVIVORS | 21P-534EZ | Survivor support intake team |

Each has four manual text facts: `intake-reference`, `requested-support`, `supporting-reference` (display label varies by program), `review-follow-up`. These are project-defined synthetic intake fields, not all official form fields or eligibility rules. They start absent. The existing reader acceptance route can fill one fact at a time with provenance. Each sample ID is `synthetic-` plus programId, e.g. `synthetic-ssa-retirement`; source IDs are `benefits-` plus programId. All seven samples are `shape-sample` with no capture date or fabricated OCR confidence, and were not produced by Textract.

Example read: `GET /api/benefits?agency=ssa&q=SSA-1`. This substring search can also match SSA-16 and SSA-10; use `q=retirement` for the retirement program alone. Response excerpt:

```json
{"programs":[{"programId":"ssa-retirement","agency":"ssa","program":"Social Security retirement","team":"Retirement intake team","counts":{"tracked":0,"missingIntakeFacts":0,"blocked":0,"overdue":0},"eligibility":"not-assessed","fundingDecision":"not-performed"}]}
```

Create the worksheet through the unchanged audited API, with `Idempotency-Key: benefits-demo-1`:

```http
POST /api/cases/DEMO-VA-003/paperwork
Content-Type: application/json
```
```json
{"expectedRevision":0,"paperworkId":"PW-VA-DISABILITY","note":"Track a synthetic compensation intake worksheet for review."}
```

201 returns the existing `{item,change,case,identity,limitation}`. The item starts `not-started`, `readiness.present=0`, `readiness.required=4`; stale revision gives 409 with `currentRevision`. Replaying the same request/key returns the saved response. Case selection is explicit; attaching paperwork does not replace checks, infer agency scope or decide applicability. Existing cases need appropriate reviewer-selected scope. No benefits-specific case creation or new profile preset is added.

`GET /api/reader-samples/synthetic-va-disability` returns `{sample,limitation}`. Import `sample.output` via the existing reader route with `synthetic:true`; accept/reject via the existing candidate routes. The benefits page's download is just the importable Blocks object. Unknown mappings fail validation, imports fill nothing, and accepted values are audited with `origin=reader`. Worksheet export includes an intake-only limitation. Existing record holds, findings and tasks stay unchanged.

UI destination: `#/benefits`, linked as Benefits intake. Filters survive in the hash; optional UI-only `caseId` preserves the selected case across filtering. Tracking opens the existing paperwork/reader screen. Team names are examples, not routing permissions, agency assignments or authenticated roles. The catalog is not exhaustive: SSA-10 is spouse-survivor guidance, not every survivor application; Veterans Pension is distinct from Social Security retirement and military retired pay. The benefits directory allocates no money to any applicant and submits no claims; `fundingDecision` keeps describing that. Program and project budgets are planned separately with simulated allocations (see "Synthetic funding allocation" below). Incomplete local worksheets must not delay a real application.

If a benefits worksheet is explicitly linked to a record (`recordId` through the existing API), its readiness also includes a read-only `no-active-hold` fact: active is blocked, unknown/missing stays missing, none is present. This fifth fact is not supplied by the reader or a typed value. No record link is required for the four-field synthetic intake worksheet. No hold affects a benefit determination here because this application makes none.

## Assessment problems in the review queue and the audit report (DEMO-CR-001)

Additive. No existing field changed meaning.

- `GET /api/workbench` rows gain `assessmentIssue`: `null`, or `{gapId, ruleId, title, detail, toClear, gapStatus}` when the check's current assessment is not sufficient, needs another review, or its freshness cannot be established (the same documentation-gap rules as `GET /api/cases/:id/documentation`, computed with the same evidence review). Such a row gets the new attention value `resolve-assessment`, ordered after an active hold and an overdue task, and stays there after the gap is confirmed or dismissed, until a new assessment changes it. The finding `status` (for example `evidence-present`) is unchanged: verification and sufficiency stay separate facts. `attention=resolve-assessment` is accepted as a filter.
- `GET /api/audit-report` case sections gain `pendingReviewIssues` (listed by default, `status: "pending-confirmation"`, each with the latest `assessment` `{id,outcome,rationale,at,actor}`), and `counts`/`totals` gain `pendingReviewIssues`. Confirming moves the line to `confirmedGaps`; dismissing removes it from both. Other undecided gaps remain the opt-in `candidates`.
- Document intake from the browser now stores the text exactly as supplied (no trimming), so a stored hash matches the original file.

## Synthetic funding allocation (FUNDING-001)

Program and project budgets for synthetic VA and SSA examples, allocation requests, and recorded decisions. Allocations are simulated: no government payment is sent, no Treasury, VA or SSA financial system is connected, no individual benefit eligibility is decided, and nothing uses sensitive personal information. Decisions are labelled simulated, and the shared demo login does not identify an individual approver. Amounts are money totals, not compliance scores. Funding never changes a case, record, hold, finding or task.

### Money

Every amount is a whole number of US cents (`availableCents`, `requestedCents`, `approvedCents`). The API accepts only safe integers from 1 to 1,000,000,000,000 ($10 billion); decimals, strings, zero, negatives, NaN and unsafe integers return 400. The server sums and compares with BigInt and the browser parses typed dollars with string and BigInt operations, so no amount passes through floating-point arithmetic. Totals per budget:

| Field | Meaning |
| --- | --- |
| `availableCents` | The budget's available funds |
| `proposedCents` | Requests in Proposed. Shown apart; never reduces the remaining budget |
| `approvedCents` | Requests in Approved |
| `remainingCents` | Available minus approved |
| `draftCents`, `rejectedCents`, `reversedCents` | For reference only |
| `proposedBeyondRemainingCents` | How far proposals exceed the remaining budget, or 0 |

### States and decisions

`draft → proposed → approved → reversed`, and `draft|proposed → rejected`. A request starts as a draft. Only a proposal can be approved. Rejected and reversed requests are closed. Approval is refused with 409 when the requested amount exceeds the remaining budget; the message gives both amounts and the excess, and nothing changes. Approved requests cannot be edited (409): record a reversal with a rationale, which keeps the approved amount on the record and returns it to the remaining budget, then create a replacement request with `replacesAllocationId` (only a reversed allocation can be replaced, and only one open replacement at a time).

### Routes

All writes require an `Idempotency-Key` header (400 without one). A repeated request with the same key returns the saved result; the same key with a different body returns 409. Every write after budget creation sends `expectedRevision`, the budget's `revision`; a stale revision returns 409 with `currentRevision`. Writes run one at a time in the store's queue, so two approvals sent together cannot both succeed when only one fits: one gets the revision conflict, and a retry against the latest revision is refused by the remaining-budget rule. Unknown fields return 400. Unknown query parameters return 400 and unsupported methods 405.

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /api/funding?agency=&program=&fiscalYear=&status=` | | `{workspaceRevision,filters,budgets,summaries,options,cases,enums,identity,notice}` |
| `GET /api/funding/budgets/:id` | | `{budget,cases,enums,identity,notice}`, 404 if unknown |
| `POST /api/funding/budgets` | `{name,agency,program,fundingSource,fiscalYear,availableCents,owner,note}` | 201 `{budget,change,identity,notice}` |
| `POST /api/funding/budgets/:id` | `{expectedRevision,reason}` plus any of `name,availableCents,owner,note` | 200 |
| `POST /api/funding/budgets/:id/allocations` | `{expectedRevision,destination,purpose,requestedCents,owner,rationale}` plus optional `caseId,evidenceIds,assessmentIds,neededBy,replacesAllocationId` | 201 `{budget,allocation,change,identity,notice}` |
| `POST /api/funding/allocations/:id` | `{expectedRevision,reason}` plus the fields to change | 200, drafts and proposals only |
| `POST /api/funding/allocations/:id/decision` | `{expectedRevision,action,rationale}`, action `propose`, `approve`, `reject` or `reverse` | 200 |

Filter values: `agency` is `va` or `ssa`, `fiscalYear` a four-digit year, `status` one of the five states, `program` the exact program name. `budgets` are sorted VA first, then SSA. Each budget carries `totals`, `allocationCount` (all requests) and `allocations` (only those in `status`, when given; the totals always cover every request). `summaries` holds one row per agency and fiscal year, `{agency,fiscalYear,budgetCount,availableCents,proposedCents,approvedCents,remainingCents}`; VA and SSA amounts are never added together. Each allocation view adds `support`, `openReplacementId` (for a reversed allocation, the open replacement request or null) and, for drafts and proposals, `approvalCheck: {remainingCents,fits,exceedsByCents}`. `cases` lists the synthetic VA and SSA cases a request can cite, with their evidence and assessments.

### Validation

- `agency` is `va` or `ssa`. `fiscalYear` is an integer from 2020 to 2100; a federal fiscal year runs from 1 October to 30 September. `neededBy`, when given, is a real date inside the budget's fiscal year.
- `fundingSource` must be synthetic: `SYN-VA-` or `SYN-SSA-` followed by 2 to 51 capital letters, digits, dots, underscores or hyphens. Its agency code must match the budget (`SYN-SSA-…` on a VA budget is 400). One reference opens one budget per fiscal year (409).
- Agency, program, funding source and fiscal year cannot be amended (400); available funds cannot drop below the approved total (409).
- A request cannot exceed the budget's available funds (400). `caseId` must name a synthetic case of the budget's agency: a VA budget citing an SSA case returns 400 ("Cross-agency link refused"). `evidenceIds` and `assessmentIds` must belong to that case, without repeats, up to 20 each, and need a `caseId`.
- Text: names and programs 3 to 160 characters, owners 2 to 120, purposes 10 to 500, notes, reasons and rationales 10 to 2000.

### Supporting evidence

`support` is read from the cited case each time: `{caseId,caseTitle,documents:[{id,title,kind,locator,documentId,verified}],assessments:[{id,findingId,outcome,at,latestForCheck}],gaps,notice}`. `gaps` lists what is missing or open: no case, no document, no assessment, an unverified reference, an assessment that is not sufficient, or a newer assessment for the same check. A request with gaps can still be decided, and the gaps stay listed. Nothing is declared compliant. Each decision stores `evidenceAtDecision: {caseId,evidenceIds,assessmentIds,gaps}`.

### Audit trail

Budgets and allocations carry `history` entries `{at,actor,action,rationale,before,after,simulated:true,budgetRevision,…}`. Decisions add `fromState,toState,remainingBeforeCents,remainingAfterCents,label,evidenceAtDecision`. Edits record only the fields that changed. The workspace event log gains `funding-budget-created`, `funding-budget-amended`, `funding-allocation-created`, `funding-allocation-edited` and `funding-allocation-decided`, with `caseId: null` and the change as `details`. A decision recorded during the browser check:

```json
{"at":"2026-11-20T23:50:01.265Z","actor":"local-demo-operator","action":"reverse","rationale":"Simulated reversal: the lease will be re-scoped to one pilot office, so this approval is returned to the budget.","before":{"state":"approved","approvedCents":30000000},"after":{"state":"reversed","approvedCents":30000000},"simulated":true,"fromState":"approved","toState":"reversed","budgetRevision":14,"remainingBeforeCents":15000000,"remainingAfterCents":45000000,"label":"Simulated demo decision. Not an agency approval, obligation or payment.","evidenceAtDecision":{"caseId":"DEMO-…","evidenceIds":["…"],"assessmentIds":["…"],"gaps":[]}}
```

A stale write returns `409 {"error":"This budget changed since you loaded it. Reload, check the latest amounts, and try again.","currentRevision":15}`.

### Export and case packet

Additive only. `GET /api/export` already carries the workspace state, which now includes `funding: {budgets,allocations}` once a budget exists, and gains `fundingSummary: {budgets:[{id,name,agency,program,fiscalYear,fundingSource,revision,totals}],notice}`. `GET /api/cases/:id/packet` gains `fundingAllocations` (each allocation citing the case, with its `budget` summary, `history` and `support`) and `fundingNotice`, inside the digest. Workspaces and packets without funding keep their earlier exact shape and digest.

### Demonstration

`npm run demo:funding` (ports 5717–5724; set `PORT` for another free block of eight) starts a new isolated workspace and prints its data folder. It seeds the completed VA contract-review case, then one SSA example case from the SSA preset with a verified reference and a sufficient assessment, then one budget per agency through the API. To reset, stop it and run it again. It never opens a saved workspace.

As seeded, each budget has an approval that stands, an earlier approval that was reversed (its amount is already back in the remaining budget, and its approval and reversal stay in the history), a supported proposal for a separate fictional next phase, and a larger proposal. The seed decides neither open proposal. The supported proposals state what their evidence does and does not show: the completed delivery evidence documents a baseline; it is not evidence that the proposed future work was performed.

| | VA | SSA |
| --- | --- | --- |
| Available funds | $1,200,000.00 | $800,000.00 |
| Approved as seeded | $500,000.00 | $300,000.00 |
| Remaining as seeded | $700,000.00 | $500,000.00 |
| Reversed earlier, already in the remaining budget | $250,000.00 | $150,000.00 |
| Supported proposal | $420,000.00, post-release accessibility monitoring | $350,000.00, digitization pilot operations |
| After approving it | $920,000.00 approved, $280,000.00 remaining | $650,000.00 approved, $150,000.00 remaining |
| Larger proposal | $900,000.00 | $650,000.00 |
| Refused after that approval, over by | $620,000.00 | $500,000.00 |

The order matters. Before the supported proposal is approved, the larger VA request exceeds the $700,000.00 remaining by $200,000.00; after the approval it exceeds the $280,000.00 remaining by $620,000.00, which is what the walkthrough shows. A refused approval changes nothing and records nothing.

### Local persistence and diagnostics

Not an API change. A save writes a temporary file and replaces the saved file with one rename, so a reader never sees a half-written file. On Windows another program (a sync client such as OneDrive, an indexer, a virus scanner) can hold a file open for a moment and the rename then fails with EPERM, EBUSY or EACCES. Measured in the OneDrive-synced source folder: about one rename in a hundred, and no other step of a save. Such a rename is retried up to six times over about one second, on Windows only. Any other error, or a lock that outlasts the retries, is returned as the same 500 as before ("Could not confirm the operation. Reload or retry with the same Idempotency-Key."): the saved file, the in-memory state, the revision, the event history and the idempotency receipts are all unchanged, so repeating the request with the same key applies it once. The destination is never deleted to force a rename.

Isolated demo launchers (`demo:pitch`, `demo:contract-review`, `demo:completed`, `demo:funding`) now default to a new folder per run under the system temporary directory, `<temp>/compliance-platform-demos/<scenario>/<time>-<random>`, the same parent that `demo/start-demo.ps1` uses. `DEMO_DATA_ROOT` still chooses another parent. Each launcher prints the folder; on a failed start it is kept and named again. Saved workspaces are not moved.

An unexpected failure (a 500) writes one line starting `[diagnostic]` to the service's error stream and appends it to `diagnostics.log` in the service data folder: time, service, method, path without query string, error name and code, system call, file name without folder, and for non-file errors a message and the innermost stack frame without folders. A save that waited out a lock writes `{"event":"rename-retried","file":…,"retries":…}` the same way. No request body, header, query string or token is recorded.

### Interface

`#/funding`, linked as Funding in the main navigation. Filters for agency, program or project, fiscal year and request status are kept in the address. Each budget shows Available funds, Proposed allocations, Approved allocations and Remaining budget; each request shows Requested amount, Approved allocation, Supporting documents with what is missing, and its Decision history. Forms keep unsaved input while the tab is open, explain revision conflicts and refusals, and resend a failed request with the same key.
