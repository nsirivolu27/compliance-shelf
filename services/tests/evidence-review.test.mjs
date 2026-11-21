import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../apps/records-contracting/src/server.mjs';
import { createDocumentsService } from '../documents.mjs';
import { createJobsService } from '../jobs.mjs';
import { createWorkerService } from '../worker.mjs';
import { createPoliciesService } from '../policies.mjs';
import { createAuditService } from '../audit.mjs';
import { createAgentService } from '../agent.mjs';
import { createGateway } from '../gateway.mjs';

const note = 'Recorded for the synthetic demo.';
const content = 'Synthetic funds memo for the demonstration.\nFunding reference FY26-SYN-001 certifies availability of funds.\nA second line mentions funds again: funds, funds.\n';

test('evidence traceability: a passage is linked to a finding, assessed, made stale by a correction, and exported with its history', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'compliance-review-'));
  const token = randomBytes(32).toString('hex'), servers = [];
  const listen = async (server, port = 0) => { servers.push(server); server.listen(port, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
  const close = async server => { if (server.stopBackground) await server.stopBackground(); if (server.listening) await new Promise(resolve => server.close(resolve)); };
  t.after(async () => { for (const server of [...servers].reverse()) await close(server); await rm(directory, { recursive: true, force: true }); });

  // The workflow service needs the document service's address before either is listening, so reserve a port first.
  const jobs = await createJobsService({ token, stateFile: join(directory, 'jobs.json') });
  const jobsUrl = await listen(jobs);
  const holder = { url: null };
  const workflow = await createApp({ stateFile: join(directory, 'workspace.json'), internalToken: token, documentsUrl: 'http://127.0.0.1:1' });
  const workflowUrl = await listen(workflow);
  let docs = await createDocumentsService({ token, stateFile: join(directory, 'documents.json'), workflowUrl, jobsUrl, outboxInterval: 60000 });
  const documentsUrl = await listen(docs), docPort = docs.address().port;
  holder.url = documentsUrl;
  await close(workflow);
  const workflow2 = await createApp({ stateFile: join(directory, 'workspace.json'), internalToken: token, documentsUrl });
  await listen(workflow2, Number(new URL(workflowUrl).port));
  const policiesUrl = await listen(await createPoliciesService({ token, workflowUrl }));
  const auditUrl = await listen(createAuditService({ token, workflowUrl, documentsUrl }));
  const agentUrl = await listen(createAgentService({ token, workflowUrl }));
  const worker = createWorkerService({ token, jobsUrl, documentsUrl, interval: 60000 });
  const workerUrl = await listen(worker);
  const gatewayUrl = await listen(createGateway({ token, urls: { workflow: workflowUrl, documents: documentsUrl, jobs: jobsUrl, policies: policiesUrl, audit: auditUrl, agent: agentUrl, worker: workerUrl } }));
  let counter = 0;
  const request = async (path, { method = 'GET', body, key } = {}) => {
    const response = await fetch(`${gatewayUrl}${path}${path.includes('?') ? '&' : '?'}asOf=2026-11-15`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(method === 'POST' ? { 'idempotency-key': key ?? `k-${++counter}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const caseOf = async id => (await request(`/api/cases/${id}`)).body;
  const reviewOf = async id => (await request(`/api/cases/${id}/evidence-review`)).body;
  const findingIn = (review, id) => review.findings.find(finding => finding.findingId === id);

  // 1. A funding finding with missing supplied evidence, and an active hold that stays blocked throughout.
  const funding = 'DEMO-VA-001:funding', hold = 'DEMO-VA-001:record:REC-001';
  let detail = await caseOf('DEMO-VA-001');
  const statusOf = (d, id) => d.report.findings.find(finding => finding.id === id).status;
  assert.equal(statusOf(detail, funding), 'needs-evidence'); assert.equal(statusOf(detail, hold), 'blocked');
  let review = await reviewOf('DEMO-VA-001');
  assert.equal(review.documents.status, 'available');
  assert.deepEqual(findingIn(review, funding).evidence, []); assert.equal(findingIn(review, funding).currentAssessment, null);
  assert.equal(review.findings.some(finding => finding.findingId === hold), false, 'record findings take no citations');
  // Existing reference-only evidence says plainly that no passage is attached.
  const award = findingIn(review, 'DEMO-VA-001:signed-award').evidence[0];
  assert.equal(award.passage, 'none'); assert.deepEqual(award.citations, []);

  // 2. Intake of a supported synthetic document; unsupported formats are refused.
  assert.equal((await request('/api/documents', { method: 'POST', body: { caseId: 'DEMO-VA-001', title: 'Scan', filename: 'scan.pdf', mediaType: 'application/pdf', content: 'x', note } })).status, 415);
  const intake = await request('/api/documents', { method: 'POST', body: { caseId: 'DEMO-VA-001', title: 'Synthetic funds memo', filename: 'funds.txt', mediaType: 'text/plain', content, note } });
  assert.equal(intake.status, 202);
  const doc = intake.body.document;
  const other = (await request('/api/documents', { method: 'POST', body: { caseId: 'DEMO-VA-002', title: 'Other case memo', filename: 'other.txt', mediaType: 'text/plain', content, note } })).body.document;
  // Before extraction there is nothing to cite.
  const linkBody = { expectedRevision: detail.case.revision, note, findingId: funding, documentId: doc.id, sha256: doc.sha256, spanId: 'span-1', quote: 'Funding reference FY26-SYN-001 certifies availability of funds.' };
  await worker.workOnce(); await worker.workOnce();
  const linked = await request(`/api/documents/${doc.id}/evidence`, { method: 'POST', body: { kind: 'funding', expectedRevision: detail.case.revision, note } });
  assert.equal(linked.status, 201);
  const evidenceId = linked.body.evidence.id;
  detail = await caseOf('DEMO-VA-001');
  assert.equal(statusOf(detail, funding), 'needs-review', 'an unverified reference is only a review item');

  // 3. Citation integrity.
  const cite = (extra = {}) => request('/api/cases/DEMO-VA-001/citations', { method: 'POST', body: { ...linkBody, evidenceId, expectedRevision: detail.case.revision, ...extra } });
  assert.equal((await cite({ quote: 'This sentence is not in the document.' })).status, 400);
  assert.equal((await cite({ quote: 'funds' })).status, 400, 'a quote that appears more than once has no exact location');
  assert.equal((await cite({ spanId: 'span-99' })).status, 404);
  assert.equal((await cite({ sha256: 'a'.repeat(64) })).status, 409, 'a different document version is refused');
  assert.equal((await cite({ documentId: other.id, sha256: other.sha256 })).status, 404, 'a document from another case is refused');
  assert.equal((await cite({ findingId: 'DEMO-VA-002:funding' })).status, 404, 'a finding from another case is refused');
  assert.equal((await cite({ findingId: hold })).status, 400);
  assert.equal((await cite({ findingId: 'DEMO-VA-001:signed-award' })).status, 400, 'the evidence must support the chosen check');
  assert.equal((await cite({ evidenceId: 'EV-404' })).status, 404);
  assert.equal((await cite({ page: 3 })).status, 400, 'page numbers are not accepted for plain text');
  const staleRevision = await cite({ expectedRevision: 99 });
  assert.equal(staleRevision.status, 409); assert.equal(staleRevision.body.currentRevision, detail.case.revision);
  assert.equal((await caseOf('DEMO-VA-001')).case.citations, undefined, 'rejected citations store nothing');
  const cited = await cite({}, 'cite-1');
  const citedAgain = await request('/api/cases/DEMO-VA-001/citations', { method: 'POST', key: 'cite-key', body: { ...linkBody, evidenceId, expectedRevision: detail.case.revision } });
  assert.equal(cited.status, 201);
  const citation = cited.body.citation;
  assert.equal(citation.sha256, doc.sha256); assert.equal(citation.documentId, doc.id); assert.equal(citation.findingId, funding);
  assert.equal(content.slice(citation.location.startOffset, citation.location.endOffset), citation.quote);
  assert.deepEqual([citation.location.spanId, citation.location.startLine, citation.location.endLine], ['span-1', 2, 2]);
  assert.equal(Object.hasOwn(citation.location, 'page'), false);
  assert.ok(citation.extraction.extractedAt); assert.equal(citation.actor, 'local-demo-operator'); assert.equal(citation.identity, 'unverified-local-demo');
  assert.equal(citedAgain.status, 409, 'the case revision moved on after the first citation');
  detail = await caseOf('DEMO-VA-001');
  assert.equal(detail.case.citations.length, 1);

  // 4. Verification stays separate from sufficiency. 5. A scoped assessment with a rationale.
  review = await reviewOf('DEMO-VA-001');
  const fundingEvidence = findingIn(review, funding).evidence[0];
  assert.equal(fundingEvidence.passage, 'attached'); assert.equal(fundingEvidence.verified, false);
  assert.equal(fundingEvidence.citations[0].check.status, 'valid'); assert.equal(fundingEvidence.citations[0].state, 'active');
  const assess = (body, key) => request('/api/cases/DEMO-VA-001/assessments', { method: 'POST', key, body: { expectedRevision: detail.case.revision, ...body } });
  const good = { findingId: funding, evidenceIds: [evidenceId], outcome: 'sufficient-for-stated-check', rationale: 'Synthetic rationale: the quoted line names a funding reference for this made-up case only.' };
  assert.equal((await assess({ ...good, outcome: 'compliant' })).status, 400);
  assert.equal((await assess({ ...good, rationale: 'short' })).status, 400);
  assert.equal((await assess({ ...good, evidenceIds: [] })).status, 400);
  assert.equal((await assess({ ...good, evidenceIds: ['EV-001'] })).status, 400, 'evidence for another check cannot be assessed here');
  assert.equal((await assess({ ...good, reviewer: 'Someone important' })).status, 400, 'typed reviewer names are not accepted');
  assert.equal((await assess({ ...good, findingId: hold })).status, 400);
  const assessed = await assess(good, 'assess-1');
  assert.equal(assessed.status, 201);
  const assessment = assessed.body.assessment;
  assert.equal(assessment.actor, 'local-demo-operator'); assert.equal(assessment.identity, 'unverified-local-demo'); assert.equal(assessment.synthetic, true);
  assert.equal(assessed.body.identity.trusted, false); assert.match(assessed.body.identity.notice, /No one has signed in/);
  assert.deepEqual(assessment.snapshot.citations.map(entry => [entry.id, entry.sha256]), [[citation.id, doc.sha256]]);
  assert.equal(assessment.snapshot.evidence[0].verified, false, 'an unverified reference can be assessed; the snapshot records that it was unverified');
  assert.ok(assessment.snapshot.policy.some(entry => entry.policyId === 'far-part-4' && entry.status === 'unresolved'), 'the policy context considered is recorded, still unresolved');
  assert.equal(assessed.body.freshness.state, 'current');
  assert.equal((await assess(good, 'assess-1')).body.assessment.id, assessment.id, 'a retried request replays the saved assessment');
  detail = await caseOf('DEMO-VA-001');
  assert.equal(detail.case.assessments.length, 1);
  // A "sufficient" assessment changes nothing else.
  assert.equal(statusOf(detail, funding), 'needs-review'); assert.equal(statusOf(detail, hold), 'blocked');
  assert.equal(detail.case.evidence.find(entry => entry.id === evidenceId).verified, false);
  assert.equal(detail.case.applicability.funding, 'yes'); assert.equal(detail.case.policyBasisConfirmed, false);
  assert.ok(detail.report.records.every(record => record.retention.canDestroy === false));
  assert.equal(detail.tasks.filter(task => task.status === 'done').length, 0);

  // 7 (set up). An unrelated assessment on a reference-only evidence item.
  const unrelated = await assess({ findingId: 'DEMO-VA-001:signed-award', evidenceIds: ['EV-001'], outcome: 'needs-clarification', rationale: 'Synthetic rationale: the reference has no passage attached, so its content was not read.' });
  assert.equal(unrelated.status, 201); assert.deepEqual(unrelated.body.assessment.snapshot.citations, []);
  detail = await caseOf('DEMO-VA-001');

  // Verifying the reference afterwards does not make the assessment stale: verification is a separate fact.
  assert.equal((await request('/api/cases/DEMO-VA-001/verify-evidence', { method: 'POST', body: { evidenceId, note, expectedRevision: detail.case.revision } })).status, 200);
  review = await reviewOf('DEMO-VA-001');
  assert.equal(findingIn(review, funding).evidence[0].verified, true);
  assert.equal(findingIn(review, funding).currentAssessment.freshness.state, 'current');
  detail = await caseOf('DEMO-VA-001');
  assert.equal(statusOf(detail, funding), 'evidence-present'); assert.equal(statusOf(detail, hold), 'blocked');

  // 6. An evidence correction makes that assessment stale and says why. 7. The unrelated one stays current.
  assert.equal((await request(`/api/cases/DEMO-VA-001/evidence/${evidenceId}`, { method: 'POST', body: { title: 'Synthetic funds memo, corrected title', note, expectedRevision: detail.case.revision } })).status, 200);
  review = await reviewOf('DEMO-VA-001');
  const stale = findingIn(review, funding).currentAssessment;
  assert.equal(stale.freshness.state, 'needs-review');
  assert.deepEqual(stale.freshness.causes.map(cause => cause.code), ['evidence-corrected']);
  assert.match(stale.freshness.causes[0].message, /was corrected after this assessment/);
  assert.deepEqual(stale.snapshot, assessment.snapshot, 'the original snapshot is preserved');
  assert.equal(findingIn(review, 'DEMO-VA-001:signed-award').currentAssessment.freshness.state, 'current');

  // Correcting the citation is appended, keeps the earlier one, and is a named cause.
  detail = await caseOf('DEMO-VA-001');
  const corrected = await cite({ replaces: citation.id, quote: 'Synthetic funds memo for the demonstration.', expectedRevision: detail.case.revision });
  assert.equal(corrected.status, 201); assert.equal(corrected.body.citation.replaces, citation.id);
  assert.deepEqual(corrected.body.change.before.id, citation.id);
  review = await reviewOf('DEMO-VA-001');
  assert.deepEqual(findingIn(review, funding).evidence[0].citations.map(entry => entry.state), ['replaced', 'active']);
  assert.deepEqual(findingIn(review, funding).currentAssessment.freshness.causes.map(cause => cause.code).sort(), ['citation-replaced', 'evidence-corrected']);
  // A fresh assessment is appended and is current; the stale one stays in history.
  detail = await caseOf('DEMO-VA-001');
  const fresh = await assess({ ...good, outcome: 'insufficient', rationale: 'Synthetic rationale: after the correction the quoted line no longer names a funding reference.' });
  assert.equal(fresh.status, 201);
  review = await reviewOf('DEMO-VA-001');
  assert.equal(findingIn(review, funding).assessments.length, 2);
  assert.equal(findingIn(review, funding).assessments[0].freshness.state, 'needs-review');
  assert.equal(findingIn(review, funding).currentAssessment.outcome, 'insufficient'); assert.equal(findingIn(review, funding).currentAssessment.freshness.state, 'current');

  // A policy change relevant to the finding is a cause; the signed-award assessment cites the same policy and is told too.
  detail = await caseOf('DEMO-VA-001');
  assert.equal((await request('/api/cases/DEMO-VA-001/policy-reviews', { method: 'POST', body: { expectedRevision: detail.case.revision, note, reviewer: 'Synthetic reviewer', decisions: [{ versionId: 'far-part-4@codified', applicability: 'confirmed', basis: 'Synthetic basis text for the demonstration.' }] } })).status, 201);
  review = await reviewOf('DEMO-VA-001');
  assert.deepEqual(findingIn(review, funding).currentAssessment.freshness.causes.map(cause => cause.code), ['policy-requires-reassessment']);

  // 9. The packet and exports carry links, snapshots, freshness, and history. 8. The hold is still blocked.
  const packet = (await request('/api/cases/DEMO-VA-001/packet')).body;
  const packetFunding = packet.evidenceReview.findings.find(finding => finding.findingId === funding);
  assert.equal(packetFunding.assessments.length, 2); assert.equal(packetFunding.evidence[0].citations.length, 2);
  assert.ok(packetFunding.assessments[0].freshness.causes.length > 0); assert.ok(packetFunding.assessments[0].snapshot);
  assert.match(packet.evidenceReviewNotice, /None establishes legal compliance/); assert.match(packet.digestNotice, /not a tamper-proof seal/);
  assert.equal(packet.report.findings.find(finding => finding.id === hold).status, 'blocked');
  assert.equal(Object.hasOwn((await request('/api/cases/DEMO-VA-003/packet')).body, 'evidenceReview'), false, 'a case with no links or assessments keeps the earlier packet shape');
  const exported = (await request('/api/export')).body.cases.find(item => item.id === 'DEMO-VA-001');
  assert.equal(exported.citations.length, 2); assert.equal(exported.assessments.length, 3);
  const audit = (await request('/api/audit/cases/DEMO-VA-001')).body.packet;
  assert.equal(audit.case.assessments.length, 3);
  const actions = (await request('/api/workspace')).body.events.map(entry => entry.action);
  for (const action of ['citation-linked', 'citation-corrected', 'sufficiency-assessed']) assert.ok(actions.includes(action), action);
  const assessedEvent = (await request('/api/workspace')).body.events.find(entry => entry.action === 'sufficiency-assessed');
  assert.equal(assessedEvent.actor, 'local-demo-operator'); assert.equal(assessedEvent.details.change.before, null); assert.equal(assessedEvent.details.change.after.outcome, 'sufficient-for-stated-check');

  // F-EVID-002 (server side): a span beyond the first page of 100 can be cited, and its location is exact.
  let long = ''; for (let n = 1; long.length < 121200; n++) long += `Synthetic ledger line ${String(n).padStart(5, '0')} for the demonstration only.\n`;
  const marker = 'Funding reference FY26-LATE-777 sits near the end of this long synthetic file.';
  long += `${marker}\n`;
  const big = (await request('/api/documents', { method: 'POST', body: { caseId: 'DEMO-VA-001', title: 'Long synthetic ledger', filename: 'ledger.txt', mediaType: 'text/plain', content: long, note } })).body.document;
  await worker.workOnce();
  const firstPage = (await request(`/api/documents/${big.id}/spans?limit=100`)).body;
  assert.ok(firstPage.pagination.total > 100); assert.equal(firstPage.pagination.nextOffset, 100);
  const lastSpanId = `span-${firstPage.pagination.total}`;
  assert.equal(firstPage.items.some(span => span.id === lastSpanId), false, 'the last span is not on the first page');
  detail = await caseOf('DEMO-VA-001');
  const late = await cite({ documentId: big.id, sha256: big.sha256, spanId: lastSpanId, quote: marker, expectedRevision: detail.case.revision });
  assert.equal(late.status, 201); assert.equal(late.body.citation.location.spanId, lastSpanId);
  assert.equal(long.slice(late.body.citation.location.startOffset, late.body.citation.location.endOffset), marker);
  review = await reviewOf('DEMO-VA-001');
  assert.equal(findingIn(review, funding).evidence[0].citations.find(entry => entry.id === late.body.citation.id).check.status, 'valid');

  // The underlying document changing, or the service being down, is reported honestly.
  await close(docs);
  review = await reviewOf('DEMO-VA-001');
  assert.equal(review.documents.status, 'unavailable');
  assert.equal(findingIn(review, funding).evidence[0].citations.find(entry => entry.id === corrected.body.citation.id).check.status, 'not-checked');
  assert.equal((await cite({ expectedRevision: (await caseOf('DEMO-VA-001')).case.revision })).status, 503, 'no citation is stored while the source cannot be read');
  const file = join(directory, 'documents.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.documents.find(entry => entry.id === doc.id).sha256 = 'b'.repeat(64);
  await writeFile(file, JSON.stringify(saved));
  docs = await createDocumentsService({ token, stateFile: file, workflowUrl, jobsUrl, outboxInterval: 60000 });
  await listen(docs, docPort);
  review = await reviewOf('DEMO-VA-001');
  assert.equal(findingIn(review, funding).evidence[0].citations.find(entry => entry.id === corrected.body.citation.id).check.status, 'document-changed');
  assert.ok(findingIn(review, funding).currentAssessment.freshness.causes.some(cause => cause.code === 'document-changed'));
  assert.equal(findingIn(review, 'DEMO-VA-001:signed-award').currentAssessment.freshness.causes.some(cause => cause.code === 'document-changed'), false, 'an assessment with no citation is not touched by a document change');
});
