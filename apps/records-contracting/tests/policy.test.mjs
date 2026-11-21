import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { analyzeCase } from '../src/lib/core/compliance.ts';
import { policyRegistry, policyContext, laterVersions, reassessmentQueue, newPolicyReview } from '../src/lib/core/policy.ts';

const note = 'Recorded for the synthetic demo.';
const basis = 'Synthetic basis text for the demonstration.';
const sources = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
const cases = JSON.parse(await readFile(new URL('../data/demo-cases.json', import.meta.url), 'utf8'));

async function start(stateFile) {
  const server = await createApp({ stateFile });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, { asOf = '2026-11-15', key } = {}) => {
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${asOf}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}

test('policy registry: stable identifiers, dated only where the source gives a date, and nothing marked reviewed', () => {
  const { policies, versions } = policyRegistry(sources);
  assert.deepEqual(policies.map(policy => policy.policyId).sort(), ['far-part-4', 'va-directive-6300', 'vaar']);
  assert.equal(new Set(versions.map(version => version.versionId)).size, versions.length);
  for (const version of versions) {
    assert.match(version.versionId, new RegExp(`^${version.policyId}@`));
    assert.equal(version.reviewStatus, 'retrieved-not-reviewed', 'retrieval is never presented as specialist approval');
    assert.ok(version.sources.length >= 1 && version.sources.every(source => source.url.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(source.retrievedOn)));
    for (const field of ['issuedOn', 'publishedOn', 'effectiveOn']) assert.ok(version[field] === null || /^\d{4}-\d{2}-\d{2}$/.test(version[field]));
    assert.ok(Array.isArray(version.applicabilityConditions) && Array.isArray(version.unresolvedQuestions));
    assert.deepEqual(version.supersedes, [], 'no supersession is claimed without evidence');
    for (const id of version.deviatesFrom) assert.ok(versions.some(other => other.versionId === id && other.policyId === version.policyId));
  }
  const deviation = versions.find(version => version.versionId === 'far-part-4@va-class-deviation-2025-11-03');
  assert.equal(deviation.effectiveOn, '2025-11-03'); assert.equal(deviation.issuedOn, '2025-10-03');
  assert.deepEqual(deviation.sources.map(source => source.id).sort(), ['va-far-part-4-deviation', 'va-flash-26-03']);
  const codified = versions.find(version => version.versionId === 'far-part-4@codified');
  assert.equal(codified.effectiveOn, null, 'a missing date stays missing');
  assert.ok(codified.unresolvedQuestions.length > 0, 'the existing FAR checks are questioned, not declared invalid');

  // Later-version detection respects the screening date and never guesses from a missing date.
  const vaar = versions.find(version => version.versionId === 'vaar@codified');
  assert.deepEqual(laterVersions(vaar, versions, '2026-09-30').map(version => version.versionId), []);
  assert.deepEqual(laterVersions(vaar, versions, '2026-10-01').map(version => version.versionId), ['vaar@va-rfo-class-deviations-2026-10-01']);
  assert.deepEqual(laterVersions(codified, versions, '2025-11-02'), []);
  assert.equal(laterVersions(codified, versions, '2025-11-03').length, 1);
  assert.deepEqual(laterVersions(deviation, versions, '2030-01-01'), []);
});

