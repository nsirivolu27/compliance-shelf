import { mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const endpoint = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const request = {
  filters: { award_type_codes: ['A', 'B', 'C', 'D'], agencies: [{ type: 'awarding', tier: 'toptier', name: 'Department of Veterans Affairs' }], time_period: [{ start_date: '2025-10-01', end_date: '2026-09-30' }] },
  fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Description', 'Start Date', 'End Date', 'Awarding Agency', 'Awarding Sub Agency'],
  page: 1, limit: 20, sort: 'Award Amount', order: 'desc', subawards: false
};
try {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`USAspending returned HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.results) || !body.results.length || body.results.some(r => typeof r['Award ID'] !== 'string' || typeof r['Recipient Name'] !== 'string' || r['Awarding Agency'] !== 'Department of Veterans Affairs' || typeof r['Award Amount'] !== 'number' || !Number.isFinite(r['Award Amount']))) throw new Error('Unexpected award response; existing cache preserved');
  const output = { provenance: 'public-data', source: endpoint, retrievedAt: new Date().toISOString(), request, caveat: 'A nonrepresentative top-20 award sample. Award metadata is not evidence of compliance. These real awards are not linked to the synthetic findings.', results: body.results };
  const directory = fileURLToPath(new URL('../data/public/', import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/va-awards.json.tmp`, JSON.stringify(output, null, 2));
  await rename(`${directory}/va-awards.json.tmp`, `${directory}/va-awards.json`);
  console.log(`Saved ${body.results.length} real VA awards. No synthetic findings are attached to these awards.`);
} catch (error) { console.error(`Import failed: ${error.message}. Any prior snapshot is unchanged.`); process.exitCode = 1; }
