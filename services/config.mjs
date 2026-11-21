import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const serviceNames = ['workflow', 'jobs', 'documents', 'policies', 'audit', 'agent', 'worker', 'gateway'];
const defaults = { gateway: 4317, workflow: 4318, documents: 4319, jobs: 4320, policies: 4321, audit: 4322, agent: 4323, worker: 4324 };
export function configuration(env = process.env) {
  const ports = Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => {
    const port = Number(env[`${name.toUpperCase()}_PORT`] || (name === 'gateway' && env.PORT) || fallback);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid ${name} port`);
    return [name, port];
  }));
  if (new Set(Object.values(ports)).size !== serviceNames.length) throw new Error('Each service needs a distinct port');
  const urls = Object.fromEntries(serviceNames.filter(name => name !== 'gateway').map(name => {
    const url = env[`${name.toUpperCase()}_URL`] || `http://127.0.0.1:${ports[name]}`;
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error(`Invalid ${name} service origin`);
    return [name, url];
  }));
  const data = resolve(env.PLATFORM_DATA_DIR || resolve(root, '.local/services'));
  return { ports, urls, host: env.SERVICE_HOST || '127.0.0.1', states: { workflow: resolve(env.WORKSPACE_FILE || resolve(root, 'apps/records-contracting/.local/workspace.json')), documents: resolve(data, 'documents.json'), jobs: resolve(data, 'jobs.json') }, tokenFile: env.SERVICE_TOKEN_FILE || resolve(data, 'service-token'), videoApiUrl: env.VIDEO_API_URL || '' };
}
export async function serviceToken(config, env = process.env) {
  const token = env.SERVICE_TOKEN || (await readFile(config.tokenFile, 'utf8')).trim();
  if (token.length < 32) throw new Error('Service token must contain at least 32 characters');
  return token;
}
