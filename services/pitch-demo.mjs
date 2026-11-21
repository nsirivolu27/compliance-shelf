// Starts the local services on a new, empty data folder and fills it with the pitch walkthrough.
// The saved demo is never opened: this run has its own folder and its own ports.
// The folder is new for every run, under the system temporary directory; DEMO_DATA_ROOT chooses another parent.
// Usage from the repository root: npm run demo:pitch   (set PORT to change the address, default 4417)
// The steps live in services/pitch-runner.mjs so they can be tested.

import { startPitchDemo } from './pitch-runner.mjs';
import { demoFolder } from './demo-folder.mjs';

const gatewayPort = Number(process.env.PORT || 4417);
if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65000) {
  console.error('PORT must be a number from 1024 to 65000');
  process.exit(1);
}

const folder = await demoFolder('va-ssa');
const today = new Date().toISOString().slice(0, 10);
const demo = await startPitchDemo({ env: process.env, gatewayPort, folder, today });

// The supervisor stops its services when told to, or when this process goes away.
process.on('SIGINT', demo.stop);
process.on('SIGTERM', demo.stop);

const seeded = await demo.ready;
if (seeded) {
  console.log('');
  console.log(`Pitch demo ready: ${demo.base}`);
  console.log(`VA case:  ${demo.base}/#/cases/${seeded.va}/paperwork`);
  console.log(`SSA case: ${demo.base}/#/cases/${seeded.ssa}/paperwork`);
  console.log(`Data folder for this run only: ${folder}`);
  console.log('Every case here is synthetic. The saved demo was not opened. Press Ctrl+C to stop.');
}
process.exitCode = await demo.exited;
