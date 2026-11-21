// Where an isolated demo keeps its data. Every run gets a new folder.
// The default parent is the system temporary directory, the same place demo/start-demo.ps1 uses,
// because a folder watched by a sync client (the source tree sits in OneDrive) was measured to refuse
// about one file rename in a hundred. DEMO_DATA_ROOT still chooses another parent folder.
// Nothing that already exists is moved, reused or deleted. Windows may clear temporary data later.

import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export async function demoFolder(scenario, env = process.env, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  if (env.DEMO_DATA_ROOT) return resolve(env.DEMO_DATA_ROOT, stamp);
  const parent = join(tmpdir(), 'compliance-platform-demos', scenario);
  await mkdir(parent, { recursive: true });
  // The random ending makes the folder unique even for two runs in the same millisecond.
  return mkdtemp(join(parent, `${stamp}-`));
}
