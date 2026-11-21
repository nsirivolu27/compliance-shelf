// Traceable citations and sufficiency assessments for a case.
// Citations are checked against the document service before they are stored.
// Assessments are appended with a snapshot and never change a finding, a hold, or a task.
import { randomUUID, createHash } from 'node:crypto';
import { analyzeCase } from './lib/core/compliance.ts';
import { policyContext } from './lib/core/policy.ts';
import { evidenceReview, newCitation, newAssessment, assessmentFreshness, outcomes, freshnessStates, citationChecks } from './lib/core/evidence-review.ts';

function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');

const limitation = 'Material received, a passage linked to a check, a verified reference, and a sufficiency assessment are four separate facts. None of them establishes legal compliance. An assessment never confirms applicability, closes a finding, completes a task, releases a hold, or authorizes destruction.';
const identityOf = trusted => (trusted
  ? { trusted: true, notice: 'Entries are attributed to the signed-in identity.' }
  : { trusted: false, notice: 'Local demo: entries are attributed to the local operator. No one has signed in, so an assessment does not prove who made it.' });

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail('expectedRevision must be a non-negative integer');
  return value;
}

/** Talks to the document service. Without one (standalone mode) every call reports that it is unavailable. */
export function documentClient({ documentsUrl, token }) {
  const call = async path => {
    const response = await fetch(new URL(path, documentsUrl), { headers: { 'x-platform-token': token }, redirect: 'error', signal: AbortSignal.timeout(4000) });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };
  return {
    configured: Boolean(documentsUrl && token),
    /** Metadata of every document on the case, or null when the service cannot be asked. */
    async caseDocuments(caseId) {
      if (!documentsUrl || !token) return null;
      try {
        const result = await call(`/internal/documents/cases/${encodeURIComponent(caseId)}/snapshot`);
        return result.status === 200 && Array.isArray(result.body?.documents) ? result.body.documents : null;
      } catch { return null; }
    },
    /** One stored span with its document's case, digest, and extraction time. */
    async span(documentId, spanId) {
      if (!documentsUrl || !token) throw fail('Linking a passage needs the document service, which is not running in this mode.', 503);
      if (typeof documentId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(documentId) || typeof spanId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(spanId)) throw fail('Name a document and one of its spans');
      let result;
      try { result = await call(`/internal/documents/${documentId}/spans/${spanId}`); }
      catch { throw fail('The document service did not answer. Nothing was saved; try again.', 503); }
      if (result.status === 404) throw fail(result.body?.error ?? 'Document or span not found', 404);
      if (result.status === 409) throw fail(result.body?.error ?? 'The document has not been extracted yet', 409);
      if (result.status !== 200 || !result.body) throw fail('The document service could not provide that span. Nothing was saved.', 503);
      return result.body;
    },
  };
}

function documentsStatus(client, documents) {
  if (!client.configured) return { status: 'not-configured', message: 'The document service is not running in this mode. Passages cannot be linked or checked. Existing references still work.' };
  if (!documents) return { status: 'unavailable', message: 'The document service did not answer. Stored passages are shown as recorded and have not been checked just now.' };
  return { status: 'available', message: 'Passages were checked against the stored documents just now.' };
}

/** The review picture, for the read route and the packet. */
export async function evidenceReviewFor(item, sources, asOf, client) {
  const report = analyzeCase(item, asOf);
  const policy = policyContext(item, report, sources, asOf);
  const hasCitations = (item.citations ?? []).length > 0;
  const documents = hasCitations || client.configured ? await client.caseDocuments(item.id) : null;
  return { ...evidenceReview(item, report, policy, sources, documents, hash), asOf, documents: documentsStatus(client, documents) };
}

export async function handleEvidenceReview({ pathname, method, readBody, store, asOf, sourcesOf, actor, trusted, client }) {
  const match = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/(evidence-review|citations|assessments)$/);
  if (!match) return null;
  const [, caseId, resource] = match;
  const found = store.read().cases.find(item => item.id === caseId);
  if (!found) throw fail('Case not found', 404);
  const attribution = actor ?? 'local-demo-operator';
  if (resource === 'evidence-review') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    return { status: 200, body: { ...await evidenceReviewFor(found, sourcesOf(found), asOf, client), enums: { outcome: outcomes, freshness: freshnessStates, citationCheck: citationChecks }, identity: identityOf(trusted), limitation } };
  }
  if (method !== 'POST') throw fail('Method not allowed', 405);
  const body = await readBody();
  const revision = expectedRevision(body.expectedRevision);

  if (resource === 'citations') {
    // Read the stored span first. The quote is compared with it inside the write, against the case as it is then.
    const stored = await client.span(body.documentId, body.spanId);
    const result = await store.mutate(body.replaces ? 'citation-corrected' : 'citation-linked', caseId, state => {
      const item = state.cases.find(candidate => candidate.id === caseId);
      const citation = newCitation(body, item, analyzeCase(item, asOf), stored, { id: randomUUID(), now: new Date().toISOString(), actor: attribution, trusted, hash });
      const before = citation.replaces ? item.citations.find(entry => entry.id === citation.replaces) : null;
      item.citations = [...(item.citations ?? []), citation];
      return { citation, case: item, change: { command: body.replaces ? 'citation-corrected' : 'citation-linked', note: citation.note, before, after: citation } };
    }, { expectedRevision: revision });
    return { status: 201, body: { ...result, case: store.read().cases.find(item => item.id === caseId), limitation } };
  }

  const documents = await client.caseDocuments(caseId);
  const result = await store.mutate('sufficiency-assessed', caseId, state => {
    const item = state.cases.find(candidate => candidate.id === caseId);
    const report = analyzeCase(item, asOf);
    const sources = sourcesOf(item);
    const policy = policyContext(item, report, sources, asOf);
    const assessment = newAssessment(body, item, report, policy, sources, { id: randomUUID(), now: new Date().toISOString(), actor: attribution, trusted, hash, asOf });
    const earlier = (item.assessments ?? []).filter(entry => entry.findingId === assessment.findingId);
    const before = earlier.length ? { id: earlier[earlier.length - 1].id, outcome: earlier[earlier.length - 1].outcome } : null;
    item.assessments = [...(item.assessments ?? []), assessment];
    return { assessment, case: item, change: { command: 'sufficiency-assessed', note: assessment.rationale, before, after: { id: assessment.id, outcome: assessment.outcome, findingId: assessment.findingId, snapshotHash: assessment.snapshotHash } } };
  }, { expectedRevision: revision });
  const saved = store.read().cases.find(item => item.id === caseId);
  const report = analyzeCase(saved, asOf);
  const sources = sourcesOf(saved);
  const freshness = assessmentFreshness(result.assessment, saved, report, policyContext(saved, report, sources, asOf), sources, documents, hash);
  return { status: 201, body: { ...result, case: saved, freshness, identity: identityOf(trusted), limitation } };
}
