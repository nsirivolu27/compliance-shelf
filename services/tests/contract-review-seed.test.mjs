import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { busyPorts } from '../free-ports.mjs';
import { startPitchDemo } from '../pitch-runner.mjs';
import { seedContractReview, loadPack } from '../contract-review-seed.mjs';
import { completeContractReview } from '../contract-review-completion.mjs';

async function freeGatewayPort() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const start = 20000 + Math.floor(Math.random() * 30000);
    if ((await busyPorts('127.0.0.1', Array.from({ length: 8 }, (_, index) => start + index))).length === 0) return start;
  }
  throw new Error('No free block of eight ports was found');
}

test('contract-review pack: every companion matches its manifest hash, and the remediation stage is held back', async () => {
  const initial = await loadPack('initial');
  const remediation = await loadPack('remediation');
  const completion = await loadPack('completion');
  assert.equal(completion.documents.length, 5);
  assert.equal(initial.documents.length, 9);
  assert.deepEqual(remediation.documents.map(entry => `${entry.documentId} v${entry.version}`).sort(), ['SYN-VAP-DOC-06 v2.0', 'SYN-VAP-DOC-09 v1.0']);
  for (const entry of [...initial.documents, ...remediation.documents, ...completion.documents]) {
    assert.equal(entry.content.split('\n')[0], 'SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD.', `${entry.documentId} carries the banner`);
    assert.match(entry.files.original.path, /^originals\/SYN-VAP-DOC-\d\d_v\d\.\d\.pdf$/);
  }
  // Two versions of the acceptance memo exist; the earlier one is not replaced.
  assert.ok(initial.documents.some(entry => entry.documentId === 'SYN-VAP-DOC-06' && entry.version === '1.0'));
});

