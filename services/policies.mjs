import { readFile } from 'node:fs/promises';
import { ruleVersion } from '../apps/records-contracting/src/lib/core/compliance.ts';
import { serviceServer, callService, digest, fail } from './common.mjs';

export async function createPoliciesService({ token, workflowUrl }) {
  const sources = JSON.parse(await readFile(new URL('../apps/records-contracting/data/sources.json', import.meta.url), 'utf8'));
  const snapshotId = digest(JSON.stringify(sources));
  // Sources a loaded check profile adds live with the workflow service. They are reported
  // separately so the packaged snapshot and its ID keep their meaning.
  const profileSources = async requestId => {
    if (!workflowUrl) return { status: 'unavailable', sources: [] };
    try {
      const { profile, builtIn } = await callService(workflowUrl, '/api/profile', token, { requestId, timeout: 2000 });
      return { status: 'available', builtIn, sources: Array.isArray(profile?.sources) ? profile.sources : [] };
    } catch { return { status: 'unavailable', sources: [] }; }
  };
  return serviceServer('policies', token, async ({ req, url, requestId }) => {
    if (!url.pathname.startsWith('/api/policies')) return null;
    if (req.method !== 'GET') throw fail('Policy snapshots are read-only', 405);
    if (url.pathname === '/api/policies') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      if (q.length > 200) throw fail('Search text is too long');
      const matches = source => [source.title, source.id, source.scope].some(text => text.toLowerCase().includes(q));
      const added = await profileSources(requestId);
      return { body: { ruleVersion, snapshotId, sources: sources.filter(matches), profileSources: { ...added, sources: added.sources.filter(matches) }, limitation: 'Packaged source registry, not an automatic policy update feed. Governing policy still requires human review.' } };
    }
    const id = url.pathname.slice('/api/policies/'.length);
    const packaged = sources.find(s => s.id === id);
    if (packaged) return { body: { ruleVersion, snapshotId, source: packaged } };
    const source = (await profileSources(requestId)).sources.find(s => s.id === id);
    if (!source) throw fail('Policy source not found', 404);
    return { body: { ruleVersion, snapshotId, source, origin: 'check-profile' } };
  });
}
