import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeCase, retention, validDate, parseEvidence } from '../src/lib/core/compliance.ts';
import { runGuidedAgent } from '../src/lib/tools/registry.mjs';
const cases = JSON.parse(await readFile(new URL('../data/demo-cases.json', import.meta.url), 'utf8'));
const record = () => ({ id: 'R', title: 'File', owner: 'Reviewer', schedule: { authority: 'Confirmed test schedule', years: 6, trigger: 'final-payment', confirmed: true }, finalPaymentDate: '2020-02-29', hold: 'none' });
test('a hold blocks review even after the retention interval', () => {
  const r = retention({ ...record(), hold: 'active' }, '2030-01-01');
  assert.equal(r.status, 'blocked'); assert.equal(r.reviewDate, null); assert.equal(r.canDestroy, false);
});
test('unknown holds and schedules never produce a disposal date', () => {
  for (const patch of [{ hold: 'unknown' }, { schedule: null }, { schedule: { ...record().schedule, confirmed: false } }]) {
    assert.equal(retention({ ...record(), ...patch }, '2030-01-01').status, 'unknown');
  }
});
test('calendar anniversary clamps leap day and requires human review', () => {
  const r = retention(record(), '2026-02-28');
  assert.equal(r.reviewDate, '2026-02-28'); assert.equal(r.status, 'review-due'); assert.equal(r.canDestroy, false);
  assert.equal(retention(record(), '2026-02-27').status, 'retain');
});
test('invalid or future final payment dates do not start a retention clock', () => {
  for (const date of [null, '2020-02-30', '2030-01-01', 'not-a-date']) assert.equal(retention({ ...record(), finalPaymentDate: date }, '2026-11-15').status, 'unknown');
  assert.equal(validDate('2026-13-01'), false); assert.throws(() => retention(record(), '2026-02-30'));
});
test('missing evidence is a workspace gap, not a legal violation', () => {
  const report = analyzeCase(cases[0], '2026-11-15');
  const funding = report.findings.find(f => f.id.endsWith(':funding'));
  assert.equal(funding.status, 'needs-evidence'); assert.match(funding.explanation, /does not prove absence/);
});
test('unknown applicability remains review even with verified evidence', () => {
  const item = structuredClone(cases[0]); item.applicability['signed-award'] = 'unknown';
  assert.equal(analyzeCase(item, '2026-11-15').findings[0].status, 'needs-review');
});
test('an evidence upload cannot assert its own verification', () => {
  const evidence = parseEvidence({ id: 'test', kind: 'funding', title: 'Funds', locator: 'demo://funds', verified: true, provenance: 'public-data' });
  assert.equal(evidence.verified, false); assert.equal(evidence.provenance, 'user-supplied');
  assert.throws(() => parseEvidence({ ...evidence, kind: 'invented' }));
});
test('a verified reference needs a locator and is not a compliance certification', () => {
  const item = structuredClone(cases[0]); item.evidence[0].locator = ' ';
  assert.equal(analyzeCase(item, '2026-11-15').findings[0].status, 'needs-review');
  assert.match(analyzeCase(cases[0], '2026-11-15').findings[0].explanation, /not certified/);
});
test('no record inventory produces an evidence request', () => {
  const report = analyzeCase({ ...cases[0], records: [] }, '2026-11-15');
  assert.ok(report.findings.some(f => f.id.endsWith(':inventory') && f.status === 'needs-evidence'));
});
test('guided agent returns the same computed retention and exposes its tool', () => {
  const context = { item: cases[0], asOf: '2026-11-15' };
  const result = runGuidedAgent('retention', context);
  assert.equal(result.trace[0].tool, 'review_retention'); assert.deepEqual(result.result, analyzeCase(context.item, context.asOf).records);
  assert.throws(() => runGuidedAgent('destroy-records', context));
});
test('every finding references a known source and has a stable ID', async () => {
  const sources = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
  for (const c of cases) {
    const findings = analyzeCase(c, '2026-11-15').findings;
    assert.equal(new Set(findings.map(f => f.id)).size, findings.length);
    assert.ok(findings.every(f => f.sourceIds.length && f.sourceIds.every(id => sources.some(s => s.id === id))));
  }
});
test('domain file has no framework, database, npm, or sibling imports', async () => {
  const text = await readFile(new URL('../src/lib/core/compliance.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /^\s*import\s/m);
});
