import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { validateProfile } from '../src/lib/core/profile.ts';

const asOf = '2026-11-15';
const note = 'Recorded for the synthetic demo.';

async function start(stateFile) {
  const server = await createApp({ stateFile });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body) => {
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${asOf}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}

// A synthetic company profile. The organization is made up; the cited section is a public regulation page.
const companyProfile = {
  organization: { name: 'Example Contractor (synthetic)', kind: 'company' },
  sources: [{ id: 'far-4-703', title: 'FAR 4.703 - Policy (contractor records retention)', url: 'https://www.acquisition.gov/far/4.703', locator: '4.703(a)', scope: 'Example citation for a contractor retention check. Applicability is decided per contract.', checkedOn: '2026-11-15' }],
  checkSet: {
    id: 'contractor-reporting-example', name: 'Contractor reporting example',
    checks: [
      { kind: 'retention-plan', title: 'Records retention plan evidence', sourceIds: ['far-4-703'] },
      { kind: 'report-filed', title: 'Required report submission evidence', sourceIds: ['far-4-703', 'far-4.803'] },
    ],
    policySourceIds: ['far-4-703'], recordsSourceIds: ['far-4-703', 'far-4.805'],
  },
};

test('profile: built-in example by default, a loaded profile drives new cases only, and nothing is inferred', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cp-profile-'));
  const stateFile = join(directory, 'workspace.json');
  let app = await start(stateFile);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

  // Default: the built-in example, and the workspace has no profile key.
  const initial = await app.call('/api/profile');
  assert.equal(initial.status, 200); assert.equal(initial.body.builtIn, true);
  assert.deepEqual(initial.body.profile.checkSet.checks.map(check => check.kind), ['signed-award', 'funding', 'market-research', 'records-plan']);
  assert.equal(Object.hasOwn((await app.call('/api/workspace')).body, 'profile'), false);
  const legacyBefore = (await app.call('/api/cases/DEMO-VA-001')).body;
  const legacyCase = (await app.call('/api/cases', { title: 'Legacy shaped case', owner: 'Demo officer', note })).body.case;
  assert.match(legacyCase.id, /^DEMO-VA-/); assert.equal(legacyCase.agency, 'Department of Veterans Affairs'); assert.equal(Object.hasOwn(legacyCase, 'checkSet'), false);

  // Rejected input changes nothing.
  for (const body of [
    { profile: companyProfile },
    { profile: companyProfile, note, reset: true },
    { profile: { ...companyProfile, score: 90 }, note },
    { profile: { ...companyProfile, sources: [{ ...companyProfile.sources[0], url: 'http://example.test/' }] }, note },
    { profile: { ...companyProfile, sources: [{ ...companyProfile.sources[0], id: 'far-4.803' }] }, note },
    { profile: { ...companyProfile, checkSet: { ...companyProfile.checkSet, checks: [{ kind: 'x-check', title: 'Bad', sourceIds: ['missing-source'] }] } }, note },
    { profile: { ...companyProfile, checkSet: { ...companyProfile.checkSet, checks: [] } }, note },
    { profile: { ...companyProfile, organization: { name: 'X', kind: 'vendor' } }, note },
  ]) assert.equal((await app.call('/api/profile', body)).status, 400);
  assert.equal((await app.call('/api/profile')).body.builtIn, true);
  const stale = await app.call('/api/profile', { profile: companyProfile, note, expectedWorkspaceRevision: 0 });
  assert.equal(stale.status, 409); assert.ok(Number.isSafeInteger(stale.body.currentRevision));

  // Loading a profile is audited and leaves existing cases exactly as they were.
  const loaded = await app.call('/api/profile', { profile: companyProfile, note, expectedWorkspaceRevision: stale.body.currentRevision });
  assert.equal(loaded.status, 200); assert.equal(loaded.body.builtIn, false); assert.equal(loaded.body.change.before, null);
  const legacyAfter = (await app.call('/api/cases/DEMO-VA-001')).body;
  assert.deepEqual(legacyAfter.case, legacyBefore.case); assert.deepEqual(legacyAfter.report.findings, legacyBefore.report.findings);
  const workspace = (await app.call('/api/workspace')).body;
  assert.equal(workspace.events.at(-1).action, 'profile-loaded');
  assert.ok(workspace.sources.some(source => source.id === 'far-4-703'));

  // A new case takes the organization and checks; every applicability starts unknown.
  const created = (await app.call('/api/cases', { title: 'Synthetic reporting case', owner: 'Demo compliance lead', note })).body.case;
  assert.match(created.id, /^DEMO-(?!VA-)/); assert.equal(created.agency, 'Example Contractor (synthetic)');
  assert.deepEqual(created.applicability, { 'retention-plan': 'unknown', 'report-filed': 'unknown' });
  const path = `/api/cases/${encodeURIComponent(created.id)}`;
  let detail = (await app.call(path)).body;
  const checkFindings = detail.report.findings.filter(finding => finding.category === 'contracting');
  assert.deepEqual(checkFindings.map(finding => finding.title), ['Records retention plan evidence', 'Required report submission evidence']);
  assert.ok(checkFindings.every(finding => finding.status === 'needs-review'));
  assert.deepEqual(detail.report.findings.find(finding => finding.category === 'policy').sourceIds, ['far-4-703']);
  assert.ok(detail.sources.some(source => source.id === 'far-4-703'));

  // Evidence kinds follow the case's own checks, in both directions.
  assert.equal((await app.call(`${path}/evidence`, { kind: 'signed-award', title: 'Wrong kind', locator: 'synthetic://x', expectedRevision: detail.case.revision })).status, 400);
  assert.equal((await app.call('/api/cases/DEMO-VA-001/evidence', { kind: 'retention-plan', title: 'Wrong kind', locator: 'synthetic://x', expectedRevision: legacyAfter.case.revision })).status, 400);
  assert.equal((await app.call(`${path}/evidence`, { kind: 'retention-plan', title: 'Synthetic retention plan', locator: 'synthetic://plans/1', expectedRevision: detail.case.revision })).status, 201);
  detail = (await app.call(path)).body;
  assert.equal((await app.call(`${path}/context`, { expectedRevision: detail.case.revision, note, applicability: { 'signed-award': 'yes' } })).status, 400);
  assert.equal((await app.call(`${path}/context`, { expectedRevision: detail.case.revision, note, applicability: { 'retention-plan': 'yes' } })).status, 200);
  detail = (await app.call(path)).body;
  // Supplied but unverified evidence is still only a review item, and the other check stays unknown.
  assert.equal(detail.report.findings.find(finding => finding.id === `${created.id}:retention-plan`).status, 'needs-review');
  assert.equal(detail.report.findings.find(finding => finding.id === `${created.id}:report-filed`).status, 'needs-review');
  const packet = (await app.call(`${path}/packet`)).body;
  assert.equal(packet.case.checkSet.id, 'contractor-reporting-example');
  assert.ok(packet.sources.some(source => source.id === 'far-4-703'));

  // Restart keeps the profile. Reset restores the example, and the stored case keeps its checks and sources.
  await app.close(); app = await start(stateFile);
  assert.equal((await app.call('/api/profile')).body.profile.organization.name, 'Example Contractor (synthetic)');
  const reset = await app.call('/api/profile', { reset: true, note });
  assert.equal(reset.status, 200); assert.equal(reset.body.builtIn, true); assert.equal(reset.body.change.after, null);
  const afterReset = (await app.call(path)).body;
  assert.deepEqual(afterReset.report.findings.map(finding => finding.id), detail.report.findings.map(finding => finding.id));
  assert.ok(afterReset.sources.some(source => source.id === 'far-4-703'));
  assert.match((await app.call('/api/cases', { title: 'Back to the example', owner: 'Demo officer', note })).body.case.id, /^DEMO-VA-/);
});

test('profile validation is pure and strict', () => {
  const clean = validateProfile(companyProfile, ['far-4.803', 'far-4.805']);
  assert.deepEqual(clean, companyProfile);
  assert.throws(() => validateProfile({ ...companyProfile, checkSet: { ...companyProfile.checkSet, checks: [companyProfile.checkSet.checks[0], companyProfile.checkSet.checks[0]] } }, ['far-4.803', 'far-4.805']), /repeated/);
  assert.throws(() => validateProfile({ ...companyProfile, checkSet: { ...companyProfile.checkSet, threshold: 3 } }, ['far-4.803', 'far-4.805']), /Unsupported/);
  assert.throws(() => validateProfile(companyProfile, ['far-4-703']), /already in use/);
});
