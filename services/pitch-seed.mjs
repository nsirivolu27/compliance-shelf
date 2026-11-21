// Fills a fresh workspace with the two synthetic cases used in the pitch walkthrough.
// Everything goes through the public API, so every change is validated and lands in the history.
// It refuses to run on a workspace that already holds saved work.

const note = 'Synthetic demonstration data for the pitch walkthrough.';

function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export async function seedPitchDemo({ base, today }) {
  const revisions = new Map();
  async function call(path, body) {
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${today}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(`${path} was refused (${response.status}): ${result.error}`);
    if (result.case) revisions.set(result.case.id, result.case.revision);
    return result;
  }
  // A change to a case always states the revision it was based on.
  const change = (caseId, path, body) => call(`/api/cases/${caseId}${path}`, { expectedRevision: revisions.get(caseId), note, ...body });

  const before = await call('/api/workspace');
  if (before.profile || before.events.length > 0 || before.cases.length !== 3) {
    throw new Error('The pitch demo seed needs a fresh workspace. This one already holds saved work, so nothing was changed.');
  }

  async function caseFromPreset(presetId, title, owner) {
    const { profile } = await call(`/api/profile-presets/${presetId}`);
    await call('/api/profile', { profile, note });
    return (await call('/api/cases', { title, owner, note })).case.id;
  }

  // ---------- VA: a transmittal two facts short, a held record, and a corrective action entry ----------
  const va = await caseFromPreset('va-system-delivery', 'Synthetic VA system delivery: release 4.2', 'Demo delivery lead');
  const addRecord = async (title, recordType) => (await change(va, '/records', { title, owner: 'Demo records officer', recordType })).case.records.at(-1).id;
  const development = await addRecord('System development records, release 4.2', 'system-development-records');
  const changes = await addRecord('Change management records, release 4.2', 'change-management-records');
  await change(va, `/records/${development}`, { schedule: { authority: 'Synthetic schedule for this walkthrough', years: 6, trigger: 'final-payment', confirmed: true, itemNumber: '010' } });
  await change(va, `/records/${development}/hold`, { status: 'none', reference: 'Synthetic hold review 2026-021: no hold applies' });
  await change(va, `/records/${changes}/hold`, { status: 'active', reference: 'Synthetic hold notice 2026-014' });

  // One evidence reference, left unverified, so the review step has something to open, verify and assess.
  await change(va, '/evidence', { kind: 'requirements-evidence', title: 'Release 4.2 requirements baseline', locator: 'Synthetic delivery share, release 4.2, requirements folder' });
  revisions.set(va, (await call(`/api/cases/${va}/paperwork`)).caseRevision);

  const transmittal = (await change(va, '/paperwork', { paperworkId: 'PW-SF135', recordId: development, dueDate: addDays(today, 25) })).item.id;
  await change(va, `/paperwork/${transmittal}`, { status: 'drafting', facts: { 'inclusive-dates': '2025-01-01 to 2025-12-31' } });
  await change(va, '/paperwork', { paperworkId: 'PW-NA13001', recordId: changes, dueDate: addDays(today, -9) });
  const action = (await change(va, '/paperwork', { paperworkId: 'PW-A50-CAP', dueDate: addDays(today, 45) })).item.id;
  await change(va, `/paperwork/${action}`, { status: 'drafting', facts: {
    'report-reference': 'Synthetic audit report SYN-2026-07', recommendation: 'Record the schedule that covers release artifacts.',
    'management-decision-date': addDays(today, -30), 'responsible-official': 'Demo delivery lead', 'planned-completion-date': addDays(today, 45),
  } });

  // The shipped sample output waits as undecided candidates, so a reviewer can accept or reject them live.
  const { sample } = await call('/api/reader-samples/synthetic-transmittal');
  await change(va, '/reader-outputs', { title: sample.title, service: sample.service, source: sample.source, synthetic: true, output: sample.output });

  // One gap confirmed by a reviewer, so the audit team report shows a recorded exception.
  const { gaps } = await call(`/api/cases/${va}/documentation`);
  const gap = gaps.find(entry => entry.ruleId === 'policy-basis-unconfirmed') ?? gaps[0];
  await change(va, '/gap-decisions', { gapId: gap.id, decision: 'confirmed', note: 'Synthetic walkthrough: a reviewer still has to confirm the policy basis.' });

  // ---------- SSA: the yearly records reports and one corrective action entry, with dates a person entered ----------
  const ssa = await caseFromPreset('ssa-system-delivery', 'Synthetic SSA system delivery: release 2.1', 'Demo delivery lead');
  for (const [paperworkId, days] of [['PW-SAORM', 110], ['PW-RMSA', 110], ['PW-FEREM', 110], ['PW-A50-CAP', 40]]) {
    await change(ssa, '/paperwork', { paperworkId, dueDate: addDays(today, days) });
  }

  return { va, ssa };
}
