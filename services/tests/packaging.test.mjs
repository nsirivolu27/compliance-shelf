import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('AWS package: the build copies every data file the server reads at startup', async () => {
  const server = await read('../../apps/records-contracting/src/server.mjs');
  const startup = server.slice(server.indexOf('export async function createApp'), server.indexOf('const persistence'));
  const needed = [...startup.matchAll(/readJson\('(data\/[^']+)'\)/g)].map(match => match[1]);
  assert.ok(needed.length >= 4, 'the startup data files were found in the server source');
  const build = await read('../../infra/aws/build.mjs');
  for (const file of needed) assert.ok(build.includes(`'${file}'`), `infra/aws/build.mjs copies ${file}`);
});
