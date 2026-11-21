import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeCase } from '../src/lib/core/compliance.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (/\.(mjs|ts|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    }
  }
}
await check(`${root}/src`);
await check(`${root}/public`);
const cases = JSON.parse(await readFile(`${root}/data/demo-cases.json`, 'utf8'));
cases.forEach(item => analyzeCase(item, '2026-11-15'));
await mkdir(`${root}/dist`, { recursive: true });
for (const name of ['src', 'public', 'data', 'package.json']) await cp(`${root}/${name}`, `${root}/dist/${name}`, { recursive: true });
await writeFile(`${root}/dist/BUILD.json`, JSON.stringify({ builtAt: new Date().toISOString(), cases: cases.length, runtime: 'Node >=22.18', start: 'node src/server.mjs' }, null, 2));
console.log('Build validated and packaged in dist/ (no transpilation or dependencies).');
