import { mkdir, mkdtemp, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';

const directory = fileURLToPath(new URL('.', import.meta.url));
const app = resolve(directory, '../../apps/records-contracting');
await mkdir(join(directory, 'dist'), { recursive: true });
const output = await mkdtemp(join(directory, 'dist/package-'));
async function copyCode(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const input = join(source, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in the deployment package');
    if (entry.isDirectory()) { await copyCode(input, join(target, entry.name)); continue; }
    if (!/\.(mjs|ts)$/.test(entry.name)) throw new Error(`Unexpected source file: ${entry.name}`);
    let content = await readFile(input, 'utf8');
    if (entry.name.endsWith('.ts')) content = stripTypeScriptTypes(content);
    content = content.replace(/(from\s+['"][^'"]+)\.ts(['"])/g, '$1.mjs$2');
    const destination = join(target, entry.name.replace(/\.ts$/, '.mjs'));
    await writeFile(destination, content);
    const result = spawnSync(process.execPath, ['--check', destination], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
}
await copyCode(join(app, 'src'), join(output, 'src'));
await mkdir(join(output, 'data/public'), { recursive: true });
// Explicit inputs keep local state, credentials, videos, and frontend work out.
for (const file of ['data/demo-cases.json', 'data/sources.json', 'data/profile-presets.json', 'data/paperwork-catalog.json', 'data/public/va-awards.json', 'package.json']) await copyFile(join(app, file), join(output, file));
await writeFile(join(output, 'BUILD.json'), JSON.stringify({ runtime: 'nodejs24.x', handler: 'src/aws/handler.handler', builtAt: new Date().toISOString(), sdk: 'AWS SDK v3 supplied by the Lambda runtime', scope: 'Synthetic single-workspace pilot; no frontend or video worker' }, null, 2));
await writeFile(join(directory, 'dist/latest.json'), JSON.stringify({ directory: output, handler: 'src/aws/handler.handler' }, null, 2));
console.log(`AWS package prepared: ${output}`);
console.log('Source TypeScript was stripped to JavaScript. No cloud resources were created.');
