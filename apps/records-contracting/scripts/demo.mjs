import { readFile } from 'node:fs/promises';
import { analyzeCase } from '../src/lib/core/compliance.ts';
const cases = JSON.parse(await readFile(new URL('../data/demo-cases.json', import.meta.url), 'utf8'));
const asOf = process.argv[2] || '2026-11-15';
console.log(JSON.stringify({ mode: 'synthetic-demo', reports: cases.map(c => analyzeCase(c, asOf)) }, null, 2));
