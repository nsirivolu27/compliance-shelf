import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { configuration } from './config.mjs';
const { tokenFile } = configuration();
await mkdir(dirname(tokenFile), { recursive: true });
try { await writeFile(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); console.log('Created the ignored local service-token file.'); }
catch (error) { if (error.code !== 'EEXIST') throw error; console.log('Existing service-token file preserved.'); }