test('policy context: unknown stays unknown, a confirmation holds until a later version is in effect, and history is kept', () => {
  const [first, , third] = cases;
  const untouched = policyContext(first, analyzeCase(first, '2026-11-15'), sources, '2026-11-15');
  assert.ok(untouched.entries.length >= 3 && untouched.entries.every(entry => entry.status === 'unresolved' && entry.reviewedVersionId === null));
  assert.deepEqual(untouched.counts, { confirmed: 0, unresolved: untouched.entries.length, requiresReassessment: 0 });
  assert.ok(untouched.consideredVersionIds.includes('far-part-4@codified') && untouched.consideredVersionIds.includes('far-part-4@va-class-deviation-2025-11-03'));

  const before = policyContext(third, analyzeCase(third, '2026-09-20'), sources, '2026-09-20');
  assert.equal(before.entries.find(entry => entry.policyId === 'vaar').status, 'confirmed');
  const after = policyContext(third, analyzeCase(third, '2026-11-15'), sources, '2026-11-15');
  const vaar = after.entries.find(entry => entry.policyId === 'vaar');
  assert.equal(vaar.status, 'requires-reassessment');
  assert.equal(vaar.reviewedVersionId, 'vaar@codified'); assert.equal(vaar.reviewId, 'DEMO-POLICY-REVIEW-001');
  assert.deepEqual(vaar.laterVersionIds, ['vaar@va-rfo-class-deviations-2026-10-01']);
  assert.equal(after.entries.find(entry => entry.policyId === 'far-part-4').status, 'confirmed');
  assert.equal(after.entries.find(entry => entry.policyId === 'va-directive-6300').status, 'unresolved');
  assert.deepEqual(after.reviews, third.policyReviews, 'the earlier review is reported unchanged');
  assert.equal(third.policyReviews[0].synthetic, true); assert.equal(third.policyReviews[0].identity, 'unverified-local-demo');
  assert.match(third.policyReviews[0].decisions[0].basis, /not a real VA determination/);

  // The policy picture never changes findings, holds, or destruction.
  const report = analyzeCase(third, '2026-11-15');
  assert.deepEqual(analyzeCase({ ...third, policyReviews: undefined }, '2026-11-15'), report);
  assert.ok(report.records.every(record => record.retention.canDestroy === false));

  const queue = reassessmentQueue(cases, cases.map(item => analyzeCase(item, '2026-11-15')), sources, '2026-11-15');
  assert.deepEqual(queue.map(entry => entry.caseId), ['DEMO-VA-003']);
  assert.deepEqual(reassessmentQueue(cases, cases.map(item => analyzeCase(item, '2026-09-20')), sources, '2026-09-20'), []);

  // Validation is strict and a later "unresolved" decision is honoured.
  const context = { id: 'r-1', now: '2026-11-15T00:00:00.000Z', actor: 'tester', trusted: false };
  const good = { note, reviewer: 'Synthetic reviewer', decisions: [{ versionId: 'vaar@va-rfo-class-deviations-2026-10-01', applicability: 'unresolved', basis }] };
  const review = newPolicyReview(good, third, sources, context);
  assert.equal(review.identity, 'unverified-local-demo'); assert.equal(review.synthetic, true); assert.equal(review.decisions[0].policyId, 'vaar');
  assert.equal(newPolicyReview(good, third, sources, { ...context, trusted: true }).identity, 'verified');
  const reopened = policyContext({ ...third, policyReviews: [...third.policyReviews, review] }, report, sources, '2026-11-15');
  assert.equal(reopened.entries.find(entry => entry.policyId === 'vaar').status, 'unresolved');
  assert.equal(reopened.reviews.length, 2);
  for (const bad of [
    { ...good, decisions: [] },
    { ...good, decisions: [{ versionId: 'vaar@codified', applicability: 'approved', basis }] },
    { ...good, decisions: [{ versionId: 'vaar@codified', applicability: 'confirmed', basis: 'short' }] },
    { ...good, decisions: [{ versionId: 'vaar@codified', applicability: 'confirmed', basis }, { versionId: 'vaar@va-rfo-class-deviations-2026-10-01', applicability: 'confirmed', basis }] },
    { ...good, decisions: [{ versionId: 'vaar@codified', applicability: 'confirmed', basis, score: 1 }] },
    { ...good, reviewer: '' }, { ...good, note: 'short' }, { ...good, approvedBy: 'VA' },
  ]) assert.throws(() => newPolicyReview(bad, third, sources, context), { status: 400 });
  assert.throws(() => newPolicyReview({ ...good, decisions: [{ versionId: 'vaar@imaginary', applicability: 'confirmed', basis }] }, third, sources, context), { status: 404 });
});

