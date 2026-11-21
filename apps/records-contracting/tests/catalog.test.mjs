import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { queryPage } from '../src/lib/core/catalog.ts';
import { workspaceScreening } from '../src/lib/core/compliance.ts';

const cases = JSON.parse(await readFile(new URL('../data/demo-cases.json', import.meta.url), 'utf8'));

test('workspace counts preserve holds, unknowns, and completed tasks with unresolved findings', () => {
  const input = structuredClone(cases);
  input[0].tasks = [{ id: 'task-1', findingId: 'DEMO-VA-001:funding', title: 'Ask for funding', owner: 'Reviewer', dueDate: '2026-01-01', status: 'done' }];
  const result = workspaceScreening(input, '2026-11-15');
  assert.equal(result.counts.cases, 3);
  assert.equal(result.counts.activeHolds, 1);
  assert.equal(result.counts.evidenceGaps, 3);
  assert.equal(result.counts.pendingReviews, 7);
  assert.equal(result.counts.openTasks, 0);
  assert.equal(result.counts.overdueTasks, 0);
  assert.equal(result.counts.tasksNeedingFollowUp, 1);
  assert.equal(result.records.find(r => r.id === 'REC-001').status, 'blocked');
  assert.ok(result.records.every(r => r.retention.canDestroy === false));
});

test('filters run before pagination, preserve order, and detect changed snapshots', () => {
  const rows = [{ id: '1', title: 'Funding A', status: 'open' }, { id: '2', title: 'Funding B', status: 'done' }, { id: '3', title: 'Funding C', status: 'open' }];
  const options = { revision: 4, textFields: ['title'], filters: { status: ['open', 'done'] } };
  const first = queryPage(rows, { q: 'FUNDING', status: 'open', limit: '1' }, options);
  assert.deepEqual(first.items, [rows[0]]);
  assert.equal(first.pagination.total, 2);
  assert.equal(first.pagination.nextOffset, 1);
  assert.deepEqual(queryPage(rows, { status: 'open', limit: '1', offset: '1', workspaceRevision: '4' }, options).items, [rows[2]]);
  assert.throws(() => queryPage(rows, { workspaceRevision: '3' }, options), e => e.status === 409 && e.currentRevision === 4);
  for (const query of [{ limit: '0' }, { limit: '101' }, { offset: '-1' }, { offset: '1.1' }, { status: 'bogus' }, { unrecognized: 'true' }, { q: 'x'.repeat(201) }]) {
    assert.throws(() => queryPage(rows, query, options), e => e.status === 400);
  }
  assert.deepEqual(queryPage(rows, { q: 'no match' }, options).items, []);
});
