// Before starting services, find out which of their ports another program already holds.
// Trying to listen briefly is the only reliable check on every system, Windows included.

import { createServer } from 'node:net';

function isBusy(host, port) {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen(port, host);
  });
}

export async function busyPorts(host, ports) {
  const busy = [];
  for (const port of ports) {
    if (await isBusy(host, port)) busy.push(port);
  }
  return busy;
}
