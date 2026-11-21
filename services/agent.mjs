import { runGuidedAgent, tools } from '../apps/records-contracting/src/lib/tools/registry.mjs';
import { serviceServer, callService, fail, readBody } from './common.mjs';

export function createAgentService({ token, workflowUrl }) {
  return serviceServer('agent', token, async ({ req, url, requestId }) => {
    if (url.pathname === '/api/agent/tools' && req.method === 'GET') return { body: { mode: 'deterministic-guided-agent', tools: tools.map(({ name, description }) => ({ name, description })) } };
    const match = url.pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/agent$/);
    if (!match) return null;
    if (req.method !== 'POST') throw fail('Method not allowed', 405);
    const body = await readBody(req, 64000);
    const detail = await callService(workflowUrl, `/api/cases/${match[1]}${url.search}`, token, { requestId });
    try { return { body: runGuidedAgent(body.intent, { item: detail.case, asOf: detail.report.asOf, findingId: body.findingId, destination: body.destination, query: body.query, recordId: body.recordId }) }; }
    catch (error) { throw fail(error.message); }
  });
}
