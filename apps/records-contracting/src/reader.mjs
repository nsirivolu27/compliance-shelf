// Document reader intake: saved output from a reading service becomes candidate fields on a case.
// This application calls no reading service. A person runs the service, and its saved output is imported here.
// A candidate writes nothing until a reviewer accepts it for one fact on one paperwork item.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from './lib/core/canonical.ts';
import { newReaderOutput, decideCandidate, parseReaderOutput, readerLabels, readerServices, readerSources } from './lib/core/reader.ts';
import { acceptedFact } from './lib/core/paperwork.ts';
import { paperworkView } from './paperwork.mjs';

function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

/** Reader output is larger than other requests. The gateway allows the same 1 MiB. */
export const readerBodyLimit = 1024 * 1024;

const limitation = 'Reader output is untrusted data. Text found in a document is shown as text and is never followed as an instruction. A candidate is a suggestion from a reading service: it fills nothing until a reviewer accepts it for one fact, and a rejected or undecided candidate counts for nothing. Confidence is shown as the service reported it and is not part of any readiness count. Only synthetic documents may be imported. This application calls no reading service itself.';
const identityOf = trusted => (trusted
  ? { trusted: true, notice: 'Decisions are attributed to the signed-in identity.' }
  : { trusted: false, notice: 'Local demo: decisions are attributed to the local operator. No one has signed in, so a decision does not prove who made it.' });

/**
 * Sample outputs shipped in data/reader-samples. A file is either a described sample
 * ({ id, title, service, source, capturedAt, output }) or a raw AnalyzeDocument response saved by a person,
 * which is listed as a service capture dated by the file's modified time.
 * A file that cannot be read is reported in the listing instead of stopping the server.
 */
export async function readSamples(directory) {
  const samples = [], unreadable = [];
  let names = [];
  try { names = (await readdir(directory)).filter(name => name.endsWith('.json')).sort(); } catch { return { samples, unreadable }; }
  for (const name of names) {
    try {
      const path = join(directory, name);
      // Windows tools often write a byte order mark first. It is not part of the JSON.
      const parsed = JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''));
      const raw = Array.isArray(parsed?.Blocks);
      const sample = raw
        ? { id: name.replace(/\.json$/, ''), title: name, service: 'amazon-textract', source: 'service-capture', capturedAt: (await stat(path)).mtime.toISOString(), about: 'Saved reader output added by a person. The capture time shown is the time the file was last changed.', output: parsed }
        : { id: parsed.id, title: parsed.title, service: parsed.service, source: parsed.source, capturedAt: parsed.capturedAt ?? null, about: typeof parsed.about === 'string' ? parsed.about.slice(0, 1000) : '', output: parsed.output };
      if (typeof sample.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(sample.id) || samples.some(existing => existing.id === sample.id)) throw new Error('The sample id is missing, repeated, or not a plain file style name');
      if (typeof sample.title !== 'string' || !sample.title.trim() || sample.title.length > 200) throw new Error('The sample title is missing or too long');
      if (!readerServices.includes(sample.service) || !readerSources.includes(sample.source)) throw new Error('The sample service or source is not supported');
      const { counts, pages } = parseReaderOutput(sample.output);
      samples.push({ ...sample, label: readerLabels[sample.source], file: name, counts, pages });
    } catch (error) { unreadable.push({ file: name, reason: String(error.message).slice(0, 200) }); }
  }
  return { samples, unreadable };
}

const outputView = output => {
  const decided = state => output.candidates.filter(candidate => candidate.decision?.decision === state).length;
  return { ...output, decided: { accepted: decided('accepted'), rejected: decided('rejected'), undecided: output.candidates.filter(candidate => !candidate.decision).length } };
};

