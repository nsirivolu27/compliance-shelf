export type ExtractionJob = {
  id: string; documentId: string; type: 'extract-text'; status: 'queued' | 'running' | 'succeeded' | 'failed';
  attempts: number; maxAttempts: number; availableAt: number; leaseUntil: number | null; leaseToken: string | null;
  createdAt: number; updatedAt: number; error: string | null; result: unknown;
};
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
export function newExtractionJob(documentId: string, now: number): ExtractionJob {
  if (!/^[A-Za-z0-9_-]+$/.test(documentId)) fail('Invalid document ID', 400);
  return { id: `job-${documentId}`, documentId, type: 'extract-text', status: 'queued', attempts: 0, maxAttempts: 3, availableAt: now, leaseUntil: null, leaseToken: null, createdAt: now, updatedAt: now, error: null, result: null };
}
export function claimExtractionJob(jobs: ExtractionJob[], now: number, token: string): ExtractionJob | null {
  for (const job of jobs) {
    if (job.status === 'running' && job.leaseUntil !== null && job.leaseUntil <= now && job.attempts >= job.maxAttempts) {
      Object.assign(job, { status: 'failed', error: 'Worker lease expired after the final attempt.', leaseToken: null, leaseUntil: null, updatedAt: now });
    }
    const expired = job.status === 'running' && job.leaseUntil !== null && job.leaseUntil <= now;
    if ((job.status === 'queued' && job.availableAt <= now || expired) && job.attempts < job.maxAttempts) {
      Object.assign(job, { status: 'running', attempts: job.attempts + 1, leaseToken: token, leaseUntil: now + 30000, updatedAt: now });
      return job;
    }
  }
  return null;
}
export function finishExtractionJob(job: ExtractionJob, token: string, now: number, error: string | null, result: unknown) {
  if (job.status !== 'running' || job.leaseToken !== token || job.leaseUntil === null || job.leaseUntil <= now) fail('Worker lease is stale; completion was not accepted');
  Object.assign(job, { updatedAt: now, leaseToken: null, leaseUntil: null });
  if (error !== null) {
    job.status = job.attempts >= job.maxAttempts ? 'failed' : 'queued';
    job.error = error.slice(0, 300);
    job.availableAt = now + 1000 * 2 ** job.attempts;
  } else { job.status = 'succeeded'; job.result = result; job.error = null; }
}
export function retryExtractionJob(job: ExtractionJob, note: unknown, now: number) {
  if (typeof note !== 'string' || note.trim().length < 10 || note.length > 2000) fail('Provide a retry rationale of 10–2000 characters', 400);
  if (job.status !== 'failed') fail('Only failed jobs can be retried');
  Object.assign(job, { status: 'queued', attempts: 0, availableAt: now, leaseUntil: null, leaseToken: null, updatedAt: now, error: null, result: null });
  return note.trim();
}
