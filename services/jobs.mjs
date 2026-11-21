import { randomUUID } from 'node:crypto';
import { newExtractionJob, claimExtractionJob, finishExtractionJob, retryExtractionJob } from '../apps/records-contracting/src/lib/core/jobs.ts';
import { serviceServer, database, fail, readBody, event, page, keyOf, digest } from './common.mjs';

const publicJob = ({ leaseToken, ...job }) => job;
export async function createJobsService({ token, stateFile, now = Date.now }) {
  const db = await database(stateFile, { jobs: [], retries: [] });
  return serviceServer('jobs', token, async ({ req, url }) => {
    const path = url.pathname;
    if (path === '/internal/jobs' && req.method === 'POST') {
      const body = await readBody(req, 64000);
      if (typeof body.documentId !== 'string') throw fail('documentId is required');
      const candidate = newExtractionJob(body.documentId, now());
      const job = await db.transact(state => {
        const existing = state.jobs.find(j => j.id === candidate.id);
        if (existing) return existing;
        state.jobs.push(candidate); event(state, 'job-enqueued', { jobId: candidate.id }); return candidate;
      });
      return { status: 201, body: { job: publicJob(job) } };
    }
    if (path === '/internal/jobs/claim' && req.method === 'POST') {
      const job = await db.transact(state => {
        const job = claimExtractionJob(state.jobs, now(), randomUUID());
        if (job) event(state, 'job-claimed', { jobId: job.id, attempt: job.attempts });
        return job;
      });
      return { body: { job } };
    }
    const finish = path.match(/^\/internal\/jobs\/([A-Za-z0-9_-]+)\/finish$/);
    if (finish && req.method === 'POST') {
      const body = await readBody(req, 64000);
      if (typeof body.leaseToken !== 'string' || body.error !== null && typeof body.error !== 'string') throw fail('leaseToken and error (string or null) are required');
      const job = await db.transact(state => {
        const job = state.jobs.find(j => j.id === finish[1]);
        if (!job) throw fail('Job not found', 404);
        finishExtractionJob(job, body.leaseToken, now(), body.error, body.result ?? null);
        event(state, 'job-finished', { jobId: job.id, status: job.status, attempt: job.attempts }); return job;
      });
      return { body: { job: publicJob(job) } };
    }
    if (path === '/api/jobs' && req.method === 'GET') {
      const status = url.searchParams.get('status');
      if (status && !['queued', 'running', 'succeeded', 'failed'].includes(status)) throw fail('Invalid job status');
      return { body: page(db.read().jobs.filter(j => (!status || j.status === status) && (!url.searchParams.has('documentId') || j.documentId === url.searchParams.get('documentId'))).map(publicJob), url) };
    }
    if (path === '/api/jobs/summary' && req.method === 'GET') {
      const jobs = db.read().jobs, counts = { queued: 0, running: 0, succeeded: 0, failed: 0 };
      for (const job of jobs) counts[job.status]++;
      const waiting = jobs.filter(job => job.status === 'queued').map(job => job.createdAt);
      return { body: { total: jobs.length, counts, oldestQueuedAt: waiting.length ? new Date(Math.min(...waiting)).toISOString() : null } };
    }
    const match = path.match(/^\/api\/jobs\/([A-Za-z0-9_-]+)(\/retry)?$/);
    if (!match) return null;
    if (req.method === 'GET' && !match[2]) {
      const state = db.read(), job = state.jobs.find(j => j.id === match[1]);
      if (!job) throw fail('Job not found', 404);
      return { body: { job: publicJob(job), events: state.events.filter(e => e.details.jobId === job.id) } };
    }
    if (req.method === 'POST' && match[2]) {
      const key = keyOf(req), body = await readBody(req, 64000), fingerprint = digest(JSON.stringify([match[1], body.note]));
      const job = await db.transact(state => {
        const prior = state.retries.find(r => r.key === key);
        if (prior) { if (prior.fingerprint !== fingerprint) throw fail('Retry key used for a different request', 409); return prior.job; }
        const job = state.jobs.find(j => j.id === match[1]);
        if (!job) throw fail('Job not found', 404);
        const note = retryExtractionJob(job, body.note, now());
        event(state, 'job-retry-requested', { jobId: job.id, note });
        state.retries.push({ key, fingerprint, job: structuredClone(job) }); state.retries = state.retries.slice(-1000);
        return job;
      });
      return { body: { job: publicJob(job) } };
    }
    throw fail('Method not allowed', 405);
  });
}
