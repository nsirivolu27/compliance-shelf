import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { validateCatalog, paperworkReadiness, newPaperworkItem, changePaperworkItem, paperworkStatuses } from '../src/lib/core/paperwork.ts';
import { validateProfile } from '../src/lib/core/profile.ts';

const asOf = '2026-11-15';
const note = 'Recorded for the synthetic demo.';
const shipped = async () => validateCatalog(JSON.parse(await readFile(new URL('../data/paperwork-catalog.json', import.meta.url), 'utf8')));
const entryOf = (catalog, id) => catalog.find(entry => entry.id === id);

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cp-paperwork-'));
  const server = await createApp({ stateFile: join(directory, 'workspace.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, key) => {
    const headers = { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) };
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${asOf}`, body === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const revisionOf = async caseId => (await call(`/api/cases/${caseId}/paperwork`)).body.caseRevision;
  return { call, revisionOf };
}

// A hand-built case, so each fact rule can be shown on its own.
const schedule = { authority: 'Synthetic schedule 1.1', years: 6, trigger: 'final-payment', confirmed: true, itemNumber: '010' };
const record = (extra = {}) => ({ id: 'R-1', title: 'Payment vouchers 2020', owner: 'Demo records officer', schedule, finalPaymentDate: null, hold: 'none', ...extra });
const caseWith = (recordExtra = {}, extra = {}) => ({ id: 'C-1', title: 'Synthetic case', agency: 'Example agency', businessUnit: 'Example records office', evidence: [{ id: 'E-1', verified: true }, { id: 'E-2', verified: false }], records: [record(recordExtra)], paperwork: [], ...extra });
const context = { id: 'P-1', now: '2026-11-15T12:00:00.000Z', actor: 'local-demo-operator', asOf };
const factsOf = readiness => Object.fromEntries(readiness.facts.map(fact => [fact.key, fact.state]));

test('catalog: the shipped file validates, and entries that were not confirmed are marked as candidates', async () => {
  const catalog = await shipped();
  assert.equal(catalog.length, 24);
  assert.deepEqual(catalog.filter(entry => entry.mode === 'readiness').map(entry => entry.id).sort(), ['PW-A50-CAP', 'PW-NA13001', 'PW-SF135', 'PW-SSA-DISABILITY', 'PW-SSA-RETIREMENT', 'PW-SSA-SSI', 'PW-SSA-SURVIVORS', 'PW-VA-DISABILITY', 'PW-VA-PENSION', 'PW-VA-SURVIVORS']);
  assert.deepEqual(catalog.filter(entry => entry.verification === 'candidate').map(entry => entry.id).sort(), ['PW-SF115', 'PW-SF258', 'PW-VA-AFR', 'PW-VA0244', 'PW-VA7468']);
  for (const entry of catalog) {
    assert.match(entry.id, /^PW-[A-Z0-9-]{2,30}$/);
    assert.equal(entry.checkedOn, '2026-11-19');
    assert.equal(entry.mode, entry.requiredFacts.length ? 'readiness' : 'catalog-only');
    if (entry.verification === 'seen') assert.match(entry.sourceUrl, /^https:\/\//, `${entry.id} cites the page it was read on`);
  }
  assert.equal(entryOf(catalog, 'PW-SF135').needsRecord, true);
  assert.equal(entryOf(catalog, 'PW-A50-CAP').needsRecord, false);
  assert.equal(JSON.stringify(catalog).match(/compliant|certif|approved by/i), null, 'the catalog claims no approval or compliance');

  const one = { id: 'PW-X1', title: 'Example', formNumber: null, family: 'privacy', scope: 'government-wide', preparedBy: 'Office', receivedBy: 'Reviewer', cadence: 'per-system', requiredFacts: [], sourceUrl: null, verification: 'candidate', checkedOn: '2026-11-19', note: 'Example entry.' };
  assert.equal(validateCatalog({ entries: [one] })[0].mode, 'catalog-only');
  assert.throws(() => validateCatalog({ entries: [one, one] }), /repeated/);
  assert.throws(() => validateCatalog({ entries: [{ ...one, verification: 'verified' }] }), /verification/);
  assert.throws(() => validateCatalog({ entries: [{ ...one, verification: 'seen' }] }), /sourceUrl/, 'an entry marked as seen must cite its page');
  assert.throws(() => validateCatalog({ entries: [{ ...one, requiredFacts: [{ key: 'a-fact', label: 'A fact', from: 'guess' }] }] }), /from/);
});

test('readiness: each required fact is present, missing, or blocked, and unknown stays unknown', async () => {
  const catalog = await shipped();
  const sf135 = entryOf(catalog, 'PW-SF135');
  const item = caseWith();
  const paperwork = { id: 'P-1', paperworkId: 'PW-SF135', recordId: 'R-1', status: 'not-started', dueDate: null, reference: null, facts: {} };

  const first = paperworkReadiness(paperwork, sf135, item, asOf);
  assert.deepEqual(factsOf(first), { 'transferring-office': 'present', 'series-title': 'present', 'inclusive-dates': 'missing', volume: 'missing', 'disposal-authority': 'present', 'receiving-center': 'missing', 'no-active-hold': 'present' });
  assert.deepEqual([first.present, first.required, first.state], [4, 7, 'incomplete']);
  assert.equal(first.facts.find(fact => fact.key === 'transferring-office').origin, 'case');
  assert.match(first.facts.find(fact => fact.key === 'disposal-authority').value, /Synthetic schedule 1\.1.*010/);
  assert.equal(Object.keys(first).some(key => /compliance|score|percent|grade/i.test(key)), false, 'readiness is a count, never a rating');

  // An undecided hold is not treated as "no hold".
  const undecided = paperworkReadiness(paperwork, sf135, caseWith({ hold: 'unknown' }), asOf);
  assert.equal(factsOf(undecided)['no-active-hold'], 'missing');
  assert.equal(undecided.state, 'incomplete');

  // An active hold blocks the item, whatever else is on file.
  const complete = { ...paperwork, facts: { 'inclusive-dates': { value: '2020-01-01 to 2020-12-31', origin: 'manual' }, volume: { value: '4 cubic feet', origin: 'manual' }, 'receiving-center': { value: 'Example records center', origin: 'manual' } } };
  assert.equal(paperworkReadiness(complete, sf135, item, asOf).state, 'facts-complete');
  const held = paperworkReadiness(complete, sf135, caseWith({ hold: 'active' }), asOf);
  assert.deepEqual([factsOf(held)['no-active-hold'], held.state, held.present], ['blocked', 'blocked', 6]);

  // A schedule nobody confirmed is not a disposal authority. A case with no business unit has no office to show.
  const unconfirmed = paperworkReadiness(paperwork, sf135, caseWith({ schedule: { ...schedule, confirmed: false } }, { businessUnit: undefined }), asOf);
  assert.equal(factsOf(unconfirmed)['disposal-authority'], 'missing');
  assert.match(unconfirmed.facts.find(fact => fact.key === 'disposal-authority').detail, /not confirmed/);
  assert.equal(factsOf(unconfirmed)['transferring-office'], 'missing');
  assert.equal(factsOf(paperworkReadiness(paperwork, sf135, caseWith({ schedule: null }), asOf))['disposal-authority'], 'missing');

  // A stored due date in the past is overdue until a person records that the agency filed it.
  assert.equal(paperworkReadiness({ ...paperwork, dueDate: '2026-11-01' }, sf135, item, asOf).overdue, true);
  assert.equal(paperworkReadiness({ ...paperwork, dueDate: '2026-11-01', status: 'filed-by-agency' }, sf135, item, asOf).overdue, false);
  assert.equal(paperworkReadiness({ ...paperwork, dueDate: null }, sf135, item, asOf).overdue, false);

  // Catalog-only entries are listed and dated. Nothing is counted for them.
  const listed = paperworkReadiness({ id: 'P-2', paperworkId: 'PW-RMSA', recordId: null, status: 'not-started', dueDate: null, reference: null, facts: {} }, entryOf(catalog, 'PW-RMSA'), item, asOf);
  assert.deepEqual([listed.state, listed.required, listed.facts.length], ['not-tracked', 0, 0]);
});

test('changes: people set facts and status, a hold cannot be typed away, and filing needs a reference', async () => {
  const catalog = await shipped();
  const item = caseWith();
  const added = newPaperworkItem({ expectedRevision: 0, paperworkId: 'PW-SF135', recordId: 'R-1', dueDate: '2026-12-01', note }, item, catalog, context);
  assert.deepEqual([added.paperwork.id, added.paperwork.status, added.paperwork.dueDate, added.paperwork.reference], ['P-1', 'not-started', '2026-12-01', null]);
  assert.deepEqual(paperworkStatuses, ['not-started', 'drafting', 'ready-for-signature', 'filed-by-agency']);
  assert.throws(() => newPaperworkItem({ expectedRevision: 0, paperworkId: 'PW-SF135', note }, item, catalog, context), /record/, 'a transmittal is about one record');
  assert.throws(() => newPaperworkItem({ expectedRevision: 0, paperworkId: 'PW-SF135', recordId: 'R-9', note }, item, catalog, context), /Record not found/);
  assert.throws(() => newPaperworkItem({ expectedRevision: 0, paperworkId: 'PW-NOPE', note }, item, catalog, context), /not in the catalog/);
  assert.throws(() => newPaperworkItem({ expectedRevision: 0, paperworkId: 'PW-RMSA', dueDate: '2026-02-30', note }, item, catalog, context), /date/);
  assert.throws(() => newPaperworkItem({ expectedRevision: 0, paperworkId: 'PW-RMSA', note: 'short' }, item, catalog, context), /note/);

  const withItem = { ...item, paperwork: [added.paperwork] };
  const change = input => changePaperworkItem({ expectedRevision: 0, note, ...input }, withItem, catalog, 'P-1', context);
  assert.throws(() => change({ facts: { 'no-active-hold': 'yes' } }), /hold review/, 'the hold fact comes only from the record');
  assert.throws(() => change({ facts: { 'made-up': 'value' } }), /not a fact/);
  assert.throws(() => change({ status: 'ready-for-signature' }), /3 required facts/, 'not ready while facts are missing');
  assert.throws(() => change({ status: 'filed-by-agency' }), /reference/);
  assert.throws(() => change({ status: 'approved' }), /status/);
  assert.throws(() => change({}), /Provide a change/);

  const filled = change({ status: 'drafting', facts: { 'inclusive-dates': ' 2020-01-01 to 2020-12-31 ', volume: '4 cubic feet', 'receiving-center': 'Example records center' } });
  assert.deepEqual(filled.paperwork.facts.volume, { value: '4 cubic feet', origin: 'manual', by: 'local-demo-operator', at: context.now });
  assert.equal(filled.paperwork.facts['inclusive-dates'].value, '2020-01-01 to 2020-12-31');
  assert.equal(filled.change.before.status, 'not-started'); assert.equal(filled.change.after.status, 'drafting');

  const ready = changePaperworkItem({ expectedRevision: 0, note, status: 'ready-for-signature' }, { ...item, paperwork: [filled.paperwork] }, catalog, 'P-1', context);
  assert.equal(ready.paperwork.status, 'ready-for-signature');
  const filed = changePaperworkItem({ expectedRevision: 0, note, status: 'filed-by-agency', reference: 'Synthetic transmittal receipt 2026-0001' }, { ...item, paperwork: [ready.paperwork] }, catalog, 'P-1', context);
  assert.deepEqual([filed.paperwork.status, filed.paperwork.reference], ['filed-by-agency', 'Synthetic transmittal receipt 2026-0001']);
  assert.throws(() => changePaperworkItem({ expectedRevision: 0, note, reference: null }, { ...item, paperwork: [filed.paperwork] }, catalog, 'P-1', context), /reference/, 'a filed item keeps its reference');

  // With an active hold, the same complete item cannot move forward.
  const heldCase = { ...caseWith({ hold: 'active' }), paperwork: [filled.paperwork] };
  assert.throws(() => changePaperworkItem({ expectedRevision: 0, note, status: 'ready-for-signature' }, heldCase, catalog, 'P-1', context), /active hold/);
  assert.throws(() => changePaperworkItem({ expectedRevision: 0, note, status: 'filed-by-agency', reference: 'Synthetic receipt' }, heldCase, catalog, 'P-1', context), /active hold/);

  // Typed facts: a date must be a real date, and completion evidence must be a reference on this case.
  const cap = newPaperworkItem({ expectedRevision: 0, paperworkId: 'PW-A50-CAP', note }, item, catalog, { ...context, id: 'P-2' }).paperwork;
  const capCase = { ...item, paperwork: [cap] };
  const capChange = facts => changePaperworkItem({ expectedRevision: 0, note, facts }, capCase, catalog, 'P-2', context);
  assert.throws(() => capChange({ 'management-decision-date': 'next week' }), /date/);
  assert.throws(() => capChange({ 'completion-evidence': 'E-9' }), /evidence reference on this case/);
  const linked = capChange({ 'completion-evidence': 'E-2', 'management-decision-date': '2026-10-01' }).paperwork;
  const pending = paperworkReadiness(linked, entryOf(catalog, 'PW-A50-CAP'), capCase, asOf);
  assert.equal(factsOf(pending)['completion-evidence'], 'missing', 'an unverified reference is not completion evidence');
  assert.match(pending.facts.find(fact => fact.key === 'completion-evidence').detail, /not been verified/);
  assert.equal(factsOf(paperworkReadiness(capChange({ 'completion-evidence': 'E-1' }).paperwork, entryOf(catalog, 'PW-A50-CAP'), capCase, asOf))['completion-evidence'], 'present');
  // Clearing a fact removes it.
  assert.equal('management-decision-date' in changePaperworkItem({ expectedRevision: 0, note, facts: { 'management-decision-date': null } }, { ...item, paperwork: [linked] }, catalog, 'P-2', context).paperwork.facts, false);
});

test('profiles: a check set may suggest paperwork, and every shipped preset names catalog entries only', async () => {
  const catalog = await shipped();
  const base = { organization: { name: 'Example office', kind: 'agency' }, sources: [], checkSet: { id: 'example-set', name: 'Example', checks: [{ kind: 'plan', title: 'Plan', sourceIds: ['far-4.805'] }], policySourceIds: ['far-4.805'], recordsSourceIds: ['far-4.805'] } };
  const withList = list => validateProfile({ ...base, checkSet: { ...base.checkSet, paperwork: list } }, ['far-4.805']);
  assert.deepEqual(withList(['PW-SF135', 'PW-A50-CAP']).checkSet.paperwork, ['PW-SF135', 'PW-A50-CAP']);
  assert.equal('paperwork' in validateProfile(base, ['far-4.805']).checkSet, false, 'absent when omitted');
  assert.throws(() => withList(['sf135']), /paperwork/);
  assert.throws(() => withList(['PW-SF135', 'PW-SF135']), /repeat/);

  const presets = JSON.parse(await readFile(new URL('../data/profile-presets.json', import.meta.url), 'utf8')).presets;
  const ids = catalog.map(entry => entry.id);
  for (const preset of presets) for (const id of preset.profile.checkSet.paperwork ?? []) assert.ok(ids.includes(id), `${preset.id} suggests ${id}`);
  assert.deepEqual(presets.find(preset => preset.id === 'va-system-delivery').profile.checkSet.paperwork, ['PW-SF135', 'PW-NA13001', 'PW-A50-CAP']);
  assert.deepEqual(presets.find(preset => preset.id === 'ssa-system-delivery').profile.checkSet.paperwork, ['PW-A50-CAP', 'PW-SAORM', 'PW-RMSA', 'PW-FEREM']);
});

test('paperwork API: add, fill, block on a hold, file with a reference, and print a draft worksheet', async t => {
  const { call, revisionOf } = await workspace(t);

  const listing = await call('/api/paperwork');
  assert.equal(listing.status, 200);
  assert.equal(listing.body.catalog.length, 24);
  assert.deepEqual(listing.body.enums.status, paperworkStatuses);
  assert.match(listing.body.limitation, /never submits/);

  // DEMO-VA-003 holds REC-003: schedule confirmed, no hold.
  const empty = await call('/api/cases/DEMO-VA-003/paperwork');
  assert.deepEqual([empty.status, empty.body.items.length, empty.body.suggested.length], [200, 0, 0]);
  const revision = empty.body.caseRevision;

  assert.equal((await call('/api/cases/DEMO-VA-003/paperwork', { expectedRevision: revision + 5, paperworkId: 'PW-SF135', recordId: 'REC-003', note })).status, 409);
  assert.equal((await call('/api/cases/DEMO-VA-003/paperwork', { expectedRevision: revision, paperworkId: 'PW-NOPE', note })).status, 400);
  assert.equal((await call('/api/cases/NOPE/paperwork', { expectedRevision: 0, paperworkId: 'PW-SF135', note })).status, 404);

  const added = await call('/api/cases/DEMO-VA-003/paperwork', { expectedRevision: revision, paperworkId: 'PW-SF135', recordId: 'REC-003', dueDate: '2026-11-01', note }, 'paperwork-add-1');
  assert.equal(added.status, 201);
  const id = added.body.item.id;
  assert.deepEqual([added.body.item.readiness.present, added.body.item.readiness.required, added.body.item.readiness.state, added.body.item.readiness.overdue], [3, 7, 'incomplete', true]);
  assert.equal(added.body.item.entry.title, 'Records Transmittal and Receipt');
  assert.equal(added.body.case.revision, revision + 1);
  // The same key and body return the same answer and add nothing.
  const retried = await call('/api/cases/DEMO-VA-003/paperwork', { expectedRevision: revision, paperworkId: 'PW-SF135', recordId: 'REC-003', dueDate: '2026-11-01', note }, 'paperwork-add-1');
  assert.equal(retried.body.item.id, id);
  assert.equal((await call('/api/cases/DEMO-VA-003/paperwork')).body.items.length, 1);

  const path = `/api/cases/DEMO-VA-003/paperwork/${id}`;
  assert.equal((await call(path, { expectedRevision: await revisionOf('DEMO-VA-003'), note, status: 'ready-for-signature' })).status, 409);
  assert.equal((await call(path, { expectedRevision: await revisionOf('DEMO-VA-003'), note, facts: { 'no-active-hold': 'none' } })).status, 400);
  const filled = await call(path, { expectedRevision: await revisionOf('DEMO-VA-003'), note, status: 'drafting', facts: { 'transferring-office': 'Example contracting office', 'inclusive-dates': '2020-01-01 to 2020-12-31', volume: '4 cubic feet', 'receiving-center': 'Example records center' } });
  assert.deepEqual([filled.status, filled.body.item.readiness.state, filled.body.item.readiness.present], [200, 'facts-complete', 7]);
  assert.equal(filled.body.item.readiness.facts.find(fact => fact.key === 'transferring-office').origin, 'manual');

  assert.equal((await call(path, { expectedRevision: await revisionOf('DEMO-VA-003'), note, status: 'ready-for-signature' })).status, 200);
  const unreferenced = await call(path, { expectedRevision: await revisionOf('DEMO-VA-003'), note, status: 'filed-by-agency' });
  assert.equal(unreferenced.status, 400); assert.match(unreferenced.body.error, /reference/);
  const filed = await call(path, { expectedRevision: await revisionOf('DEMO-VA-003'), note, status: 'filed-by-agency', reference: 'Synthetic transmittal receipt 2026-0001' });
  assert.deepEqual([filed.status, filed.body.item.status, filed.body.item.readiness.overdue], [200, 'filed-by-agency', false]);

  const worksheet = await call(`${path}/worksheet`);
  assert.equal(worksheet.status, 200);
  assert.equal(worksheet.body.worksheet.label, 'Draft worksheet. Not an official form. Not submitted.');
  assert.equal(worksheet.body.worksheet.rows.length, 7);
  assert.equal(worksheet.body.worksheet.rows.find(row => row.key === 'volume').value, '4 cubic feet');
  assert.equal((await call(`${path}/worksheet`, {})).status, 405);
  assert.equal((await call('/api/cases/DEMO-VA-003/paperwork/NOPE')).status, 404);

  // DEMO-VA-001 holds REC-001 under an active hold. Its disposal notice cannot move forward.
  const heldRevision = await revisionOf('DEMO-VA-001');
  const notice = await call('/api/cases/DEMO-VA-001/paperwork', { expectedRevision: heldRevision, paperworkId: 'PW-NA13001', recordId: 'REC-001', note });
  assert.deepEqual([notice.status, notice.body.item.readiness.state], [201, 'blocked']);
  const noticePath = `/api/cases/DEMO-VA-001/paperwork/${notice.body.item.id}`;
  for (const body of [{ status: 'ready-for-signature' }, { status: 'filed-by-agency', reference: 'Synthetic response 2026-0002' }]) {
    const refused = await call(noticePath, { expectedRevision: await revisionOf('DEMO-VA-001'), note, ...body });
    assert.equal(refused.status, 409); assert.match(refused.body.error, /active hold/);
  }
  const summary = (await call('/api/cases/DEMO-VA-001/paperwork')).body.summary;
  assert.deepEqual([summary.total, summary.blocked], [1, 1]);

  // History records who changed what, and the rest of the case is untouched.
  const state = (await call('/api/workspace')).body;
  const events = state.events.filter(event => event.action.startsWith('paperwork-'));
  assert.deepEqual([...new Set(events.map(event => event.action))].sort(), ['paperwork-added', 'paperwork-changed']);
  assert.equal(events.at(-1).details.change.note, note);
  const report = (await call('/api/cases/DEMO-VA-001/report')).body;
  assert.ok(report.records.every(row => row.retention.canDestroy === false));
  assert.equal(state.cases.find(item => item.id === 'DEMO-VA-001').records[0].hold, 'active', 'paperwork never changes a hold');
});

test('paperwork API: a case created from a preset is offered that preset\'s paperwork', async t => {
  const { call } = await workspace(t);
  const preset = (await call('/api/profile-presets/va-system-delivery')).body.profile;
  assert.equal((await call('/api/profile', { profile: preset, note })).status, 200);
  const created = await call('/api/cases', { title: 'Synthetic delivery case', owner: 'Demo analyst', note });
  assert.equal(created.status, 201);
  const view = (await call(`/api/cases/${created.body.case.id}/paperwork`)).body;
  assert.deepEqual(view.suggested.map(entry => entry.id), ['PW-SF135', 'PW-NA13001', 'PW-A50-CAP']);
  const added = await call(`/api/cases/${created.body.case.id}/paperwork`, { expectedRevision: view.caseRevision, paperworkId: 'PW-A50-CAP', note });
  assert.equal(added.status, 201);
  assert.deepEqual((await call(`/api/cases/${created.body.case.id}/paperwork`)).body.suggested.map(entry => entry.id), ['PW-SF135', 'PW-NA13001']);
});

test('paperwork API: one list across cases, and due dates a person entered show in planning', async t => {
  const { call, revisionOf } = await workspace(t);
  const empty = await call('/api/paperwork/items');
  assert.deepEqual([empty.status, empty.body.items.length, empty.body.summary.total], [200, 0, 0]);
  assert.equal((await call('/api/paperwork/items', {})).status, 405);

  const add = async (caseId, body) => (await call(`/api/cases/${caseId}/paperwork`, { expectedRevision: await revisionOf(caseId), note, ...body })).body.item;
  const rmsa = await add('DEMO-VA-002', { paperworkId: 'PW-RMSA', dueDate: '2026-11-01' });
  await add('DEMO-VA-002', { paperworkId: 'PW-SAORM', dueDate: '2027-05-15' });
  await add('DEMO-VA-002', { paperworkId: 'PW-FEREM' });
  await add('DEMO-VA-003', { paperworkId: 'PW-SF135', recordId: 'REC-003' });

  const all = (await call('/api/paperwork/items')).body;
  assert.deepEqual(all.items.map(item => [item.caseId, item.paperworkId]), [['DEMO-VA-002', 'PW-RMSA'], ['DEMO-VA-002', 'PW-SAORM'], ['DEMO-VA-002', 'PW-FEREM'], ['DEMO-VA-003', 'PW-SF135']]);
  assert.equal(all.items[0].caseTitle, 'Facilities maintenance support');
  assert.deepEqual([all.summary.total, all.summary.overdue, all.summary.notTracked, all.summary.incomplete], [4, 1, 3, 1]);
  assert.match(all.limitation, /never submits/);

  const planning = (await call('/api/planning?caseId=DEMO-VA-002')).body;
  const dated = planning.dated.filter(entry => entry.type === 'paperwork');
  assert.deepEqual(dated.map(entry => [entry.date, entry.past, entry.section]), [['2026-11-01', true, 'paperwork'], ['2027-05-15', false, 'paperwork']]);
  assert.match(dated[0].title, /Records Management Self-Assessment/);
  assert.match(dated[0].note, /past its stored due date/);
  assert.deepEqual(planning.undated.filter(entry => entry.type === 'paperwork').map(entry => entry.note), ['Open paperwork with no due date.']);
  assert.match(planning.limitation, /paperwork due dates a person entered/);

  // Once a person records that the agency filed it, it leaves the planning view.
  assert.equal((await call(`/api/cases/DEMO-VA-002/paperwork/${rmsa.id}`, { expectedRevision: await revisionOf('DEMO-VA-002'), note, status: 'filed-by-agency', reference: 'Synthetic survey receipt 2026-0003' })).status, 200);
  assert.deepEqual((await call('/api/planning?caseId=DEMO-VA-002')).body.dated.filter(entry => entry.type === 'paperwork').map(entry => entry.date), ['2027-05-15']);
});

test('safeguards: a status that no longer matches the facts is flagged, and complete facts never mean compliance or disposal', async t => {
  const catalog = await shipped();
  const sf135 = entryOf(catalog, 'PW-SF135');
  const facts = { 'inclusive-dates': { value: '2020', origin: 'manual' }, volume: { value: '4', origin: 'manual' }, 'receiving-center': { value: 'Center', origin: 'manual' } };
  const ready = { id: 'P-1', paperworkId: 'PW-SF135', recordId: 'R-1', status: 'ready-for-signature', dueDate: null, reference: null, facts };
  assert.equal(paperworkReadiness(ready, sf135, caseWith(), asOf).attention, null);
  assert.equal(paperworkReadiness({ ...ready, status: 'drafting' }, sf135, caseWith({ hold: 'active' }), asOf).attention, null, 'a draft under a hold is simply blocked');
  // A hold placed after the item was marked ready, or filed, is called out.
  assert.match(paperworkReadiness(ready, sf135, caseWith({ hold: 'active' }), asOf).attention, /Marked ready for signature.*active hold/);
  assert.match(paperworkReadiness({ ...ready, status: 'filed-by-agency', reference: 'Receipt' }, sf135, caseWith({ hold: 'active' }), asOf).attention, /Recorded as filed.*active hold/);
  // So is a fact that went away, such as a schedule that is no longer confirmed.
  assert.match(paperworkReadiness(ready, sf135, caseWith({ schedule: null }), asOf).attention, /Marked ready for signature.*no longer on file/);

  const { call } = await workspace(t);
  const listing = (await call('/api/paperwork')).body;
  assert.match(listing.limitation, /does not establish compliance and does not authorize disposal/);
  // Read routes refuse parameters they do not know, like the rest of the API.
  for (const path of ['/api/paperwork?verdict=pass', '/api/paperwork/items?caseId=DEMO-VA-001', '/api/cases/DEMO-VA-001/paperwork?include=all', '/api/reader-samples?x=1', '/api/cases/DEMO-VA-001/reader-outputs?x=1']) assert.equal((await call(path)).status, 400, path);
});
