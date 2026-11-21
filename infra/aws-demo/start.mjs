import { resolve } from 'node:path';
import { startPitchDemo } from '../../services/pitch-runner.mjs';
import { seedPitchDemo } from '../../services/pitch-seed.mjs';
import { seedContractReview } from '../../services/contract-review-seed.mjs';
import { inspectDemo, saveDemoMarker } from './state.mjs';

const scenario = process.env.DEMO_SCENARIO || 'va-ssa';
if (!process.env.DEMO_STATE_DIR) throw new Error('DEMO_STATE_DIR must name a dedicated persistent demo folder');
const folder = resolve(process.env.DEMO_STATE_DIR);
const gatewayPort = Number(process.env.PORT || 5417);
if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65000) throw new Error('Invalid PORT');
const saved = await inspectDemo(folder, scenario);
const today = new Date().toISOString().slice(0, 10);
// Only the settings needed by the local processes cross the child boundary.
// AWS credentials, application keys and arbitrary shell variables are not inherited.
const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'TZ']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const demo = await startPitchDemo({ env, folder, gatewayPort, today, seed: async options => {
  if (saved) return saved.cases;
  const cases = await (scenario === 'va-ssa' ? seedPitchDemo(options) : seedContractReview(options));
  await saveDemoMarker(folder, scenario, cases, today);
  return cases;
} });
process.on('SIGINT', demo.stop);
process.on('SIGTERM', demo.stop);
process.on('message', message => { if (message === 'shutdown') demo.stop(); });
process.on('disconnect', demo.stop);
const cases = await demo.ready;
if (cases) console.log(JSON.stringify({ status: 'ready', scenario, base: demo.base, cases, resumed: Boolean(saved), synthetic: true }));
process.exitCode = await demo.exited;
if (process.connected) process.disconnect();
