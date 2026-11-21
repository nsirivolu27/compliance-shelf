// Seeds the VA contract-review demonstration into a FRESH workspace through the public API.
// Every write goes through the same validation, revision checks and audit events as a person's would.
// The case data comes from demo/agency-contract-review/manifest.json and scenario.json, so nothing here can drift
// from the saved document pack. Only the initial packet is loaded; the remediation documents are added live.
// The facilitator answer key is never read or loaded: the platform does not "find" the planted exceptions.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './config.mjs';

export const packFolder = resolve(root, 'demo/agency-contract-review');
const note = 'Synthetic demonstration data for the VA contract-review walkthrough. Not an official agency record.';

// Public policy references cited by the checks. Their applicability to this fictional contract is for a qualified
// reviewer to confirm; the contract requirement itself lives in the fictional statement of work (SYN-VAP-DOC-01).
const sources = [
  {
    id: 'demo-cr-508-standards', title: 'Revised Section 508 Standards, 36 CFR Part 1194 (public policy reference)',
    url: 'https://www.ecfr.gov/current/title-36/chapter-XI/part-1194',
    locator: '36 CFR Part 1194, Appendices A, C and D; incorporates WCAG 2.0 Level A and AA by reference. Snapshot in demo/agency-contract-review/sources/snapshots/.',
    scope: 'Public policy reference. Whether and which version governs this fictional contract is not decided here; a qualified reviewer confirms it. The contract\'s own requirement is in the fictional statement of work SYN-VAP-DOC-01.',
    checkedOn: '2026-11-20',
  },
  {
    id: 'demo-cr-508-applicability', title: 'Section508.gov: applicability and conformance (public guidance reference)',
    url: 'https://www.section508.gov/develop/applicability-conformance/',
    locator: 'Applicability and conformance page; snapshot in demo/agency-contract-review/sources/snapshots/.',
    scope: 'Public guidance about how the standards are applied. Background for the reviewer; not a contract term and not a finding about any agency.',
    checkedOn: '2026-11-20',
  },
];

const checks = [
  { kind: 'accessibility-conformance', title: 'Accessibility evidence covers the delivered build', sourceIds: ['demo-cr-508-standards', 'demo-cr-508-applicability'] },
  { kind: 'delivery-traceability', title: 'Delivered version traceable to the evaluated version', sourceIds: ['demo-cr-508-standards'] },
  { kind: 'acceptance-review', title: 'Acceptance review carries the required acknowledgment', sourceIds: ['demo-cr-508-standards'] },
];

// Which saved documents are filed as evidence references on which check. The others are filed as documents only.
const evidenceFor = {
  'accessibility-conformance': ['SYN-VAP-DOC-01', 'SYN-VAP-DOC-03', 'SYN-VAP-DOC-04'],
  'delivery-traceability': ['SYN-VAP-DOC-05', 'SYN-VAP-DOC-02'],
  'acceptance-review': ['SYN-VAP-DOC-06'],
};

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

/** Reads the pack and checks every companion of a stage against its manifest hash before anything is sent. */
export async function loadPack(stage = 'initial') {
  const manifest = JSON.parse(await readFile(resolve(packFolder, 'manifest.json'), 'utf8'));
  const scenario = JSON.parse(await readFile(resolve(packFolder, 'scenario.json'), 'utf8'));
  const documents = [];
  for (const entry of manifest.documents.filter(document => document.stage === stage)) {
    const content = (await readFile(resolve(packFolder, entry.files.companion.path), 'utf8')).replace(/\r\n?/g, '\n');
    if (sha256(content) !== entry.files.companion.sha256) throw new Error(`${entry.files.companion.path} does not match its manifest hash. Regenerate the manifest or restore the file.`);
    documents.push({ ...entry, content });
  }
  return { manifest, scenario, documents };
}

/** One document intake request: the prepared text companion, labelled with its original PDF and both hashes. */
export function intakeBody(caseId, entry) {
  const label = `${entry.documentId} v${entry.version}`;
  return {
    caseId,
    title: `${label} — ${entry.title}`,
    filename: entry.files.companion.path.split('/').pop(),
    mediaType: 'text/markdown',
    content: entry.content,
    note: `Prepared text companion of ${entry.files.original.path} in demo/agency-contract-review (original PDF SHA-256 ${entry.files.original.sha256}; companion SHA-256 ${entry.files.companion.sha256}). The platform stores and cites this text; it does not read the PDF. Synthetic demonstration document.`,
  };
}

