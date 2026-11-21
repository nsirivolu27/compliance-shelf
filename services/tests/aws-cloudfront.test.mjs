import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import crypto from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { cloudfrontTemplate } from '../../infra/aws-demo/cloudfront-template.mjs';
const code = await readFile(new URL('../../infra/aws-demo/edge-auth.js', import.meta.url), 'utf8');

test('CloudFront denies missing/wrong passwords on pages and APIs and strips valid credentials', () => {
  const authorization = 'Basic ' + Buffer.from('reviewer:SyntheticTestOnly!').toString('base64');
  const hash = createHash('sha256').update(authorization).digest('hex');
  const context = { require: name => { assert.equal(name, 'crypto'); return crypto; } };
  runInNewContext(code.replace('__AUTH_HASH__', hash), context);
  for (const uri of ['/', '/api/cases', '/api/export', '/js/app.js']) {
    for (const value of [undefined, 'Basic wrong', 'x'.repeat(2049)]) {
      const headers = value === undefined ? {} : { authorization: { value } };
      const result = context.handler({ request: { uri, headers } });
      assert.equal(result.statusCode, 401);
      assert.equal(result.headers['cache-control'].value, 'no-store');
    }
    const request = { uri, headers: { authorization: { value: authorization }, origin: { value: 'https://example.cloudfront.net' } } };
    assert.equal(context.handler({ request }), request);
    assert.equal(request.headers.authorization, undefined);
    assert.ok(request.headers.origin);
  }
});

test('domain-free demo keeps the server private, disables caches and protects every request', () => {
  const stack = cloudfrontTemplate("#!/bin/bash\nsetup '${DemoDomain}'", code);
  assert.equal(stack.Parameters.DemoDomain, undefined);
  assert.equal(stack.Resources.Listener, undefined);
  const instance = stack.Resources.Instance.Properties;
  assert.equal(instance.NetworkInterfaces[0].AssociatePublicIpAddress, false);
  assert.equal(instance.NetworkInterfaces[0].SubnetId.Ref, 'PrivateSubnet');
  assert.doesNotMatch(JSON.stringify(instance.UserData), /DemoDomain/);
  const behavior = stack.Resources.Distribution.Properties.DistributionConfig.DefaultCacheBehavior;
  assert.equal(behavior.CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
  assert.equal(behavior.FunctionAssociations[0].EventType, 'viewer-request');
  assert.equal(behavior.ViewerProtocolPolicy, 'redirect-to-https');
  assert.equal(stack.Resources.InstanceSecurity.Properties.SecurityGroupIngress[0].CidrIp, undefined);
});
