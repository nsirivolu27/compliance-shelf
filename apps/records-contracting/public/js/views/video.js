// Video evidence: read-only task metadata from the optional local video service.

import * as api from '../api.js';
import { h, setChildren, pageHeader, notice, emptyState, loadingState, errorState, dataTable, externalLink, formatTime } from '../dom.js';

const headings = {
  connected: 'Video service connected',
  disabled: 'Video service not connected',
  unavailable: 'Video service unavailable',
};

export function create() {
  const body = h('div', null);
  const refresh = h('button', { type: 'button', class: 'button' }, 'Refresh');

  async function load() {
    refresh.setAttribute('aria-disabled', 'true');
    body.replaceChildren(loadingState('Checking the video service…'));
    try {
      const result = await api.getVideoTasks();
      setChildren(body,
        notice(result.status === 'connected' ? 'info' : 'warn', headings[result.status] || 'Video service status unknown',
          result.message,
          result.docsUrl && h('p', null, externalLink(result.docsUrl, 'Open the video upload and results API'))),
        result.status !== 'connected' ? null
          : result.tasks.length === 0
            ? emptyState('No video tasks yet.', 'Upload a local video through the video API to see it listed here.')
            : dataTable({
                label: 'Video analysis tasks',
                rows: result.tasks,
                columns: [
                  { header: 'File', cell: task => h('span', { class: 'wrap' }, task.filename) },
                  { header: 'Status', cell: task => task.status },
                  { header: 'Updated', cell: task => task.updatedAt ? formatTime(task.updatedAt) : 'Not reported' },
                  { header: 'Task ID', cell: task => h('span', { class: 'mono' }, task.id) },
                ],
              }));
    } catch (error) {
      body.replaceChildren(errorState(error, load));
    } finally {
      refresh.removeAttribute('aria-disabled');
    }
  }

  refresh.addEventListener('click', load);
  load();
  return {
    key: 'video',
    el: h('div', null,
      pageHeader('Video evidence', 'Task metadata from the existing video analysis service. Detections are review material for a person. They do not verify evidence, close findings, or establish compliance.', refresh),
      h('div', { class: 'stack' }, body)),
  };
}
