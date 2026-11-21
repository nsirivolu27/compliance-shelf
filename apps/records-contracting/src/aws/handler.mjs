import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../server.mjs';
import { authorizeCloudRequest } from '../lib/core/cloud-access.ts';
import { awsSnapshot } from './s3-snapshot.mjs';

const reply = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }, body: JSON.stringify(body) });

// Reuse the existing HTTP implementation on an ephemeral loopback socket. Each
// invocation loads a fresh S3 snapshot; no mutable workspace survives warm reuse.
export function createLambdaHandler({ snapshotFactory = awsSnapshot, config = process.env } = {}) {
  return async event => {
    let server;
    try {
      if (event.version !== '2.0') return reply(400, { error: 'HTTP API payload version 2.0 is required.' });
      const method = event.requestContext?.http?.method;
      const path = event.rawPath;
      if (typeof path !== 'string' || !/^\/api\/[A-Za-z0-9/_-]+$/.test(path)) return reply(400, { error: 'Invalid API path.' });
      const session = authorizeCloudRequest(event.requestContext?.authorizer?.jwt?.claims, method, path, config.COGNITO_ISSUER, config.COGNITO_CLIENT_ID);
      if (!config.WORKSPACE_BUCKET || !config.WORKSPACE_KEY) return reply(503, { error: 'Cloud workspace configuration is missing.' });
      const body = Buffer.from(event.body ?? '', event.isBase64Encoded ? 'base64' : 'utf8');
      if (body.length > 64000) return reply(413, { error: 'Request body exceeds 64 KB' });
      const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
      const storageBackend = await snapshotFactory({ bucket: config.WORKSPACE_BUCKET, key: config.WORKSPACE_KEY });
      server = await createApp({ storageBackend, actor: session.actor, session, videoApiUrl: '' });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const response = await new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: server.address().port, method, path: path + (event.rawQueryString ? `?${event.rawQueryString}` : ''), headers: {
          ...(headers['content-type'] ? { 'content-type': headers['content-type'] } : {}),
          // Scope retry keys to the verified principal, not a caller-controlled header.
          ...(headers['idempotency-key'] ? { 'idempotency-key': headers['idempotency-key'] } : {}),
        } }, res => {
          const chunks = [];
          let size = 0;
          res.on('data', chunk => { size += chunk.length; if (size > 5 * 1024 * 1024) { res.destroy(new Error('Response too large')); } else chunks.push(chunk); });
          res.on('error', reject);
          res.on('end', () => resolve({ statusCode: res.statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.end(body);
      });
      return response;
    } catch (error) {
      return reply(error.status || 503, { error: error.status ? error.message : 'Could not confirm the cloud operation. Reload or retry with the same Idempotency-Key.' });
    } finally {
      if (server?.listening) await new Promise(resolve => server.close(resolve));
    }
  };
}

export const handler = createLambdaHandler();
