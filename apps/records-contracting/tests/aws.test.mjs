import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createS3Snapshot } from '../src/aws/s3-snapshot.mjs';
import { createLambdaHandler } from '../src/aws/handler.mjs';
import { createStore } from '../src/store.mjs';
import { authorizeCloudRequest } from '../src/lib/core/cloud-access.ts';

const config = { WORKSPACE_BUCKET: 'test-bucket', WORKSPACE_KEY: 'workspaces/demo/workspace.json', COGNITO_ISSUER: 'https://issuer.example/pool', COGNITO_CLIENT_ID: 'test-client' };
const claims = (roles = ['reviewer'], sub = 'reviewer-1') => ({ iss: config.COGNITO_ISSUER, client_id: config.COGNITO_CLIENT_ID, token_use: 'access', sub, 'cognito:groups': roles });
function memoryS3() {
  let body;
  let version = 0;
  return {
    get state() { return body ? JSON.parse(body) : null; },
    async get() {
      if (body === undefined) throw Object.assign(new Error('Missing'), { name: 'NoSuchKey' });
      const snapshot = body;
      return { ETag: `"${version}"`, ContentLength: Buffer.byteLength(snapshot), Body: { transformToString: async () => snapshot } };
    },
    async put(input) {
      assert.equal(input.ServerSideEncryption, 'AES256');
      if (body === undefined ? input.IfNoneMatch !== '*' : input.IfMatch !== `"${version}"`) throw Object.assign(new Error('Conflict'), { name: 'PreconditionFailed' });
      body = input.Body; version++;
      return { ETag: `"${version}"` };
    },
  };
}
const backend = transport => createS3Snapshot({ transport, bucket: config.WORKSPACE_BUCKET, key: config.WORKSPACE_KEY });

test('S3 conditional writes reject stale workers and preserve their last committed memory', async () => {
  const s3 = memoryS3();
  const cases = JSON.parse(await readFile(new URL('../data/demo-cases.json', import.meta.url), 'utf8'));
  const first = await createStore(null, cases, { backend: backend(s3), actor: 'operator-1' });
  const second = await createStore(null, cases, { backend: backend(s3), actor: 'operator-2' });
  const edit = state => { state.cases[0].title = 'Changed'; return state.cases[0]; };
  await first.mutate('context', cases[0].id, edit);
  await assert.rejects(second.mutate('context', cases[0].id, edit), error => error.status === 409);
  assert.equal(second.read().revision, 0);
  assert.equal(s3.state.events.length, 1);
  assert.equal(s3.state.events[0].actor, 'operator-1');
  const freshA = await createStore(null, cases, { backend: backend(s3) });
  const freshB = await createStore(null, cases, { backend: backend(s3) });
  await freshA.mutate('context', cases[0].id, edit);
  await assert.rejects(freshB.mutate('context', cases[0].id, edit), error => error.status === 409);
  assert.equal(s3.state.events.length, 2);
});

test('S3 storage never treats denied access or corrupt data as an empty workspace', async () => {
  await assert.rejects(backend({ get: async () => { throw Object.assign(new Error('Denied'), { name: 'AccessDenied' }); } }).load(), /Denied/);
  await assert.rejects(backend({ get: async () => ({ ETag: 'etag', Body: { transformToString: async () => 'null' } }) }).load(), /Invalid workspace/);
  const snapshot = backend(memoryS3());
  await assert.rejects(snapshot.save({}), /Load workspace/);
  await snapshot.load();
  await assert.rejects(snapshot.save({ text: 'x'.repeat(4 * 1024 * 1024) }), e => e.status === 413);
});

test('cloud roles and verified claims control writes before storage access', () => {
  const check = (identity, method, path) => authorizeCloudRequest(identity, method, path, config.COGNITO_ISSUER, config.COGNITO_CLIENT_ID);
  for (const identity of [undefined, { ...claims(), token_use: 'id' }, { ...claims(), iss: 'other' }, { ...claims(), client_id: 'other' }]) assert.throws(() => check(identity, 'GET', '/api/workspace'), e => e.status === 401);
  assert.throws(() => check(claims([]), 'GET', '/api/workspace'), e => e.status === 403);
  assert.equal(check(claims(['reader']), 'GET', '/api/workspace').actor, 'reviewer-1');
  assert.equal(check(claims(['reader']), 'POST', '/api/cases/DEMO-VA-001/agent').authenticated, true);
  assert.throws(() => check(claims(['reader']), 'POST', '/api/cases'), e => e.status === 403);
  assert.throws(() => check(claims(['reviewer']), 'POST', '/api/cases/DEMO-VA-001/records/REC-001/hold'), e => e.status === 403);
  assert.equal(check(claims('[records-officer]'), 'POST', '/api/cases/DEMO-VA-001/records/REC-001/hold').roles[0], 'records-officer');
  assert.throws(() => check(claims(['records-officer']), 'POST', '/api/cases'), e => e.status === 403);
  assert.equal(check(claims(['admin']), 'POST', '/api/cases').roles[0], 'admin');
});

