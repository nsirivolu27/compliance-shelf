import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { canonicalJson } from '../src/lib/core/canonical.ts';
import { runGuidedAgent } from '../src/lib/tools/registry.mjs';

const asOf = '2026-11-15';
const note = 'Recorded for the synthetic demo.';

async function start(stateFile, options = {}) {
  const server = await createApp({ stateFile, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, key) => {
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${asOf}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { server, call, close: () => new Promise(resolve => server.close(resolve)) };
}

test('review drafts: transitions, hash-bound decisions, staleness, conflicts, retries, and persistence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'va-drafts-'));
  const stateFile = join(directory, 'workspace.json');
  let app = await start(stateFile);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const path = '/api/cases/DEMO-VA-001';
  const revision = async () => (await app.call(path)).body.case.revision;

  // Legacy shapes are unchanged while no draft exists.
  const legacyExport = (await app.call('/api/export')).body;
  assert.equal('drafts' in legacyExport, false);
  assert.deepEqual((await app.call(`${path}/drafts`)).body.drafts, []);
  assert.deepEqual(Object.keys((await app.call('/api/cases')).body), ['cases']);
  assert.equal((await app.call(`${path}/agent`, { intent: 'evidence' })).body.trace[0].tool, 'list_evidence_gaps');

  // A deterministic starting text is prepared from the current findings.
  const defaultPrepared = await app.call(`${path}/drafts/prepare`);
  assert.equal(defaultPrepared.status, 200);
  assert.ok(defaultPrepared.body.findingIds.includes('DEMO-VA-001:funding'));
  assert.ok(defaultPrepared.body.findingIds.includes('DEMO-VA-001:record:REC-001'));
  assert.ok(defaultPrepared.body.snapshot.findings.every(finding => ['needs-evidence', 'needs-review', 'blocked'].includes(finding.status)));
  assert.deepEqual((await app.call(`${path}/drafts`)).body.drafts, [], 'preparation never saves a draft');
  assert.equal((await app.call(`${path}/drafts/prepare?findingIds=`)).status, 400, 'an explicitly empty selection remains invalid');
  const prepared = (await app.call(`${path}/drafts/prepare?findingIds=DEMO-VA-001:funding,DEMO-VA-001:record:REC-001`)).body;
  assert.match(prepared.text, /Availability of funds evidence: needs-evidence/);
  assert.match(prepared.text, /does not resolve a finding/);
  assert.equal(prepared.snapshot.records[0].canDestroy, false);
  assert.equal((await app.call(`${path}/drafts/prepare?findingIds=DEMO-VA-002:funding`)).status, 404, 'a finding from another case cannot be cited');

  // Validation and cross-case references.
  const fields = { title: prepared.title, text: prepared.text, findingIds: prepared.findingIds, author: 'Demo analyst', reviewer: 'Demo supervisor' };
  assert.equal((await app.call(`${path}/drafts`, { expectedRevision: 0, ...fields, findingIds: ['DEMO-VA-002:funding'] })).status, 404);
  assert.equal((await app.call(`${path}/drafts`, { expectedRevision: 0, ...fields, text: 'short' })).status, 400);
  const staleCase = await app.call(`${path}/drafts`, { expectedRevision: 7, ...fields });
  assert.equal(staleCase.status, 409); assert.equal(staleCase.body.currentRevision, 0);

  // Create. The case revision does not move.
  const created = await app.call(`${path}/drafts`, { expectedRevision: 0, ...fields }, 'draft-create-1');
  assert.equal(created.status, 201);
  let draft = created.body.draft;
  assert.equal(draft.state, 'draft'); assert.equal(draft.version, 1); assert.equal(draft.identity, 'unverified-local-demo');
  assert.equal(draft.evidenceHash, prepared.evidenceHash);
  assert.deepEqual(draft.versions[0].snapshot.sourceIds, ['far-4.803', 'far-4.805', 'va-6300']);
  assert.equal(await revision(), 0);
  const id = draft.id;

  // Decisions need a submitted draft, and author and reviewer must differ.
  assert.equal((await app.call(`${path}/drafts/${id}/decision`, { expectedRevision: 0, expectedVersion: 1, decision: 'reviewed', reviewer: 'Demo supervisor', note })).status, 409);
  assert.equal((await app.call(`${path}/drafts/${id}/submit`, { expectedRevision: 0, expectedVersion: 1, reviewer: 'demo analyst' })).status, 400);
  const submitted = await app.call(`${path}/drafts/${id}/submit`, { expectedRevision: 0, expectedVersion: 1 }, 'draft-submit-1');
  assert.equal(submitted.body.draft.state, 'submitted');
  assert.equal((await app.call(`${path}/drafts/${id}/decision`, { expectedRevision: 0, expectedVersion: 1, decision: 'reviewed', reviewer: 'Demo Analyst', note })).status, 400);
  const changes = await app.call(`${path}/drafts/${id}/decision`, { expectedRevision: 0, expectedVersion: 1, decision: 'changes-requested', reviewer: 'Demo supervisor', note: 'Please add the hold reference.' });
  assert.equal(changes.body.draft.state, 'changes-requested');
  assert.equal((await app.call(`${path}/drafts/${id}/submit`, { expectedRevision: 0, expectedVersion: 1 })).status, 409, 'changes requested needs a new version first');

  // A stale version number is refused with the current version.
  const staleVersion = await app.call(`${path}/drafts/${id}`, { expectedRevision: 0, expectedVersion: 5, text: `${prepared.text}\nHold reference added.`, note });
  assert.equal(staleVersion.status, 409); assert.equal(staleVersion.body.currentVersion, 1);

  // Revising makes the earlier decision stale but keeps it in history.
  const reviseBody = { expectedRevision: 0, expectedVersion: 1, text: `${prepared.text}\nHold reference added.`, note };
  const revised = await app.call(`${path}/drafts/${id}`, reviseBody, 'draft-revise-1');
  draft = revised.body.draft;
  assert.equal(draft.state, 'draft'); assert.equal(draft.version, 2); assert.equal(draft.versions.length, 2);
  assert.equal(draft.decisions.length, 2);
  assert.ok(draft.decisions.every(decision => decision.stale && decision.staleReasons.includes('draft-text-changed')));
  assert.equal(draft.decisions[1].version, 1, 'the decision stays bound to the version it was made against');

  await app.call(`${path}/drafts/${id}/submit`, { expectedRevision: 0, expectedVersion: 2 });
  const reviewed = await app.call(`${path}/drafts/${id}/decision`, { expectedRevision: 0, expectedVersion: 2, decision: 'reviewed', reviewer: 'Demo supervisor', note: 'Note matches the cited findings.' }, 'draft-review-1');
  draft = reviewed.body.draft;
  assert.equal(draft.state, 'reviewed'); assert.equal(draft.reviewCurrent, true); assert.equal(draft.needsFreshReview, false);
  assert.match(reviewed.body.limitation, /does not resolve a finding/);

  // Reviewed describes the note only: findings, evidence, and holds are untouched.
  const detail = (await app.call(path)).body;
  assert.equal(detail.report.findings.find(f => f.id === 'DEMO-VA-001:funding').status, 'needs-evidence');
  assert.equal(detail.report.records[0].retention.status, 'blocked'); assert.equal(detail.report.records[0].retention.canDestroy, false);
  assert.equal(detail.case.revision, 0);
  assert.equal(detail.journey.find(stage => stage.id === 'review').state, 'Review note reviewed');
  assert.ok(detail.journey.find(stage => stage.id === 'handoff').outstanding.some(line => /unresolved/.test(line)));

  // A retried request replays its original result and cannot overwrite the newer draft.
  const replay = await app.call(`${path}/drafts/${id}`, reviseBody, 'draft-revise-1');
  assert.equal(replay.status, 200); assert.equal(replay.body.draft.version, 2); assert.equal(replay.body.draft.state, 'draft');
  const afterReplay = (await app.call(`${path}/drafts/${id}`)).body.draft;
  assert.equal(afterReplay.state, 'reviewed'); assert.equal(afterReplay.versions.length, 2);
  assert.equal((await app.call(`${path}/drafts/${id}`, { ...reviseBody, note: 'Different content, same key.' }, 'draft-revise-1')).status, 409);

  // Changing the cited evidence makes the review visibly stale without rewriting history.
  const evidence = await app.call(`${path}/evidence`, { kind: 'funding', title: 'Synthetic funds reference', locator: 'demo://DEMO-VA-001/funds', expectedRevision: 0 });
  assert.equal(evidence.status, 201);
  draft = (await app.call(`${path}/drafts/${id}`)).body.draft;
  assert.equal(draft.state, 'reviewed'); assert.equal(draft.evidenceChanged, true); assert.equal(draft.reviewCurrent, false); assert.equal(draft.needsFreshReview, true);
  assert.deepEqual(draft.decisions.at(-1).staleReasons, ['evidence-changed']);
  assert.equal((await app.call(path)).body.journey.find(stage => stage.id === 'review').state, 'Review is out of date');
  assert.equal((await app.call(`${path}/drafts/${id}/submit`, { expectedRevision: 1, expectedVersion: 2 })).status, 409);

  // Evidence on another case does not affect this draft.
  await app.call('/api/cases/DEMO-VA-002/evidence', { kind: 'records-plan', title: 'Other case reference', locator: 'demo://DEMO-VA-002/plan' });
  assert.equal((await app.call(`${path}/drafts/${id}`)).body.draft.currentEvidenceHash, draft.currentEvidenceHash);

  // A fresh version against the current evidence, then a fresh review.
  const refreshed = await app.call(`${path}/drafts/${id}`, { expectedRevision: 1, expectedVersion: 2, refreshSnapshot: true, note: 'Refreshed after a funding reference was added.' });
  draft = refreshed.body.draft;
  assert.equal(draft.version, 3); assert.equal(draft.state, 'draft'); assert.equal(draft.evidenceChanged, false);
  assert.equal(draft.versions[2].snapshot.evidence.length, 1);
  await app.call(`${path}/drafts/${id}/submit`, { expectedRevision: 1, expectedVersion: 3 });
  assert.equal((await app.call(`${path}/drafts/${id}/decision`, { expectedRevision: 1, expectedVersion: 3, decision: 'reviewed', reviewer: 'Demo supervisor', note })).body.draft.reviewCurrent, true);

  // The packet carries drafts and every decision, and its digest still verifies.
  const packet = (await app.call(`${path}/packet`)).body;
  assert.equal(packet.reviewDrafts.length, 1); assert.equal(packet.reviewDrafts[0].decisions.length, 6);
  assert.ok(packet.reviewDrafts[0].decisions.slice(0, 4).every(decision => decision.stale));
  assert.ok(packet.report.findings.some(f => f.status === 'needs-evidence')); assert.ok(packet.report.findings.some(f => f.status === 'blocked'));
  const { digest, ...rest } = packet;
  assert.equal(createHash('sha256').update(canonicalJson(rest), 'utf8').digest('hex'), digest.value);
  assert.ok(packet.events.some(event => event.action === 'review-draft-decided' && event.details.change.before.state === 'submitted'));

  // Everything survives a restart, including the retry receipt.
  await app.close();
  app = await start(stateFile);
  const persisted = (await app.call(`${path}/drafts/${id}`)).body.draft;
  assert.equal(persisted.version, 3); assert.equal(persisted.state, 'reviewed'); assert.equal(persisted.decisions.length, 6);
  assert.equal((await app.call(`${path}/drafts/${id}`, reviseBody, 'draft-revise-1')).body.draft.version, 2, 'receipt replays after restart');
  assert.equal((await app.call(`${path}/drafts/${id}`)).body.draft.version, 3);
  assert.equal((await app.call(`${path}/drafts/missing`)).status, 404);
  assert.equal((await app.call('/api/cases/DEMO-VA-002/drafts/' + id)).status, 404, 'a draft is scoped to its case');
});

test('a trusted identity is used for author and reviewer, and an author cannot review their own note', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'va-drafts-trusted-'));
  const stateFile = join(directory, 'workspace.json');
  const session = actor => ({ mode: 'aws-pilot', authenticated: true, actor, roles: ['reviewer'] });
  let app = await start(stateFile, { actor: 'subject-author', session: session('subject-author') });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const path = '/api/cases/DEMO-VA-003';
  const created = await app.call(`${path}/drafts`, { expectedRevision: 0, title: 'Review note', text: 'Synthetic review note text.', findingIds: ['DEMO-VA-003:funding'], author: 'Typed name is ignored', reviewer: 'subject-reviewer' });
  assert.equal(created.body.draft.author, 'subject-author'); assert.equal(created.body.draft.identity, 'verified');
  const id = created.body.draft.id;
  await app.call(`${path}/drafts/${id}/submit`, { expectedRevision: 0, expectedVersion: 1 });
  assert.equal((await app.call(`${path}/drafts/${id}/decision`, { expectedRevision: 0, expectedVersion: 1, decision: 'reviewed', reviewer: 'Someone else', note })).status, 403);
  await app.close();
  app = await start(stateFile, { actor: 'subject-reviewer', session: session('subject-reviewer') });
  const decided = await app.call(`${path}/drafts/${id}/decision`, { expectedRevision: 0, expectedVersion: 1, decision: 'reviewed', reviewer: 'Typed name is ignored', note });
  assert.equal(decided.status, 200); assert.equal(decided.body.draft.decisions.at(-1).reviewer, 'subject-reviewer'); assert.equal(decided.body.draft.decisions.at(-1).identity, 'verified');
});

