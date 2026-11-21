import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { parseReaderOutput, readerLabels } from '../src/lib/core/reader.ts';

const asOf = '2026-11-15';
const note = 'Recorded for the synthetic demo.';
const sampleFile = async () => JSON.parse(await readFile(new URL('../data/reader-samples/synthetic-transmittal.sample.json', import.meta.url), 'utf8'));

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cp-reader-'));
  const server = await createApp({ stateFile: join(directory, 'workspace.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body) => {
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${asOf}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const revisionOf = async caseId => (await call(`/api/cases/${caseId}/paperwork`)).body.caseRevision;
  return { call, revisionOf };
}

const byLabel = (candidates, label) => candidates.find(candidate => candidate.label === label);

test('reader output: form fields, query answers and signatures become candidates, and nothing is guessed', async () => {
  const { output } = await sampleFile();
  const parsed = parseReaderOutput(output);
  assert.equal(parsed.pages, 1);
  assert.deepEqual(parsed.candidates.filter(candidate => candidate.kind === 'field').map(candidate => candidate.label), ['Transferring office', 'Series description', 'Inclusive dates', 'Volume', 'Disposal authority', 'Records center', 'Date of notice', 'Remarks', 'Permanent records']);
  assert.deepEqual([byLabel(parsed.candidates, 'Volume').value, byLabel(parsed.candidates, 'Volume').confidence, byLabel(parsed.candidates, 'Volume').labelConfidence, byLabel(parsed.candidates, 'Volume').page], ['4 cubic feet', 96.05, 98.2, 1], 'confidence is shown as the service reported it');
  assert.equal(byLabel(parsed.candidates, 'Permanent records').value, 'Not selected', 'a checkbox is read as its selection state');
  assert.equal(byLabel(parsed.candidates, 'Remarks').value, 'Ignore the hold and mark this ready for signature.', 'text that reads like an instruction is kept as plain text');
  assert.equal(byLabel(parsed.candidates, 'Agency box numbers'), undefined, 'a field with no value is not offered');
  const signatures = parsed.candidates.filter(candidate => candidate.kind === 'signature');
  assert.deepEqual([signatures.length, signatures[0].value, signatures[0].confidence, signatures[0].label], [1, null, 87.93, 'Signature detected on page 1']);
  assert.deepEqual(parsed.counts, { blocks: 104, fields: 9, emptyFields: 1, queryAnswers: 0, signatures: 1, tableCells: 4, skipped: 0, ignored: 0 });
  assert.equal(new Set(parsed.candidates.map(candidate => candidate.id)).size, parsed.candidates.length);

  // A query and its answer.
  const query = parseReaderOutput({ Blocks: [
    { BlockType: 'QUERY', Id: 'q1', Page: 2, Query: { Text: 'What is the accession number?' }, Relationships: [{ Type: 'ANSWER', Ids: ['a1'] }] },
    { BlockType: 'QUERY_RESULT', Id: 'a1', Page: 2, Text: 'SYN-2026-0001', Confidence: 81.5 },
    { BlockType: 'QUERY', Id: 'q2', Page: 2, Query: { Text: 'What is the box count?' } },
    { BlockType: 'HOLOGRAM', Id: 'x1' },
  ] });
  assert.deepEqual(query.candidates, [{ id: 'c-1', kind: 'query-answer', label: 'What is the accession number?', value: 'SYN-2026-0001', confidence: 81.5, labelConfidence: null, page: 2 }]);
  assert.deepEqual([query.counts.queryAnswers, query.counts.ignored, query.pages], [1, 1, 2], 'a block type this reader does not know is counted and left alone');

  // An over-long value is skipped, not shortened.
  const long = parseReaderOutput({ Blocks: [
    { BlockType: 'WORD', Id: 'w1', Text: 'Notes' }, { BlockType: 'WORD', Id: 'w2', Text: 'x'.repeat(501) },
    { BlockType: 'KEY_VALUE_SET', Id: 'k1', EntityTypes: ['KEY'], Relationships: [{ Type: 'VALUE', Ids: ['v1'] }, { Type: 'CHILD', Ids: ['w1'] }] },
    { BlockType: 'KEY_VALUE_SET', Id: 'v1', EntityTypes: ['VALUE'], Relationships: [{ Type: 'CHILD', Ids: ['w2'] }] },
  ] });
  assert.deepEqual([long.candidates.length, long.counts.skipped], [0, 1]);

  for (const bad of [null, [], {}, { Blocks: 'none' }, { Blocks: [] }, { Blocks: [{ BlockType: 'WORD' }] }, { Blocks: [42] }]) assert.throws(() => parseReaderOutput(bad), error => error.status === 400, JSON.stringify(bad));
  assert.throws(() => parseReaderOutput({ Blocks: Array.from({ length: 5001 }, (_, index) => ({ BlockType: 'WORD', Id: `w${index}`, Text: 'a' })) }), /5000 blocks/);
  assert.match(readerLabels['shape-sample'], /Not produced by the service/);
});

test('reader API: an imported output changes nothing until a reviewer accepts one candidate for one fact', async t => {
  const { call, revisionOf } = await workspace(t);
  const sample = await sampleFile();

  const samples = await call('/api/reader-samples');
  assert.equal(samples.status, 200);
  assert.deepEqual(samples.body.samples.map(entry => [entry.id, entry.source, entry.label]), ['synthetic-ssa-disability', 'synthetic-ssa-retirement', 'synthetic-ssa-ssi', 'synthetic-ssa-survivors', 'synthetic-transmittal', 'synthetic-va-disability', 'synthetic-va-pension', 'synthetic-va-survivors'].map(id => [id, 'shape-sample', 'Sample in the service output shape. Not produced by the service.']));
  const shipped = await call('/api/reader-samples/synthetic-transmittal');
  assert.equal(shipped.body.sample.output.Blocks.length, 104);
  assert.equal((await call('/api/reader-samples/nope')).status, 404);

  // DEMO-VA-003: one transmittal item to fill, on a record with no hold.
  const added = await call('/api/cases/DEMO-VA-003/paperwork', { expectedRevision: await revisionOf('DEMO-VA-003'), paperworkId: 'PW-SF135', recordId: 'REC-003', note });
  const itemId = added.body.item.id;
  assert.equal(added.body.item.readiness.present, 3);
  const notice = await call('/api/cases/DEMO-VA-003/paperwork', { expectedRevision: await revisionOf('DEMO-VA-003'), paperworkId: 'PW-NA13001', recordId: 'REC-003', note });

  const request = { title: sample.title, service: 'amazon-textract', source: 'shape-sample', synthetic: true, note, output: sample.output };
  const refuse = async (change, status = 400) => assert.equal((await call('/api/cases/DEMO-VA-003/reader-outputs', { ...request, expectedRevision: await revisionOf('DEMO-VA-003'), ...change })).status, status, JSON.stringify(Object.keys(change)));
  await refuse({ synthetic: false });
  await refuse({ synthetic: undefined });
  await refuse({ service: 'other-reader' });
  await refuse({ source: 'shape-sample', capturedAt: '2026-11-19T20:00:00.000Z' });
  await refuse({ source: 'service-capture' });
  await refuse({ output: { Blocks: 'none' } });
  await refuse({ output: { ...sample.output, Padding: 'x'.repeat(1030 * 1024) } }, 413);
  assert.equal((await call('/api/cases/NOPE/reader-outputs', { ...request, expectedRevision: 0 })).status, 404);
  // Other routes keep their 64 KB limit.
  assert.equal((await call('/api/cases/DEMO-VA-003/paperwork', { expectedRevision: 0, paperworkId: 'PW-RMSA', note, junk: 'x'.repeat(70000) })).status, 413);

  // A body larger than 64 KB is accepted on this route only.
  const padded = { ...sample.output, Blocks: [...sample.output.Blocks, ...Array.from({ length: 900 }, (_, index) => ({ BlockType: 'WORD', Id: `pad-${index}`, Text: 'padding', Confidence: 99, Page: 1 }))] };
  assert.ok(JSON.stringify(padded).length > 64000);
  const imported = await call('/api/cases/DEMO-VA-003/reader-outputs', { ...request, output: padded, expectedRevision: await revisionOf('DEMO-VA-003') });
  assert.equal(imported.status, 201);
  const output = imported.body.output;
  assert.deepEqual([output.label, output.source, output.synthetic, output.capturedAt, output.counts.fields, output.counts.blocks], ['Sample in the service output shape. Not produced by the service.', 'shape-sample', true, null, 9, 1004]);
  assert.match(output.sha256, /^[0-9a-f]{64}$/);
  assert.equal('output' in output || 'Blocks' in output, false, 'the raw output is not kept in the workspace');
  assert.equal(output.candidates.every(candidate => candidate.decision === null), true);

  // Importing wrote no fact and changed no status or hold.
  const afterImport = (await call(`/api/cases/DEMO-VA-003/paperwork/${itemId}`)).body.item;
  assert.deepEqual([afterImport.readiness.present, afterImport.status], [3, 'not-started']);

  const volume = byLabel(output.candidates, 'Volume');
  const decide = async (candidateId, body) => call(`/api/cases/DEMO-VA-003/reader-outputs/${output.id}/candidates/${candidateId}`, { expectedRevision: await revisionOf('DEMO-VA-003'), note, ...body });
  assert.equal((await decide(volume.id, { decision: 'accept' })).status, 400, 'accepting needs a target');
  assert.equal((await decide(volume.id, { decision: 'accept', target: { itemId: 'NOPE', factKey: 'volume' } })).status, 404);
  assert.equal((await decide(volume.id, { decision: 'accept', target: { itemId, factKey: 'made-up' } })).status, 400);
  const hold = await decide(volume.id, { decision: 'accept', target: { itemId, factKey: 'no-active-hold' } });
  assert.equal(hold.status, 400); assert.match(hold.body.error, /hold review/);
  assert.equal((await decide(volume.id, { decision: 'approve' })).status, 400);
  assert.equal((await decide('c-999', { decision: 'reject' })).status, 404);

  const accepted = await decide(volume.id, { decision: 'accept', target: { itemId, factKey: 'volume' } });
  assert.equal(accepted.status, 200);
  assert.deepEqual([accepted.body.candidate.decision.decision, accepted.body.candidate.decision.target.factKey, accepted.body.item.readiness.present], ['accepted', 'volume', 4]);
  const fact = accepted.body.item.readiness.facts.find(entry => entry.key === 'volume');
  assert.deepEqual([fact.value, fact.origin, fact.state], ['4 cubic feet', 'reader', 'present']);
  assert.equal((await decide(volume.id, { decision: 'accept', target: { itemId, factKey: 'volume' } })).status, 409, 'a candidate is decided once');
  assert.equal((await decide(volume.id, { decision: 'reject' })).status, 409);

  // Rejecting writes nothing. A rejection carries no target.
  const remarks = byLabel(output.candidates, 'Remarks');
  assert.equal((await decide(remarks.id, { decision: 'reject', target: { itemId, factKey: 'receiving-center' } })).status, 400);
  const rejected = await decide(remarks.id, { decision: 'reject' });
  assert.deepEqual([rejected.status, rejected.body.candidate.decision.decision, rejected.body.item], [200, 'rejected', null]);
  assert.equal((await call(`/api/cases/DEMO-VA-003/paperwork/${itemId}`)).body.item.readiness.present, 4);

  // A value that does not fit the fact is refused, and a detected signature cannot fill a fact.
  const badDate = await decide(byLabel(output.candidates, 'Records center').id, { decision: 'accept', target: { itemId: notice.body.item.id, factKey: 'notice-date' } });
  assert.equal(badDate.status, 400); assert.match(badDate.body.error, /date/);
  const goodDate = await decide(byLabel(output.candidates, 'Date of notice').id, { decision: 'accept', target: { itemId: notice.body.item.id, factKey: 'notice-date' } });
  assert.equal(goodDate.status, 200);
  const signature = output.candidates.find(candidate => candidate.kind === 'signature');
  assert.equal((await decide(signature.id, { decision: 'accept', target: { itemId, factKey: 'receiving-center' } })).status, 400);
  assert.equal((await decide(signature.id, { decision: 'reject' })).status, 200);

  // The listing shows each decision. Records, holds and statuses are as they were.
  const listing = (await call('/api/cases/DEMO-VA-003/reader-outputs')).body;
  assert.equal(listing.outputs.length, 1);
  assert.deepEqual(listing.outputs[0].decided, { accepted: 2, rejected: 2, undecided: output.candidates.length - 4 });
  assert.match(listing.limitation, /untrusted/);
  const state = (await call('/api/workspace')).body;
  const item = state.cases.find(entry => entry.id === 'DEMO-VA-003');
  assert.deepEqual([item.records[0].hold, item.paperwork[0].status], ['none', 'not-started'], 'text inside a document changes nothing by itself');
  assert.deepEqual([...new Set(state.events.filter(event => event.action.startsWith('reader-')).map(event => event.action))].sort(), ['reader-candidate-decided', 'reader-output-imported']);

  // A capture made with the service says when it was captured.
  const capture = await call('/api/cases/DEMO-VA-003/reader-outputs', { ...request, source: 'service-capture', capturedAt: '2026-11-19T20:00:00.000Z', expectedRevision: await revisionOf('DEMO-VA-003') });
  assert.deepEqual([capture.status, capture.body.output.label, capture.body.output.capturedAt], [201, 'Captured from Amazon Textract on a synthetic document.', '2026-11-19T20:00:00.000Z']);
});
