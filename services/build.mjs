import { mkdir, mkdtemp, readdir, cp, copyFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { root } from './config.mjs';

for (const entry of await readdir(resolve(root, 'services'), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.mjs')) {
    const checked = spawnSync(process.execPath, ['--check', resolve(root, 'services', entry.name)], { encoding: 'utf8' });
    if (checked.status !== 0) throw new Error(checked.stderr);
  }
}
await mkdir(resolve(root, 'dist'), { recursive: true });
const output = await mkdtemp(resolve(root, 'dist/microservices-'));
await cp(resolve(root, 'services'), resolve(output, 'services'), { recursive: true, filter: path => !path.includes(`${process.platform === 'win32' ? '\\' : '/'}tests`) });
for (const name of ['src', 'public', 'data', 'package.json']) await cp(resolve(root, 'apps/records-contracting', name), resolve(output, 'apps/records-contracting', name), { recursive: true });
await copyFile(resolve(root, 'package.json'), resolve(output, 'package.json'));
await writeFile(resolve(root, 'dist/latest-services.json'), JSON.stringify({ directory: output, start: 'node services/run.mjs', runtime: 'Node >=22.18', mode: 'local-microservices' }, null, 2));
console.log(`Microservices packaged: ${output}`);
