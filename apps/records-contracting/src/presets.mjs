// Example profiles shipped with the application. Reading one changes nothing: no revision, no event, no case.
// A preset is loaded like any other profile, through POST /api/profile with a note.
import { validateProfile } from './lib/core/profile.ts';

function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

const limitation = 'Example presets use made-up offices and public sources. Each check list is a configurable review aid, not a list of mandatory artifacts and not a statement that any schedule or rule applies to a case. Selecting a preset only fills the editor. Nothing is loaded until you submit it with a note, and no case is created.';

/** Validates every shipped preset once at startup, so a broken data file stops the server instead of reaching a user. */
export function readPresets(file, builtInSourceIds) {
  if (!file || !Array.isArray(file.presets)) throw new Error('Preset data must list presets');
  const presets = file.presets.map(entry => {
    const profile = validateProfile(entry.profile, builtInSourceIds);
    const summary = { id: entry.id, name: entry.name, description: entry.description, organization: profile.organization.name, businessUnit: profile.businessUnit ?? null, family: profile.family ?? null, checkCount: profile.checkSet.checks.length, sourceCount: profile.sources.length, example: true };
    return { summary, profile };
  });
  if (new Set(presets.map(preset => preset.summary.id)).size !== presets.length) throw new Error('Preset ids must be unique');
  return presets;
}

export function handlePresets({ pathname, method, presets }) {
  if (pathname !== '/api/profile-presets' && !pathname.startsWith('/api/profile-presets/')) return null;
  if (method !== 'GET') throw fail('Method not allowed', 405);
  if (pathname === '/api/profile-presets') return { status: 200, body: { presets: presets.map(preset => preset.summary), limitation } };
  const found = presets.find(preset => preset.summary.id === pathname.slice('/api/profile-presets/'.length));
  if (!found) throw fail('Preset not found', 404);
  return { status: 200, body: { preset: found.summary, profile: structuredClone(found.profile), limitation } };
}
