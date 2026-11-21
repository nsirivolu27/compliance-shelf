import { readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// An interrupted seed is never replayed over reviewer work. Recover it deliberately.
export async function inspectDemo(folder, scenario) {
  if (!['va-ssa', 'va-audit'].includes(scenario)) throw new Error('Unknown demo scenario');
  let names;
  try { names = await readdir(folder); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (names.length === 0) return null;
  if (!names.includes('demo-ready.json')) throw new Error('Incomplete demo initialization: preserve this folder and inspect it before starting a fresh one.');
  const marker = JSON.parse(await readFile(join(folder, 'demo-ready.json'), 'utf8'));
  if (marker.scenario !== scenario || marker.version !== 1) throw new Error('Saved demo scenario does not match the requested scenario');
  const workspace = JSON.parse(await readFile(join(folder, 'workspace.json'), 'utf8'));
  const ids = scenario === 'va-ssa' ? [marker.cases.va, marker.cases.ssa] : [marker.cases.caseId];
  if (ids.some(id => !id || !workspace.cases.some(item => item.id === id))) throw new Error('Saved demo cases are missing; refusing to reseed');
  // The service stores are created lazily. The audit seed always creates both.
  for (const file of ['documents.json', 'jobs.json']) {
    try { JSON.parse(await readFile(join(folder, 'services', file), 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT' || scenario === 'va-audit') throw error;
    }
  }
  return marker;
}

export async function saveDemoMarker(folder, scenario, cases, today) {
  const marker = { version: 1, scenario, cases, seededAsOf: today, synthetic: true };
  const path = join(folder, 'demo-ready.json');
  await writeFile(`${path}.tmp`, JSON.stringify(marker, null, 2), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  return marker;
}
