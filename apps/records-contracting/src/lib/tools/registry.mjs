import { analyzeCase, taskQueue } from '../core/compliance.ts';

// One tool registry for the local API and a future LLM/MCP adapter.
// Every tool is read-only and deterministic. None of them calls a model.

// The only places the assistant may send someone. Each path is built from this
// list and from IDs checked against the case, never from text the user typed.
export const destinations = [
  { id: 'workbench', label: 'Workbench', keywords: ['workbench', 'queue', 'work queue', 'daily work'], path: () => '#/workbench' },
  { id: 'overview', label: 'Overview', keywords: ['overview', 'dashboard', 'counts', 'summary'], path: () => '#/overview' },
  { id: 'cases', label: 'Contracting cases', keywords: ['cases', 'case list', 'contracting', 'contracts'], path: () => '#/cases' },
  { id: 'gaps', label: 'Gap register', keywords: ['gap register', 'gaps', 'documentation gaps', 'completeness', 'documentation score', 'missing documentation'], path: () => '#/gaps' },
  { id: 'planning', label: 'Planning', keywords: ['planning', 'due dates', 'upcoming', 'calendar'], path: () => '#/planning' },
  { id: 'evidence-library', label: 'Evidence library', keywords: ['evidence library', 'all evidence', 'references', 'library'], path: () => '#/evidence' },
  { id: 'documents', label: 'Document intake', keywords: ['document intake', 'documents', 'upload', 'intake', 'spans'], path: () => '#/documents' },
  { id: 'records', label: 'Records', keywords: ['records', 'record inventory', 'retention', 'holds', 'hold'], path: () => '#/records' },
  { id: 'tasks', label: 'Tasks', keywords: ['tasks', 'follow-up', 'follow up', 'assignments', 'overdue'], path: () => '#/tasks' },
  { id: 'activity', label: 'Activity', keywords: ['activity', 'audit trail', 'history', 'log'], path: () => '#/activity' },
  { id: 'export', label: 'Audit export', keywords: ['audit export', 'export', 'workspace packet'], path: () => '#/export' },
  { id: 'status', label: 'Service status', keywords: ['service status', 'services', 'status', 'health', 'jobs'], path: () => '#/status' },
  { id: 'sources', label: 'Sources', keywords: ['sources', 'authorities', 'policy sources', 'far', 'citations'], path: () => '#/sources' },
  { id: 'profile', label: 'Check profile', keywords: ['check profile', 'profile', 'check set', 'organization', 'own checks'], path: () => '#/profile' },
  { id: 'awards', label: 'Public awards', keywords: ['public awards', 'awards', 'usaspending'], path: () => '#/awards' },
  { id: 'case-findings', label: 'This case: findings', keywords: ['case findings', 'findings', 'checks', 'this case'], path: item => `#/cases/${encodeURIComponent(item.id)}/findings` },
  { id: 'case-evidence', label: 'This case: evidence', keywords: ['case evidence', 'evidence'], path: item => `#/cases/${encodeURIComponent(item.id)}/evidence` },
  { id: 'case-records', label: 'This case: records', keywords: ['case records'], path: item => `#/cases/${encodeURIComponent(item.id)}/records` },
  { id: 'case-tasks', label: 'This case: tasks', keywords: ['case tasks'], path: item => `#/cases/${encodeURIComponent(item.id)}/tasks` },
  { id: 'case-policy', label: 'This case: policy context', keywords: ['policy', 'policy context', 'policy versions', 'applicability', 'reassessment'], path: item => `#/cases/${encodeURIComponent(item.id)}/policy` },
  { id: 'case-drafts', label: 'This case: review drafts', keywords: ['review drafts', 'drafts', 'review note', 'review notes'], path: item => `#/cases/${encodeURIComponent(item.id)}/drafts` },
  { id: 'case-links', label: 'This case: relationships', keywords: ['relationships', 'links', 'inspector', 'source inspector'], path: item => `#/cases/${encodeURIComponent(item.id)}/links` },
  { id: 'case-history', label: 'This case: history', keywords: ['case history', 'check runs', 'analysis history'], path: item => `#/cases/${encodeURIComponent(item.id)}/history` },
  { id: 'case-file', label: 'This case: case file and packet', keywords: ['case file', 'packet', 'handoff', 'case packet'], path: item => `#/cases/${encodeURIComponent(item.id)}/file` },
];

function findingOf(item, asOf, findingId) {
  if (typeof findingId !== 'string' || !findingId) throw new Error('Choose a finding first');
  const finding = analyzeCase(item, asOf).findings.find(f => f.id === findingId);
  if (!finding) throw new Error('That finding is not in this case');
  return finding;
}

// Picks one destination by its ID, or by the longest keyword found in the text.
function matchDestination(destination, query) {
  if (typeof destination === 'string' && destination) return destinations.find(d => d.id === destination) ?? null;
  const text = typeof query === 'string' ? query.toLowerCase().slice(0, 200) : '';
  let best = null;
  for (const candidate of destinations) {
    for (const keyword of candidate.keywords) {
      if (text.includes(keyword) && (!best || keyword.length > best.length)) best = { candidate, length: keyword.length };
    }
  }
  return best?.candidate ?? null;
}

