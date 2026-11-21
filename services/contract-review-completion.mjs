// Scripted training decisions, not automated compliance judgments. Uses the normal audited API.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPack, intakeBody } from './contract-review-seed.mjs';

const note = 'Scripted synthetic exercise: final evidence reviewed under the fictional SOW. Not an actual agency approval.';
const finalTitle = 'Completed evidence review — synthetic portal delivery';
const kinds = ['accessibility-conformance', 'delivery-traceability', 'acceptance-review'];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export async function completeContractReview({ base, caseId, today = new Date().toISOString().slice(0, 10), headers = {} }) {
  if (!/^DEMO-/.test(caseId)) throw Error('A synthetic DEMO case is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || today < '2026-11-20') throw Error('The completion exercise is dated 2026-11-20 or later');
  const prefix = `/api/cases/${encodeURIComponent(caseId)}`;
  async function api(path, body, key) {
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${today}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers, ...(body === undefined ? {} : { Origin: new URL(base).origin, 'Content-Type': 'application/json', 'Idempotency-Key': key ?? `completion:${randomUUID()}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(`${path}: ${response.status} ${data.error ?? 'Request refused'}`);
    return data;
  }
  const current = async () => (await api(prefix)).case;
  const change = async (path, body, useNote = true) => api(prefix + path, { expectedRevision: (await current()).revision, ...(useNote ? { note } : {}), ...body });
  const initial = await current();
  assert.equal(initial.provenance, 'synthetic');
  assert.equal(initial.contractNumber, 'SYN-VA-PORTAL-2026-001', 'Only the named training scenario is supported');
  assert.ok(kinds.every(kind => initial.applicability[kind] === 'yes'), 'A person must establish the scenario applicability first');
  assert.ok(initial.records.some(record => record.hold === 'active'), 'The training hold must be present');
  const beforeHolds = initial.records.map(({ id, hold, holdReviews }) => ({ id, hold, holdReviews }));
  // Load and validate every file before making a change.
  const completion = (await loadPack('completion')).documents;
  assert.equal(completion.length, 5);
  const remediation = (await loadPack('remediation')).documents;

  async function addDocument(entry) {
    const title = `${entry.documentId} v${entry.version} — ${entry.title}`;
    const { document } = await api('/api/documents', intakeBody(caseId, entry), `demo-completion:${caseId}:${entry.documentId}:${entry.version}`);
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = (await api(`/api/documents/${document.id}`)).document;
      if (result.status === 'failed') throw Error(`Document extraction failed: ${title}`);
      if (result.status === 'ready') { assert.equal(result.sha256, entry.files.companion.sha256); return result; }
      await delay(100);
    }
    throw Error(`Document extraction timed out: ${title}`);
  }
  async function link(document, kind) {
    const existing = (await current()).evidence.find(item => item.kind === kind && item.locator.startsWith(`document://${document.id}`));
    if (existing) return existing;
    await api(`/api/documents/${document.id}/evidence`, { kind, expectedRevision: (await current()).revision, note });
    return (await current()).evidence.find(item => item.kind === kind && item.locator.startsWith(`document://${document.id}`));
  }
  async function cite(evidence, quote) {
    const documentId = evidence.locator.match(/^document:\/\/([^#]+)/)?.[1];
    assert.ok(documentId, 'The reference must point to a stored document');
    const { document } = await api(`/api/documents/${documentId}`);
    const { items } = await api(`/api/documents/${documentId}/spans?limit=100`);
    const span = items.find(item => item.text.includes(quote));
    assert.ok(span, `Exact passage must exist: ${quote}`);
    const findingId = `${caseId}:${evidence.kind}`;
    if (!(await current()).citations?.some(item => item.findingId === findingId && item.evidenceId === evidence.id && item.quote === quote)) {
      await change('/citations', { findingId, evidenceId: evidence.id, documentId, sha256: document.sha256, spanId: span.id, quote });
    }
  }
  const assess = async (kind, evidenceIds, outcome, rationale) => {
    if (!(await current()).assessments?.some(item => item.findingId === `${caseId}:${kind}` && item.rationale === rationale)) {
      await change('/assessments', { findingId: `${caseId}:${kind}`, evidenceIds, outcome, rationale }, false);
    }
  };

  // A fresh run retains the original failed review before adding the final evidence.
  if (!initial.assessments?.length) {
    const original = initial.evidence.find(item => item.title.includes('DOC-04'));
    assert.ok(original);
    await cite(original, 'Unresolved keyboard defects at the close of testing: KB-01 and KB-02.');
    await change('/verify-evidence', { evidenceId: original.id });
    await assess(kinds[0], [original.id], 'insufficient', 'Scripted initial review: the original evaluation covers build 1.1 while delivery is 1.2. KB-01 and KB-02 are open. Request a retest, corrected declaration and replacement traceability.');
  }
  if (!(await current()).tasks.some(task => task.findingId === `${caseId}:${kinds[0]}`)) {
    await change('/tasks', { findingId: `${caseId}:${kinds[0]}`, title: 'CA-01: provide final retest and corrected vendor statement', owner: 'SYN-EVAL-06 (fictional evaluator)', dueDate: '2026-11-23' });
  }
  // Preserve the intermediate, incomplete submission as a separate version too.
  for (const entry of remediation) {
    // Earlier rehearsals may already have the exact version under a different intake key.
    const documents = await api(`/api/documents?caseId=${caseId}`);
    const existing = (documents.items ?? documents.documents ?? []).find(item => item.sha256 === entry.files.companion.sha256);
    if (!existing) await addDocument(entry);
  }

  const final = {};
  for (const entry of completion) final[entry.documentId] = await addDocument(entry);
  const finalEvidence = {};
  for (const [kind, ids] of Object.entries({ 'accessibility-conformance': ['SYN-VAP-DOC-09', 'SYN-VAP-DOC-03'], 'delivery-traceability': ['SYN-VAP-DOC-02'], 'acceptance-review': ['SYN-VAP-DOC-06'] })) {
    finalEvidence[kind] = [];
    for (const id of ids) finalEvidence[kind].push(await link(final[id], kind));
  }
  await cite(finalEvidence[kinds[0]][0], 'KB-01 and KB-02 passed the final retest on SYN-BUILD-1.2.1.');
  await cite(finalEvidence[kinds[0]][1], 'The vendor declaration now names SYN-BUILD-1.2.1 and agrees with the final evaluator report.');
  await cite(finalEvidence[kinds[1]][0], 'The delivered replacement and evaluated replacement both identify SYN-BUILD-1.2.1.');
  await cite(finalEvidence[kinds[2]][0], 'SYN-AR-03 acknowledges the final evidence for the stated six-flow acceptance scope.');

  // Verification means the stored reference exists and its content is available. It does not erase old adverse results.
  for (const evidence of (await current()).evidence) {
    if (evidence.verified) continue;
    const documentId = evidence.locator.match(/^document:\/\/([^#]+)/)?.[1];
    assert.ok(documentId);
    assert.equal((await api(`/api/documents/${documentId}`)).document.status, 'ready');
    await change('/verify-evidence', { evidenceId: evidence.id, note: 'Synthetic exercise: checked this stored document reference. Historical versions remain historical; verification alone is not a sufficient-evidence decision.' });
  }
  if (!(await current()).policyBasisConfirmed) {
    await change('/context', { policyBasis: { confirmed: true, description: 'Training basis reviewed in SYN-VAP-DOC-10 v1.0: fictional SOW DOC-01 and its six-flow scope. Section 508 references are background; this scripted confirmation is not an actual agency applicability decision.', sourceIds: ['demo-cr-508-standards', 'demo-cr-508-applicability'] } });
  }
  for (const record of (await current()).records) {
    if (record.schedule?.confirmed) continue; // Never replace a prior reviewer schedule.
    await change(`/records/${record.id}`, { schedule: { authority: 'SYN-TRAINING-RET-01 — invented training schedule; not NARA authority (DOC-10)', itemNumber: 'DEMO-01', years: 6, trigger: 'final-payment', confirmed: true }, finalPaymentDate: '2026-11-19', note: 'Scripted records review from SYN-VAP-DOC-10 v1.0. Fictional schedule and final-payment receipt SYN-PAY-2026-019, for training only. Preserve both series and the active hold; no disposition is authorized.' });
  }
  const reasons = [
    'Scripted final review: DOC-09 v2.0 records KB-01 and KB-02 passing on correction build 1.2.1 in six named flows. DOC-03 v2.0 corrects the vendor statement and matches that scope. Sufficient for the stated evidence check; no legal certification or inference about excluded pages.',
    'Scripted final review: DOC-02 v2.0 records replacement receipt SYN-RECEIPT-121 and matches delivered and evaluated build SYN-BUILD-1.2.1. Earlier 1.1 and 1.2 documents remain historical evidence. Sufficient for this traceability check.',
    'Scripted final review: DOC-06 v3.0 contains the fictional SYN-AR-03 acknowledgment and ties it to final retest, corrected declaration and receipt for the six-flow scope. Sufficient for this acknowledgment check; no executed contract acceptance or payment authorization.',
  ];
  for (let i = 0; i < kinds.length; i++) await assess(kinds[i], finalEvidence[kinds[i]].map(item => item.id), 'sufficient-for-stated-check', reasons[i]);
  for (const task of (await current()).tasks.filter(task => task.findingId === `${caseId}:${kinds[0]}` && task.status !== 'done')) {
    await change(`/tasks/${task.id}`, { status: 'done', note: 'Scripted completion: final retest, corrected vendor statement and reviewer assessment are saved. Task completion records follow-up only; it does not establish sufficiency or release the hold.' });
  }
  await change('/analyze', {});
  let { drafts } = await api(prefix + '/drafts');
  let draft = drafts.find(item => item.versions.at(-1).title === finalTitle);
  if (!draft) {
    ({ draft } = await change('/drafts', { title: finalTitle, text: 'Synthetic exercise completed: the three stated delivery evidence checks have current sufficient-evidence assessments on build SYN-BUILD-1.2.1. Earlier adverse reviews and document versions remain in the packet. CA-01 follow-up is done. Training records instructions are recorded in DOC-10; the delivery hold stays active and both record series are preserved. This note is an evidence-review handoff, not agency acceptance, legal certification or permission to destroy.', findingIds: kinds.map(kind => `${caseId}:${kind}`), author: 'Synthetic preparer SYN-COR-02', reviewer: 'Synthetic reviewer SYN-AR-03' }));
  }
  if (draft.state === 'draft') ({ draft } = await change(`/drafts/${draft.id}/submit`, { expectedVersion: draft.version, reviewer: 'Synthetic reviewer SYN-AR-03' }));
  if (draft.state === 'submitted') ({ draft } = await change(`/drafts/${draft.id}/decision`, { expectedVersion: draft.version, decision: 'reviewed', reviewer: 'Synthetic reviewer SYN-AR-03', note: 'Scripted fictional reviewer decision for the completed evidence packet. Names are scenario roles under the shared demo operator, not independently authenticated reviewers. The active hold remains.' }));

  const detail = await api(prefix);
  assert.deepEqual(detail.case.records.map(({ id, hold, holdReviews }) => ({ id, hold, holdReviews })), beforeHolds, 'Hold history must be untouched');
  const review = await api(prefix + '/evidence-review');
  assert.ok(review.findings.every(item => item.currentAssessment?.outcome === 'sufficient-for-stated-check' && item.currentAssessment.freshness.state === 'current'));
  const documentation = await api(prefix + '/documentation');
  assert.equal(documentation.gaps.length, 0, 'The completed training file must have no documentation gap');
  assert.ok(detail.report.records.every(record => record.retention.canDestroy === false));
  const packet = await api(prefix + '/packet');
  const { digest, ...body } = packet;
  const expected = createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
  assert.equal(typeof digest === 'string' ? digest : digest.value, expected, 'Packet digest must verify independently');
  return { caseId, revision: detail.case.revision, assessments: detail.case.assessments.length, currentSufficientChecks: review.findings.length, documentationGaps: documentation.gaps.length, openTasks: detail.case.tasks.filter(task => task.status !== 'done').length, activeHolds: detail.case.records.filter(record => record.hold === 'active').length, draftId: draft.id, packet };
}
