import { serviceServer, callService, fail, digest } from './common.mjs';

export function createAuditService({ token, workflowUrl, documentsUrl }) {
  return serviceServer('audit', token, async ({ req, url, requestId }) => {
    const match = url.pathname.match(/^\/api\/audit\/cases\/([A-Za-z0-9_-]+)$/);
    if (url.pathname !== '/api/export' && !match) return null;
    if (req.method !== 'GET') throw fail('Audit exports are read-only', 405);
    const exported = await callService(workflowUrl, `/api/export${url.search}`, token, { requestId });
    if (!match) return { body: exported };
    const item = exported.cases.find(c => c.id === match[1]);
    if (!item) throw fail('Case not found', 404);
    let documents;
    try { documents = { status: 'available', ...await callService(documentsUrl, `/internal/documents/cases/${item.id}/snapshot`, token, { requestId }) }; }
    catch { documents = { status: 'unavailable', message: 'Document metadata could not be captured. This packet is incomplete for document-service evidence.' }; }
    // Review drafts and their decisions are part of the case trail. The key is added only when the case has drafts.
    const drafts = (exported.drafts ?? []).filter(draft => draft.caseId === item.id);
    // The export lists every workspace source once per ID. For one case, keep the built-in entries and
    // take custom entries only from the case itself, never from the loaded profile or another case.
    const customIds = new Set([...(exported.profile?.sources ?? []), ...exported.cases.flatMap(c => c.checkSet?.sources ?? [])].map(s => s.id));
    const caseSources = [...exported.sources.filter(s => !customIds.has(s.id)), ...(item.checkSet?.sources ?? [])];
    const packet = { exportedAt: exported.exportedAt, asOf: exported.asOf, workspaceRevision: exported.revision, case: item, report: exported.reports.find(r => r.caseId === item.id), sources: caseSources, reviews: exported.reviews.filter(r => r.caseId === item.id), events: exported.events.filter(e => e.caseId === item.id), documents, ...(drafts.length ? { reviewDrafts: drafts, reviewDraftNotice: 'A reviewed draft describes the note only. It does not resolve a finding, verify evidence, release a hold, or authorize destruction.' } : {}), limitation: 'Workflow and document snapshots have separate capture revisions. This is an editable local audit packet, not a signed or immutable attestation.' };
    return { body: { packet, integrity: { algorithm: 'sha256', hash: digest(JSON.stringify(packet)), encoding: 'UTF-8 JSON.stringify(packet)', authenticated: false } } };
  });
}
