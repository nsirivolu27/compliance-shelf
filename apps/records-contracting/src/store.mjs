import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { replaceFile } from './lib/persistence.mjs';

// `files` lets a test stand in for the rename step; everything else uses the real file system.
export async function createStore(path, initialCases, { backend, actor = 'local-demo-operator', files } = {}) {
  let state;
  try { state = backend ? await backend.load() : JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (backend) throw error;
    if (error.code !== 'ENOENT') throw new Error('Saved workspace is unreadable. Preserve it and inspect before restarting.');
    state = { version: 1, cases: structuredClone(initialCases), reviews: [], events: [] };
  }
  if (backend && state === null) state = { version: 1, cases: structuredClone(initialCases), reviews: [], events: [] };
  if (!state || state.version !== 1 || !Array.isArray(state.cases) || !Array.isArray(state.events) || !Array.isArray(state.reviews)) throw new Error('Unsupported saved workspace');
  state.revision ??= state.events.length;
  state.requests ??= [];
  if (!Array.isArray(state.requests) || state.requests.some(r => !r || typeof r.key !== 'string' || typeof r.fingerprint !== 'string' || !Object.hasOwn(r, 'result'))) throw new Error('Invalid saved request receipts');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error('Invalid workspace revision');
  if (state.drafts !== undefined && !Array.isArray(state.drafts)) throw new Error('Invalid saved review drafts');
  if (state.profile !== undefined && (!state.profile || typeof state.profile !== 'object' || Array.isArray(state.profile))) throw new Error('Invalid saved profile');
  const ids = new Set();
  for (const item of state.cases) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || !Array.isArray(item.evidence) || !Array.isArray(item.records)) throw new Error('Invalid saved case');
    ids.add(item.id);
    item.revision ??= 0;
    item.tasks ??= [];
    if (!Number.isSafeInteger(item.revision) || item.revision < 0 || !Array.isArray(item.tasks)) throw new Error('Invalid saved case revision or tasks');
  }
  let queue = Promise.resolve();
  return {
    read: () => {
      const { requests, ...workspace } = state;
      return structuredClone(workspace);
    },
    mutate: (action, caseId, change, options = {}) => {
      const operation = queue.then(async () => {
        const request = options.idempotency;
        if (request) {
          const receipt = state.requests.find(r => r.key === request.key);
          if (receipt) {
            if (receipt.fingerprint !== request.fingerprint) throw Object.assign(new Error('Idempotency-Key was already used for a different request.'), { status: 409 });
            return structuredClone(receipt.result);
          }
        }
        const current = state.cases.find(c => c.id === caseId);
        if (options.expectedRevision !== undefined && current?.revision !== options.expectedRevision) {
          throw Object.assign(new Error('Case changed since it was loaded. Reload the case and retry.'), { status: 409, currentRevision: current?.revision });
        }
        const next = structuredClone(state);
        const result = change(next);
        const updated = next.cases.find(c => c.id === caseId);
        // Analysis is a history event, not a change to case inputs.
        // Review drafts are stored beside the case and also leave its revision alone.
        if (updated && action !== 'analysis-run' && !options.keepCaseRevision) updated.revision = (current?.revision ?? 0) + 1;
        next.revision += 1;
        next.events.push({ id: randomUUID(), at: new Date().toISOString(), actor, action, caseId, workspaceRevision: next.revision, caseRevision: updated?.revision ?? null, details: structuredClone(result) });
        // Receipt and mutation commit together, so retries survive process restarts.
        if (request) next.requests = [...next.requests, { ...request, result: structuredClone(result) }].slice(-1000);
        if (backend) await backend.save(next);
        else {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2));
          // One rename replaces the saved file. A momentary Windows file lock is retried briefly. Any other
          // failure is thrown here, before `state` changes, so memory, file, history and receipts stay in step.
          await replaceFile(`${path}.tmp`, path, files);
        }
        state = next;
        return structuredClone(result);
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
}
