// The audit team report: a read only compilation of what reviewers have recorded and what is still open.
// It reuses the documentation picture and the paperwork views. It writes nothing.
import { createHash } from 'node:crypto';
import { canonicalJson } from './lib/core/canonical.ts';
import { auditCaseSection, auditTotals } from './lib/core/audit-report.ts';
import { pictureOf } from './documentation.mjs';
import { paperworkView } from './paperwork.mjs';

function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

const limitation = 'This report lists what is on file: gaps a reviewer confirmed, screening results that still need evidence or review, active holds, and paperwork that is open or past a stored due date. It is not a compliance rating and gives no verdict. Screening results are not determinations. Completing a task does not remove a line, and a dismissed gap is never listed. Nothing here was sent to any agency.';
const digestNotice = 'A digest is not a signature or tamper-proof seal. It only shows whether two copies of this report have the same content.';

export async function handleAuditReport({ pathname, method, searchParams, state, asOf, reviewFor, catalog }) {
  if (pathname !== '/api/audit-report') return null;
  if (method !== 'GET') throw fail('Method not allowed', 405);
  for (const key of searchParams.keys()) if (!['asOf', 'caseId', 'include'].includes(key)) throw fail(`Unknown query parameter: ${key}`);
  const include = searchParams.get('include');
  if (include !== null && include !== 'candidates') throw fail('include must be candidates when present');
  const only = searchParams.get('caseId');
  if (only && !state.cases.some(item => item.id === only)) throw fail('Case not found', 404);
  const options = { asOf, includeCandidates: include === 'candidates' };

  const cases = [];
  for (const item of state.cases) {
    if (only && item.id !== only) continue;
    const { report, score, gaps } = await pictureOf(item, asOf, reviewFor);
    const paperwork = (item.paperwork ?? []).map(entry => paperworkView(entry, catalog, item, asOf));
    cases.push(auditCaseSection({ item, score, gaps, findings: report.findings, paperwork }, options));
  }
  const content = { asOf, workspaceRevision: state.revision, scope: { caseId: only ?? null }, includeCandidates: options.includeCandidates, totals: auditTotals(cases), cases, limitation, digestNotice };
  const value = createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex');
  return { status: 200, body: { ...content, generatedAt: new Date().toISOString(), digest: { algorithm: 'SHA-256', value, canonicalization: 'sorted-keys-json-v1', excludedFields: ['digest', 'generatedAt'] } } };
}
