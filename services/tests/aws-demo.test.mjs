import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDemo, saveDemoMarker } from '../../infra/aws-demo/state.mjs';
import { proxyConfiguration } from '../../infra/aws-demo/nginx.mjs';
import { applicationTemplate, artifactTemplate } from '../../infra/aws-demo/template.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { busyPorts } from '../free-ports.mjs';

test('AWS demo restart preserves IDs and refuses a partial or mismatched workspace', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'cp-aws-state-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  assert.equal(await inspectDemo(folder, 'va-ssa'), null);
  await assert.rejects(inspectDemo(folder, 'other'), /Unknown/);
  await writeFile(join(folder, 'workspace.json'), JSON.stringify({ cases: [{ id: 'DEMO-VA' }, { id: 'DEMO-SSA' }] }));
  await assert.rejects(inspectDemo(folder, 'va-ssa'), /Incomplete/);
  await saveDemoMarker(folder, 'va-ssa', { va: 'DEMO-VA', ssa: 'DEMO-SSA' }, '2026-11-20');
  const before = await readFile(join(folder, 'workspace.json'), 'utf8');
  assert.equal((await inspectDemo(folder, 'va-ssa')).cases.ssa, 'DEMO-SSA');
  assert.equal(await readFile(join(folder, 'workspace.json'), 'utf8'), before);
  await assert.rejects(inspectDemo(folder, 'va-audit'), /does not match/);
  await writeFile(join(folder, 'workspace.json'), '{"cases":[]}');
  await assert.rejects(inspectDemo(folder, 'va-ssa'), /missing/);
  await writeFile(join(folder, 'workspace.json'), '{"cases":[{"id":"DEMO-AUDIT"}]}');
  await saveDemoMarker(folder, 'va-audit', { caseId: 'DEMO-AUDIT' }, '2026-11-20');
  await assert.rejects(inspectDemo(folder, 'va-audit'), /ENOENT/);
  await mkdir(join(folder, 'services'));
  await writeFile(join(folder, 'services/documents.json'), '{}');
  await writeFile(join(folder, 'services/jobs.json'), '{}');
  assert.equal((await inspectDemo(folder, 'va-audit')).cases.caseId, 'DEMO-AUDIT');
  await writeFile(join(folder, 'services/documents.json'), 'broken');
  await assert.rejects(inspectDemo(folder, 'va-audit'), SyntaxError);
});

test('AWS public entry has mandatory sign-in, scoped artifact access and no direct app ingress', () => {
  const stack = applicationTemplate('#!/bin/bash\n');
  const resources = stack.Resources;
  const actions = resources.Listener.Properties.DefaultActions;
  assert.equal(actions[0].Type, 'authenticate-cognito');
  assert.equal(actions[0].AuthenticateCognitoConfig.OnUnauthenticatedRequest, 'authenticate');
  assert.equal(actions[1].Type, 'forward');
  assert.equal(resources.Listener.Properties.Protocol, 'HTTPS');
  assert.equal(resources.UserPool.Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly, true);
  assert.deepEqual(resources.InstanceSecurity.Properties.SecurityGroupIngress, [{ IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, SourceSecurityGroupId: { Ref: 'BalancerSecurity' } }]);
  assert.equal(resources.Instance.Properties.MetadataOptions.HttpTokens, 'required');
  assert.equal(resources.Instance.Properties.BlockDeviceMappings[0].Ebs.Encrypted, true);
  const statement = resources.InstanceRole.Properties.Policies[0].PolicyDocument.Statement[0];
  assert.equal(statement.Action, 's3:GetObjectVersion');
  assert.deepEqual(statement.Condition.StringEquals['s3:VersionId'], { Ref: 'ArtifactVersion' });
  assert.equal(artifactTemplate().Resources.Artifacts.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy, true);
});

test('public proxy rejects unknown hosts and origins before translating valid same-origin requests', () => {
  const config = proxyConfiguration('demo.example.org', 5417);
  assert.match(config, /map \$http_origin \$origin_allowed \{\s+default 0;/);
  assert.match(config, /if \(\$origin_allowed = 0\) \{ return 403;/);
  assert.match(config, /if \(\$host_allowed = 0\) \{ return 421;/);
  assert.match(config, /"https:\/\/demo.example.org" "http:\/\/127.0.0.1:5417"/);
  assert.match(config, /proxy_set_header X-Platform-Token "";/);
  assert.throws(() => proxyConfiguration('example.org; return 200;', 5417), /domain/);
  assert.throws(() => proxyConfiguration('demo.example.org', 80), /port/);
});

test('persistent AWS entry starts and resumes both demos without duplicating reviewer history', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cp-aws-entry-'));
  const running = new Set();
  t.after(async () => {
    for (const demo of running) await demo.stop();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  let port;
  for (let i = 0; i < 50; i++) {
    port = 20000 + Math.floor(Math.random() * 30000);
    if (!(await busyPorts('127.0.0.1', Array.from({ length: 8 }, (_, j) => port + j))).length) break;
    port = undefined;
  }
  assert.ok(port);
  async function launch(scenario) {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../infra/aws-demo/start.mjs', import.meta.url))], {
      env: { ...process.env, PORT: String(port), DEMO_STATE_DIR: join(directory, scenario), DEMO_SCENARIO: scenario },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    });
    let logs = '';
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const exited = new Promise(resolve => child.once('exit', code => { readyReject(new Error(`Demo exited ${code}: ${logs}`)); resolve(code); }));
    child.on('error', readyReject);
    const timer = setTimeout(() => readyReject(new Error(`Demo readiness timeout: ${logs}`)), 50000);
    let pending = '';
    child.stdout.on('data', chunk => {
      logs += chunk; pending += chunk;
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try { const value = JSON.parse(line); if (value.status === 'ready') readyResolve(value); } catch { /* ordinary log */ }
      }
    });
    child.stderr.on('data', chunk => { logs += chunk; });
    const demo = { async stop() {
      if (child.connected) child.send('shutdown');
      const code = await exited;
      running.delete(demo);
      assert.equal(code, 0, logs);
    } };
    running.add(demo);
    try { demo.result = await ready; } finally { clearTimeout(timer); }
    return demo;
  }
  for (const scenario of ['va-ssa', 'va-audit']) {
    let demo = await launch(scenario);
    assert.equal(demo.result.resumed, false);
    const base = demo.result.base;
    const seeded = demo.result.cases;
    const id = seeded.va || seeded.caseId;
    const detail = await (await fetch(`${base}/api/cases/${id}`)).json();
    const response = await fetch(`${base}/api/cases/${id}/context`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `aws-restart-${scenario}` },
      body: JSON.stringify({ expectedRevision: detail.case.revision, contractNumber: 'SYN-AWS-RESTART-001', note: 'Synthetic saved reviewer context for restart verification.' }),
    });
    assert.equal(response.status, 200, await response.text());
    const before = await (await fetch(`${base}/api/workspace`)).json();
    await demo.stop();
    demo = await launch(scenario);
    assert.equal(demo.result.resumed, true);
    assert.deepEqual(demo.result.cases, seeded);
    const after = await (await fetch(`${base}/api/workspace`)).json();
    assert.deepEqual(after.events, before.events);
    assert.deepEqual(after.cases, before.cases);
    assert.equal((await (await fetch(`${base}/api/services`)).json()).status, 'ok');
    await demo.stop();
  }
});
