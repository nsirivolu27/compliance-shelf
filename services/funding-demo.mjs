// A fresh, isolated funding demonstration with one synthetic VA and one synthetic SSA example.
// Each run creates its own workspace folder; to reset, stop it and run it again. It never opens or resets
// a saved workspace, the completed VA case or the saved SSA example.
// The folder is new for every run, under the system temporary directory; DEMO_DATA_ROOT chooses another parent.
import { startPitchDemo } from './pitch-runner.mjs';
import { demoFolder } from './demo-folder.mjs';
import { seedContractReview } from './contract-review-seed.mjs';
import { completeContractReview } from './contract-review-completion.mjs';
import { seedFunding } from './funding-seed.mjs';

const gatewayPort = Number(process.env.PORT || 5717);
if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65000) throw Error('Invalid PORT');
const folder = await demoFolder('funding');
const seed = async context => {
  const initial = await seedContractReview(context);
  await completeContractReview({ ...context, caseId: initial.caseId });
  return { ...initial, funding: await seedFunding({ ...context, vaCaseId: initial.caseId }) };
};
const demo = await startPitchDemo({ env: process.env, gatewayPort, folder, today: new Date().toISOString().slice(0, 10), seed });
process.on('SIGINT', demo.stop);
process.on('SIGTERM', demo.stop);
const seeded = await demo.ready;
if (seeded) console.log(`Synthetic funding demonstration: ${demo.base}/#/funding\nVA and SSA examples each hold a supported proposal for a separate next phase, a larger proposal that the budget cannot also cover, and an earlier reversal with its history. Allocations are simulated planning decisions; no payment is sent.
Completed VA case: ${demo.base}/#/cases/${seeded.caseId}/findings
Data folder for this run only: ${folder}
Press Ctrl+C to stop. To reset, run it again: every run starts a new workspace.`);
process.exitCode = await demo.exited;
