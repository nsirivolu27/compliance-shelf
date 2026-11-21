import { createServer } from 'node:http';
import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { replaceFile, failureRecord, reportFailure } from '../apps/records-contracting/src/lib/persistence.mjs';

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const digest = value => createHash('sha256').update(value).digest('hex');
export function tokenMatches(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string' && Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
export function keyOf(req) {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw fail('Provide an Idempotency-Key of 1–128 letters, digits, dots, underscores, colons, or hyphens');
  return key;
}
export async function readBody(req, maxBytes = 1024 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Use application/json', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw fail('Request body is too large', 413); chunks.push(chunk); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Expected a JSON object');
  return value;
}
export function send(res, status, body, requestId) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(requestId ? { 'x-request-id': requestId } : {}) });
  res.end(JSON.stringify(body));
}
export function serviceServer(name, token, handler, extraHealth = () => ({})) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('An internal service token of at least 32 characters is required');
  return createServer(async (req, res) => {
    const requestId = /^[A-Za-z0-9-]{1,80}$/.test(req.headers['x-request-id'] ?? '') ? req.headers['x-request-id'] : randomUUID();
    try {
      const url = new URL(req.url, 'http://service');
      if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { status: 'ok', service: name, ...extraHealth() }, requestId);
      if (!tokenMatches(req.headers['x-platform-token'], token)) throw fail('Service authentication required', 401);
      const result = await handler({ req, url, requestId });
      if (!result) throw fail('Route not found', 404);
      send(res, result.status ?? 200, result.body, requestId);
    } catch (error) {
      // An unexpected failure is recorded for the operator, without any body, header, query string or token.
      if (!error?.status) await reportFailure(failureRecord(error, { service: name, method: req.method, path: String(req.url).split('?')[0], requestId }));
      send(res, error.status ?? 500, { error: error.status ? error.message : 'Service operation could not be confirmed. Reload or retry with the same key.', ...(Number.isSafeInteger(error.currentRevision) && error.currentRevision >= 0 ? { currentRevision: error.currentRevision } : {}) }, requestId);
    }
  });
}
export async function callService(base, path, token, { method = 'GET', body, key, requestId, timeout = 5000 } = {}) {
  let response;
  try {
    response = await fetch(new URL(path, base), { method, redirect: 'error', signal: AbortSignal.timeout(timeout), headers: { 'x-platform-token': token, ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}), ...(requestId ? { 'x-request-id': requestId } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw fail('A dependent service is unavailable. Retry later.', 503); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(fail(data?.error ?? 'Dependent service failed', response.status), Number.isSafeInteger(data?.currentRevision) && data.currentRevision >= 0 ? { currentRevision: data.currentRevision } : {});
  if (data === null) throw fail('Dependent service returned an invalid response', 502);
  return data;
}
export function page(items, url) {
  const integer = (name, fallback, max) => {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) throw fail(`Invalid ${name}`);
    return Number(raw);
  };
  const limit = integer('limit', 50, 100), offset = integer('offset', 0, Number.MAX_SAFE_INTEGER);
  if (!limit) throw fail('limit must be positive');
  return { items: items.slice(offset, offset + limit), pagination: { total: items.length, limit, offset, nextOffset: offset + limit < items.length ? offset + limit : null } };
}

/** Single-owner local database. A per-write lock fails closed if another writer exists. `files` lets a test stand in for the rename step. */
export async function database(file, initial, { files } = {}) {
  const read = async fallback => {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || !Array.isArray(value.events)) throw new Error('Invalid service data');
      for (const [key, expected] of Object.entries(initial)) if (Array.isArray(expected) && !Array.isArray(value[key])) throw new Error('Invalid service collection');
      return value;
    } catch (error) { if (error.code === 'ENOENT' && fallback) return structuredClone(fallback); throw new Error('Service data is unreadable; preserve it before recovery.'); }
  };
  let state = await read({ version: 1, revision: 0, events: [], ...initial });
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(state),
    transact(change) {
      const operation = queue.then(async () => {
        await mkdir(dirname(file), { recursive: true });
        let lock;
        try { lock = await open(`${file}.lock`, 'wx'); }
        catch (error) { if (error.code === 'EEXIST') throw fail('Service storage is locked by another write. Retry later; inspect a persistent lock after a crash.', 503); throw error; }
        try {
          await lock.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
          state = await read(state);
          const next = structuredClone(state);
          const result = change(next);
          if (result instanceof Promise) throw new Error('Database changes must not perform asynchronous side effects');
          if (JSON.stringify(next) !== JSON.stringify(state)) {
            next.revision++;
            const content = JSON.stringify(next);
            if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw fail('Local service data reached the 32 MiB pilot limit', 413);
            await writeFile(`${file}.tmp`, content);
            // A momentary Windows file lock is retried briefly; any other failure is thrown before `state` changes.
            await replaceFile(`${file}.tmp`, file, files);
            state = next;
          }
          return structuredClone(result);
        } finally { await lock.close(); await unlink(`${file}.lock`); }
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
export function event(state, action, details) {
  state.events.push({ id: randomUUID(), at: new Date().toISOString(), actor: 'local-demo-operator', action, details });
}
