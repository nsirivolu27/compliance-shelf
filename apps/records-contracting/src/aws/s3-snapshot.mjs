const MAX_BYTES = 4 * 1024 * 1024;
const fail = (message, status) => Object.assign(new Error(message), { status });

/** One small shared workspace, protected by S3 conditional writes across processes. */
export function createS3Snapshot({ transport, bucket, key }) {
  if (!bucket || !key) throw new Error('Workspace bucket and key are required');
  let loaded = false;
  let etag;
  return {
    async load() {
      try {
        const object = await transport.get({ Bucket: bucket, Key: key });
        if (!object.ETag) throw new Error('Workspace object has no ETag');
        if (object.ContentLength > MAX_BYTES) throw fail('Workspace exceeds the pilot storage limit.', 413);
        const text = await object.Body.transformToString();
        if (Buffer.byteLength(text) > MAX_BYTES) throw fail('Workspace exceeds the pilot storage limit.', 413);
        const state = JSON.parse(text);
        if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid workspace object');
        etag = object.ETag;
        loaded = true;
        return state;
      } catch (error) {
        if (error.name === 'NoSuchKey') { loaded = true; etag = undefined; return null; }
        throw error;
      }
    },
    async save(state) {
      if (!loaded) throw new Error('Load workspace before saving');
      const body = JSON.stringify(state);
      if (Buffer.byteLength(body) > MAX_BYTES) throw fail('Workspace exceeds the 4 MiB pilot limit. No change was saved.', 413);
      try {
        const result = await transport.put({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/json', ServerSideEncryption: 'AES256', ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }) });
        etag = result.ETag;
        // Missing write acknowledgement must not permit a later unconditional save.
        if (!etag) { loaded = false; throw new Error('Workspace write acknowledgement missing'); }
      } catch (error) {
        if (['PreconditionFailed', 'ConditionalRequestConflict'].includes(error.name) || [409, 412].includes(error.$metadata?.httpStatusCode)) {
          throw fail('Workspace changed in another request. Reload and retry with the same Idempotency-Key.', 409);
        }
        throw error;
      }
    },
  };
}

let transportPromise;
export async function awsSnapshot(config) {
  // Lambda Node.js supplies SDK v3. Local development never loads this dependency.
  transportPromise ??= import('@aws-sdk/client-s3').then(({ S3Client, GetObjectCommand, PutObjectCommand }) => {
    const client = new S3Client({ maxAttempts: 2 });
    return { get: input => client.send(new GetObjectCommand(input)), put: input => client.send(new PutObjectCommand(input)) };
  }).catch(error => { transportPromise = undefined; throw error; });
  return createS3Snapshot({ ...config, transport: await transportPromise });
}
