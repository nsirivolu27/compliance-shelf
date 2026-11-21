import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { analyzeCase } from '../src/lib/core/compliance.ts';
import { policyContext } from '../src/lib/core/policy.ts';
import { newCitation, newAssessment, assessmentFreshness, checkCitation, activeCitations, evidenceReview } from '../src/lib/core/evidence-review.ts';

const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const sources = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
const cases = JSON.parse(await readFile(new URL('../data/demo-cases.json', import.meta.url), 'utf8'));
const asOf = '2026-11-15';
const note = 'Recorded for the synthetic demo.';

test('core: citations are exact, assessments snapshot what was considered, and freshness names its cause', () => {
  const item = structuredClone(cases[0]);
  const report = analyzeCase(item, asOf);
  const policy = policyContext(item, report, sources, asOf);
  const text = 'Line one of a synthetic award.\nSigned award reference SYN-AWARD-7.\n';
  const stored = { documentId: 'doc-1', caseId: item.id, sha256: hash(text), status: 'ready', extractedAt: '2026-11-15T10:00:00.000Z', spanCount: 1, span: { id: 'span-1', startOffset: 0, endOffset: text.length, startLine: 1, endLine: 2, text } };
  const context = { id: 'c-1', now: '2026-11-15T11:00:00.000Z', actor: 'local-demo-operator', trusted: false, hash, asOf };
  const body = { note, findingId: `${item.id}:signed-award`, evidenceId: 'EV-001', documentId: 'doc-1', sha256: stored.sha256, spanId: 'span-1', quote: 'Signed award reference SYN-AWARD-7.' };
  const citation = newCitation(body, item, report, stored, context);
  assert.deepEqual(citation.location, { spanId: 'span-1', startOffset: 31, endOffset: 66, startLine: 2, endLine: 2 });
  assert.equal(text.slice(citation.location.startOffset, citation.location.endOffset), citation.quote);
  assert.equal(citation.quoteHash, hash(citation.quote)); assert.equal(citation.replaces, null);
  assert.throws(() => newCitation({ ...body, quote: 'signed award reference syn-award-7.' }, item, report, stored, context), /does not match/);
  assert.throws(() => newCitation(body, item, report, { ...stored, caseId: 'DEMO-VA-002' }, context), { status: 404 });
  assert.throws(() => newCitation(body, item, report, { ...stored, status: 'pending', span: null }, context), { status: 409 });
  assert.throws(() => newCitation({ ...body, replaces: 'nope' }, item, report, stored, context), { status: 404 });

  item.citations = [citation];
  const documents = [{ id: 'doc-1', sha256: stored.sha256, extractedAt: stored.extractedAt }];
  assert.equal(checkCitation(citation, documents).status, 'valid');
  assert.equal(checkCitation(citation, [{ ...documents[0], extractedAt: '2026-11-16T00:00:00.000Z' }]).status, 'extraction-changed');
  assert.equal(checkCitation(citation, []).status, 'document-missing');
  assert.equal(checkCitation(citation, null).status, 'not-checked');

  const assessment = newAssessment({ findingId: body.findingId, evidenceIds: ['EV-001'], outcome: 'sufficient-for-stated-check', rationale: 'Synthetic rationale for the signed award check only.' }, item, report, policy, sources, { ...context, id: 'a-1' });
  assert.equal(assessment.snapshotHash, hash(JSON.stringify(assessment.snapshot)));
  assert.equal(assessment.snapshot.finding.status, 'evidence-present');
  const fresh = extra => assessmentFreshness(assessment, { ...item, ...extra }, report, policy, sources, documents, hash);
  assert.deepEqual(fresh({}), { state: 'current', causes: [] });
  // Verification is a separate fact and does not make an assessment stale.
  assert.equal(fresh({ evidence: item.evidence.map(entry => ({ ...entry, verified: !entry.verified })) }).state, 'current');
  assert.deepEqual(fresh({ evidence: item.evidence.map(entry => (entry.id === 'EV-001' ? { ...entry, locator: 'demo://changed' } : entry)) }).causes.map(cause => cause.code), ['evidence-corrected']);
  assert.deepEqual(fresh({ evidence: [] }).causes.map(cause => cause.code), ['evidence-removed']);
  assert.deepEqual(assessmentFreshness(assessment, item, report, policy, sources, [{ ...documents[0], sha256: 'x' }], hash).causes.map(cause => cause.code), ['document-changed']);
  assert.deepEqual(assessmentFreshness(assessment, item, report, policy, sources, [], hash).causes.map(cause => cause.code), ['citation-invalid']);
  assert.equal(assessmentFreshness(assessment, item, report, policy, sources, null, hash).state, 'cannot-establish');
  const second = newCitation({ ...body, quote: 'Line one of a synthetic award.' }, item, report, stored, { ...context, id: 'c-2' });
  assert.deepEqual(fresh({ citations: [citation, second] }).causes.map(cause => cause.code), ['citation-added']);
  const replacement = newCitation({ ...body, quote: 'Line one of a synthetic award.', replaces: 'c-1' }, item, report, stored, { ...context, id: 'c-3' });
  assert.deepEqual(activeCitations({ citations: [citation, replacement] }).map(entry => entry.id), ['c-3']);
  assert.deepEqual(fresh({ citations: [citation, replacement] }).causes.map(cause => cause.code), ['citation-replaced']);
  // Policy: only the policies behind this finding matter.
  const moved = { ...policy, entries: policy.entries.map(entry => (entry.policyId === 'far-part-4' ? { ...entry, status: 'requires-reassessment' } : entry)) };
  assert.deepEqual(assessmentFreshness(assessment, item, report, moved, sources, documents, hash).causes.map(cause => cause.code), ['policy-requires-reassessment']);
  const elsewhere = { ...policy, entries: policy.entries.map(entry => (entry.policyId === 'vaar' ? { ...entry, status: 'confirmed', reviewedVersionId: 'vaar@codified' } : entry)) };
  assert.equal(assessmentFreshness(assessment, item, report, elsewhere, sources, documents, hash).state, 'current', 'a policy this finding does not cite cannot make it stale');
  // Applicability (F-EVID-001): the scope of the assessed check is compared; other checks and status changes are not.
  assert.equal(assessment.snapshot.finding.applicability, 'yes');
  for (const to of ['no', 'unknown']) {
    const changed = { ...item, applicability: { ...item.applicability, 'signed-award': to } };
    const result = assessmentFreshness(assessment, changed, analyzeCase(changed, asOf), policy, sources, documents, hash);
    assert.equal(result.state, 'needs-review');
    assert.deepEqual(result.causes.map(cause => [cause.code, cause.from, cause.to]), [['applicability-changed', 'yes', to]]);
  }
  const otherCheck = { ...item, applicability: { ...item.applicability, funding: 'no', 'market-research': 'unknown' } };
  assert.equal(assessmentFreshness(assessment, otherCheck, analyzeCase(otherCheck, asOf), policy, sources, documents, hash).state, 'current', 'another check changing scope leaves this assessment current');
  // A status change caused by verification alone is not an applicability change.
  const unverified = { ...item, evidence: item.evidence.map(entry => ({ ...entry, verified: false })) };
  const unverifiedReport = analyzeCase(unverified, asOf);
  assert.notEqual(unverifiedReport.findings.find(finding => finding.id === body.findingId).status, assessment.snapshot.finding.status);
  assert.equal(assessmentFreshness(assessment, unverified, unverifiedReport, policy, sources, documents, hash).state, 'current');
  // A snapshot saved before applicability was recorded gets no invented baseline, and a real cause still wins.
  const older = { ...assessment, snapshot: { ...assessment.snapshot, finding: { id: body.findingId, title: 'Signed award evidence', status: 'evidence-present' } } };
  const olderFreshness = assessmentFreshness(older, item, report, policy, sources, documents, hash);
  assert.equal(olderFreshness.state, 'cannot-establish'); assert.deepEqual(olderFreshness.causes.map(cause => cause.code), ['no-applicability-baseline']);
  assert.deepEqual(assessmentFreshness(older, { ...item, evidence: [] }, report, policy, sources, documents, hash).causes.map(cause => cause.code), ['evidence-removed']);
  // Legacy data without a snapshot: no baseline is invented.
  const legacy = { id: 'old', findingId: body.findingId, outcome: 'insufficient', rationale: 'Recorded before snapshots existed.', evidenceIds: ['EV-001'] };
  assert.deepEqual(assessmentFreshness(legacy, item, report, policy, sources, documents, hash).causes.map(cause => cause.code), ['no-snapshot']);
  // The core functions never change what they are given.
  const frozenItem = structuredClone(item), frozenReport = structuredClone(report), frozenPolicy = structuredClone(policy), frozenStored = structuredClone(stored);
  newCitation({ ...body, quote: 'Line one of a synthetic award.' }, item, report, stored, { ...context, id: 'c-9' });
  newAssessment({ findingId: body.findingId, evidenceIds: ['EV-001'], outcome: 'insufficient', rationale: 'Synthetic rationale used to check immutability.' }, item, report, policy, sources, { ...context, id: 'a-9' });
  assessmentFreshness(assessment, item, report, policy, sources, documents, hash);
  assert.deepEqual([item, report, policy, stored], [frozenItem, frozenReport, frozenPolicy, frozenStored]);
  // Nothing here changes the report.
  item.assessments = [assessment, legacy];
  assert.deepEqual(analyzeCase(item, asOf), report);
  const review = evidenceReview(item, report, policy, sources, documents, hash);
  assert.equal(review.findings.find(finding => finding.findingId === body.findingId).currentAssessment.id, 'old');
  assert.ok(review.findings.every(finding => !finding.findingId.includes(':record:') && !finding.findingId.endsWith(':policy-basis')));
});

