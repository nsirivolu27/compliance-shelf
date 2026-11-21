// Starts the local services on a new, empty data folder and seeds the VA contract-review demonstration.
// Saved workspaces are never opened: this run has its own folder and its own ports (default 4817 to 4824).
// Each run is a fresh copy, so a rehearsal never needs anything deleted.
// The folder is new for every run, under the system temporary directory; DEMO_DATA_ROOT chooses another parent.
// Usage from the repository root, with the portable Node 22 runtime and without changing PATH:
//   & ".\.local\tools\node-v22.23.5-win-x64\node.exe" services\contract-review-demo.mjs
// or: npm run demo:contract-review   (set PORT to change the address)

import { resolve } from 'node:path';
import { root } from './config.mjs';
import { startPitchDemo } from './pitch-runner.mjs';
import { seedContractReview } from './contract-review-seed.mjs';
import { demoFolder } from './demo-folder.mjs';

const gatewayPort = Number(process.env.PORT || 4817);
if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65000) {
  console.error('PORT must be a number from 1024 to 65000');
  process.exit(1);
}

const folder = await demoFolder('va-audit');
const today = new Date().toISOString().slice(0, 10);
const demo = await startPitchDemo({ env: process.env, gatewayPort, folder, today, seed: seedContractReview });

process.on('SIGINT', demo.stop);
process.on('SIGTERM', demo.stop);

const seeded = await demo.ready;
if (seeded) {
  const caseLink = `${demo.base}/#/cases/${seeded.caseId}`;
  console.log('');
  console.log(`Contract review demo ready (Node ${process.version}): ${demo.base}`);
  console.log(`Case:              ${caseLink}/findings`);
  console.log(`Document register: ${demo.base}/#/documents`);
  console.log(`Audit report:      ${demo.base}/#/auditreport?caseId=${seeded.caseId}`);
  console.log(`Document pack:     ${resolve(root, 'demo/agency-contract-review')}`);
  console.log(`Data folder for this run only: ${folder}`);
  console.log('Every case and document here is synthetic. Saved workspaces were not opened. Press Ctrl+C to stop.');
}
process.exitCode = await demo.exited;
