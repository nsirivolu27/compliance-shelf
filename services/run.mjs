import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { configuration, root, serviceNames } from './config.mjs';

const config = configuration();
if (config.host !== '127.0.0.1') throw new Error('The local supervisor binds to loopback. Use the container configuration for a private service network.');
const token = randomBytes(32).toString('hex');
const children = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null) return;
    const closed = new Promise(resolve => child.once('exit', resolve));
    if (child.connected) { try { child.send('shutdown', () => {}); } catch { child.kill(); } }
    const timer = setTimeout(() => child.kill(), 8000); timer.unref();
    await closed; clearTimeout(timer);
  }));
  process.exitCode = code;
  if (process.connected) process.disconnect();
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
process.on('message', message => { if (message === 'shutdown') stop(); });
process.on('disconnect', () => stop());
try {
  for (const name of serviceNames) {
    if (stopping) break;
    const child = spawn(process.execPath, [resolve(root, 'services/start.mjs'), name], { cwd: root, env: { ...process.env, SERVICE_TOKEN: token }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
    children.push(child);
    child.on('exit', code => { if (!stopping) { console.error(`${name} stopped unexpectedly (${code}); stopping owned services.`); stop(1); } });
    child.on('error', () => stop(1));
    let ready = false;
    for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${config.ports[name]}${name === 'workflow' ? '/api/health' : '/health'}`, { headers: { 'x-platform-token': token }, signal: AbortSignal.timeout(500) });
        const data = await response.json();
        if (response.ok && (name === 'workflow' ? data.mode === 'local-demo' : data.service === name)) { ready = true; break; }
      } catch { /* Wait for this child to bind. */ }
      await delay(150);
    }
    if (!ready && !stopping) throw new Error(`${name} did not become ready; check its port and service data.`);
  }
  if (!stopping) console.log(`Compliance Platform microservices: http://127.0.0.1:${config.ports.gateway}`);
} catch (error) { console.error(error.message); await stop(1); }