export async function handleReader({ pathname, method, searchParams = new URLSearchParams(), readBody, store, asOf, catalog, samples, actor, trusted }) {
  const known = pathname.startsWith('/api/reader-samples') || /^\/api\/cases\/[A-Za-z0-9_-]+\/reader-outputs(?:\/|$)/.test(pathname);
  if (known) for (const key of searchParams.keys()) if (key !== 'asOf') throw fail(`Unknown query parameter: ${key}`);
  if (pathname === '/api/reader-samples' || pathname.startsWith('/api/reader-samples/')) {
    if (method !== 'GET') throw fail('Method not allowed', 405);
    if (pathname === '/api/reader-samples') return { status: 200, body: { samples: samples.samples.map(({ output, ...summary }) => summary), unreadable: samples.unreadable, limitation } };
    const sample = samples.samples.find(entry => entry.id === pathname.slice('/api/reader-samples/'.length));
    if (!sample) throw fail('Sample not found', 404);
    return { status: 200, body: { sample, limitation } };
  }
  const match = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/reader-outputs(?:\/([A-Za-z0-9_-]+)\/candidates\/([A-Za-z0-9_-]+))?$/);
  if (!match) return null;
  const [, caseId, outputId, candidateId] = match;
  const found = store.read().cases.find(item => item.id === caseId);
  if (!found) throw fail('Case not found', 404);

  if (method === 'GET') {
    if (outputId) throw fail('Method not allowed', 405);
    return { status: 200, body: { caseId, asOf, caseRevision: found.revision ?? 0, outputs: (found.readerOutputs ?? []).map(outputView), enums: { service: readerServices, source: readerSources, decision: ['accept', 'reject'] }, identity: identityOf(trusted), limitation } };
  }
  if (method !== 'POST') throw fail('Method not allowed', 405);
  const body = await readBody();
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw fail('expectedRevision must be a non-negative integer');
  const context = { id: randomUUID(), now: new Date().toISOString(), actor: actor ?? 'local-demo-operator' };

  if (!outputId) {
    const digestible = body.output && typeof body.output === 'object';
    const sha256 = digestible ? createHash('sha256').update(canonicalJson(body.output), 'utf8').digest('hex') : '';
    const result = await store.mutate('reader-output-imported', caseId, state => {
      const current = state.cases.find(item => item.id === caseId);
      if ((current.readerOutputs ?? []).length >= 10) throw fail('A case holds at most 10 imported reader outputs', 409);
      const { output, note } = newReaderOutput(body, { ...context, sha256 });
      current.readerOutputs = [...(current.readerOutputs ?? []), output];
      return { readerOutputId: output.id, change: { command: 'reader-output-imported', note, before: null, after: { id: output.id, title: output.title, source: output.source, sha256: output.sha256, candidates: output.candidates.length } } };
    }, { expectedRevision: body.expectedRevision });
    const fresh = store.read().cases.find(item => item.id === caseId);
    return { status: 201, body: { output: outputView(fresh.readerOutputs.find(output => output.id === result.readerOutputId)), change: result.change, case: fresh, identity: identityOf(trusted), limitation } };
  }

  const result = await store.mutate('reader-candidate-decided', caseId, state => {
    const current = state.cases.find(item => item.id === caseId);
    const output = (current.readerOutputs ?? []).find(entry => entry.id === outputId);
    if (!output) throw fail('Reader output not found', 404);
    const { candidate, target, note } = decideCandidate(body, output, candidateId, context);
    let before = null;
    const after = { candidateId, decision: candidate.decision.decision };
    if (target) {
      const paperwork = (current.paperwork ?? []).find(entry => entry.id === target.itemId);
      if (!paperwork) throw fail('Paperwork item not found', 404);
      const entry = catalog.find(known => known.id === paperwork.paperworkId) ?? null;
      // The accepted value goes through the same check as a value typed by a person.
      const fact = acceptedFact(entry, target.factKey, candidate.value, current, context);
      if (paperwork.facts?.[target.factKey]) before = { factKey: target.factKey, value: paperwork.facts[target.factKey].value };
      paperwork.facts = { ...(paperwork.facts ?? {}), [target.factKey]: { ...fact, readerOutputId: outputId, candidateId } };
      paperwork.updatedAt = context.now; paperwork.updatedBy = context.actor;
      Object.assign(after, { itemId: target.itemId, factKey: target.factKey, value: fact.value });
    }
    output.candidates = output.candidates.map(entry => (entry.id === candidateId ? candidate : entry));
    return { itemId: target?.itemId ?? null, change: { command: 'reader-candidate-decided', note, before, after } };
  }, { expectedRevision: body.expectedRevision });
  const fresh = store.read().cases.find(item => item.id === caseId);
  const output = outputView(fresh.readerOutputs.find(entry => entry.id === outputId));
  const item = result.itemId ? paperworkView(fresh.paperwork.find(entry => entry.id === result.itemId), catalog, fresh, asOf) : null;
  return { status: 200, body: { output, candidate: output.candidates.find(entry => entry.id === candidateId), item, change: result.change, case: fresh, identity: identityOf(trusted), limitation } };
}
