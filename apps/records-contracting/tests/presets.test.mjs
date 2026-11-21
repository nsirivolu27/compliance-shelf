import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { validateProfile } from '../src/lib/core/profile.ts';
import { sourcesForCase } from '../src/profile.mjs';
import { tools } from '../src/lib/tools/registry.mjs';

const asOf = '2026-11-15';
const note = 'Recorded for the synthetic demo.';

async function start(stateFile) {
  const server = await createApp({ stateFile });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, key, method) => {
    const headers = { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) };
    const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}asOf=${asOf}`, body === undefined ? { method: method ?? 'GET' } : { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cp-presets-'));
  const stateFile = join(directory, 'workspace.json');
  const holder = { app: await start(stateFile) };
  t.after(async () => { await holder.app.close(); await rm(directory, { recursive: true, force: true }); });
  holder.restart = async () => { await holder.app.close(); holder.app = await start(stateFile); };
  return holder;
}

// Two made-up profiles that reuse the source ID "shared-rule" with different content.
const profileWith = (name, title, locator) => ({
  organization: { name, kind: 'other' },
  sources: [{ id: 'shared-rule', title, url: 'https://example.test/rule', locator, scope: 'Synthetic source used to test source resolution.', checkedOn: '2026-11-15' }],
  checkSet: { id: 'collision-example', name: 'Collision example', checks: [{ kind: 'plan-evidence', title: 'Plan evidence', sourceIds: ['shared-rule'] }], policySourceIds: ['shared-rule'], recordsSourceIds: ['shared-rule'] },
});
const profileA = profileWith('Office A (synthetic)', 'Stored source A', 'Section A');
const profileB = profileWith('Office B (synthetic)', 'Loaded source B', 'Section B');

// A packet differs between two reads only by its export time and digest. Everything else must be equal.
const comparable = packet => ({ ...packet, exportedAt: null, digest: null });
const sharedIn = sources => sources.find(source => source.id === 'shared-rule');

test('source resolution: a case keeps its own sources through profile switches, reset, and restart', async t => {
  const holder = await workspace(t);
  const call = (...args) => holder.app.call(...args);
  const at = async path => (await call(path)).body.case.revision;

  assert.equal((await call('/api/profile', { profile: profileA, note })).status, 200);
  const caseA = (await call('/api/cases', { title: 'Case under profile A', owner: 'Demo reviewer', note })).body.case;
  const pathA = `/api/cases/${caseA.id}`;
  // Give case A a policy basis citing its own source, an evidence reference, and an assessment, so every reader has something to resolve.
  assert.equal((await call(`${pathA}/context`, { expectedRevision: await at(pathA), note, applicability: { 'plan-evidence': 'yes' }, policyBasis: { confirmed: true, description: 'Synthetic basis citing the stored source.', sourceIds: ['shared-rule'] } })).status, 200);
  const evidence = (await call(`${pathA}/evidence`, { kind: 'plan-evidence', title: 'Synthetic plan', locator: 'synthetic://plans/a', expectedRevision: await at(pathA) })).body;
  assert.equal((await call(`${pathA}/verify-evidence`, { evidenceId: evidence.id, note, expectedRevision: await at(pathA) })).status, 200);
  const assessed = await call(`${pathA}/assessments`, { expectedRevision: await at(pathA), findingId: `${caseA.id}:plan-evidence`, evidenceIds: [evidence.id], outcome: 'sufficient-for-stated-check', rationale: 'Synthetic rationale for the plan check only.' });
  assert.equal(assessed.status, 201);

  const read = async () => ({
    detail: (await call(pathA)).body,
    packet: (await call(`${pathA}/packet`)).body,
    review: (await call(`${pathA}/evidence-review`)).body,
    policy: (await call(`${pathA}/policy-context`)).body,
    workbench: (await call(`/api/workbench?caseId=${caseA.id}`)).body,
    events: (await call(`/api/activity?caseId=${caseA.id}`)).body.items.length,
  });
  const before = await read();
  assert.equal(sharedIn(before.detail.sources).title, 'Stored source A');
  assert.equal(sharedIn(before.packet.sources).title, 'Stored source A');
  assert.equal(sharedIn(before.workbench.caseSources[caseA.id]).title, 'Stored source A');
  assert.equal(before.review.findings.find(finding => finding.findingId === `${caseA.id}:plan-evidence`).currentAssessment.freshness.state, 'current');

  // Profile B reuses the ID with different content. Case A is open the whole time and must not change.
  assert.equal((await call('/api/profile', { profile: profileB, note })).status, 200);
  const caseB = (await call('/api/cases', { title: 'Case under profile B', owner: 'Demo reviewer', note })).body.case;
  const pathB = `/api/cases/${caseB.id}`;
  const afterSwitch = await read();
  assert.deepEqual(comparable(afterSwitch.packet), comparable(before.packet));
  assert.deepEqual(afterSwitch.detail.sources, before.detail.sources);
  assert.deepEqual(afterSwitch.detail.case, before.detail.case);
  assert.deepEqual({ ...afterSwitch.review, caseRevision: null }, { ...before.review, caseRevision: null });
  assert.deepEqual(afterSwitch.policy, before.policy);
  assert.equal(sharedIn(afterSwitch.workbench.caseSources[caseA.id]).title, 'Stored source A');
  assert.equal(afterSwitch.events, before.events, 'a profile switch adds no event to an existing case');
  // Case B resolves its own copy, on every case-specific read.
  assert.equal(sharedIn((await call(pathB)).body.sources).title, 'Loaded source B');
  assert.equal(sharedIn((await call(`${pathB}/packet`)).body.sources).title, 'Loaded source B');
  assert.equal(sharedIn((await call(`/api/workbench?caseId=${caseB.id}`)).body.caseSources[caseB.id]).locator, 'Section B');
  // Case-specific validation: a policy basis may cite the case's own source, and not one it does not hold.
  assert.equal((await call(`${pathB}/context`, { expectedRevision: await at(pathB), note, policyBasis: { confirmed: true, description: 'Synthetic basis citing the stored source.', sourceIds: ['shared-rule'] } })).status, 200);
  assert.equal((await call('/api/cases/DEMO-VA-001/context', { expectedRevision: await at('/api/cases/DEMO-VA-001'), note, policyBasis: { confirmed: true, description: 'A built-in case cannot cite a custom source.', sourceIds: ['shared-rule'] } })).status, 400);

  // Same ID and same content again: nothing changes for either case.
  assert.equal((await call('/api/profile', { profile: profileA, note })).status, 200);
  assert.deepEqual(comparable((await read()).packet), comparable(before.packet));
  assert.equal(sharedIn((await call(`${pathB}/packet`)).body.sources).title, 'Loaded source B');

  // Reset, then restart.
  assert.equal((await call('/api/profile', { reset: true, note })).status, 200);
  assert.deepEqual(comparable((await read()).packet), comparable(before.packet));
  await holder.restart();
  const afterRestart = await read();
  assert.deepEqual(comparable(afterRestart.packet), comparable(before.packet));
  assert.equal(afterRestart.events, before.events);
  assert.equal(sharedIn((await call(`${pathB}/packet`)).body.sources).title, 'Loaded source B');
  // The workspace list is a discovery list: one entry per ID. It is not how a case resolves its sources.
  const listed = (await call('/api/workspace')).body;
  assert.equal(listed.sources.filter(source => source.id === 'shared-rule').length, 1);
  assert.ok(listed.builtInSourceIds.includes('far-4.803')); assert.equal(listed.builtInSourceIds.includes('shared-rule'), false);
});

test('source resolution: a source the case does not hold stays unresolved', () => {
  const builtIn = [{ id: 'far-4.803', title: 'Built in' }];
  const older = { checkSet: { checks: [{ kind: 'x', title: 'X', sourceIds: ['shared-rule'] }], sources: [] } };
  assert.deepEqual(sourcesForCase(builtIn, older).map(source => source.id), ['far-4.803']);
  assert.deepEqual(sourcesForCase(builtIn, {}).map(source => source.id), ['far-4.803']);
  // A stored source can never replace a built-in one.
  assert.equal(sourcesForCase(builtIn, { checkSet: { sources: [{ id: 'far-4.803', title: 'Impostor' }] } })[0].title, 'Built in');
});

test('presets: every example validates, reads change nothing, and loading stays an explicit profile write', async t => {
  const holder = await workspace(t);
  const call = (...args) => holder.app.call(...args);
  const at = async path => (await call(path)).body.case.revision;
  const start = (await call('/api/workspace')).body;

  const list = await call('/api/profile-presets');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.presets.map(preset => preset.id), ['va-system-delivery', 'ssa-system-delivery', 'ssa-benefit-statement', 'public-sector-records']);
  assert.ok(list.body.presets.every(preset => preset.example === true && preset.businessUnit && preset.family && preset.organization));
  assert.deepEqual(list.body.presets.map(preset => [preset.checkCount, preset.sourceCount]), [[6, 3], [6, 3], [1, 2], [4, 5]]);
  assert.match(list.body.limitation, /review aid/);
  assert.equal((await call('/api/profile-presets/unknown-preset')).status, 404);
  assert.equal((await call('/api/profile-presets', {})).status, 405);
  assert.equal((await call('/api/profile-presets/va-system-delivery', {})).status, 405);

  const details = [];
  const allSourceIds = [];
  for (const summary of list.body.presets) {
    const detail = await call(`/api/profile-presets/${summary.id}`);
    assert.equal(detail.status, 200); assert.deepEqual(detail.body.preset, summary);
    const profile = detail.body.profile;
    // The returned profile is exactly what the profile route accepts, and every cited ID resolves.
    assert.deepEqual(validateProfile(profile, start.builtInSourceIds), profile);
    const known = [...start.builtInSourceIds, ...profile.sources.map(source => source.id)];
    for (const check of profile.checkSet.checks) assert.ok(check.sourceIds.every(id => known.includes(id)));
    allSourceIds.push(...profile.sources.map(source => source.id));
    details.push(detail.body);
  }
  assert.equal(new Set(allSourceIds).size, allSourceIds.length, 'preset source IDs are distinct across presets');
  assert.ok(details[0].profile.sources.some(source => source.locator.includes('DAA-GRS-2013-0005-0007')));
  assert.ok(details[0].profile.sources.some(source => source.locator.includes('DAA-GRS-2013-0005-0005')));

  // Reading presets created no revision, event, profile, or case.
  const afterReads = (await call('/api/workspace')).body;
  assert.equal(afterReads.revision, start.revision); assert.equal(afterReads.events.length, start.events.length);
  assert.equal(afterReads.cases.length, start.cases.length); assert.equal(Object.hasOwn(afterReads, 'profile'), false);

  // Loading: conflict, success, idempotent replay, and still no case.
  const stale = await call('/api/profile', { profile: details[0].profile, note, expectedWorkspaceRevision: start.revision + 5 });
  assert.equal(stale.status, 409);
  const loaded = await call('/api/profile', { profile: details[0].profile, note, expectedWorkspaceRevision: start.revision }, 'load-va');
  assert.equal(loaded.status, 200); assert.equal(loaded.body.change.before, null); assert.equal(loaded.body.change.after.family, 'System delivery');
  const replay = await call('/api/profile', { profile: details[0].profile, note, expectedWorkspaceRevision: start.revision }, 'load-va');
  assert.equal(replay.status, 200);
  const afterLoad = (await call('/api/workspace')).body;
  assert.equal(afterLoad.events.filter(event => event.action === 'profile-loaded').length, 1);
  assert.equal(afterLoad.cases.length, start.cases.length);
});

test('profile metadata: optional, trimmed, and absent when omitted or null', () => {
  const base = profileA;
  assert.deepEqual(validateProfile({ ...base, businessUnit: '  Example office  ', family: ' System delivery ' }, []), { ...base, businessUnit: 'Example office', family: 'System delivery' });
  assert.deepEqual(validateProfile({ ...base, businessUnit: null, family: null }, []), base);
  assert.deepEqual(validateProfile(base, []), base);
  for (const bad of [{ businessUnit: '   ' }, { family: '' }, { businessUnit: 7 }, { family: ['x'] }, { businessUnit: 'x'.repeat(121) }, { family: 'x'.repeat(81) }])
    assert.throws(() => validateProfile({ ...base, ...bad }, []), error => error.status === 400);
});

test('preset cases: metadata, unknown start, neutral wording, evidence journey, and unchanged protections', async t => {
  const holder = await workspace(t);
  const call = (...args) => holder.app.call(...args);
  const at = async path => (await call(path)).body.case.revision;
  const defaultBefore = (await call('/api/cases/DEMO-VA-001')).body;
  const plain = (await call('/api/cases', { title: 'Default case with undecided checks', owner: 'Demo officer', note })).body.case;

  // An existing custom-profile case, created before any preset is loaded.
  await call('/api/profile', { profile: profileA, note });
  const custom = (await call('/api/cases', { title: 'Existing custom case', owner: 'Demo reviewer', note })).body.case;
  assert.equal(Object.hasOwn(custom, 'businessUnit'), false); assert.equal(Object.hasOwn(custom, 'recordFamily'), false);

  const preset = async id => (await call(`/api/profile-presets/${id}`)).body.profile;
  await call('/api/profile', { profile: await preset('va-system-delivery'), note });
  const va = (await call('/api/cases', { title: 'VA scheduling tool, release 2.4 (synthetic)', owner: 'Demo system owner', note })).body.case;
  assert.equal(va.agency, 'Department of Veterans Affairs (synthetic example)');
  assert.equal(va.businessUnit, 'Example delivery office (synthetic)'); assert.equal(va.recordFamily, 'System delivery');
  assert.equal(Object.keys(va.applicability).length, 6); assert.ok(Object.values(va.applicability).every(value => value === 'unknown'));
  const vaPath = `/api/cases/${va.id}`;
  let detail = (await call(vaPath)).body;
  const checks = () => detail.report.findings.filter(finding => finding.category === 'contracting');
  assert.equal(checks().length, 6, 'evidence checks keep the internal category');
  assert.ok(checks().every(finding => finding.status === 'needs-review' && finding.nextAction === 'Ask the responsible reviewer whether this check applies to this case.'));
  assert.ok(detail.sources.every(source => source.id.startsWith('va-sd-')));

  // Relevant and missing stays an evidence gap. Outside scope, with a rationale, is not applicable. Undecided stays unknown.
  assert.equal((await call(`${vaPath}/context`, { expectedRevision: await at(vaPath), note: 'Reviewer: this release changed the design, so design evidence is in scope. The release notes state no requirement changed, so requirements evidence is outside this review.', applicability: { 'design-evidence': 'yes', 'requirements-evidence': 'no', 'test-evidence': 'yes' } })).status, 200);
  detail = (await call(vaPath)).body;
  const statusOf = kind => detail.report.findings.find(finding => finding.id === `${va.id}:${kind}`);
  assert.equal(statusOf('design-evidence').status, 'needs-evidence');
  assert.equal(statusOf('requirements-evidence').status, 'not-applicable');
  assert.equal(statusOf('requirements-evidence').nextAction, 'Confirm the applicability decision against the recorded scope of this case.');
  assert.equal(statusOf('release-evidence').status, 'needs-review');

  // The evidence journey on a preset case: reference, verification, assessment, then an applicability change flags it.
  const evidence = (await call(`${vaPath}/evidence`, { kind: 'test-evidence', title: 'Synthetic test report', locator: 'synthetic://tests/2.4', expectedRevision: await at(vaPath) })).body;
  assert.equal((await call(`${vaPath}/verify-evidence`, { evidenceId: evidence.id, note, expectedRevision: await at(vaPath) })).status, 200);
  const body = { expectedRevision: await at(vaPath), findingId: `${va.id}:test-evidence`, evidenceIds: [evidence.id], outcome: 'sufficient-for-stated-check', rationale: 'Synthetic rationale for the test evidence check only.' };
  assert.equal((await call(`${vaPath}/assessments`, { ...body, expectedRevision: 9 })).status, 409);
  assert.equal((await call(`${vaPath}/assessments`, body, 'assess-va')).status, 201);
  assert.equal((await call(`${vaPath}/assessments`, body, 'assess-va')).status, 201, 'replay returns the stored result');
  const freshnessOf = async () => (await call(`${vaPath}/evidence-review`)).body.findings.find(finding => finding.findingId === `${va.id}:test-evidence`).currentAssessment.freshness;
  assert.equal((await freshnessOf()).state, 'current');
  // Passages need the document service; without it the link is refused and nothing is stored.
  assert.equal((await call(`${vaPath}/citations`, { expectedRevision: await at(vaPath), note, findingId: `${va.id}:test-evidence`, evidenceId: evidence.id, documentId: 'doc-1', sha256: 'a'.repeat(64), spanId: 'span-1', quote: 'x' })).status, 503);
  assert.equal((await call(`${vaPath}/context`, { expectedRevision: await at(vaPath), note, applicability: { 'test-evidence': 'unknown' } })).status, 200);
  const flagged = await freshnessOf();
  assert.equal(flagged.state, 'needs-review'); assert.ok(flagged.causes.some(cause => cause.code === 'applicability-changed'));

  // Guided tools recognize evidence checks on default, custom, and preset cases alike.
  const explain = tools.find(tool => tool.name === 'explain_finding');
  const evidenceFor = tools.find(tool => tool.name === 'evidence_for_finding');
  const stored = (await call('/api/workspace')).body.cases;
  for (const [id, kind] of [['DEMO-VA-001', 'signed-award'], [custom.id, 'plan-evidence'], [va.id, 'test-evidence']]) {
    const item = stored.find(entry => entry.id === id);
    assert.equal(explain.run({ item, asOf, findingId: `${id}:${kind}` }).applicability, item.applicability[kind]);
    assert.equal(evidenceFor.run({ item, asOf, findingId: `${id}:${kind}` }).usesEvidence, true);
    const guided = await call(`/api/cases/${id}/agent`, { intent: 'explain-finding', findingId: `${id}:${kind}` });
    assert.equal(guided.status, 200);
  }

  // Records under a preset: unknown without a schedule, non-final-payment triggers refused, holds block, nothing permits destruction.
  const withRecord = (await call(`${vaPath}/records`, { expectedRevision: await at(vaPath), note, title: 'Synthetic release record' })).body.case;
  const recordId = withRecord.records[0].id;
  assert.equal((await call(`${vaPath}/records/${recordId}`, { expectedRevision: await at(vaPath), note, schedule: { authority: 'GRS 3.1 item 011', years: 5, trigger: 'system-terminated', confirmed: true } })).status, 400);
  let report = (await call(`${vaPath}/report`)).body;
  assert.equal(report.records[0].retention.status, 'unknown'); assert.equal(report.records[0].retention.canDestroy, false);
  assert.equal((await call(`${vaPath}/records/${recordId}/hold`, { expectedRevision: await at(vaPath), note, status: 'active', reference: 'SYN-HOLD-1' })).status, 200);
  report = (await call(`${vaPath}/report`)).body;
  assert.equal(report.records[0].retention.status, 'blocked'); assert.equal(report.records[0].retention.canDestroy, false);

  // SSA statement example: undecided, justified not applicable, and applicable but missing.
  await call('/api/profile', { profile: await preset('ssa-benefit-statement'), note });
  const states = {};
  for (const [label, applies] of [['undecided', null], ['ssi-only', 'no'], ['expected', 'yes']]) {
    const item = (await call('/api/cases', { title: `Statement review, ${label} (synthetic)`, owner: 'Demo reviewer', note })).body.case;
    assert.equal(item.agency, 'Social Security Administration (synthetic example)'); assert.equal(item.recordFamily, 'Tax and financial');
    assert.deepEqual(item.applicability, { 'benefit-statement': 'unknown' });
    if (applies) assert.equal((await call(`/api/cases/${item.id}/context`, { expectedRevision: await at(`/api/cases/${item.id}`), note: 'Reviewer decision recorded from the synthetic payment program for the year.', applicability: { 'benefit-statement': applies } })).status, 200);
    const found = (await call(`/api/cases/${item.id}`)).body;
    states[label] = found.report.findings.find(finding => finding.id === `${item.id}:benefit-statement`).status;
    assert.ok(found.sources.some(source => source.id === 'ssa-bs-ssa-tax-form'));
    assert.equal(JSON.stringify(found.report).includes('taxable'), false);
  }
  assert.deepEqual(states, { undecided: 'needs-review', 'ssi-only': 'not-applicable', expected: 'needs-evidence' });

  // Older cases are untouched by all of this: same stored case, same findings, same wording, no new keys.
  const defaultAfter = (await call('/api/cases/DEMO-VA-001')).body;
  assert.deepEqual(defaultAfter.case, defaultBefore.case); assert.deepEqual(defaultAfter.report, defaultBefore.report);
  assert.deepEqual(defaultAfter.sources, defaultBefore.sources);
  const plainChecks = (await call(`/api/cases/${plain.id}`)).body.report.findings.filter(finding => finding.category === 'contracting');
  assert.ok(plainChecks.length === 4 && plainChecks.every(finding => finding.nextAction === 'Ask the contracting officer whether this evidence is applicable.'));
  const customAfter = (await call(`/api/cases/${custom.id}`)).body;
  assert.deepEqual(customAfter.case, custom); assert.equal(sharedIn(customAfter.sources).title, 'Stored source A');
  const vaAfter = (await call(vaPath)).body.case;
  assert.equal(vaAfter.recordFamily, 'System delivery'); assert.equal(vaAfter.agency, va.agency);
});
