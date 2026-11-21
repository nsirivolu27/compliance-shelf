import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { validateCatalog, paperworkReadiness, changePaperworkItem } from '../src/lib/core/paperwork.ts';
import { benefitPrograms } from '../src/lib/core/benefits.ts';
import { parseReaderOutput } from '../src/lib/core/reader.ts';
const note = 'Synthetic intake review for the benefits demonstration.';
const file = async name => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cp-benefits-'));
  const server = await createApp({ stateFile: join(directory, 'workspace.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, key) => {
    const response = await fetch(origin + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { call };
}

test('benefits directory uses seven source-linked programs and does not infer eligibility from worksheet counts', async () => {
  const raw = await file('paperwork-catalog.json');
  const catalog = validateCatalog(raw);
  const programs = benefitPrograms(catalog, []);
  assert.equal(programs.length, 7);
  assert.equal(benefitPrograms(catalog, [], { agency: 'ssa' }).length, 4);
  assert.equal(benefitPrograms(catalog, [], { agency: 'va', q: 'PENSION' }).length, 2);
  assert.equal(benefitPrograms(catalog, [], { q: 'retirement intake team' })[0].programId, 'ssa-retirement');
  assert.equal(benefitPrograms(catalog, [], { q: '21-526ez' })[0].programId, 'va-disability');
  assert.equal(benefitPrograms(catalog, [], { q: 'no-matching-program' }).length, 0);
  assert.throws(() => benefitPrograms(catalog, [], { agency: 'other' }), /agency/);
  assert.throws(() => benefitPrograms(catalog, [], { q: 'x'.repeat(201) }), /q/);
  const sources = await file('sources.json');
  for (const program of programs) {
    const entry = program.paperwork;
    assert.equal(sources.find(source => source.id === program.sourceId).url, entry.sourceUrl);
    const sample = await file(`reader-samples/${program.sampleId}.sample.json`);
    assert.equal(sample.source, 'shape-sample');
    const parsed = parseReaderOutput(sample.output);
    assert.deepEqual(parsed.candidates.map(candidate => candidate.label), entry.requiredFacts.map(fact => fact.label));
    assert(parsed.candidates.every(candidate => candidate.confidence === null), 'handwritten samples claim no OCR confidence');
    assert.equal(program.eligibility, 'not-assessed');
    assert.equal(program.fundingDecision, 'not-performed');
  }
  assert(catalog.filter(entry => !entry.benefit).every(entry => !Object.hasOwn(entry, 'benefit')), 'legacy entries get no metadata defaults');
  const entry = structuredClone(raw.entries.find(entry => entry.benefit));
  for (const mutation of [x => x.benefit.team = '', x => x.benefit.programId = '../bad', x => x.benefit.guidanceUrl = 'https://example.com/', x => x.scope = 'government-wide', x => x.benefit.extra = true, x => delete x.benefit]) {
    const bad = structuredClone(entry); mutation(bad);
    assert.throws(() => validateCatalog({ entries: [bad] }));
  }
  assert.throws(() => validateCatalog({ entries: [entry, { ...entry, id: 'PW-DUPLICATE' }] }), /repeated/);
});

test('benefits reads are additive, filtered, validated and create no state or audit events', async t => {
  const { call } = await workspace(t);
  const before = (await call('/api/workspace')).body;
  assert.deepEqual(Object.keys((await call('/api/cases')).body), ['cases']);
  const response = await call('/api/benefits?agency=ssa&q=retirement');
  assert.equal(response.status, 200);
  assert.equal(response.body.programs.length, 1);
  assert.equal(response.body.programs[0].programId, 'ssa-retirement');
  for (const query of ['agency=nope', 'limit=2', 'q=' + 'a'.repeat(201), 'agency=va&agency=ssa', 'asOf=not-a-date']) assert.equal((await call('/api/benefits?' + query)).status, 400, query);
  assert.equal((await call('/api/benefits', {})).status, 405);
  assert.equal((await call('/api/benefits?q=zzzz')).body.programs.length, 0);
  assert.deepEqual((await call('/api/workspace')).body, before);
});

test('an optionally linked benefits record keeps active and unknown holds unresolved', async () => {
  const entry = validateCatalog(await file('paperwork-catalog.json')).find(entry => entry.benefit);
  const worksheet = { id: 'P-1', paperworkId: entry.id, recordId: 'R-1', status: 'not-started', facts: Object.fromEntries(entry.requiredFacts.map(fact => [fact.key, { value: 'Synthetic reference', origin: 'manual' }])) };
  const item = { paperwork: [worksheet], records: [{ id: 'R-1', hold: 'active' }] };
  assert.equal(paperworkReadiness(worksheet, entry, item, '2026-11-19').state, 'blocked');
  assert.throws(() => changePaperworkItem({ status: 'ready-for-signature', note }, item, [entry], 'P-1', { now: '2026-11-19T12:00:00Z', actor: 'local-demo-operator', asOf: '2026-11-19' }), error => error.status === 409);
  item.records[0].hold = 'unknown';
  const unknown = paperworkReadiness(worksheet, entry, item, '2026-11-19');
  assert.equal(unknown.state, 'incomplete'); assert.equal(unknown.required, 5);
  assert.equal(unknown.facts.find(fact => fact.key === 'no-active-hold').state, 'missing');
});

test('each benefits worksheet uses audited revision-safe reader acceptance; imports and complete facts never decide benefits', async t => {
  const { call } = await workspace(t);
  const caseId = 'DEMO-VA-003', path = `/api/cases/${caseId}`;
  const initial = (await call('/api/workspace')).body.cases.find(item => item.id === caseId);
  const revision = async () => (await call(path + '/paperwork')).body.caseRevision;
  const programs = (await call('/api/benefits')).body.programs;
  for (const program of programs) {
    const payload = { expectedRevision: await revision(), paperworkId: program.paperwork.id, note };
    assert.equal((await call(path + '/paperwork', { ...payload, note: 'bad' })).status, 400);
    assert.equal((await call(path + '/paperwork', { ...payload, dueDate: '2026-02-30' })).status, 400);
    const added = await call(path + '/paperwork', payload, program.programId);
    assert.equal(added.status, 201);
    assert.equal(added.body.item.readiness.present, 0);
    assert.deepEqual((await call(path + '/paperwork', payload, program.programId)).body, added.body, 'receipt replays exact response');
    const conflict = await call(path + '/paperwork', payload, program.programId + '-stale');
    assert.equal(conflict.status, 409); assert.equal(conflict.body.currentRevision, await revision());
    const itemId = added.body.item.id;
    assert.equal((await call(`${path}/paperwork/${itemId}`, { expectedRevision: await revision(), status: 'ready-for-signature', note })).status, 409);
    const sample = (await call('/api/reader-samples/' + program.sampleId)).body.sample;
    const request = { expectedRevision: await revision(), title: sample.title, service: sample.service, source: sample.source, synthetic: true, note, output: sample.output };
    assert.equal((await call(path + '/reader-outputs', { ...request, synthetic: false })).status, 400);
    const imported = await call(path + '/reader-outputs', request, program.programId + '-reader');
    assert.equal(imported.status, 201);
    assert.equal((await call(`${path}/paperwork/${itemId}`)).body.item.readiness.present, 0);
    for (const [index, candidate] of imported.body.output.candidates.entries()) {
      const target = { itemId, factKey: program.paperwork.requiredFacts[index].key };
      const decisionPath = `${path}/reader-outputs/${imported.body.output.id}/candidates/${candidate.id}`;
      const decision = { expectedRevision: await revision(), decision: 'accept', target, note };
      assert.equal((await call(decisionPath, { ...decision, target: { itemId, factKey: 'invented' } })).status, 400);
      const accepted = await call(decisionPath, decision, `${program.programId}-${index}`);
      assert.equal(accepted.status, 200);
      assert.equal((await call(decisionPath, decision, `${program.programId}-${index}-stale`)).status, 409);
    }
    const item = (await call(`${path}/paperwork/${itemId}`)).body.item;
    assert.equal(item.readiness.present, 4);
    assert.equal(item.status, 'not-started');
    assert(item.readiness.facts.every(fact => fact.origin === 'reader'));
    const view = (await call(`/api/benefits?q=${program.programId === 'ssa-ssi' ? 'SSA-8000-BK' : program.paperwork.formNumber}`)).body.programs.find(row => row.programId === program.programId);
    assert.deepEqual([view.counts.tracked, view.counts.missingIntakeFacts, view.eligibility, view.fundingDecision], [1, 0, 'not-assessed', 'not-performed']);
    assert.match((await call(`${path}/paperwork/${itemId}/worksheet`)).body.worksheet.limitation, /not a complete official application/);
  }
  const after = (await call('/api/workspace')).body;
  const current = after.cases.find(item => item.id === caseId);
  for (const key of ['records', 'applicability', 'evidence', 'tasks']) assert.deepEqual(current[key], initial[key], `${key} unchanged`);
  const events = after.events.filter(event => ['paperwork-added', 'reader-output-imported', 'reader-candidate-decided'].includes(event.action));
  assert.equal(events.length, 42);
  assert(events.every(event => event.result?.change || event.change || event.details), 'events retain audit details');
});