test('standalone mode: references and assessments work, passages need the document service, and other edits keep the history', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cp-review-'));
  const stateFile = join(directory, 'workspace.json');
  const start = async options => {
    const server = await createApp({ stateFile, ...options });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, body, key) => {
      const response = await fetch(`${base}${path}?asOf=${asOf}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    return { call, close: () => new Promise(resolve => server.close(resolve)) };
  };
  let app = await start({});
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

  const before = (await app.call('/api/cases/DEMO-VA-001')).body;
  const review = (await app.call('/api/cases/DEMO-VA-001/evidence-review')).body;
  assert.equal(review.documents.status, 'not-configured');
  assert.deepEqual(review.enums.outcome, ['sufficient-for-stated-check', 'insufficient', 'needs-clarification']);
  assert.deepEqual(review.enums.freshness, ['current', 'needs-review', 'cannot-establish']);
  assert.equal(review.findings.length, 4);
  assert.equal(review.findings.find(finding => finding.findingId === 'DEMO-VA-001:signed-award').evidence[0].passage, 'none');
  assert.equal((await app.call('/api/cases/NOPE/evidence-review')).status, 404);
  assert.equal((await app.call('/api/cases/DEMO-VA-001/evidence-review', {})).status, 405);

  const cite = await app.call('/api/cases/DEMO-VA-001/citations', { expectedRevision: 0, note, findingId: 'DEMO-VA-001:signed-award', evidenceId: 'EV-001', documentId: 'doc-1', sha256: 'a'.repeat(64), spanId: 'span-1', quote: 'anything' });
  assert.equal(cite.status, 503); assert.match(cite.body.error, /document service/i);

  const body = { expectedRevision: 0, findingId: 'DEMO-VA-001:signed-award', evidenceIds: ['EV-001'], outcome: 'needs-clarification', rationale: 'Synthetic rationale: a reference only, with no passage to read.' };
  assert.equal((await app.call('/api/cases/DEMO-VA-001/assessments', { ...body, expectedRevision: undefined })).status, 400);
  const stale = await app.call('/api/cases/DEMO-VA-001/assessments', { ...body, expectedRevision: 5 });
  assert.equal(stale.status, 409); assert.equal(stale.body.currentRevision, 0);
  const saved = await app.call('/api/cases/DEMO-VA-001/assessments', body, 'a-1');
  assert.equal(saved.status, 201); assert.equal(saved.body.freshness.state, 'current'); assert.equal(saved.body.case.revision, 1);
  assert.equal((await app.call('/api/cases/DEMO-VA-001/assessments', { ...body, rationale: 'A different request sent under the same key.' }, 'a-1')).status, 409);

  // Legacy shapes are unchanged apart from the stored history and the revision.
  const after = (await app.call('/api/cases/DEMO-VA-001')).body;
  assert.deepEqual(after.report.findings, before.report.findings);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  assert.deepEqual({ ...after.case, assessments: undefined, revision: 0 }, { ...before.case, assessments: undefined });

  // Q-EVID-001: a sufficient assessment over an unverified reference is allowed, is labelled, and resolves nothing.
  const added = await app.call('/api/cases/DEMO-VA-001/evidence', { kind: 'funding', title: 'Synthetic funds reference', locator: 'synthetic://funds/1', expectedRevision: 1 });
  assert.equal(added.status, 201);
  const fundingId = 'DEMO-VA-001:funding';
  const fundsEvidenceId = (await app.call('/api/cases/DEMO-VA-001')).body.case.evidence.find(entry => entry.title === 'Synthetic funds reference').id;
  const statusOf = async id => (await app.call('/api/cases/DEMO-VA-001')).body.report.findings.find(finding => finding.id === id).status;
  assert.equal(await statusOf(fundingId), 'needs-review');
  const sufficient = await app.call('/api/cases/DEMO-VA-001/assessments', { expectedRevision: 2, findingId: fundingId, evidenceIds: [fundsEvidenceId], outcome: 'sufficient-for-stated-check', rationale: 'Synthetic rationale: assessed for the funds check only, on an unverified reference.' });
  assert.equal(sufficient.status, 201); assert.equal(sufficient.body.assessment.snapshot.evidence[0].verified, false);
  assert.equal(sufficient.body.assessment.snapshot.finding.applicability, 'yes');
  assert.equal(await statusOf(fundingId), 'needs-review', 'the finding is not resolved by the assessment');
  assert.equal(await statusOf('DEMO-VA-001:record:REC-001'), 'blocked');
  const fundingReview = async () => (await app.call('/api/cases/DEMO-VA-001/evidence-review')).body.findings.find(finding => finding.findingId === fundingId).currentAssessment.freshness;
  // Verifying afterwards leaves it current.
  assert.equal((await app.call('/api/cases/DEMO-VA-001/verify-evidence', { evidenceId: fundsEvidenceId, note, expectedRevision: 3 })).status, 200);
  assert.equal((await fundingReview()).state, 'current');
  // Known edge (CODEX-003): a correction that resubmits the same values clears verification but changes nothing that is
  // hashed, so the assessment still reads current. This records today's behavior; it is not a claim that it is ideal.
  const noop = await app.call(`/api/cases/DEMO-VA-001/evidence/${fundsEvidenceId}`, { title: 'Synthetic funds reference', note, expectedRevision: 4 });
  assert.equal(noop.status, 200); assert.equal(noop.body.case.evidence.find(entry => entry.id === fundsEvidenceId).verified, false);
  assert.equal((await fundingReview()).state, 'current');
  // F-EVID-001 through the API: changing that check's applicability flags its assessment and no other.
  assert.equal((await app.call('/api/cases/DEMO-VA-001/context', { expectedRevision: 5, note, applicability: { funding: 'unknown' } })).status, 200);
  const flagged = await fundingReview();
  assert.equal(flagged.state, 'needs-review'); assert.deepEqual(flagged.causes.map(cause => cause.code), ['applicability-changed']);
  assert.match(flagged.causes[0].message, /from "yes" to "unknown"/);
  const awardFresh = (await app.call('/api/cases/DEMO-VA-001/evidence-review')).body.findings.find(finding => finding.findingId === 'DEMO-VA-001:signed-award').currentAssessment.freshness;
  assert.equal(awardFresh.state, 'current', 'the unrelated assessment stays current');
  assert.equal((await app.call('/api/cases/DEMO-VA-001/context', { expectedRevision: 6, note, applicability: { funding: 'yes' } })).status, 200);
  assert.equal((await fundingReview()).state, 'current', 'restoring the assessed applicability restores the match');

  // Other case edits keep the appended history, and a restart keeps it too.
  const task = await app.call('/api/cases/DEMO-VA-001/tasks', { expectedRevision: 7, findingId: 'DEMO-VA-001:funding', title: 'Request the funds reference', owner: 'Demo officer', dueDate: '2026-12-01', note });
  assert.equal(task.status, 201);
  const context = await app.call('/api/cases/DEMO-VA-001/context', { expectedRevision: 8, note, owner: 'Demo contracting officer two' });
  assert.equal(context.status, 200); assert.equal(context.body.case.assessments.length, 2);
  await app.close(); app = await start({});
  assert.equal((await app.call('/api/cases/DEMO-VA-001/evidence-review')).body.findings.find(finding => finding.findingId === 'DEMO-VA-001:signed-award').assessments.length, 1);

  // An assessment saved before snapshots existed is shown as unable to establish freshness.
  await app.close();
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.cases[0].assessments.push({ id: 'legacy-1', caseId: 'DEMO-VA-001', findingId: 'DEMO-VA-001:signed-award', outcome: 'insufficient', rationale: 'Recorded before snapshots existed.', evidenceIds: ['EV-001'], at: '2026-01-01T00:00:00.000Z', actor: 'local-demo-operator' });
  await writeFile(stateFile, JSON.stringify(state));
  app = await start({});
  const legacy = (await app.call('/api/cases/DEMO-VA-001/evidence-review')).body.findings.find(finding => finding.findingId === 'DEMO-VA-001:signed-award').currentAssessment;
  assert.equal(legacy.freshness.state, 'cannot-establish'); assert.equal(legacy.freshness.causes[0].code, 'no-snapshot');

  // A signed-in actor is used for attribution and labelled as verified.
  await app.close(); app = await start({ actor: 'records.officer@example.test', session: { mode: 'authenticated', authenticated: true } });
  const revision = (await app.call('/api/cases/DEMO-VA-001')).body.case.revision;
  const trusted = await app.call('/api/cases/DEMO-VA-001/assessments', { ...body, expectedRevision: revision });
  assert.equal(trusted.status, 201); assert.equal(trusted.body.assessment.actor, 'records.officer@example.test'); assert.equal(trusted.body.assessment.identity, 'verified');
});

test('packet (R-EVID-001): evidence checks are live observations, so availability changes the digest while both digests verify and nothing is mutated', async t => {
  const { handlePacket } = await import('../src/packet.mjs');
  const { evidenceReviewFor } = await import('../src/evidence-review.mjs');
  const { canonicalJson } = await import('../src/lib/core/canonical.ts');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-18T12:00:00.000Z') });
  const item = structuredClone(cases[0]);
  const report = analyzeCase(item, asOf);
  const text = 'Signed award reference SYN-AWARD-7.\n';
  const stored = { documentId: 'doc-1', caseId: item.id, sha256: hash(text), status: 'ready', extractedAt: '2026-11-15T10:00:00.000Z', spanCount: 1, span: { id: 'span-1', startOffset: 0, endOffset: text.length, startLine: 1, endLine: 1, text } };
  const context = { id: 'c-1', now: '2026-11-15T11:00:00.000Z', actor: 'local-demo-operator', trusted: false, hash, asOf };
  item.citations = [newCitation({ note, findingId: `${item.id}:signed-award`, evidenceId: 'EV-001', documentId: 'doc-1', sha256: stored.sha256, spanId: 'span-1', quote: 'Signed award reference SYN-AWARD-7.' }, item, report, stored, context)];
  item.assessments = [newAssessment({ findingId: `${item.id}:signed-award`, evidenceIds: ['EV-001'], outcome: 'sufficient-for-stated-check', rationale: 'Synthetic rationale for the signed award check only.' }, item, report, policyContext(item, report, sources, asOf), sources, { ...context, id: 'a-1' })];
  const state = { revision: 3, cases: [item], reviews: [], events: [{ id: 'e-1', action: 'sufficiency-assessed', caseId: item.id, at: '2026-11-15T11:00:00.000Z', actor: 'local-demo-operator', details: {} }], drafts: [] };
  const untouched = structuredClone(state);
  const packetWith = async documents => (await handlePacket({ pathname: `/api/cases/${item.id}/packet`, method: 'GET', searchParams: new URLSearchParams(), state, asOf, sourcesOf: () => sources,
    reviewFor: entry => evidenceReviewFor(entry, sources, asOf, { configured: true, caseDocuments: async () => documents }) })).body;
  const available = await packetWith([{ id: 'doc-1', sha256: stored.sha256, extractedAt: stored.extractedAt }]);
  const unavailable = await packetWith(null);
  const again = await packetWith([{ id: 'doc-1', sha256: stored.sha256, extractedAt: stored.extractedAt }]);

  const verify = packet => { const { digest, ...body } = packet; return createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex') === digest.value; };
  for (const packet of [available, unavailable]) {
    assert.ok(verify(packet), 'each packet verifies against its own digest');
    assert.deepEqual(packet.digest.excludedFields, ['digest']); assert.equal(packet.digest.canonicalization, 'sorted-keys-json-v1');
    assert.equal(packet.exportedAt, '2026-11-18T12:00:00.000Z');
  }
  const seen = packet => packet.evidenceReview.findings.find(finding => finding.findingId === `${item.id}:signed-award`);
  assert.equal(available.evidenceReview.documents.status, 'available'); assert.equal(seen(available).evidence[0].citations[0].check.status, 'valid'); assert.equal(seen(available).currentAssessment.freshness.state, 'current');
  assert.equal(unavailable.evidenceReview.documents.status, 'unavailable'); assert.equal(seen(unavailable).evidence[0].citations[0].check.status, 'not-checked'); assert.equal(seen(unavailable).currentAssessment.freshness.state, 'cannot-establish');
  assert.notEqual(available.digest.value, unavailable.digest.value, 'same stored case and time, different live observation, different digest');
  assert.equal(again.digest.value, available.digest.value, 'the same observation at the same time reproduces the digest');
  // The stored citation and assessment are identical in both; only the live observations differ.
  assert.deepEqual(unavailable.case, available.case); assert.deepEqual(unavailable.events, available.events);
  assert.deepEqual(state, untouched, 'producing a packet changes no case and writes no audit event');
});
