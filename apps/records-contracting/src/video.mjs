// Optional adapter to the existing Python service. Never expose its disk paths.
export async function readVideoTasks(baseUrl, fetcher = fetch) {
  if (!baseUrl) return { status: 'disabled', tasks: [], message: 'Video analysis is not connected to this workspace. Records and contracting remain available.' };
  let base;
  try {
    base = new URL(baseUrl);
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid URL');
  } catch {
    return { status: 'unavailable', tasks: [], message: 'VIDEO_API_URL must be an HTTP loopback origin, for example http://127.0.0.1:8000.' };
  }
  try {
    const response = await fetcher(new URL('/tasks', base), { signal: AbortSignal.timeout(2500), redirect: 'error' });
    if (!response.ok) throw new Error('Video service failed');
    const payload = await response.json();
    if (!Array.isArray(payload.tasks)) throw new Error('Invalid task list');
    const tasks = payload.tasks.map(task => {
      if (!task || typeof task.task_id !== 'string' || typeof task.filename !== 'string' || !['queued', 'processing', 'completed', 'failed'].includes(task.status)) throw new Error('Invalid task');
      return { id: task.task_id, filename: task.filename, status: task.status, updatedAt: typeof task.updated_at === 'string' ? task.updated_at : null };
    });
    return { status: 'connected', tasks, docsUrl: new URL('/docs', base).href, message: 'Live metadata from the local video service. Results require human review and do not close compliance findings.' };
  } catch {
    return { status: 'unavailable', tasks: [], message: 'Video service is unavailable or returned an invalid response. Records and contracting remain available.' };
  }
}
