import { randomUUID } from 'node:crypto';
import { validateDocument, extractSpans } from '../apps/records-contracting/src/lib/core/documents.ts';
import { expectedRevision } from '../apps/records-contracting/src/lib/core/compliance.ts';
import { serviceServer, database, fail, readBody, callService, keyOf, digest, event, page } from './common.mjs';

const metadata = ({ content, spans, ...item }) => ({ ...item, spanCount: spans?.length ?? 0 });
export async function createDocumentsService({ token, stateFile, workflowUrl, jobsUrl, outboxInterval = 1000 }) {
  const db = await database(stateFile, { documents: [], receipts: [] });
  const dispatch = async id => {
    const item = db.read().documents.find(d => d.id === id);
    if (!item?.dispatchPending) return;
    await callService(jobsUrl, '/internal/jobs', token, { method: 'POST', body: { documentId: id } });
    await db.transact(state => {
      const doc = state.documents.find(d => d.id === id);
      if (doc.dispatchPending) { doc.dispatchPending = false; event(state, 'extraction-dispatched', { documentId: id, jobId: doc.jobId }); }
    });
  };
  const server = serviceServer('documents', token, async ({ req, url, requestId }) => {
    const path = url.pathname;
    const snapshot = path.match(/^\/internal\/documents\/cases\/([A-Za-z0-9_-]+)\/snapshot$/);
    if (snapshot && req.method === 'GET') {
      const state = db.read(), documents = state.documents.filter(d => d.caseId === snapshot[1]);
      return { body: { revision: state.revision, capturedAt: new Date().toISOString(), documents: documents.map(metadata), events: state.events.filter(e => documents.some(d => d.id === e.details.documentId)) } };
    }
    if (path === '/api/documents' && req.method === 'GET') {
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      if (query.length > 200) throw fail('Search text is too long');
      const items = db.read().documents.filter(d => (!url.searchParams.has('caseId') || d.caseId === url.searchParams.get('caseId')) && [d.title, d.filename, d.id].some(v => v.toLowerCase().includes(query))).map(metadata);
      return { body: page(items, url) };
    }
    if (path === '/api/documents' && req.method === 'POST') {
      const key = keyOf(req);
      const body = validateDocument(await readBody(req));
      if (Buffer.byteLength(body.content) > 256 * 1024) throw fail('Document text exceeds 256 KiB', 413);
      const sha256 = digest(body.content), fingerprint = digest(JSON.stringify(body));
      await callService(workflowUrl, `/api/cases/${body.caseId}`, token, { requestId });
      const id = await db.transact(state => {
        const receipt = state.receipts.find(r => r.key === key);
        if (receipt) { if (receipt.fingerprint !== fingerprint) throw fail('Idempotency-Key was used for different content', 409); return receipt.id; }
        const id = randomUUID();
        state.documents.push({ ...body, id, sha256, bytes: Buffer.byteLength(body.content), provenance: 'user-supplied', status: 'pending', jobId: `job-${id}`, dispatchPending: true, createdAt: new Date().toISOString(), spans: [], linkedEvidence: [] });
        state.receipts.push({ key, fingerprint, id });
        state.receipts = state.receipts.slice(-1000);
        event(state, 'document-received', { documentId: id, caseId: body.caseId, sha256, note: body.note });
        return id;
      });
      // The pending dispatch is durable. An unavailable queue does not lose intake.
      try { await dispatch(id); } catch { /* The outbox pump will retry. */ }
      return { status: 202, body: { document: metadata(db.read().documents.find(d => d.id === id)) } };
    }
    // One stored span with the facts a citation is checked against. Internal: the gateway never routes here.
    const stored = path.match(/^\/internal\/documents\/([A-Za-z0-9_-]+)\/spans\/([A-Za-z0-9_-]+)$/);
    if (stored && req.method === 'GET') {
      const item = db.read().documents.find(d => d.id === stored[1]);
      if (!item) throw fail('Document not found', 404);
      if (item.status !== 'ready') throw fail('Document extraction is pending; check its job.', 409);
      const span = item.spans.find(s => s.id === stored[2]);
      if (!span) throw fail('Span not found in that document', 404);
      return { body: { documentId: item.id, caseId: item.caseId, title: item.title, mediaType: item.mediaType, sha256: item.sha256, status: item.status, extractedAt: item.extractedAt ?? null, spanCount: item.spans.length, span } };
    }
    const internal = path.match(/^\/internal\/documents\/([A-Za-z0-9_-]+)\/extract$/);
    if (internal && req.method === 'POST') {
      const result = await db.transact(state => {
        const item = state.documents.find(d => d.id === internal[1]);
        if (!item) throw fail('Document not found', 404);
        if (item.status !== 'ready') {
          item.spans = extractSpans(item.content);
          item.status = 'ready'; item.extractedAt = new Date().toISOString();
          event(state, 'document-extracted', { documentId: item.id, sha256: item.sha256, spanCount: item.spans.length });
        }
        return { documentId: item.id, sha256: item.sha256, spanCount: item.spans.length };
      });
      return { body: result };
    }
    const match = path.match(/^\/api\/documents\/([A-Za-z0-9_-]+)(?:\/(content|spans|evidence))?$/);
    if (!match) return null;
    const item = db.read().documents.find(d => d.id === match[1]);
    if (!item) throw fail('Document not found', 404);
    if (req.method === 'GET') {
      if (!match[2]) return { body: { document: metadata(item), events: db.read().events.filter(e => e.details.documentId === item.id) } };
      if (match[2] === 'content') return { body: { documentId: item.id, sha256: item.sha256, mediaType: item.mediaType, content: item.content, normalization: 'CRLF/CR converted to LF before hashing; offsets are UTF-16 code units.' } };
      if (match[2] === 'spans') {
        if (item.status !== 'ready') throw fail('Document extraction is pending; check its job.', 409);
        const query = (url.searchParams.get('q') ?? '').toLowerCase();
        if (query.length > 200) throw fail('Search text is too long');
        return { body: { documentId: item.id, sha256: item.sha256, ...page(item.spans.filter(s => s.text.toLowerCase().includes(query)).map(s => ({ ...s, locator: `document://${item.id}#${s.id}` })), url) } };
      }
    }
    if (req.method === 'POST' && match[2] === 'evidence') {
      const key = keyOf(req), body = await readBody(req, 64000);
      expectedRevision(body.expectedRevision);
      if (typeof body.note !== 'string' || body.note.trim().length < 10 || body.note.length > 2000) throw fail('Provide a link rationale of 10–2000 characters');
      if (item.status !== 'ready') throw fail('Extract the document before linking it as evidence', 409);
      const evidence = await callService(workflowUrl, `/api/cases/${item.caseId}/evidence`, token, { method: 'POST', key: `doclink-${digest(JSON.stringify([item.id, key]))}`, requestId, body: { kind: body.kind, title: item.title, locator: `document://${item.id}#sha256=${item.sha256}`, expectedRevision: body.expectedRevision, note: body.note } });
      await db.transact(state => {
        const doc = state.documents.find(d => d.id === item.id);
        if (!doc.linkedEvidence.includes(evidence.id)) { doc.linkedEvidence.push(evidence.id); event(state, 'evidence-reference-linked', { documentId: item.id, evidenceId: evidence.id, caseId: item.caseId, note: body.note.trim() }); }
      });
      return { status: 201, body: { evidence, note: 'The reference starts unverified. Extracted text is not a compliance determination.' } };
    }
    throw fail('Method not allowed', 405);
  });
  let busy = false, stopped = false;
  server.pumpOutbox = async () => {
    if (busy || stopped) return;
    busy = true;
    try { for (const item of db.read().documents.filter(d => d.dispatchPending).slice(0, 10)) { try { await dispatch(item.id); } catch { break; } } }
    finally { busy = false; }
  };
  const timer = setInterval(() => server.pumpOutbox().catch(() => {}), outboxInterval);
  timer.unref(); server.on('close', () => clearInterval(timer));
  server.stopBackground = async () => { stopped = true; clearInterval(timer); while (busy) await new Promise(resolve => setTimeout(resolve, 20)); };
  return server;
}