test('contract-review seed: a fresh isolated stack gets the case, records, hold, documents and unverified references only', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'cp-contract-review-'));
  let demo;
  t.after(async () => {
    if (demo) { demo.stop(); await demo.exited; }
    // Workers must stop writing before their temporary directory is removed.
    await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const today = new Date().toISOString().slice(0, 10);
  demo = await startPitchDemo({ env: process.env, gatewayPort: await freeGatewayPort(), folder, today, seed: seedContractReview, output: { log() {}, error() {} } });
  const seeded = await demo.ready;
  assert.ok(seeded, 'the seed finished');
  const get = async path => (await fetch(`${demo.base}${path}${path.includes('?') ? '&' : '?'}asOf=${today}`)).json();

  const detail = await get(`/api/cases/${seeded.caseId}`);
  const item = detail.case;
  assert.equal(item.title, 'VA regional services portal — accessibility and delivery evidence review');
  assert.equal(item.contractNumber, 'SYN-VA-PORTAL-2026-001');
  assert.deepEqual(Object.values(item.applicability), ['yes', 'yes', 'yes']);
  assert.deepEqual(item.records.map(record => record.hold), ['active', 'none'], 'the synthetic hold is active');
  assert.equal(item.records.every(record => !record.schedule?.confirmed), true, 'no schedule is asserted for this fictional file');
  assert.equal(item.evidence.length, 6);
  assert.equal(item.evidence.every(entry => entry.verified === false && entry.locator.startsWith('document://')), true, 'references wait for a reviewer to verify them');
  assert.deepEqual([(item.citations ?? []).length, (item.assessments ?? []).length, (item.gapDecisions ?? []).length], [0, 0, 0], 'no passage, judgment or gap decision is pre-made');

  // The prepared text companions arrived unchanged: the stored hash is the manifest hash.
  const { documents: initial } = await loadPack('initial');
  for (const entry of initial) {
    const { document } = await get(`/api/documents/${seeded.documents[entry.documentId]}`);
    assert.equal(document.status, 'ready');
    assert.equal(document.sha256, entry.files.companion.sha256, `${entry.documentId} hash`);
    assert.match(document.note, /does not read the PDF/);
    const references = item.evidence.filter(evidence => evidence.locator.startsWith(`document://${document.id}#`));
    assert.deepEqual([...document.linkedEvidence].sort(), references.map(evidence => evidence.id).sort(), `${entry.documentId}: register and case reference IDs agree`);
  }
  const listing = JSON.stringify(await get('/api/documents?limit=100'));
  assert.doesNotMatch(listing, /answer key|answer-key|SYN-VAP-DOC-09|v2\.0/i, 'neither the answer key nor the remediation documents are loaded');

  const report = await get(`/api/audit-report?caseId=${seeded.caseId}`);
  assert.deepEqual([report.cases[0].activeHolds.length, report.cases[0].confirmedGaps.length, report.cases[0].pendingReviewIssues.length], [1, 0, 0]);
  assert.equal((await get('/api/records?hold=active')).items.every(record => record.retention.canDestroy === false), true);

  // Later versions arrive separately, with exact content hashes; neither the old memo nor the hold changes.
  const { documents: remediation } = await loadPack('remediation');
  for (const entry of remediation) {
    const response = await fetch(`${demo.base}/api/documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `remediation-${entry.documentId}-${entry.version}` },
      body: JSON.stringify({ caseId: item.id, title: `${entry.documentId} v${entry.version}`, filename: entry.files.companion.path.split('/').pop(), mediaType: 'text/markdown', content: entry.content, note: 'Synthetic revised evidence, earlier versions retained.' }),
    });
    assert.equal(response.status, 202);
    const { document: added } = await response.json();
    assert.equal(added.sha256, entry.files.companion.sha256, `${entry.documentId} v${entry.version} intake hash`);
    assert.notEqual(added.id, seeded.documents[entry.documentId], 'revision is a separate document');
  }
  const { document: originalMemo } = await get(`/api/documents/${seeded.documents['SYN-VAP-DOC-06']}`);
  assert.equal(originalMemo.sha256, initial.find(entry => entry.documentId === 'SYN-VAP-DOC-06').files.companion.sha256);
  assert.equal((await get(`/api/cases/${item.id}`)).case.records.find(record => record.id === item.records[0].id).hold, 'active');

  // Complete an actual isolated case through the same APIs as the UI, preserving its adverse history.
  await assert.rejects(completeContractReview({ base: demo.base, caseId: item.id, today: '2026-11-01' }), /dated/);
  await assert.rejects(completeContractReview({ base: demo.base, caseId: 'REAL-001', today }), /synthetic/);
  const completed = await completeContractReview({ base: demo.base, caseId: item.id, today });
  assert.equal(completed.currentSufficientChecks, 3);
  assert.equal(completed.documentationGaps, 0);
  assert.equal(completed.openTasks, 0);
  assert.equal(completed.activeHolds, 1);
  const finalDetail = await get(`/api/cases/${item.id}`);
  const handoffItems = finalDetail.journey.find(stage => stage.id === 'handoff').outstanding;
  assert.equal(handoffItems.length, 1, 'An active hold is reported once, not counted again as an unfinished evidence review');
  assert.match(handoffItems[0], /active hold/);
  assert.match(finalDetail.journey.find(stage => stage.id === 'checks').nextAction, /preserved/);
  assert.equal(finalDetail.case.assessments[0].outcome, 'insufficient');
  assert.deepEqual(finalDetail.case.records.map(record => record.holdReviews), item.records.map(record => record.holdReviews));
  const drafts = await get(`/api/cases/${item.id}/drafts`);
  assert.equal(drafts.drafts[0].state, 'reviewed');
  assert.equal(drafts.drafts[0].reviewCurrent, true);
  const repeated = await completeContractReview({ base: demo.base, caseId: item.id, today });
  assert.equal(repeated.revision, completed.revision, 'Retry does not duplicate case changes');
  assert.equal(repeated.assessments, completed.assessments);
  assert.equal(repeated.draftId, completed.draftId);
  const stale = await fetch(`${demo.base}/api/cases/${item.id}/tasks/${finalDetail.case.tasks[0].id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'completion-stale-check' },
    body: JSON.stringify({ expectedRevision: item.revision, status: 'open', note: 'An outdated browser must not reopen the completed follow-up.' }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).currentRevision, completed.revision);
});
