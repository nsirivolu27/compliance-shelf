import { mkdir, mkdtemp, readdir, readFile, writeFile, copyFile, lstat } from 'node:fs/promises';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { artifactTemplate, applicationTemplate } from './template.mjs';
import { cloudfrontTemplate } from './cloudfront-template.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = resolve(process.env.AWS_DEMO_BUILD_ROOT || join(root, 'dist/aws-demo'));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'build-'));
const payload = join(output, 'payload');
const files = [];
const hash = data => createHash('sha256').update(data).digest('hex');

async function copy(path) {
  const input = resolve(root, path);
  const local = relative(root, input);
  if (local.startsWith('..') || local.split(sep).some(part => part.startsWith('.') || /^(node_modules|dist|uploads|outputs)$/i.test(part))) throw new Error(`Forbidden package path: ${path}`);
  let current = root;
  for (const part of local.split(sep)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
  }
  if (!(await lstat(input)).isFile()) throw new Error(`Expected file: ${path}`);
  const target = join(payload, local);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(input, target);
  if (path.endsWith('.sh')) await writeFile(target, (await readFile(target, 'utf8')).replace(/\r\n/g, '\n'));
  const content = await readFile(target);
  files.push({ path: local.split(sep).join('/'), bytes: content.length, sha256: hash(content) });
}
async function tree(path, extensions) {
  if ((await lstat(join(root, path))).isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) throw new Error(`Unexpected package entry: ${path}/${entry.name}`);
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await tree(child, extensions);
    else if (extensions.test(entry.name)) await copy(child);
    else throw new Error(`Unexpected package extension: ${child}`);
  }
}
await copy('package.json');
await copy('apps/records-contracting/package.json');
await tree('apps/records-contracting/src', /\.(mjs|ts)$/);
await tree('apps/records-contracting/public', /\.(html|css|js)$/);
for (const entry of await readdir(join(root, 'services'), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.mjs')) await copy(`services/${entry.name}`);
}
for (const name of ['demo-cases.json', 'sources.json', 'profile-presets.json', 'paperwork-catalog.json', 'public/va-awards.json']) await copy(`apps/records-contracting/data/${name}`);
await tree('apps/records-contracting/data/reader-samples', /^synthetic-[a-z-]+\.sample\.json$/);
const pack = 'demo/agency-contract-review';
const manifest = JSON.parse(await readFile(join(root, pack, 'manifest.json'), 'utf8'));
if (manifest.synthetic !== true) throw new Error('The document pack must be synthetic');
await copy(`${pack}/manifest.json`);
await copy(`${pack}/scenario.json`);
for (const document of manifest.documents) for (const file of Object.values(document.files)) {
  if (!/^(originals|text)\/[A-Za-z0-9_.-]+\.(pdf|md)$/.test(file.path)) throw new Error(`Unexpected document path: ${file.path}`);
  const content = await readFile(join(root, pack, file.path));
  if (hash(content) !== file.sha256) throw new Error(`Document hash mismatch: ${file.path}`);
  await copy(`${pack}/${file.path}`);
}
for (const name of ['start.mjs', 'state.mjs', 'install.sh', 'nginx.mjs']) await copy(`infra/aws-demo/${name}`);
await writeFile(join(payload, 'BUILD.json'), JSON.stringify({ builtAt: new Date().toISOString(), runtime: 'Node 22 >=22.18', synthetic: true, files }, null, 2));
const archive = join(output, 'compliance-demo.tar.gz');
const result = spawnSync('tar', ['-czf', archive, '-C', payload, '.'], { encoding: 'utf8', windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || 'tar is required');
const bootstrap = (await readFile(join(root, 'infra/aws-demo/bootstrap.sh'), 'utf8')).replace(/\r\n/g, '\n');
await writeFile(join(output, 'artifacts.template.json'), JSON.stringify(artifactTemplate(), null, 2));
await writeFile(join(output, 'application.template.json'), JSON.stringify(applicationTemplate(bootstrap), null, 2));
const authCode = await readFile(join(root, 'infra/aws-demo/edge-auth.js'), 'utf8');
await writeFile(join(output, 'cloudfront.template.json'), JSON.stringify(cloudfrontTemplate(bootstrap, authCode), null, 2));
const metadata = { directory: output, payload, archive, sha256: hash(await readFile(archive)), fileCount: files.length, synthetic: true, deployed: false };
await writeFile(join(outputRoot, 'latest.json'), JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(metadata, null, 2));
