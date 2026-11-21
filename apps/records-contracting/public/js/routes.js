// The page names this application can show. The router and the assistant both use
// this list, so the assistant can never send someone to an address outside it.
export const routeNames = ['workbench', 'overview', 'cases', 'gaps', 'paperwork', 'benefits', 'funding', 'planning', 'evidence', 'documents', 'records', 'tasks', 'activity', 'auditreport', 'export', 'status', 'video', 'awards', 'sources', 'profile'];

export function isKnownRoute(hash) {
  const match = /^#\/([a-z]+)(?:[/?]|$)/.exec(String(hash));
  return Boolean(match) && routeNames.includes(match[1]);
}
