// A fresh, completed training case. Never opens or resets a saved workspace.
// The data folder is new for every run, under the system temporary directory; DEMO_DATA_ROOT chooses another parent.
import { startPitchDemo } from './pitch-runner.mjs';
import { demoFolder } from './demo-folder.mjs';
import { seedContractReview } from './contract-review-seed.mjs';
import { completeContractReview } from './contract-review-completion.mjs';

const gatewayPort = Number(process.env.PORT || 5617);
if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65000) throw Error('Invalid PORT');
const folder = await demoFolder('va-completed');
const seed = async context => {
  const initial = await seedContractReview(context);
  const result = await completeContractReview({ ...context, caseId: initial.caseId });
  return { ...initial, completion: { checks: result.currentSufficientChecks, gaps: result.documentationGaps, openTasks: result.openTasks, activeHolds: result.activeHolds } };
};
const demo = await startPitchDemo({ env: process.env, gatewayPort, folder, today: new Date().toISOString().slice(0, 10), seed });
process.on('SIGINT', demo.stop);
process.on('SIGTERM', demo.stop);
const seeded = await demo.ready;
if (seeded) console.log(`Completed synthetic evidence review: ${demo.base}/#/cases/${seeded.caseId}/findings\nThree evidence reviews complete; records preserved under the active hold. Data: ${folder}`);
process.exitCode = await demo.exited;
