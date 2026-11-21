import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../../apps/records-contracting/src/server.mjs';
import { seedPitchDemo } from '../pitch-seed.mjs';

test('pitch demo seed: two synthetic cases through the public API, on a fresh workspace only', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cp-pitch-seed-'));
  const server = await createApp({ stateFile: join(directory, 'workspace.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const today = '2026-11-20';
  const read = async path => (await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${today}`)).json();

  const result = await seedPitchDemo({ base, today });
  assert.match(result.va, /^DEMO-/); assert.match(result.ssa, /^DEMO-/);

  const state = await read('/api/workspace');
  assert.equal(state.cases.length, 5);
  for (const id of ['DEMO-VA-001', 'DEMO-VA-002', 'DEMO-VA-003']) assert.equal(state.cases.find(item => item.id === id).revision, 0, 'the built-in cases are untouched');
  const va = state.cases.find(item => item.id === result.va), ssa = state.cases.find(item => item.id === result.ssa);
  assert.deepEqual([va.provenance, ssa.provenance], ['synthetic', 'synthetic']);
  assert.match(va.agency, /Veterans Affairs/); assert.match(ssa.agency, /Social Security/);
  assert.deepEqual(va.records.map(record => record.hold), ['none', 'active']);

  // VA: a transmittal two facts short, a disposal notice blocked by the hold and past its date, one corrective action entry.
  const vaPaperwork = await read(`/api/cases/${result.va}/paperwork`);
  const byId = id => vaPaperwork.items.find(item => item.paperworkId === id);
  assert.deepEqual([byId('PW-SF135').readiness.summary, byId('PW-SF135').readiness.state], ['5 of 7 facts present', 'incomplete']);
  assert.deepEqual(byId('PW-SF135').readiness.facts.filter(fact => fact.state === 'missing').map(fact => fact.key), ['volume', 'receiving-center']);
  assert.deepEqual([byId('PW-NA13001').readiness.state, byId('PW-NA13001').readiness.overdue], ['blocked', true]);
  assert.equal(byId('PW-A50-CAP').readiness.state, 'incomplete');

  // One evidence reference is on file and not yet verified, so the review step has something to open.
  assert.deepEqual(va.evidence.map(entry => [entry.kind, entry.verified]), [['requirements-evidence', false]]);

  // The sample reader output is waiting, undecided, with its label.
  const reader = await read(`/api/cases/${result.va}/reader-outputs`);
  assert.deepEqual([reader.outputs.length, reader.outputs[0].label, reader.outputs[0].decided.undecided], [1, 'Sample in the service output shape. Not produced by the service.', 10]);

  // One gap is confirmed by a reviewer, so the audit team report has a recorded exception.
  const report = await read(`/api/audit-report?caseId=${result.va}`);
  assert.deepEqual([report.cases[0].confirmedGaps.length, report.cases[0].activeHolds.length, report.cases[0].overduePaperwork.length], [1, 1, 1]);

  // SSA: the three yearly records reports and one corrective action entry, with dates a person entered.
  const ssaPaperwork = await read(`/api/cases/${result.ssa}/paperwork`);
  assert.deepEqual(ssaPaperwork.items.map(item => item.paperworkId).sort(), ['PW-A50-CAP', 'PW-FEREM', 'PW-RMSA', 'PW-SAORM']);
  assert.equal(ssaPaperwork.items.every(item => typeof item.dueDate === 'string' && item.dueDate > today), true);
  const planning = await read(`/api/planning?caseId=${result.ssa}`);
  assert.equal(planning.dated.filter(entry => entry.type === 'paperwork').length, 4);

  // Every change carries a note that says it is synthetic, and nothing can be destroyed.
  const seeded = state.events.filter(event => event.caseId === result.va || event.caseId === result.ssa);
  assert.ok(seeded.length >= 15);
  assert.equal(seeded.every(event => /synthetic/i.test(JSON.stringify(event.details.change?.note ?? event.details.note ?? 'synthetic'))), true);
  assert.equal((await read(`/api/cases/${result.va}/report`)).records.every(row => row.retention.canDestroy === false), true);

  // A second run refuses: the seed is for a fresh workspace, never for saved work.
  await assert.rejects(seedPitchDemo({ base, today }), /fresh workspace/);
  assert.equal((await read('/api/workspace')).cases.length, 5);
});