test('policy API: additive reads, a revision-checked and idempotent review, restart persistence, and unchanged legacy responses', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cp-policy-'));
  const stateFile = join(directory, 'workspace.json');
  let app = await start(stateFile);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

  const versions = await app.call('/api/policy-versions');
  assert.equal(versions.status, 200); assert.equal(versions.body.policies.length, 3);
  assert.deepEqual(versions.body.enums, { policyStatus: ['confirmed', 'unresolved', 'requires-reassessment'], reviewStatus: ['retrieved-not-reviewed', 'qualified-review-recorded'] });
  assert.match(versions.body.limitation, /never a real agency approval/);
  assert.equal((await app.call('/api/policy-versions', {})).status, 405);

  // Legacy shapes: existing keys and findings are untouched; policyContext is an added key.
  const detail = (await app.call('/api/cases/DEMO-VA-001')).body;
  assert.deepEqual(detail.report, analyzeCase(cases[0], '2026-11-15'));
  assert.equal(detail.report.findings.find(finding => finding.id === 'DEMO-VA-001:policy-basis').status, 'needs-review');
  assert.equal(detail.policyContext.counts.unresolved, detail.policyContext.entries.length);
  const context = await app.call('/api/cases/DEMO-VA-001/policy-context');
  assert.equal(context.status, 200); assert.deepEqual(context.body.entries, detail.policyContext.entries);
  assert.equal((await app.call('/api/cases/NOPE/policy-context')).status, 404);
  assert.equal(Object.hasOwn((await app.call('/api/cases/DEMO-VA-001/packet')).body, 'policyContext'), false, 'a case with no policy review keeps the earlier packet shape');

  const queue = (await app.call('/api/policy-reassessment')).body;
  assert.equal(queue.total, 1); assert.equal(queue.cases[0].caseId, 'DEMO-VA-003'); assert.equal(queue.cases[0].entries[0].policyId, 'vaar');
  assert.equal((await app.call('/api/policy-reassessment', undefined, { asOf: '2026-09-20' })).body.total, 0);

  // Recording a review: validation, revision conflict, idempotent replay.
  const path = '/api/cases/DEMO-VA-001/policy-reviews';
  const body = { expectedRevision: detail.case.revision, note, reviewer: 'Synthetic demo reviewer', decisions: [{ versionId: 'far-part-4@codified', applicability: 'confirmed', basis }, { versionId: 'vaar@va-rfo-class-deviations-2026-10-01', applicability: 'unresolved', basis }] };
  assert.equal((await app.call(path, { ...body, expectedRevision: undefined })).status, 400);
  assert.equal((await app.call(path, { ...body, decisions: [{ versionId: 'nope@1', applicability: 'confirmed', basis }] })).status, 404);
  const stale = await app.call(path, { ...body, expectedRevision: 99 });
  assert.equal(stale.status, 409); assert.equal(stale.body.currentRevision, detail.case.revision);
  assert.equal((await app.call('/api/workspace')).body.events.length, 0, 'rejected requests leave no event');
  const saved = await app.call(path, body, { key: 'policy-1' });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.review.synthetic, true); assert.equal(saved.body.review.identity, 'unverified-local-demo');
  assert.equal(saved.body.case.revision, detail.case.revision + 1);
  // Confirming the codified text while the VA deviation is in effect is recorded as given and flagged, not silently accepted.
  const far = saved.body.policyContext.entries.find(entry => entry.policyId === 'far-part-4');
  assert.equal(far.status, 'requires-reassessment'); assert.deepEqual(far.laterVersionIds, ['far-part-4@va-class-deviation-2025-11-03']);
  assert.equal(saved.body.policyContext.entries.find(entry => entry.policyId === 'vaar').status, 'unresolved');
  assert.deepEqual(saved.body.change.before.find(entry => entry.policyId === 'far-part-4'), { policyId: 'far-part-4', status: 'unresolved', reviewedVersionId: null });
  assert.equal(saved.body.change.after.find(entry => entry.policyId === 'far-part-4').reviewedVersionId, 'far-part-4@codified');
  const replay = await app.call(path, body, { key: 'policy-1' });
  assert.equal(replay.body.review.id, saved.body.review.id);
  assert.equal((await app.call(path, { ...body, note: 'A different request under the same key.' }, { key: 'policy-1' })).status, 409);
  const after = (await app.call('/api/cases/DEMO-VA-001')).body;
  assert.equal(after.case.policyReviews.length, 1, 'a replay does not append a second review');
  assert.deepEqual(after.report.findings, detail.report.findings, 'a policy review never changes findings');
  assert.ok(after.report.records.every(record => record.retention.canDestroy === false));
  assert.equal(after.report.findings.find(finding => finding.id === 'DEMO-VA-001:record:REC-001').status, 'blocked', 'the active hold still blocks');
  const events = (await app.call('/api/workspace')).body.events;
  assert.equal(events.length, 1); assert.equal(events[0].action, 'policy-review-recorded');
  assert.equal((await app.call('/api/policy-reassessment')).body.total, 2);

  // A second review is appended; the first is preserved. The packet carries the context once a review exists.
  const second = await app.call(path, { ...body, expectedRevision: after.case.revision, decisions: [{ versionId: 'far-part-4@va-class-deviation-2025-11-03', applicability: 'confirmed', basis }] });
  assert.equal(second.status, 201);
  assert.equal(second.body.policyContext.entries.find(entry => entry.policyId === 'far-part-4').status, 'confirmed');
  assert.equal(second.body.policyContext.reviews.length, 2); assert.deepEqual(second.body.policyContext.reviews[0], saved.body.review);
  const packet = (await app.call('/api/cases/DEMO-VA-001/packet')).body;
  assert.equal(packet.policyContext.reviews.length, 2); assert.match(packet.policyContextNotice, /never a real agency approval/);
  assert.equal(packet.digest.algorithm, 'SHA-256');

  await app.close(); app = await start(stateFile);
  assert.equal((await app.call('/api/cases/DEMO-VA-001/policy-context')).body.reviews.length, 2);
  assert.equal((await app.call('/api/policy-reassessment')).body.total, 1);
});
