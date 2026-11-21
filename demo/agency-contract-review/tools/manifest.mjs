// Builds ../manifest.json: one entry per document version with SHA-256 hashes
// and byte sizes of the PDF original and the Markdown companion.
//
// Usage: node tools/manifest.mjs   (run after node tools/render.mjs)
//        node tools/manifest.mjs --check   (recompute and compare; exit 1 on mismatch)
//
// Companions are hashed exactly as saved. They must use LF line endings; the
// script refuses a companion that contains CR. The platform normalizes CRLF to
// LF before hashing, so an LF file hashes the same here and in the platform.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'manifest.json');

const DOCUMENTS = [
  { documentId: 'SYN-VAP-DOC-00', version: '1.0', title: 'Engagement brief', stage: 'initial', authorRole: 'Review engagement team', date: '2026-10-14', relationship: null },
  { documentId: 'SYN-VAP-DOC-01', version: '1.0', title: 'Statement of work (fictional)', stage: 'initial', authorRole: 'SYN-CO-01', date: '2026-06-01', relationship: null },
  { documentId: 'SYN-VAP-DOC-02', version: '1.0', title: 'Deliverable register', stage: 'initial', authorRole: 'SYN-COR-02', date: '2026-10-06', relationship: { type: 'implements', target: 'SYN-VAP-DOC-01 v1.0' } },
  { documentId: 'SYN-VAP-DOC-03', version: '1.0', title: 'Vendor accessibility conformance declaration', stage: 'initial', authorRole: 'SYN-VDL-04', date: '2026-09-29', relationship: { type: 'responds-to', target: 'SYN-VAP-DOC-01 v1.0', note: 'deliverable D-02' } },
  { documentId: 'SYN-VAP-DOC-04', version: '1.0', title: 'Accessibility evaluation report', stage: 'initial', authorRole: 'SYN-EVAL-06', date: '2026-09-15', relationship: null },
  { documentId: 'SYN-VAP-DOC-05', version: '1.0', title: 'Delivery transmittal', stage: 'initial', authorRole: 'SYN-VDL-04', date: '2026-09-30', relationship: { type: 'encloses', target: 'SYN-VAP-DOC-03 v1.0' } },
  { documentId: 'SYN-VAP-DOC-06', version: '1.0', title: 'Acceptance-review memorandum', stage: 'initial', authorRole: 'SYN-COR-02', date: '2026-10-07', relationship: null },
  { documentId: 'SYN-VAP-DOC-07', version: '1.0', title: 'Records inventory and synthetic hold notice', stage: 'initial', authorRole: 'SYN-RO-05', date: '2026-10-02', relationship: null },
  { documentId: 'SYN-VAP-DOC-08', version: '1.0', title: 'Corrective-action plan', stage: 'initial', authorRole: 'SYN-CO-01', date: '2026-10-09', relationship: { type: 'responds-to', target: 'SYN-VAP-DOC-06 v1.0' } },
  { documentId: 'SYN-VAP-DOC-09', version: '1.0', title: 'Remediation evidence addendum', stage: 'remediation', authorRole: 'SYN-EVAL-06', date: '2026-10-28', relationship: { type: 'supplements', target: 'SYN-VAP-DOC-04 v1.0', note: 'earlier evaluation retained; not replaced' } },
  { documentId: 'SYN-VAP-DOC-06', version: '2.0', title: 'Revised acceptance-review memorandum', stage: 'remediation', authorRole: 'SYN-COR-02', date: '2026-11-03', relationship: { type: 'supersedes-for-review', target: 'SYN-VAP-DOC-06 v1.0', note: 'earlier version retained' } },
];

function describeFile(relativePath, extra = {}) {
  const absolute = join(ROOT, relativePath);
  if (!existsSync(absolute)) throw new Error(`Missing file: ${relativePath}`);
  const bytes = readFileSync(absolute);
  return { path: relativePath, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, ...extra };
}

function buildEntry(doc) {
  const stem = `${doc.documentId}_v${doc.version}`;
  const companion = describeFile(`text/${stem}.md`, { mediaType: 'text/markdown' });
  if (readFileSync(join(ROOT, companion.path)).includes(0x0d)) {
    throw new Error(`${companion.path} contains CR characters; save it with LF line endings`);
  }
  const original = describeFile(`originals/${stem}.pdf`, { mediaType: 'application/pdf' });
  return { ...doc, files: { original, companion } };
}

function buildManifest() {
  return {
    pack: 'agency-contract-review',
    caseTitle: 'VA regional services portal — accessibility and delivery evidence review',
    contractId: 'SYN-VA-PORTAL-2026-001',
    synthetic: true,
    banner: 'SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD.',
    hashAlgorithm: 'sha256',
    hashingNote: 'Companions are hashed exactly as saved, UTF-8 with LF line endings. The platform normalizes CRLF to LF before hashing, so these values match the platform after normalization.',
    citationSource: 'companion',
    documents: DOCUMENTS.map(buildEntry),
  };
}

function check() {
  const saved = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const fresh = buildManifest();
  let failures = 0;
  for (const entry of saved.documents) {
    const match = fresh.documents.find((d) => d.documentId === entry.documentId && d.version === entry.version);
    for (const kind of ['original', 'companion']) {
      const ok = match && match.files[kind].sha256 === entry.files[kind].sha256 && match.files[kind].bytes === entry.files[kind].bytes;
      if (!ok) failures += 1;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${entry.documentId} v${entry.version} ${kind} ${entry.files[kind].path}`);
    }
  }
  if (failures > 0) { console.error(`${failures} mismatch(es)`); process.exit(1); }
  console.log('All manifest hashes match.');
}

if (process.argv.includes('--check')) {
  check();
} else {
  writeFileSync(MANIFEST_PATH, JSON.stringify(buildManifest(), null, 2) + '\n', 'utf8');
  console.log(`wrote manifest.json with ${DOCUMENTS.length} entries`);
}