test('Lambda uses verified actors, isolates retry keys by user, and returns original evidence/review IDs', async () => {
  const s3 = memoryS3();
  let loads = 0;
  const handler = createLambdaHandler({ config, snapshotFactory: async () => { loads++; return backend(s3); } });
  const invoke = async (method, path, body, key, identity = claims()) => {
    const response = await handler({ version: '2.0', rawPath: path, rawQueryString: 'asOf=2026-11-15', headers: { 'content-type': 'application/json', 'x-actor': 'spoofed-admin', ...(key ? { 'idempotency-key': key } : {}) }, requestContext: { http: { method }, authorizer: { jwt: { claims: identity } } }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  };
  assert.equal((await invoke('GET', '/api/workspace', undefined, undefined, null)).status, 401);
  assert.equal((await invoke('POST', '/api/cases', {}, 'unauthorized', claims(['reader']))).status, 403);
  assert.equal(loads, 0);
  assert.equal((await invoke('GET', '/api/session')).body.actor, 'reviewer-1');
  assert.equal((await invoke('GET', '/api/dashboard')).body.mode, 'aws-pilot');
  const evidence = { title: 'Synthetic funding', kind: 'funding', locator: 'demo://aws-test' };
  const path = '/api/cases/DEMO-VA-001';
  const created = await invoke('POST', path + '/evidence', evidence, 'evidence-1');
  assert.equal(created.status, 201);
  assert.deepEqual(await invoke('POST', path + '/evidence', evidence, 'evidence-1'), created);
  assert.equal(s3.state.events.length, 1);
  const other = await invoke('POST', path + '/evidence', evidence, 'evidence-1', claims(['reviewer'], 'reviewer-2'));
  assert.notEqual(other.body.id, created.body.id);
  assert.equal(s3.state.events[0].actor, 'reviewer-1');
  assert.equal(s3.state.events[1].actor, 'reviewer-2');
  const review = { findingId: 'DEMO-VA-001:funding', disposition: 'request-evidence', note: 'Please review this synthetic evidence.' };
  const reviewed = await invoke('POST', path + '/reviews', review, 'review-1');
  assert.equal(reviewed.status, 201);
  assert.deepEqual(await invoke('POST', path + '/reviews', review, 'review-1'), reviewed);
  assert.equal(s3.state.events.length, 3);
  assert.equal((await invoke('GET', '/api/video/tasks')).body.status, 'disabled');
  assert.equal((await invoke('GET', path)).body.report.records.find(r => r.id === 'REC-001').retention.canDestroy, false);
});

test('deployment template protects every API route and keeps storage and users on stack deletion', async () => {
  const template = JSON.parse(await readFile(new URL('../../../infra/aws/template.json', import.meta.url), 'utf8'));
  const resources = template.Resources;
  for (const resource of Object.values(resources).filter(r => r.Type === 'AWS::ApiGatewayV2::Route')) {
    assert.equal(resource.Properties.AuthorizationType, 'JWT');
    assert.ok(resource.Properties.AuthorizationScopes.length);
  }
  assert.equal(resources.WorkspaceBucket.DeletionPolicy, 'Retain');
  assert.equal(resources.WorkspaceBucket.Properties.VersioningConfiguration.Status, 'Enabled');
  assert.ok(Object.values(resources.WorkspaceBucket.Properties.PublicAccessBlockConfiguration).every(Boolean));
  assert.equal(resources.UserPool.Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly, true);
  const statements = resources.FunctionRole.Properties.Policies.flatMap(p => p.PolicyDocument.Statement);
  assert.ok(statements.every(s => !s.Action.includes('s3:DeleteObject') && s.Resource !== '*'));
  assert.equal(resources.InvokePermission.Properties.SourceAccount.Ref, 'AWS::AccountId');
});

test('a lost S3 write acknowledgement can be retried without a second mutation', async () => {
  const s3 = memoryS3();
  let loseReply = true;
  const transport = {
    get: input => s3.get(input),
    async put(input) {
      const result = await s3.put(input);
      if (loseReply) { loseReply = false; throw new Error('Connection lost after commit'); }
      return result;
    },
  };
  const handler = createLambdaHandler({ config, snapshotFactory: async () => backend(transport) });
  const event = { version: '2.0', rawPath: '/api/cases/DEMO-VA-001/evidence', rawQueryString: '', headers: { 'content-type': 'application/json', 'idempotency-key': 'lost-response' }, requestContext: { http: { method: 'POST' }, authorizer: { jwt: { claims: claims() } } }, body: JSON.stringify({ title: 'Synthetic funds', kind: 'funding', locator: 'demo://lost-reply' }) };
  assert.equal((await handler(event)).statusCode, 500);
  assert.equal(s3.state.events.length, 1);
  const retried = await handler(event);
  assert.equal(retried.statusCode, 201);
  assert.equal(JSON.parse(retried.body).id, s3.state.events[0].details.id);
  assert.equal(s3.state.events.length, 1);
});
