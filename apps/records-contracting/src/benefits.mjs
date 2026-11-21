import { benefitPrograms } from './lib/core/benefits.ts';
import { paperworkView } from './paperwork.mjs';

export function handleBenefits({ pathname, method, searchParams, store, catalog, asOf }) {
  if (pathname !== '/api/benefits') return null;
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  if (method !== 'GET') fail('Method not allowed', 405);
  for (const key of searchParams.keys()) {
    if (!['asOf', 'agency', 'q'].includes(key)) fail(`Unknown query parameter: ${key}`);
    if (searchParams.getAll(key).length > 1) fail(`Repeated query parameter: ${key}`);
  }
  const state = store.read();
  const items = state.cases.flatMap(item => (item.paperwork ?? []).map(paperwork => ({ ...paperworkView(paperwork, catalog, item, asOf), caseId: item.id, caseTitle: item.title, organization: item.agency, caseRevision: item.revision ?? 0 })));
  const filters = Object.fromEntries(['agency', 'q'].filter(key => searchParams.has(key)).map(key => [key, searchParams.get(key)]));
  return { status: 200, body: { asOf, workspaceRevision: state.revision, programs: benefitPrograms(catalog, items, filters),
    limitation: 'Synthetic intake demonstration only. Team labels are examples, not official organizational assignments. Worksheet counts are local review aids, not a complete application checklist. No eligibility decision, benefit calculation, individual award, claim submission, or payment is performed. Program and project budgets are planned separately on the Funding page as simulated allocations. Only saved Textract JSON is read; PDF/image OCR is not connected. Check the current official instructions with an authorized reviewer.' } };
}
