import { serviceServer, callService } from './common.mjs';

export function createWorkerService({ token, jobsUrl, documentsUrl, interval = 500 }) {
  let busy = false, lastCycleAt = null, lastError = null, stopped = false;
  let completed = 0, failed = 0, skipUntil = 0, misses = 0;
  const server = serviceServer('worker', token, async () => null, () => ({ busy, lastCycleAt, lastError, completed, failed }));
  server.workOnce = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const { job } = await callService(jobsUrl, '/internal/jobs/claim', token, { method: 'POST', body: {} });
      if (job) {
        let result = null, error = null;
        try { result = await callService(documentsUrl, `/internal/documents/${job.documentId}/extract`, token, { method: 'POST', body: {} }); }
        catch { error = 'Document extraction could not be completed. Check the document service.'; }
        await callService(jobsUrl, `/internal/jobs/${job.id}/finish`, token, { method: 'POST', body: { leaseToken: job.leaseToken, error, result } });
        if (error) failed++; else completed++;
      }
      lastError = null; misses = 0; skipUntil = 0;
    } catch {
      // Back off while a dependency is down: 1s, 2s, 4s, then every 8s. Queued jobs stay saved.
      lastError = 'A processing dependency is unavailable; queued jobs remain saved.';
      misses = Math.min(misses + 1, 4); skipUntil = Date.now() + 500 * 2 ** misses;
    }
    finally { lastCycleAt = new Date().toISOString(); busy = false; }
  };
  const timer = setInterval(() => { if (Date.now() >= skipUntil) server.workOnce(); }, interval); timer.unref();
  server.on('close', () => { stopped = true; clearInterval(timer); });
  server.stopBackground = async () => { stopped = true; clearInterval(timer); while (busy) await new Promise(resolve => setTimeout(resolve, 20)); };
  return server;
}
