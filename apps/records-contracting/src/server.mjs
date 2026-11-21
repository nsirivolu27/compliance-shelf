import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { analyzeCase, parseEvidence, validDate, expectedRevision } from './lib/core/compliance.ts';
import { runGuidedAgent, tools } from './lib/tools/registry.mjs';
import { createStore } from './store.mjs';
import { handleWorkflow } from './workflow.mjs';
import { readVideoTasks } from './video.mjs';
import { handleCatalog } from './catalog.mjs';
import { handlePacket } from './packet.mjs';
import { handleDrafts } from './drafts.mjs';
import { handleProfile, sourcesFor, sourcesForCase } from './profile.mjs';
import { handlePresets, readPresets } from './presets.mjs';
import { handleDocumentation } from './documentation.mjs';
import { handlePaperwork, readCatalog } from './paperwork.mjs';
import { handleBenefits } from './benefits.mjs';
import { handleAuditReport } from './audit-report.mjs';
import { handleReader, readSamples, readerBodyLimit } from './reader.mjs';
import { handlePolicy } from './policy.mjs';
import { handleEvidenceReview, evidenceReviewFor, documentClient } from './evidence-review.mjs';
import { handleWorkbench } from './workbench.mjs';
import { handleFunding, fundingExportFields } from './funding.mjs';
import { failureRecord, reportFailure } from './lib/persistence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async relative => JSON.parse(await readFile(resolve(root, relative), 'utf8'));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  return value;
}

// Static frontend delivery. Only files found under public/ at startup, with a known
// extension, are ever served. Requests are matched against that fixed list, so no
// request path is used to build a file path and nothing outside public/ is reachable.
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const contentSecurityPolicy = "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function listPublicFiles(directory, prefix = '') {
  const files = new Map();
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      for (const [route, file] of await listPublicFiles(resolve(directory, entry.name), `${prefix}/${entry.name}`)) files.set(route, file);
    } else if (entry.isFile()) {
      const type = contentTypes[extname(entry.name)];
      if (type) files.set(`${prefix}/${entry.name}`, { path: resolve(directory, entry.name), type });
    }
  }
  return files;
}

async function bodyOf(req, limit = 64000) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Use application/json', 415);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw fail(limit === 64000 ? 'Request body exceeds 64 KB' : `Request body exceeds ${Math.round(limit / 1024)} KB`, 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Body must be a JSON object');
  return value;
}

