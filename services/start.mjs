import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { configuration, serviceToken, serviceNames } from './config.mjs';

const name = process.argv[2] || process.env.SERVICE_NAME;
if (!serviceNames.includes(name)) throw new Error(`Choose a service: ${serviceNames.join(', ')}`);
const config = configuration();
const token = await serviceToken(config);
// Unexpected failures are also appended beside the service data, so they outlive the console.
process.env.PLATFORM_DIAGNOSTICS_FILE ||= resolve(dirname(config.states.documents), 'diagnostics.log');
const options = { token, stateFile: config.states[name], workflowUrl: config.urls.workflow, documentsUrl: config.urls.documents, jobsUrl: config.urls.jobs };
let server;
if (name === 'workflow') {
  const { createApp } = await import('../apps/records-contracting/src/server.mjs');
  server = await createApp({ stateFile: config.states.workflow, internalToken: token, documentsUrl: config.urls.documents, videoApiUrl: config.videoApiUrl });
} else {
  const factories = { documents: 'createDocumentsService', jobs: 'createJobsService', policies: 'createPoliciesService', audit: 'createAuditService', agent: 'createAgentService', worker: 'createWorkerService', gateway: 'createGateway' };
  const module = await import(`./${name}.mjs`);
  server = await module[factories[name]](name === 'gateway' ? { token, urls: config.urls } : options);
}
server.listen(config.ports[name], config.host);
await once(server, 'listening');
console.log(`${name} listening on port ${config.ports[name]}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (server.stopBackground) await server.stopBackground();
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('disconnect', stop);
process.on('message', message => { if (message === 'shutdown') stop(); });
