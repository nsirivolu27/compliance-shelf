// Stands in for services/run.mjs in runner tests. It answers the readiness request on the gateway port
// it was given, stops cleanly when told to, and can be asked to crash with FAKE_CRASH_CODE.

import { createServer } from 'node:http';
import { configuration } from '../../config.mjs';

const { ports } = configuration();
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(request.url === '/api/services' ? { status: 'ok' } : { error: 'not found' }));
});
server.listen(ports.gateway, '127.0.0.1');

process.on('message', message => {
  if (message === 'shutdown') server.close(() => process.exit(0));
});

if (process.env.FAKE_CRASH_CODE) {
  setTimeout(() => process.exit(Number(process.env.FAKE_CRASH_CODE)), 300);
}