export const tools = [
  { name: 'analyze_case', description: 'Screen supplied contract evidence and records metadata.', run: ({ item, asOf }) => analyzeCase(item, asOf) },
  { name: 'list_evidence_gaps', description: 'List supplied-evidence gaps without claiming a legal violation.', run: ({ item, asOf }) => analyzeCase(item, asOf).findings.filter(f => f.status === 'needs-evidence' || f.status === 'needs-review') },
  { name: 'review_retention', description: 'Explain schedule assumptions, holds, and retention review dates.', run: ({ item, asOf }) => analyzeCase(item, asOf).records },
  { name: 'list_follow_up_tasks', description: 'Show assigned tasks, overdue work, and unresolved findings even after a task is marked done.', run: ({ item, asOf }) => taskQueue([item], asOf) },
  { name: 'explain_finding', description: 'Explain one finding: its status, the rule text behind it, its sources, and the next action.', run: ({ item, asOf, findingId }) => {
    const finding = findingOf(item, asOf, findingId);
    const kind = finding.category === 'contracting' ? finding.id.slice(item.id.length + 1) : null;
    const record = finding.category === 'records' ? analyzeCase(item, asOf).records.find(r => `${item.id}:record:${r.id}` === finding.id) ?? null : null;
    return { finding, applicability: kind ? item.applicability[kind] : null, record: record ? { id: record.id, title: record.title, hold: record.hold, retention: record.retention } : null,
      tasks: taskQueue([item], asOf).filter(t => t.findingId === finding.id), limitation: 'A finding describes supplied evidence. It is not a determination of noncompliance.' };
  } },
  { name: 'evidence_for_finding', description: 'Show which evidence references support a finding and what is still missing.', run: ({ item, asOf, findingId }) => {
    const finding = findingOf(item, asOf, findingId);
    const linked = item.evidence.filter(e => finding.evidenceIds.includes(e.id));
    const verified = linked.filter(e => e.verified && e.locator.trim());
    const usesEvidence = finding.category === 'contracting';
    return { findingId: finding.id, title: finding.title, status: finding.status, usesEvidence,
      supporting: verified.map(({ id, title, locator, kind }) => ({ id, title, locator, kind })),
      unverified: linked.filter(e => !verified.includes(e)).map(({ id, title, locator, kind }) => ({ id, title, locator, kind })),
      missing: !usesEvidence ? 'This check does not use evidence references.'
        : verified.length ? null
        : linked.length ? 'A reference is on file but no reviewer has verified it.'
        : 'No reference has been supplied in this workspace. That does not show the document is missing from agency files.',
      sourceIds: finding.sourceIds };
  } },
  { name: 'preview_handoff', description: 'Preview what the case packet will show, including unresolved findings and active holds.', run: ({ item, asOf }) => {
    const report = analyzeCase(item, asOf);
    const tasks = taskQueue([item], asOf);
    return { caseId: item.id, title: item.title, asOf,
      unresolvedFindings: report.findings.filter(f => !['evidence-present', 'not-applicable'].includes(f.status)).map(({ id, title, status }) => ({ id, title, status })),
      activeHolds: report.records.filter(r => r.hold === 'active').map(({ id, title }) => ({ id, title, canDestroy: false })),
      openTasks: tasks.filter(t => t.status !== 'done').map(({ id, title, owner, dueDate, overdue }) => ({ id, title, owner, dueDate, overdue })),
      evidence: { total: item.evidence.length, verified: item.evidence.filter(e => e.verified).length },
      packetUrl: `/api/cases/${encodeURIComponent(item.id)}/packet?asOf=${asOf}`,
      note: 'The packet is a handoff record. It is not proof of compliance, and unresolved findings and holds stay visible in it.' };
  } },
  { name: 'navigate', description: 'Find an existing page or case section from a fixed list of destinations.', run: ({ item, destination, query }) => {
    const match = matchDestination(destination, query);
    if (!match) return { matched: false, message: 'No page matches that. Choose one of the listed destinations.', destinations: destinations.map(d => ({ id: d.id, label: d.label })) };
    return { matched: true, destination: { id: match.id, label: match.label, hash: match.path(item) } };
  } },
];

export function runTool(name, context) {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new Error('Unknown tool');
  return tool.run(context);
}

const intents = {
  overview: 'analyze_case', evidence: 'list_evidence_gaps', retention: 'review_retention', tasks: 'list_follow_up_tasks',
  'explain-finding': 'explain_finding', 'finding-evidence': 'evidence_for_finding', handoff: 'preview_handoff', navigate: 'navigate',
};

export function runGuidedAgent(intent, context) {
  const name = Object.hasOwn(intents, intent) ? intents[intent] : null;
  if (!name) throw new Error('Choose overview, evidence, retention, tasks, explain-finding, finding-evidence, handoff, or navigate');
  const step = { step: 1, tool: name, caseId: context.item.id, asOf: context.asOf, ...(context.findingId && ['explain_finding', 'evidence_for_finding'].includes(name) ? { findingId: context.findingId } : {}) };
  return { mode: 'deterministic-guided-agent', intent, trace: [step], result: runTool(name, context), note: 'Tools execute real screening logic. Free-form LLM conversation is not connected yet.' };
}
