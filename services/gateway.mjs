import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { send, fail } from './common.mjs';

export function createGateway({ token, urls }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('Internal service token is required');
  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    try {
      const hosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      if (!req.url.startsWith('/') || req.url.startsWith('//')) throw fail('Invalid request target');
      if (!hosts.includes(req.headers.host)) throw fail('Local host only', 403);
      if (req.headers.origin && !hosts.some(host => req.headers.origin === `http://${host}`)) throw fail('Cross-origin requests are disabled', 403);
      const url = new URL(req.url, `http://${hosts[0]}`);
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok', service: 'gateway' }, requestId);
      if (req.method === 'GET' && url.pathname === '/api/services') {
        const services = await Promise.all(Object.entries(urls).map(async ([name, base]) => {
          const started = Date.now();
          try {
            const response = await fetch(new URL(name === 'workflow' ? '/api/health' : '/health', base), { headers: { 'x-platform-token': token }, signal: AbortSignal.timeout(1500), redirect: 'error' });
            const health = response.ok ? await response.json().catch(() => null) : null;
            // Only the worker reports extra detail today: whether it is busy and how its last cycle went.
            const detail = name === 'worker' && health ? { busy: health.busy === true, lastCycleAt: health.lastCycleAt ?? null, lastError: health.lastError ?? null, completed: health.completed ?? 0, failed: health.failed ?? 0 } : undefined;
            return { name, status: response.ok ? 'ok' : 'unavailable', responseMs: Date.now() - started, ...(detail ? { detail } : {}) };
          } catch { return { name, status: 'unavailable', responseMs: null }; }
        }));
        return send(res, 200, { mode: 'local-microservices', status: services.every(s => s.status === 'ok') ? 'ok' : 'degraded', checkedAt: new Date().toISOString(), services }, requestId);
      }
      if (url.pathname.startsWith('/internal/')) throw fail('Route not found', 404);
      if (!['GET', 'POST'].includes(req.method)) throw fail('Method not allowed', 405);
      let name = 'workflow';
      if (/^\/api\/documents(?:\/|$)/.test(url.pathname)) name = 'documents';
      else if (/^\/api\/jobs(?:\/|$)/.test(url.pathname)) name = 'jobs';
      else if (/^\/api\/policies(?:\/|$)/.test(url.pathname)) name = 'policies';
      else if (url.pathname === '/api/export' || /^\/api\/audit(?:\/|$)/.test(url.pathname)) name = 'audit';
      else if (url.pathname === '/api/agent/tools' || /^\/api\/cases\/[^/]+\/agent$/.test(url.pathname)) name = 'agent';
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw fail('Request body exceeds 1 MiB', 413); chunks.push(chunk); }
      const response = await fetch(new URL(url.pathname + url.search, urls[name]), {
        method: req.method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'x-platform-token': token, 'x-request-id': requestId, ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}), ...(req.headers['idempotency-key'] ? { 'idempotency-key': req.headers['idempotency-key'] } : {}) },
        ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
      });
      const body = Buffer.from(await response.arrayBuffer());
      const headers = { 'x-request-id': requestId, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      for (const name of ['content-type', 'content-security-policy', 'referrer-policy']) if (response.headers.has(name)) headers[name] = response.headers.get(name);
      res.writeHead(response.status, headers); res.end(body);
    } catch (error) { send(res, error.status ?? 503, { error: error.status ? error.message : 'The requested service is unavailable. Saved data remains with its owning service; retry with the same key.' }, requestId); }
  });
  return server;
}
