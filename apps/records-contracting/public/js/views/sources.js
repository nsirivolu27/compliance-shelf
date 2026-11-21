import { h, pageHeader, facts, externalLink, formatDay, errorState } from '../dom.js';
import { loadPolicyVersions, versionFacts } from './case-policy.js';

export function create(route, ctx) {
  // Policy versions: the same sources grouped into policies, with dates and open questions.
  const versions = h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'Loading policy versions…'));
  const load = () => loadPolicyVersions().then(result => {
    versions.replaceChildren(
      h('p', { class: 'hint' }, result.limitation),
      ...result.policies.map(policy => h('section', { class: 'source-entry' },
        h('h3', null, policy.title),
        h('div', { class: 'stack' }, policy.versions.map(versionFacts)))));
  }, error => versions.replaceChildren(errorState(error, load)));
  load();
  return {
    key: 'sources',
    el: h('div', null,
      pageHeader('Sources', 'Official authorities cited by the screening rules, with the section used and the limits of what each one supports.'),
      h('p', { class: 'hint' }, 'This is a workspace list: the built-in sources, then sources added by the loaded profile or stored with a case, one entry per identifier. A case always shows and exports its own stored sources, which may differ from an entry here that shares an identifier.'),
      h('div', { class: 'stack' }, ctx.sources.map(source =>
        h('section', { class: 'source-entry' },
          h('h2', null, source.title),
          facts([
            ['Cited section', source.locator],
            ['Scope and limits', source.scope],
            ['Last checked', formatDay(source.checkedOn)],
            ['Link', externalLink(source.url, source.url)],
          ], true))),
        h('section', null, h('h2', null, 'Policy versions'), versions))),
  };
}