export async function seedContractReview({ base, today }) {
  const revisions = new Map();
  async function call(path, body, idempotencyKey) {
    const headers = { 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) };
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${today}`, body === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(`${path} was refused (${response.status}): ${result.error}`);
    if (result.case) revisions.set(result.case.id, result.case.revision);
    return result;
  }
  // Document intake can advance the case revision on its own a moment after a document is ready. When that happens the
  // seed reloads the revision once and resends; any other conflict still stops the seed.
  async function change(caseId, path, body) {
    try {
      return await call(`/api/cases/${caseId}${path}`, { expectedRevision: revisions.get(caseId), note, ...body });
    } catch (error) {
      if (!/\(409\)/.test(error.message)) throw error;
      revisions.set(caseId, (await call(`/api/cases/${caseId}`)).case.revision);
      return call(`/api/cases/${caseId}${path}`, { expectedRevision: revisions.get(caseId), note, ...body });
    }
  }

  const before = await call('/api/workspace');
  if (before.profile || before.events.length > 0 || before.cases.length !== 3) {
    throw new Error('The contract-review seed needs a fresh workspace. This one already holds saved work, so nothing was changed.');
  }
  const { scenario, documents } = await loadPack('initial');

  // 1. A check set for this kind of review, loaded explicitly with a note, as a person would through Check profile.
  const profile = {
    organization: { name: 'Department of Veterans Affairs (synthetic example)', kind: 'agency' },
    businessUnit: 'Synthetic Regional Contracting Office 3 (fictional)',
    family: 'Contract file and delivery records',
    sources,
    checkSet: {
      id: 'demo-va-contract-review', name: 'VA contract file review (synthetic example)', checks,
      policySourceIds: ['demo-cr-508-standards'], recordsSourceIds: ['demo-cr-508-standards'],
      expectedRecords: [{ kind: 'delivery-records', title: 'Release delivery records', sourceIds: ['demo-cr-508-standards'] }],
    },
  };
  await call('/api/profile', { profile, note });

  // 2. The case. Applicability is decided by a reviewer here, with the reason in the note; nothing is assumed.
  const caseId = (await call('/api/cases', { title: scenario.caseTitle, owner: 'SYN-COR-02 (Contracting Officer\'s Representative, fictional)', note })).case.id;
  await change(caseId, '/context', {
    contractNumber: scenario.contract?.id ?? 'SYN-VA-PORTAL-2026-001',
    applicability: Object.fromEntries(checks.map(check => [check.kind, 'yes'])),
    note: 'Synthetic: the fictional statement of work SYN-VAP-DOC-01 sets all three review criteria for deliverables D-02 to D-04.',
  });

  // 3. Records and the synthetic hold. The hold stays active for the whole demonstration.
  const addRecord = async (title, recordType) => (await change(caseId, '/records', { title, owner: 'SYN-RO-05 (Records Officer, fictional)', ...(recordType ? { recordType } : {}) })).case.records.at(-1).id;
  const delivery = await addRecord('Release 1.2 delivery records (portal build, transmittal, acceptance file)', 'delivery-records');
  const working = await addRecord('Release 1.1 test working files');
  await change(caseId, `/records/${delivery}/hold`, { status: 'active', reference: 'SYN-HOLD-2026-07 (synthetic hold notice in SYN-VAP-DOC-07 v1.0)' });
  await change(caseId, `/records/${working}/hold`, { status: 'none', reference: 'SYN-VAP-DOC-07 v1.0: no hold covers this series' });

  // 4. The initial packet: each prepared text companion through document intake, then wait for extraction.
  const stored = {};
  for (const entry of documents) {
    // One stable key per document version: a retried intake returns the same document instead of a second copy.
    const result = await call('/api/documents', intakeBody(caseId, entry), `demo-cr:${caseId}:${entry.documentId}:v${entry.version}`);
    stored[entry.documentId] = { id: result.document?.id ?? result.documentId ?? result.id, entry };
  }
  for (const { id, entry } of Object.values(stored)) {
    for (let attempt = 0; ; attempt++) {
      const { document } = await call(`/api/documents/${id}`);
      if (document?.status === 'ready') break;
      if (attempt > 80) throw new Error(`${entry.documentId} was not extracted in time.`);
      await delay(250);
    }
  }

  // 5. Evidence references, unverified: verifying a reference and judging its sufficiency are done live by the reviewer.
  revisions.set(caseId, (await call(`/api/cases/${caseId}`)).case.revision);
  for (const [kind, ids] of Object.entries(evidenceFor)) {
    for (const documentId of ids) {
      const { id } = stored[documentId];
      // Use document intake's link operation so the register and case share the same evidence ID.
      // A case-only reference leaves the document register incorrectly showing zero linked references.
      const current = (await call(`/api/cases/${caseId}`)).case.revision;
      await call(`/api/documents/${id}/evidence`, { kind, expectedRevision: current, note }, `demo-cr-link:${caseId}:${documentId}:${kind}`);
    }
  }
  return { caseId, documents: Object.fromEntries(Object.entries(stored).map(([documentId, value]) => [documentId, value.id])) };
}
