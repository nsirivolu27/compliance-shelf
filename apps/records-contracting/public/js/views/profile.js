// Check profile: who this workspace belongs to and which evidence checks new cases
// are screened against. Any agency or company can load its own list of checks.
// A profile only names checks and cites sources. It cannot score or clear a case.

import * as api from '../api.js';
import { h, button, pageHeader, notice, facts, externalLink, loadingState, errorState, dataTable, announce, formatDay, rememberChecks } from '../dom.js';
import { openForm, noteField } from '../forms.js';
import { downloadText } from '../csv.js';

const organizationKinds = { agency: 'Government agency', company: 'Company', other: 'Other organization' };

export function create(route, ctx) {
  const body = h('div', { class: 'stack' }, loadingState('Loading the check profile…'));
  let current = null;
  let presets = null;
  const presetProblem = h('div');

  // Fetch one example and open the editor with it. Reading a preset changes nothing on the server.
  async function choosePreset(summary) {
    presetProblem.replaceChildren();
    try {
      const detail = await api.getPreset(summary.id);
      loadProfile({ name: summary.name, profile: detail.profile });
    } catch (error) {
      presetProblem.replaceChildren(errorState(error, () => choosePreset(summary)));
    }
  }

  // The server validates everything again. This only catches text that is not JSON.
  function parseProfile(text) {
    try {
      const value = JSON.parse(text);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch { return null; }
  }

  async function afterChange(message) {
    announce(message);
    // Source lists elsewhere in the application come from the workspace reference.
    try {
      const reference = await api.getReference();
      ctx.sources = reference.sources;
      ctx.builtInSources = reference.sources.filter(source => (reference.builtInSourceIds ?? []).includes(source.id));
    } catch (error) { presetProblem.replaceChildren(errorState(error, () => afterChange('Reloading profile references.'))); }
    await load();
  }

  // With a preset, the editor opens filled in. Nothing is loaded until the form is submitted with a note.
  function loadProfile(preset) {
    openForm({
      title: preset ? `Review and load: ${preset.name}` : 'Load a check profile',
      intro: preset
        ? 'This example fills the editor below. Review it, change it if you need to, and add a note to load it. New cases will use it. Existing cases keep their own checks and sources, and no case is created.'
        : 'Paste a profile as JSON. Download the current profile to use as a template. New cases will use the loaded organization and checks. Existing cases, findings, records, and holds are not changed.',
      submitLabel: 'Load profile',
      fields: [
        { name: 'profile', type: 'textarea', label: 'Profile JSON', required: true, rows: 14, maxlength: 60000, value: preset ? `${JSON.stringify(preset.profile, null, 2)}\n` : '',
          hint: 'Use only made-up organizations and public sources. Do not paste nonpublic contracting, employee, or patient data.' },
        noteField('Why this profile is being loaded'),
      ],
      validate: values => (parseProfile(values.profile) ? null : { profile: 'Profile JSON is not a valid JSON object.' }),
      submit: (values, keyFor) => {
        const payload = { profile: parseProfile(values.profile), note: values.note, expectedWorkspaceRevision: current.workspaceRevision };
        return api.saveProfile(payload, keyFor(payload));
      },
      onConflict: () => load(),
      onSuccess: () => afterChange('Profile loaded. New cases will use its checks.'),
    });
  }

  function restoreExample() {
    openForm({
      title: 'Restore the built-in example',
      intro: 'New cases will go back to the built-in example checks. Cases created under the loaded profile keep their own checks and sources.',
      submitLabel: 'Restore example',
      fields: [noteField('Why the example is being restored')],
      submit: (values, keyFor) => {
        const payload = { reset: true, note: values.note, expectedWorkspaceRevision: current.workspaceRevision };
        return api.saveProfile(payload, keyFor(payload));
      },
      onConflict: () => load(),
      onSuccess: () => afterChange('Built-in example restored.'),
    });
  }

  function download() {
    downloadText('Compliance Shelf check profile.json', `${JSON.stringify(current.profile, null, 2)}\n`, 'application/json');
    announce('Profile downloaded.');
  }

  async function load() {
    try {
      current = await api.getProfile();
      presets = await api.getPresets();
    } catch (error) {
      body.replaceChildren(errorState(error, load));
      return;
    }
    const { profile, builtIn } = current;
    rememberChecks(profile.checkSet.checks);
    const titleOf = id => [...ctx.builtInSources, ...profile.sources].find(source => source.id === id)?.title || id;
    const cited = ids => h('ul', { class: 'plain-list' }, ids.map(id => h('li', null, titleOf(id))));

    body.replaceChildren(...[
      builtIn
        ? notice('info', 'This workspace uses the built-in example.', 'The example screens a federal contract file and cites one agency\'s records directive. Load your own profile to screen new cases against the checks your organization answers to.')
        : notice('info', 'This workspace uses a loaded profile.', 'New cases use the checks listed here. Cases created earlier keep the checks they were created with.'),
      h('section', null,
        h('h2', null, 'Organization and check set'),
        facts([
          ['Organization', profile.organization.name],
          ['Type', organizationKinds[profile.organization.kind] || profile.organization.kind],
          ['Business unit', profile.businessUnit || h('span', { class: 'missing' }, 'Not recorded')],
          ['Record family', profile.family || h('span', { class: 'missing' }, 'Not recorded')],
          ['Check set', `${profile.checkSet.name} (${profile.checkSet.id})`],
          ['Policy version check cites', cited(profile.checkSet.policySourceIds)],
          ['Record checks cite', cited(profile.checkSet.recordsSourceIds)],
        ], true)),
      h('section', null,
        h('h2', null, 'Evidence checks'),
        h('p', { class: 'hint' }, 'Each check asks for an evidence reference. Applicability starts as unknown on every new case and stays unknown until a reviewer decides it.'),
        dataTable({
          label: 'Evidence checks',
          rows: profile.checkSet.checks,
          columns: [
            { header: 'Check', cell: check => h('span', { class: 'wrap' }, check.title) },
            { header: 'Identifier', cell: check => h('span', { class: 'mono' }, check.kind) },
            { header: 'Cites', cell: check => cited(check.sourceIds) },
          ],
        })),
      profile.checkSet.expectedRecords?.length > 0 && h('section', null,
        h('h2', null, 'Expected record types'),
        h('p', { class: 'hint' }, 'Record types this check set expects a case to hold. A type with no inventoried record is reported as a documentation gap. Whether a record must be kept is for a records officer.'),
        dataTable({
          label: 'Expected record types',
          rows: profile.checkSet.expectedRecords,
          columns: [
            { header: 'Record type', cell: entry => h('span', { class: 'wrap' }, entry.title) },
            { header: 'Identifier', cell: entry => h('span', { class: 'mono' }, entry.kind) },
            { header: 'Cites', cell: entry => cited(entry.sourceIds) },
          ],
        })),
      profile.sources.length > 0 && h('section', null,
        h('h2', null, 'Sources added by this profile'),
        h('div', { class: 'stack' }, profile.sources.map(source =>
          h('section', { class: 'source-entry' },
            h('h3', null, source.title),
            facts([
              ['Cited section', source.locator],
              ['Scope and limits', source.scope],
              ['Last checked', formatDay(source.checkedOn)],
              ['Link', externalLink(source.url, source.url)],
            ], true))))),
      h('section', null,
        h('h2', null, 'Example presets'),
        h('p', { class: 'hint' }, presets.limitation),
        presetProblem,
        h('div', { class: 'preset-cards' }, presets.presets.map(preset => h('article', { class: 'preset-card' },
          h('h3', null, preset.name), h('p', null, preset.description),
          h('p', { class: 'hint' }, `${preset.organization} · ${preset.family} · ${preset.checkCount} checks`),
          h('p', { class: 'hint' }, presets.limitation),
          button('Review and load', () => choosePreset(preset), 'button-small', `preset-${preset.id}`))))),
      h('p', { class: 'hint' }, 'Loading a profile is not isolation between organizations. Every case in this workspace stays visible, and each case keeps the checks and sources it was created with.'),
      h('p', { class: 'hint' }, current.limitation),
    ].filter(Boolean));
    restore.hidden = builtIn;
  }

  const restore = button('Restore example', restoreExample, '', 'profile-restore');
  restore.hidden = true;
  load();
  return {
    key: 'profile',
    el: h('div', null,
      pageHeader('Check profile', 'Who this workspace belongs to and which evidence checks new cases are screened against. Any agency or company can load its own.',
        h('div', { class: 'button-row' }, button('Download profile', download, '', 'profile-download'), restore, button('Load a profile', () => loadProfile(), 'button-primary', 'profile-load'))),
      body),
  };
}
