import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyCaseChange, createDemoCase, analyzeCase, taskQueue } from '../src/lib/core/compliance.ts';

const cases = JSON.parse(await readFile(new URL('../data/demo-cases.json', import.meta.url), 'utf8'));
const context = { id: 'NEW-ID', asOf: '2026-11-15', sourceIds: ['va-rfo', 'va-6300', 'far-4.805'], reviewedAt: '2026-11-15T12:00:00.000Z', actor: 'test-reviewer' };
const body = fields => ({ expectedRevision: 0, note: 'Reviewed this synthetic case.', ...fields });
const change = (item, command, fields, extra = {}) => applyCaseChange(item, command, body(fields), { ...context, ...extra });

test('new demo cases begin with unknown applicability and cannot impersonate public awards', () => {
  const { item } = createDemoCase({ title: 'New synthetic case', owner: 'Reviewer', note: 'Created for the demo workflow.' }, 'DEMO-NEW');
  assert.equal(item.provenance, 'synthetic');
  assert.ok(Object.values(item.applicability).every(v => v === 'unknown'));
  assert.equal(item.policyBasisConfirmed, false);
  assert.throws(() => createDemoCase({ title: 'A', owner: 'B', note: 'Reviewed case.', provenance: 'public-data' }, 'DEMO-NEW'));
});

test('context decisions require known authorities and cannot silently accept typo fields', () => {
  const result = change(cases[0], 'context', { applicability: { funding: 'no' }, policyBasis: { confirmed: true, description: 'Confirmed the synthetic policy basis.', sourceIds: ['va-rfo'] } });
  assert.equal(analyzeCase(result.item, context.asOf).findings.find(f => f.id.endsWith(':funding')).status, 'not-applicable');
  assert.equal(cases[0].applicability.funding, 'yes');
  assert.equal(result.change.before.applicability.funding, 'yes');
  assert.throws(() => change(cases[0], 'context', { applicability: { fundng: 'yes' } }));
  assert.throws(() => change(cases[0], 'context', { policyBasis: { confirmed: true, description: 'Claims an invented source.', sourceIds: ['invented-law'] } }));
});

test('editing metadata cannot remove an active hold; releasing it requires a reference', () => {
  assert.throws(() => change(cases[0], 'record-update', { hold: 'none' }, { targetId: 'REC-001' }));
  assert.throws(() => change(cases[0], 'record-hold', { status: 'none', reference: 'review-123' }, { targetId: 'REC-001' }));
  const result = change(cases[0], 'record-hold', { status: 'none', reference: 'review-123', releaseReference: 'release-456' }, { targetId: 'REC-001' });
  assert.equal(result.change.releaseReference, 'release-456');
  const retention = analyzeCase(result.item, context.asOf).records[0].retention;
  assert.equal(retention.status, 'review-due'); assert.equal(retention.canDestroy, false);
  assert.equal(cases[0].records[0].hold, 'active');
});

test('new records have no inferred schedule or hold clearance', () => {
  const result = change(cases[1], 'record-create', { title: 'New inventory item' });
  const record = result.item.records.at(-1);
  assert.equal(record.schedule, null); assert.equal(record.hold, 'unknown');
  assert.equal(analyzeCase(result.item, context.asOf).records.at(-1).retention.status, 'unknown');
});

test('record schedule and trigger changes reject malformed or unsupported claims', () => {
  const schedule = { authority: 'Synthetic confirmed schedule', years: 6, trigger: 'final-payment', confirmed: true };
  for (const fields of [{ schedule: { ...schedule, trigger: 'award-end' } }, { schedule: { ...schedule, years: -1 } }, { schedule: { ...schedule, confirmed: 'yes' } }, { finalPaymentDate: '2026-02-30' }, { finalPaymentDate: '2027-01-01' }]) {
    assert.throws(() => change(cases[1], 'record-update', fields, { targetId: 'REC-002' }));
  }
  const result = change(cases[1], 'record-update', { schedule, finalPaymentDate: '2020-02-29', owner: 'Records reviewer' }, { targetId: 'REC-002' });
  assert.equal(result.item.records[0].hold, 'unknown');
});

test('correcting a verified evidence reference clears verification and records before/after', () => {
  const result = change(cases[0], 'evidence-update', { locator: 'demo://replacement' }, { targetId: 'EV-001' });
  assert.equal(result.item.evidence[0].verified, false);
  assert.equal(result.change.before.verified, true);
  assert.equal(analyzeCase(result.item, context.asOf).findings[0].status, 'needs-review');
  assert.equal(cases[0].evidence[0].verified, true);
});

test('completing a task never hides the underlying evidence gap', () => {
  let { item } = change(cases[0], 'task-create', { findingId: 'DEMO-VA-001:funding', title: 'Ask for funds certification', owner: 'Demo reviewer', dueDate: '2026-11-10' });
  assert.equal(taskQueue([item], context.asOf)[0].overdue, true);
  item = change(item, 'task-update', { status: 'done' }, { targetId: 'NEW-ID' }).item;
  const task = taskQueue([item], context.asOf)[0];
  assert.equal(task.status, 'done'); assert.equal(task.needsFollowUp, true); assert.equal(task.findingStatus, 'needs-evidence');
  assert.equal(task.overdue, false);
});

test('task references are case-scoped and missing inventory findings remain visible', () => {
  assert.throws(() => change(cases[0], 'task-create', { findingId: 'DEMO-VA-002:funding', title: 'Cross-case task', owner: 'Reviewer' }));
  const blank = createDemoCase({ title: 'Inventory case', owner: 'Reviewer', note: 'Synthetic case creation.' }, 'DEMO-NEW').item;
  let { item } = change(blank, 'task-create', { findingId: 'DEMO-NEW:inventory', title: 'Inventory records', owner: 'Reviewer' });
  item = change(item, 'record-create', { title: 'New record' }).item;
  const task = taskQueue([item], context.asOf)[0];
  assert.equal(task.findingStatus, 'unavailable'); assert.equal(task.needsFollowUp, true);
});
