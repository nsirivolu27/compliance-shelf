// Policy versions and per-case policy context.
// Reads are computed from the source registry and the case. The one mutation appends a review;
// it never edits an earlier review, a finding, a record, or a hold.
import { randomUUID } from 'node:crypto';
import { analyzeCase } from './lib/core/compliance.ts';
import { policyRegistry, policyContext, reassessmentQueue, newPolicyReview, policyStatuses, reviewStatuses } from './lib/core/policy.ts';

function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

const limitation = 'Retrieving an official source is not approval of how this prototype reads it. Every registered version is marked retrieved-not-reviewed until a qualified reviewer says otherwise. Internal cases and the reviews recorded on them are synthetic and are never a real agency approval. A policy decision does not resolve a finding, release a hold, or authorize destruction.';

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail('expectedRevision must be a non-negative integer');
  return value;
}

/** The policy context of one case, for case detail and the packet. */
export function policyContextFor(item, sources, asOf) {
  return policyContext(item, analyzeCase(item, asOf), sources, asOf);
}

export async function handlePolicy({ pathname, method, readBody, store, asOf, builtInSources, sourcesOf, actor, trusted }) {
  if (pathname === '/api/policy-versions') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    // Version metadata exists only on built-in sources.
    const { policies } = policyRegistry(builtInSources);
    return { status: 200, body: { policies, enums: { policyStatus: policyStatuses, reviewStatus: reviewStatuses }, limitation } };
  }
  if (pathname === '/api/policy-reassessment') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    const state = store.read();
    const cases = reassessmentQueue(state.cases, state.cases.map(item => analyzeCase(item, asOf)), builtInSources, asOf);
    return { status: 200, body: { asOf, workspaceRevision: state.revision, total: cases.length, cases, limitation } };
  }
  const match = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/(policy-context|policy-reviews)$/);
  if (!match) return null;
  const [, caseId, resource] = match;
  const found = store.read().cases.find(item => item.id === caseId);
  if (!found) throw fail('Case not found', 404);
  if (resource === 'policy-context') {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    return { status: 200, body: { ...policyContextFor(found, sourcesOf(found), asOf), limitation } };
  }
  if (method !== 'POST') throw fail('Method not allowed', 405);
  const body = await readBody();
  const revision = expectedRevision(body.expectedRevision);
  const result = await store.mutate('policy-review-recorded', caseId, state => {
    const item = state.cases.find(candidate => candidate.id === caseId);
    const sources = sourcesOf(item);
    const before = policyContextFor(item, sources, asOf).entries.map(({ policyId, status, reviewedVersionId }) => ({ policyId, status, reviewedVersionId }));
    const review = newPolicyReview(body, item, sources, { id: randomUUID(), now: new Date().toISOString(), actor: actor ?? 'local-demo-operator', trusted });
    item.policyReviews = [...(item.policyReviews ?? []), review];
    const after = policyContextFor(item, sources, asOf).entries.map(({ policyId, status, reviewedVersionId }) => ({ policyId, status, reviewedVersionId }));
    return { review, case: item, change: { command: 'policy-review-recorded', note: review.note, before, after } };
  }, { expectedRevision: revision });
  const saved = store.read().cases.find(item => item.id === caseId);
  return { status: 201, body: { ...result, case: saved, policyContext: policyContextFor(saved, sourcesOf(saved), asOf), limitation } };
}