export async function createApp({ stateFile = resolve(root, '.local/workspace.json'), videoApiUrl = process.env.VIDEO_API_URL, storageBackend, actor, internalToken, documentsUrl, session = { mode: 'local-demo', authenticated: false, actor: 'local-demo-operator', roles: [] } } = {}) {
  if (internalToken !== undefined && (typeof internalToken !== 'string' || internalToken.length < 32)) throw new Error('Internal service token must contain at least 32 characters');
  const [initialCases, builtInSources, presetFile, catalogFile] = await Promise.all([readJson('data/demo-cases.json'), readJson('data/sources.json'), readJson('data/profile-presets.json'), readJson('data/paperwork-catalog.json')]);
  const presets = readPresets(presetFile, builtInSources.map(source => source.id));
  const paperworkCatalog = readCatalog(catalogFile, presets);
  const readerSamples = await readSamples(resolve(root, 'data/reader-samples'));
  const persistence = await createStore(stateFile, initialCases, { backend: storageBackend, actor });
  const publicFiles = await listPublicFiles(resolve(root, 'public'));
  // The document service holds stored text. Without it (standalone mode) passages cannot be linked or checked.
  const documents = documentClient({ documentsUrl, token: internalToken });
  const server = createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
    try {
      const actualPort = server.address()?.port;
      const allowedHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      if (internalToken) {
        const supplied = req.headers['x-platform-token'];
        if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(internalToken) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(internalToken))) throw fail('Service authentication required', 401);
      } else {
        if (!allowedHosts.includes(req.headers.host)) throw fail('Local host only', 403);
        if (req.headers.origin && !allowedHosts.some(h => req.headers.origin === `http://${h}`)) throw fail('Cross-origin requests are disabled', 403);
      }
      const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      const asOf = url.searchParams.get('asOf') || new Date().toISOString().slice(0, 10);
      if (!validDate(asOf)) throw fail('Invalid asOf date');
      const requestKey = req.headers['idempotency-key'];
      if (requestKey !== undefined && (typeof requestKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey))) throw fail('Idempotency-Key must be 1–128 letters, digits, dots, underscores, colons, or hyphens');
      let bodyPromise;
      const readBody = limit => bodyPromise ??= bodyOf(req, limit);
      const store = {
        read: persistence.read,
        mutate: async (action, caseId, change, options = {}) => {
          const scopedKey = actor && requestKey ? createHash('sha256').update(JSON.stringify([actor, requestKey])).digest('hex') : requestKey;
          const idempotency = requestKey ? { key: scopedKey, fingerprint: createHash('sha256').update(JSON.stringify([req.method, url.pathname, url.searchParams.get('asOf') || null, canonicalJson(await readBody())])).digest('hex') } : undefined;
          return persistence.mutate(action, caseId, change, { ...options, idempotency });
        },
      };
      // Workspace discovery list for workspace-wide responses. One case's sources come from sourcesOf.
      const sources = sourcesFor(builtInSources, store.read());
      const sourcesOf = item => sourcesForCase(builtInSources, item);
      const staticFile = publicFiles.get(url.pathname === '/' ? '/index.html' : url.pathname);
      if (req.method === 'GET' && staticFile) {
        const content = await readFile(staticFile.path);
        res.writeHead(200, { 'Content-Type': staticFile.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': contentSecurityPolicy });
        res.end(content);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { status: 'ok', mode: session.mode });
      if (req.method === 'GET' && url.pathname === '/api/session') return send(200, session);
      if (req.method === 'GET' && url.pathname === '/api/video/tasks') return send(200, await readVideoTasks(videoApiUrl));
      if (req.method === 'GET' && url.pathname === '/api/workspace') return send(200, { ...store.read(), sources, builtInSourceIds: builtInSources.map(source => source.id), tools: tools.map(({ name, description }) => ({ name, description })) });
      if (req.method === 'GET' && url.pathname === '/api/awards') {
        try { return send(200, await readJson('data/public/va-awards.json')); }
        catch { return send(200, { provenance: 'unavailable', results: [], message: 'No readable public snapshot. Run npm run data:refresh. Synthetic cases remain usable.' }); }
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        const state = store.read();
        return send(200, { exportedAt: new Date().toISOString(), asOf, ...state, sources, reports: state.cases.map(c => analyzeCase(c, asOf)), ...fundingExportFields(state), limitation: 'Local editable demo history, not a tamper-proof audit system. No official approvals or record destruction are performed.' });
      }
      const workbench = await handleWorkbench({ pathname: url.pathname, method: req.method, searchParams: url.searchParams, state: store.read(), asOf, sources, sourcesOf, reviewFor: item => evidenceReviewFor(item, sourcesOf(item), asOf, documents) });
      if (workbench) return send(workbench.status, workbench.body);
      const packet = await handlePacket({ pathname: url.pathname, method: req.method, searchParams: url.searchParams, state: store.read(), asOf, sourcesOf, reviewFor: item => evidenceReviewFor(item, sourcesOf(item), asOf, documents) });
      if (packet) return send(packet.status, packet.body);
      const catalog = handleCatalog({ pathname: url.pathname, method: req.method, searchParams: url.searchParams, state: store.read(), asOf, sourcesOf, mode: session.mode });
      if (catalog) return send(catalog.status, catalog.body);
      const preset = handlePresets({ pathname: url.pathname, method: req.method, presets });
      if (preset) return send(preset.status, preset.body);
      const profile = await handleProfile({ pathname: url.pathname, method: req.method, readBody, store, builtInSources });
      if (profile) return send(profile.status, profile.body);
      const evidenceReviewResult = await handleEvidenceReview({ pathname: url.pathname, method: req.method, readBody, store, asOf, sourcesOf, actor, trusted: Boolean(actor) && session.authenticated === true, client: documents });
      if (evidenceReviewResult) return send(evidenceReviewResult.status, evidenceReviewResult.body);
      const policy = await handlePolicy({ pathname: url.pathname, method: req.method, readBody, store, asOf, builtInSources, sourcesOf, actor, trusted: Boolean(actor) && session.authenticated === true });
      if (policy) return send(policy.status, policy.body);
      const documentation = await handleDocumentation({ pathname: url.pathname, method: req.method, searchParams: url.searchParams, readBody, store, asOf, reviewFor: item => evidenceReviewFor(item, sourcesOf(item), asOf, documents), actor, trusted: Boolean(actor) && session.authenticated === true, catalog: paperworkCatalog });
      if (documentation) return send(documentation.status, documentation.body);
      const benefits = handleBenefits({ pathname: url.pathname, method: req.method, searchParams: url.searchParams, store, catalog: paperworkCatalog, asOf });
      if (benefits) return send(benefits.status, benefits.body);
      const paperwork = await handlePaperwork({ pathname: url.pathname, method: req.method, searchParams: url.searchParams, readBody, store, asOf, catalog: paperworkCatalog, actor, trusted: Boolean(actor) && session.authenticated === true });
      if (paperwork) return send(paperwork.status, paperwork.body);
      const auditReport = await handleAuditReport({ pathname: url.pathname, method: req.method, searchParams: url.searchParams, state: store.read(), asOf, reviewFor: item => evidenceReviewFor(item, sourcesOf(item), asOf, documents), catalog: paperworkCatalog });
      if (auditReport) return send(auditReport.status, auditReport.body);
      const funding = await handleFunding({ pathname: url.pathname, method: req.method, searchParams: url.searchParams, readBody, store, actor: actor ?? session.actor, trusted: Boolean(actor) && session.authenticated === true, hasIdempotencyKey: requestKey !== undefined });
      if (funding) return send(funding.status, funding.body);
      const reader = await handleReader({ pathname: url.pathname, method: req.method, searchParams: url.searchParams, readBody: () => readBody(readerBodyLimit), store, asOf, catalog: paperworkCatalog, samples: readerSamples, actor, trusted: Boolean(actor) && session.authenticated === true });
      if (reader) return send(reader.status, reader.body);
      const drafts = await handleDrafts({ pathname: url.pathname, method: req.method, searchParams: url.searchParams, readBody, store, asOf, actor: actor ?? session.actor, trusted: Boolean(actor) && session.authenticated === true });
      if (drafts) return send(drafts.status, drafts.body);
      const workflow = await handleWorkflow({ pathname: url.pathname, method: req.method, readBody, store, asOf, sourcesOf, searchParams: url.searchParams, actor: actor ?? session.actor });
      if (workflow) return send(workflow.status, workflow.body);
      const match = url.pathname.match(/^\/api\/cases\/([^/]+)\/(report|analyze|evidence|verify-evidence|reviews|agent)$/);
      if (!match) throw fail('Route not found', 404);
      const [, caseId, operation] = match;
      const item = store.read().cases.find(c => c.id === caseId);
      if (!item) throw fail('Case not found', 404);
      if (req.method === 'GET' && operation === 'report') return send(200, analyzeCase(item, asOf));
      if (req.method !== 'POST' || operation === 'report') throw fail('Method not allowed', 405);
      const body = await readBody();
      const writeOptions = body.expectedRevision === undefined ? {} : { expectedRevision: expectedRevision(body.expectedRevision) };
      if (operation === 'analyze') {
        const report = await store.mutate('analysis-run', caseId, state => analyzeCase(state.cases.find(c => c.id === caseId), asOf), writeOptions);
        return send(200, report);
      }
      if (operation === 'agent') {
        let result;
        try { result = runGuidedAgent(body.intent, { item, asOf, findingId: body.findingId, destination: body.destination, query: body.query, recordId: body.recordId }); } catch (error) { throw fail(error.message); }
        return send(200, result);
      }
      if (operation === 'evidence') {
        let evidence;
        try { evidence = parseEvidence({ ...body, id: randomUUID() }, item); } catch (error) { throw fail(error.message); }
        const added = await store.mutate('evidence-added', caseId, state => { state.cases.find(c => c.id === caseId).evidence.push(evidence); return evidence; }, writeOptions);
        return send(201, added);
      }
      if (typeof body.note !== 'string' || body.note.trim().length < 10 || body.note.length > 2000) throw fail('Provide a review rationale of 10–2000 characters');
      if (operation === 'verify-evidence') {
        const result = await store.mutate('evidence-reference-verified', caseId, state => {
          const evidence = state.cases.find(c => c.id === caseId).evidence.find(e => e.id === body.evidenceId);
          if (!evidence) throw fail('Evidence not found', 404);
          const before = { ...evidence };
          evidence.verified = true;
          return { evidenceId: evidence.id, note: body.note.trim(), before, after: { ...evidence } };
        }, writeOptions);
        return send(200, result);
      }
      if (!['acknowledged', 'request-evidence', 'escalated'].includes(body.disposition)) throw fail('Unsupported review disposition');
      const review = { id: randomUUID(), caseId, findingId: body.findingId, disposition: body.disposition, note: body.note.trim(), at: new Date().toISOString() };
      const reviewed = await store.mutate('finding-reviewed', caseId, state => {
        const current = state.cases.find(c => c.id === caseId);
        const finding = analyzeCase(current, asOf).findings.find(f => f.id === body.findingId);
        if (!finding) throw fail('Finding not found', 404);
        review.findingSnapshot = finding;
        review.caseRevisionAtReview = current.revision;
        state.reviews.push(review);
        return review;
      }, writeOptions);
      return send(201, reviewed);
    } catch (error) {
      // An unexpected failure is recorded for the operator, without any body, header, query string or token.
      if (!error?.status) await reportFailure(failureRecord(error, { service: 'workflow', method: req.method, path: String(req.url).split('?')[0] }));
      send(error.status || 500, { error: error.status ? error.message : 'Could not confirm the operation. Reload or retry with the same Idempotency-Key.', ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}), ...(Number.isSafeInteger(error.currentVersion) ? { currentVersion: error.currentVersion } : {}) });
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp();
  const port = Number(process.env.PORT || 4317);
  server.listen(port, '127.0.0.1', () => console.log(`Compliance Platform API: http://127.0.0.1:${server.address().port}`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
