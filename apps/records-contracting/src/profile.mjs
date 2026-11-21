// Workspace profile: who the workspace belongs to and which checks new cases use.
// Loading a profile never changes an existing case, finding, record, or hold.
import { defaultCheckSet } from './lib/core/compliance.ts';
import { validateProfile } from './lib/core/profile.ts';

function fail(message, status = 400, extra = {}) { return Object.assign(new Error(message), { status, ...extra }); }

const limitation = 'A profile names evidence checks and cites sources. It cannot score a case, mark it compliant, release a hold, or authorize destruction. Unknown applicability stays unknown until a reviewer decides it.';
const exampleProfile = { organization: { name: 'Department of Veterans Affairs', kind: 'agency' }, checkSet: defaultCheckSet, sources: [] };

/**
 * Sources for one case: the built-in registry plus only the sources stored with that case.
 * A case never takes source content from the loaded profile or from another case, so a later
 * profile that reuses a source ID cannot change what an older case shows or exports.
 * A source the case cites but does not hold stays unresolved.
 */
export function sourcesForCase(builtIn, item) {
  const own = (item?.checkSet?.sources ?? []).filter(source => !builtIn.some(entry => entry.id === source.id));
  return [...builtIn, ...own];
}

/**
 * Workspace discovery list: built-in sources, then the loaded profile's, then any stored with a case.
 * One entry per ID, first one wins. Use it for workspace-wide listings only, never to resolve a case's sources.
 */
export function sourcesFor(builtIn, state) {
  const all = [...builtIn, ...(state.profile?.sources ?? []), ...state.cases.flatMap(item => item.checkSet?.sources ?? [])];
  return all.filter((source, index) => all.findIndex(other => other.id === source.id) === index);
}

/** Options for a new case: nothing for the built-in example, or the loaded organization and checks. */
export function newCaseOptions(state) {
  if (!state.profile) return { prefix: 'DEMO-VA', options: {} };
  const { businessUnit, family } = state.profile;
  return { prefix: 'DEMO', options: { organization: state.profile.organization.name, checkSet: { ...state.profile.checkSet, sources: state.profile.sources }, ...(businessUnit ? { businessUnit } : {}), ...(family ? { recordFamily: family } : {}) } };
}

function view(state) {
  return { profile: state.profile ?? exampleProfile, builtIn: !state.profile, workspaceRevision: state.revision, limitation };
}

export async function handleProfile({ pathname, method, readBody, store, builtInSources }) {
  if (pathname !== '/api/profile') return null;
  if (method === 'GET') return { status: 200, body: view(store.read()) };
  if (method !== 'POST') throw fail('Method not allowed', 405);
  const body = await readBody();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Expected a JSON object');
  for (const key of Object.keys(body)) if (!['profile', 'reset', 'note', 'expectedWorkspaceRevision'].includes(key)) throw fail('Unsupported field');
  if (typeof body.note !== 'string' || body.note.trim().length < 10 || body.note.length > 2000) throw fail('Provide a note of 10 to 2000 characters');
  if ((body.reset === true) === (body.profile !== undefined)) throw fail('Provide a profile, or set reset to true');
  if (body.reset !== undefined && body.reset !== true) throw fail('reset must be true when present');
  const profile = body.reset ? null : validateProfile(body.profile, builtInSources.map(source => source.id));
  const expected = body.expectedWorkspaceRevision;
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0)) throw fail('expectedWorkspaceRevision must be a non-negative integer');
  const result = await store.mutate(profile ? 'profile-loaded' : 'profile-reset', null, state => {
    if (expected !== undefined && state.revision !== expected) throw fail('The workspace changed since the profile was loaded. Reload and retry.', 409, { currentRevision: state.revision });
    const before = state.profile ?? null;
    if (profile) state.profile = profile; else delete state.profile;
    return { profile: profile ?? exampleProfile, builtIn: !profile, change: { note: body.note.trim(), before, after: profile } };
  });
  return { status: 200, body: { ...result, workspaceRevision: store.read().revision, limitation } };
}
