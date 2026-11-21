import { createHash } from 'node:crypto';
import { casePacket } from './lib/core/compliance.ts';
import { canonicalJson } from './lib/core/canonical.ts';
import { draftViews } from './drafts.mjs';
import { policyContextFor } from './policy.mjs';
import { fundingPacketFields } from './funding.mjs';

export async function handlePacket({ pathname, method, searchParams, state, asOf, sourcesOf, reviewFor }) {
  const match = pathname.match(/^\/api\/cases\/([^/]+)\/packet$/);
  if (!match) return null;
  const fail = (message, status) => Object.assign(new Error(message), { status });
  if (method !== 'GET') throw fail('Method not allowed', 405);
  for (const key of searchParams.keys()) if (key !== 'asOf') throw fail(`Unknown query parameter: ${key}`, 400);
  if (searchParams.getAll('asOf').length > 1) throw fail('Repeated query parameter: asOf', 400);
  const item = state.cases.find(c => c.id === match[1]);
  if (!item) throw fail('Case not found', 404);
  // Built-in sources plus this case's own. The loaded profile and other cases are never consulted.
  const sources = sourcesOf(item);
  // Review drafts and their decision history travel with the packet, including stale decisions.
  // The two keys are added only when the case has drafts, so earlier packets keep their exact shape and digest.
  const drafts = draftViews(state, item, asOf);
  // Linked passages and sufficiency assessments, with their snapshots and freshness, once the case has any.
  const evidence = reviewFor && ((item.citations ?? []).length || (item.assessments ?? []).length)
    ? { evidenceReview: await reviewFor(item), evidenceReviewNotice: 'A linked passage, a verified reference, and a sufficiency assessment are separate facts. None establishes legal compliance, and an assessment never closes a finding or releases a hold.' } : {};
  // The policy context travels with the packet once a policy review has been recorded on the case.
  const policy = item.policyReviews?.length ? { policyContext: policyContextFor(item, sources, asOf), policyContextNotice: 'Policy versions were retrieved from official sources, not approved by a specialist. Recorded reviews on synthetic cases are synthetic and are never a real agency approval.' } : {};
  const body = { ...casePacket(item, asOf, new Date().toISOString(), state.reviews, state.events, sources), ...(drafts.length ? { reviewDrafts: drafts, reviewDraftNotice: 'A reviewed draft describes the note only. It does not resolve a finding, verify evidence, release a hold, or authorize destruction.' } : {}), ...policy, ...evidence, ...fundingPacketFields(state, item) };
  const value = createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
  return { status: 200, body: { ...body, digest: { algorithm: 'SHA-256', value, canonicalization: 'sorted-keys-json-v1', excludedFields: ['digest'] } } };
}