test('assistant tools stay read-only, validate IDs, and navigate only to listed destinations', () => {
  const item = { id: 'DEMO-X', title: 'Synthetic', owner: 'Owner', provenance: 'synthetic', policyBasisConfirmed: false, revision: 0, tasks: [],
    applicability: { 'signed-award': 'yes', funding: 'yes', 'market-research': 'unknown', 'records-plan': 'no' },
    evidence: [{ id: 'EV-1', kind: 'funding', title: 'Funds', locator: 'demo://funds', verified: false, provenance: 'synthetic' }], records: [] };
  const run = (intent, extra = {}) => runGuidedAgent(intent, { item, asOf, ...extra });
  const explained = run('explain-finding', { findingId: 'DEMO-X:market-research' });
  assert.equal(explained.result.applicability, 'unknown'); assert.equal(explained.result.finding.status, 'needs-review');
  assert.deepEqual(explained.trace[0], { step: 1, tool: 'explain_finding', caseId: 'DEMO-X', asOf, findingId: 'DEMO-X:market-research' });
  assert.throws(() => run('explain-finding', { findingId: 'DEMO-VA-001:funding' }), /not in this case/);
  assert.throws(() => run('explain-finding'), /Choose a finding/);
  const evidence = run('finding-evidence', { findingId: 'DEMO-X:funding' });
  assert.equal(evidence.result.supporting.length, 0); assert.equal(evidence.result.unverified.length, 1); assert.match(evidence.result.missing, /no reviewer has verified/);
  assert.match(run('finding-evidence', { findingId: 'DEMO-X:signed-award' }).result.missing, /does not show the document is missing/);
  const handoff = run('handoff');
  assert.ok(handoff.result.unresolvedFindings.length >= 3); assert.match(handoff.result.note, /not proof of compliance/);
  assert.equal(run('navigate', { destination: 'case-drafts' }).result.destination.hash, '#/cases/DEMO-X/drafts');
  assert.equal(run('navigate', { query: 'take me to the evidence library please' }).result.destination.id, 'evidence-library');
  assert.equal(run('navigate', { query: 'https://example.com/evil' }).result.matched, false);
  assert.equal(run('navigate', { destination: 'javascript:alert(1)' }).result.matched, false);
  assert.throws(() => run('write-something'), /Choose overview/);
});
