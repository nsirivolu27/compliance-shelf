// Runs the pitch walkthrough on its own folder and its own ports, then seeds it.
// services/pitch-demo.mjs is the command; this file holds the steps so they can be tested.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration, root, serviceNames } from './config.mjs';
import { busyPorts } from './free-ports.mjs';
import { seedPitchDemo } from './pitch-seed.mjs';

// Settings that decide where the services listen, whom they call, and which data and token they use.
// A shell may still hold these from another run, so the demo removes them and sets its own.
function isServiceSetting(name) {
  const upper = name.toUpperCase();
  if (['PORT', 'SERVICE_HOST', 'SERVICE_TOKEN', 'SERVICE_TOKEN_FILE', 'VIDEO_API_URL', 'WORKSPACE_FILE', 'PLATFORM_DATA_DIR'].includes(upper)) return true;
  return serviceNames.some(service => upper === `${service.toUpperCase()}_PORT` || upper === `${service.toUpperCase()}_URL`);
}

// The full environment for one isolated demo: gateway on gatewayPort, each other service on the next port up,
// every service address derived from those ports, data in folder. Ordinary settings such as PATH are kept.
export function pitchDemoEnvironment(baseEnv, gatewayPort, folder) {
  const env = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (!isServiceSetting(name)) env[name] = value;
  }
  serviceNames.filter(name => name !== 'gateway').forEach((name, index) => {
    env[`${name.toUpperCase()}_PORT`] = String(gatewayPort + index + 1);
  });
  env.GATEWAY_PORT = String(gatewayPort);
  env.PORT = String(gatewayPort);
  env.SERVICE_HOST = '127.0.0.1';
  env.PLATFORM_DATA_DIR = resolve(folder, 'services');
  env.WORKSPACE_FILE = resolve(folder, 'workspace.json');
  return env;
}

// Starts the supervisor, waits for it, and seeds it.
// Returns { stop, ready, exited }: ready gives the seeded case IDs (or null on failure),
// exited gives the exit code for the whole command.
export async function startPitchDemo({ env: baseEnv, gatewayPort, folder, supervisor = resolve(root, 'services/run.mjs'), seed = seedPitchDemo, today, output = console }) {
  const env = pitchDemoEnvironment(baseEnv, gatewayPort, folder);
  const config = configuration(env);

  // An earlier run that is still open would otherwise answer in place of this one. Stop before starting anything.
  const taken = await busyPorts(config.host, Object.values(config.ports));
  if (taken.length > 0) {
    const [noun, verb] = taken.length === 1 ? ['Port', 'is'] : ['Ports', 'are'];
    output.error(`${noun} ${taken.join(', ')} ${verb} already in use, probably by an earlier demo that is still running.`);
    output.error(`Stop that one with Ctrl+C in its window, or pick other ports first, for example: $env:PORT = "${gatewayPort + 100}"`);
    return { stop() {}, ready: Promise.resolve(null), exited: Promise.resolve(1) };
  }

  await mkdir(folder, { recursive: true });
  output.log(`Data folder for this run: ${folder}`);
  const child = spawn(process.execPath, [supervisor], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
  const stop = () => { if (child.exitCode === null && child.connected) child.send('shutdown'); };

  // A failure this runner saw (start or seed) wins over a clean supervisor shutdown that follows it.
  // Otherwise the supervisor's own exit code is the answer, so a real crash is never hidden.
  let failed = false;
  const exited = new Promise(done => child.on('exit', code => done(failed ? 1 : (code ?? 1))));

  const base = `http://127.0.0.1:${config.ports.gateway}`;
  async function servicesAnswer() {
    for (let attempt = 0; attempt < 120 && child.exitCode === null; attempt++) {
      try {
        const response = await fetch(`${base}/api/services`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json()).status === 'ok') return true;
      } catch { /* still starting */ }
      await delay(500);
    }
    return false;
  }

  const ready = (async () => {
    try {
      if (!await servicesAnswer()) throw new Error(`The services did not start on ${base}. Set PORT to a free number and run again.`);
      return await seed({ base, today });
    } catch (error) {
      failed = true;
      output.error(error.message);
      // The folder is kept so the cause can be read; a later run never reuses it.
      output.error(`Data folder kept for inspection: ${folder}`);
      output.error(`Service diagnostics, if any were recorded: ${resolve(folder, 'services', 'diagnostics.log')}`);
      stop();
      return null;
    }
  })();

  return { stop, ready, exited, base };
}
