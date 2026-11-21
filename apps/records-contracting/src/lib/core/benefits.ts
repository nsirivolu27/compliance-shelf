/** Read-only program directory. Team names are example routing labels, not an agency org chart. */
export type Row = Record<string, any>;

export function benefitPrograms(catalog: Row[], items: Row[], filters: { agency?: string; q?: string } = {}) {
  if (filters.agency !== undefined && !['ssa', 'va'].includes(filters.agency)) throw Object.assign(new Error('agency must be ssa or va'), { status: 400 });
  if (filters.q !== undefined && (typeof filters.q !== 'string' || filters.q.length > 200)) throw Object.assign(new Error('q must be at most 200 characters'), { status: 400 });
  const q = (filters.q ?? '').trim().toLowerCase();
  return catalog.filter(entry => entry.benefit && (!filters.agency || entry.scope === filters.agency))
    .filter(entry => [entry.title, entry.formNumber, entry.benefit.program, entry.benefit.team, entry.benefit.purpose].join(' ').toLowerCase().includes(q))
    .map(entry => {
      const tracked = items.filter(item => item.paperworkId === entry.id);
      return { ...entry.benefit, agency: entry.scope, paperwork: entry, items: tracked,
        counts: { tracked: tracked.length, missingIntakeFacts: tracked.filter(item => item.readiness.state === 'incomplete').length,
          blocked: tracked.filter(item => item.readiness.state === 'blocked').length, overdue: tracked.filter(item => item.readiness.overdue).length },
        eligibility: 'not-assessed', fundingDecision: 'not-performed' };
    });
}
