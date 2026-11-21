/** Claims must come from API Gateway's verified JWT context, never request headers. */
export function authorizeCloudRequest(claims: Record<string, unknown> | undefined, method: string, path: string, issuer: string, audience: string) {
  function fail(message: string, status: number): never { throw Object.assign(new Error(message), { status }); }
  if (!issuer || !audience) fail('Cloud identity configuration is missing.', 503);
  if (!claims || claims.iss !== issuer || claims.client_id !== audience || claims.token_use !== 'access' || typeof claims.sub !== 'string' || !claims.sub.trim()) fail('A verified Cognito access token is required.', 401);
  const value = claims['cognito:groups'];
  const groups = Array.isArray(value) ? value : typeof value === 'string' ? value.replace(/[\[\]"]/g, '').split(/[\s,]+/) : [];
  const roles = groups.filter((role): role is string => typeof role === 'string' && ['reader', 'reviewer', 'records-officer', 'admin'].includes(role));
  if (!roles.length) fail('An assigned platform role is required.', 403);
  if (!path.startsWith('/api/')) fail('Only API routes are exposed by this service.', 404);
  if (method !== 'GET' && method !== 'POST') fail('Method not allowed', 405);
  if (method === 'POST') {
    const recordChange = /^\/api\/cases\/[^/]+\/records(?:\/|$)/.test(path);
    const guidedRead = /^\/api\/cases\/[^/]+\/agent$/.test(path);
    if (!guidedRead && !roles.includes('admin') && !(recordChange ? roles.includes('records-officer') : roles.includes('reviewer'))) fail('Your role cannot perform this operation.', 403);
  }
  return { mode: 'aws-pilot', authenticated: true, actor: claims.sub as string, roles };
}
