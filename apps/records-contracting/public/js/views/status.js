// Service status: what is actually responding right now, and extraction jobs that
// need attention. A service counts as available only when it answers a health check.

import * as api from '../api.js';
import { h, button, status, pageHeader, notice, facts, emptyState, loadingState, errorState, dataTable, announce, formatTime } from '../dom.js';
import { openForm, noteField } from '../forms.js';

const serviceInfo = {
  workflow: 'Cases, findings, records, tasks, reviews, and drafts',
  documents: 'Stored text documents and their spans',
  jobs: 'The extraction job queue',
  worker: 'Runs queued extraction jobs',
  policies: 'The policy source registry',
  audit: 'Workspace and case exports',
  agent: 'The deterministic guided assistant',
};
const health = { ok: { label: 'Responding', tone: 'ok' }, unavailable: { label: 'Not responding', tone: 'block' } };
const jobLabels = {
  queued: { label: 'Queued', tone: 'review' },
  running: { label: 'Running', tone: 'info' },
  succeeded: { label: 'Finished', tone: 'ok' },
  failed: { label: 'Failed', tone: 'warn' },
};

// The extraction queue and the worker that drains it, from what each service reports about itself.
function workerSection(worker, summary) {
  if (!summary && !worker?.detail) return null;
  const detail = worker?.detail;
  const rows = [];
  if (summary) {
    rows.push(['Waiting', String(summary.counts.queued)], ['Running', String(summary.counts.running)],
      ['Finished', String(summary.counts.succeeded)], ['Failed', String(summary.counts.failed)]);
    if (summary.oldestQueuedAt) rows.push(['Oldest waiting job', formatTime(summary.oldestQueuedAt)]);
  }
  if (detail) {
    rows.push(['Worker', detail.busy ? 'Working on a job' : 'Idle'],
      ['Last worker cycle', detail.lastCycleAt ? formatTime(detail.lastCycleAt) : 'None yet'],
      ['Since the worker started', `${detail.completed} finished, ${detail.failed} failed`]);
  }
  return h('section', null,
    h('h2', null, 'Extraction queue'),
    detail?.lastError && notice('warn', 'The worker could not reach a service it depends on.', `${detail.lastError} It waits a little longer between attempts and resumes on its own.`),
    facts(rows, true));
}

// Used by the top bar. Returns a short, honest summary of what is responding.
export async function serviceSummary() {
  try {
    const result = await api.getServices();
    const down = result.services.filter(service => service.status !== 'ok');
    return down.length ? { tone: 'warn', text: `${down.length} ${down.length === 1 ? 'service is' : 'services are'} not responding` } : { tone: 'ok', text: 'All services responding' };
  } catch (error) {
    if (error.status === 404) return { tone: 'muted', text: 'Standalone mode' };
    return { tone: 'warn', text: 'Service status unknown' };
  }
}

export function create() {
  const body = h('div', { class: 'stack' }, loadingState('Checking services…'));
  const refresh = button('Check again', () => load(), 'button-primary', 'status-refresh');

  function retry(job) {
    openForm({
      title: 'Retry extraction',
      intro: 'Puts this failed extraction job back in the queue. The stored document is not changed.',
      submitLabel: 'Retry',
      fields: [noteField('Reason for retrying')],
      submit: (values, keyFor) => api.retryJob(job.id, { note: values.note }, keyFor(values)),
      onSuccess: async () => {
        announce('Extraction queued again.');
        await load();
      },
    });
  }

  async function load() {
    refresh.setAttribute('aria-disabled', 'true');
    try {
      let services;
      try {
        services = await api.getServices();
      } catch (error) {
        if (error.status !== 404) throw error;
        body.replaceChildren(notice('info', 'Running in standalone mode.',
          'Only the main workflow server is running, so cases, findings, records, tasks, drafts, and exports work. Document intake and extraction are not available. To use them, stop this server and start the full local services with "npm run dev" from the repository root.'));
        return;
      }
      const down = services.services.filter(service => service.status !== 'ok');
      const [jobs, summary, documents] = await Promise.all([
        api.getJobs({ limit: 100 }),
        api.getJobSummary(),
        api.getDocuments({ limit: 100 }),
      ]);
      const titleOf = id => documents?.items.find(document => document.id === id)?.title || id;
      const attention = jobs ? jobs.items.filter(job => job.status !== 'succeeded') : [];

      body.replaceChildren(...[
        down.length > 0
          ? notice('warn', `${down.length} ${down.length === 1 ? 'service is' : 'services are'} not responding.`,
              'Saved data stays with the service that owns it. Restart the local services from the repository root with "npm run dev". Work that does not depend on the missing service still works.')
          : notice('info', 'All services responded to a health check just now.', 'This shows that each process answered. It does not test every feature.'),
        h('section', null,
          h('h2', null, 'Services'),
          dataTable({
            label: 'Services',
            rows: services.services,
            columns: [
              { header: 'Service', cell: service => service.name },
              { header: 'Health check', cell: service => status(health, service.status) },
              { header: 'Answered in', class: 'num', cell: service => (Number.isSafeInteger(service.responseMs) ? `${service.responseMs} ms` : 'No answer') },
              { header: 'What it does', cell: service => h('span', { class: 'wrap' }, serviceInfo[service.name] || '') },
            ],
          }),
          services.checkedAt && h('p', { class: 'hint' }, `Checked ${formatTime(services.checkedAt)}.`)),
        workerSection(services.services.find(service => service.name === 'worker'), summary),
        h('section', null,
          h('h2', null, 'Extraction jobs needing attention'),
          jobs === null
            ? notice('warn', 'The job queue could not be read.', 'The jobs service did not answer. Queued work is saved and resumes when it is back.')
            : attention.length === 0
              ? emptyState('No queued, running, or failed extraction jobs.', `${jobs.pagination.total} ${jobs.pagination.total === 1 ? 'job has' : 'jobs have'} been recorded in total.`)
              : dataTable({
                  label: 'Extraction jobs needing attention',
                  rows: attention,
                  columns: [
                    { header: 'Document', cell: job => h('a', { href: `#/documents/${encodeURIComponent(job.documentId)}` }, titleOf(job.documentId)) },
                    { header: 'Status', cell: job => status(jobLabels, job.status) },
                    { header: 'Attempts', class: 'num', cell: job => `${job.attempts} of ${job.maxAttempts}` },
                    { header: 'Last error', cell: job => h('span', { class: 'wrap' }, job.error || 'None') },
                    { header: 'Updated', cell: job => formatTime(new Date(job.updatedAt).toISOString()) },
                    { header: 'Action', cell: job => job.status === 'failed'
                      ? button('Retry', () => retry(job), 'button-small', `retry-${job.id}`)
                      : h('span', { class: 'hint' }, 'Retries automatically') },
                  ],
                })),
      ].filter(Boolean));
    } catch (error) {
      body.replaceChildren(errorState(error, load));
    } finally {
      refresh.removeAttribute('aria-disabled');
    }
  }

  load();
  return {
    key: 'status',
    el: h('div', null,
      pageHeader('Service status', 'Which local services are answering right now, and extraction jobs that have not finished. A configured service is shown as available only when it responds.', refresh),
      h('div', { class: 'stack' }, body)),
  };
}
