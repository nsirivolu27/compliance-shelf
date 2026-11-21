// Client for the local API. Every call goes to the same origin.

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || {};
  }

  // The server could not be reached at all, so nothing is known about the request.
  get offline() { return this.status === 0; }

  // The case changed since the form was loaded. The body carries the current revision.
  get revisionConflict() { return this.status === 409 && this.body.currentRevision !== undefined; }

  // A review draft changed, or the evidence it cites changed. The body carries the draft's current version.
  get versionConflict() { return this.status === 409 && this.body.currentVersion !== undefined; }
}

let asOf = '';

// An empty value lets the server use today's UTC date.
export function setAsOf(value) { asOf = value || ''; }
export function getAsOf() { return asOf; }

// ---------- Connection state ----------

let online = true;
const connectionListeners = new Set();

export function onConnectionChange(listener) { connectionListeners.add(listener); }

function setOnline(value) {
  if (online === value) return;
  online = value;
  for (const listener of connectionListeners) listener(online);
}

export async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    setOnline(response.ok);
  } catch {
    setOnline(false);
  }
  return online;
}

// ---------- Requests ----------

// plain: true leaves out the screening date, for services that do not screen anything.
async function request(method, path, { query, body, key, plain = false } = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query || {})) {
    if (value !== '' && value !== null && value !== undefined) params.set(name, value);
  }
  if (asOf && !plain) params.set('asOf', asOf);
  const url = params.size ? `${path}?${params}` : path;

  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;

  let response;
  try {
    response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    setOnline(false);
    throw new ApiError('The local server did not respond.', 0);
  }
  setOnline(true);

  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* handled below */ }
  if (!response.ok) throw new ApiError(parsed?.error || `The request failed with status ${response.status}.`, response.status, parsed);
  if (parsed === null) throw new ApiError('The server returned a response that could not be read.', response.status);
  return { body: parsed, text };
}

const get = async (path, query) => (await request('GET', path, { query })).body;
const post = async (path, body, key) => (await request('POST', path, { body, key })).body;
const casePath = (caseId, rest = '') => `/api/cases/${encodeURIComponent(caseId)}${rest}`;

// One retry key per intended action. The same key is reused only while the request
// body is unchanged, so a retry after a dropped connection cannot apply a change twice.
export function createRetryKey() {
  let key = null;
  let lastBody = null;
  const keyFor = body => {
    const serialized = JSON.stringify(body);
    if (serialized !== lastBody) {
      key = crypto.randomUUID();
      lastBody = serialized;
    }
    return key;
  };
  keyFor.reset = () => { lastBody = null; };
  return keyFor;
}

// ---------- Reads ----------

export const getReference = () => get('/api/workspace');
export const getDashboard = () => get('/api/dashboard');
export const getCases = () => get('/api/cases');
// Sending q, limit, or offset switches the case list to its paginated form with per-case summaries.
export const searchCases = query => get('/api/cases', { q: '', ...query });
export const getWorkbench = query => get('/api/workbench', query);
export const getEvidence = query => get('/api/evidence', query);
export const searchTasks = query => get('/api/tasks', { q: '', ...query });
export const getCase = caseId => get(casePath(caseId));
export const getFindings = query => get('/api/findings', query);
export const getRecords = query => get('/api/records', query);
export const getActivity = query => get('/api/activity', query);
export const getTasks = () => get('/api/tasks');
export const getAwards = () => get('/api/awards');
export const getVideoTasks = () => get('/api/video/tasks');

// Returns the parsed packet and the exact response text, so the download is the real export.
export const getExport = () => request('GET', '/api/export');
export const getCasePacket = caseId => request('GET', casePath(caseId, '/packet'));

// ---------- Document intake (available only when the full local services are running) ----------

const documentPath = (documentId, rest = '') => `/api/documents/${encodeURIComponent(documentId)}${rest}`;
const plainGet = async (path, query) => (await request('GET', path, { query, plain: true })).body;
const plainPost = async (path, body, key) => (await request('POST', path, { body, key, plain: true })).body;

export const getServices = () => plainGet('/api/services');
export const getProfile = () => get('/api/profile');

// Documentation completeness, detected gaps, and dated needs. All three are computed by the server.
export const getDocumentation = () => get('/api/documentation');
export const getCaseDocumentation = caseId => get(casePath(caseId, '/documentation'));
export const getGaps = query => get('/api/gaps', query);
export const getPlanning = () => get('/api/planning');
export const decideGap = (caseId, body, key) => post(casePath(caseId, '/gap-decisions'), body, key);
// Agency paperwork: the catalog, the items a case tracks, and a draft worksheet. Readiness is computed by the server.
export const getPaperworkCatalog = () => get('/api/paperwork');
export const getBenefits = query => get('/api/benefits', query);
export const getPaperworkItems = () => get('/api/paperwork/items');
export const getCasePaperwork = caseId => get(casePath(caseId, '/paperwork'));
export const getWorksheet = (caseId, itemId) => request('GET', casePath(caseId, `/paperwork/${encodeURIComponent(itemId)}/worksheet`));
export const addPaperwork = (caseId, body, key) => post(casePath(caseId, '/paperwork'), body, key);
export const changePaperwork = (caseId, itemId, body, key) => post(casePath(caseId, `/paperwork/${encodeURIComponent(itemId)}`), body, key);
// The audit team report. Returns the parsed report and the exact response text, so the download is the real report.
export const getAuditReport = query => request('GET', '/api/audit-report', { query });
// Saved output from a document reading service. This application calls no reading service itself.
export const getReaderSamples = () => get('/api/reader-samples');
export const getReaderSample = id => get(`/api/reader-samples/${encodeURIComponent(id)}`);
export const getReaderOutputs = caseId => get(casePath(caseId, '/reader-outputs'));
export const importReaderOutput = (caseId, body, key) => post(casePath(caseId, '/reader-outputs'), body, key);
export const decideReaderCandidate = (caseId, outputId, candidateId, body, key) => post(casePath(caseId, `/reader-outputs/${encodeURIComponent(outputId)}/candidates/${encodeURIComponent(candidateId)}`), body, key);
export const getPresets = () => get('/api/profile-presets');
export const getPreset = id => get(`/api/profile-presets/${encodeURIComponent(id)}`);
export const getEvidenceReview = caseId => get(`/api/cases/${encodeURIComponent(caseId)}/evidence-review`);
export const linkCitation = (caseId, body, key) => post(`/api/cases/${encodeURIComponent(caseId)}/citations`, body, key);
export const recordAssessment = (caseId, body, key) => post(`/api/cases/${encodeURIComponent(caseId)}/assessments`, body, key);
export const getPolicyVersions = () => plainGet('/api/policy-versions');
export const getPolicyReassessment = () => get('/api/policy-reassessment');
export const recordPolicyReview = (caseId, body, key) => post(`/api/cases/${encodeURIComponent(caseId)}/policy-reviews`, body, key);
export const getDocuments = query => plainGet('/api/documents', query);
export const getDocument = documentId => plainGet(documentPath(documentId));
export const getDocumentSpans = (documentId, query) => plainGet(documentPath(documentId, '/spans'), query);
export const getJobs = query => plainGet('/api/jobs', query);
export const getJobSummary = () => plainGet('/api/jobs/summary');
export const createDocument = (body, key) => plainPost('/api/documents', body, key);
export const linkDocumentEvidence = (documentId, body, key) => plainPost(documentPath(documentId, '/evidence'), body, key);
export const retryJob = (jobId, body, key) => plainPost(`/api/jobs/${encodeURIComponent(jobId)}/retry`, body, key);

// Synthetic program and project funding. The server computes every total in whole cents; approvals are simulated.
const budgetPath = (budgetId, rest = '') => `/api/funding/budgets/${encodeURIComponent(budgetId)}${rest}`;
const allocationPath = (allocationId, rest = '') => `/api/funding/allocations/${encodeURIComponent(allocationId)}${rest}`;
export const getFunding = query => get('/api/funding', query);
export const createBudget = (body, key) => post('/api/funding/budgets', body, key);
export const amendBudget = (budgetId, body, key) => post(budgetPath(budgetId), body, key);
export const createAllocation = (budgetId, body, key) => post(budgetPath(budgetId, '/allocations'), body, key);
export const changeAllocation = (allocationId, body, key) => post(allocationPath(allocationId), body, key);
export const decideAllocation = (allocationId, body, key) => post(allocationPath(allocationId, '/decision'), body, key);

// ---------- Writes ----------

export const createCase = (body, key) => post('/api/cases', body, key);
export const saveProfile = (body, key) => post('/api/profile', body, key);
export const updateContext = (caseId, body, key) => post(casePath(caseId, '/context'), body, key);
export const addRecord = (caseId, body, key) => post(casePath(caseId, '/records'), body, key);
export const updateRecord = (caseId, recordId, body, key) => post(casePath(caseId, `/records/${encodeURIComponent(recordId)}`), body, key);
export const reviewHold = (caseId, recordId, body, key) => post(casePath(caseId, `/records/${encodeURIComponent(recordId)}/hold`), body, key);
export const addEvidence = (caseId, body, key) => post(casePath(caseId, '/evidence'), body, key);
export const correctEvidence = (caseId, evidenceId, body, key) => post(casePath(caseId, `/evidence/${encodeURIComponent(evidenceId)}`), body, key);
export const verifyEvidence = (caseId, body, key) => post(casePath(caseId, '/verify-evidence'), body, key);
export const addReview = (caseId, body, key) => post(casePath(caseId, '/reviews'), body, key);
export const createTask = (caseId, body, key) => post(casePath(caseId, '/tasks'), body, key);
export const updateTask = (caseId, taskId, body, key) => post(casePath(caseId, `/tasks/${encodeURIComponent(taskId)}`), body, key);
export const analyze = (caseId, body, key) => post(casePath(caseId, '/analyze'), body, key);
export const runAgent = (caseId, intent, extra = {}) => post(casePath(caseId, '/agent'), { intent, ...extra });

// Review drafts. Saving a draft does not change the case revision; each draft has its own version.
const draftPath = (caseId, draftId = '', rest = '') => casePath(caseId, `/drafts${draftId ? `/${encodeURIComponent(draftId)}` : ''}${rest}`);
export const getDrafts = caseId => get(draftPath(caseId));
export const prepareDraft = (caseId, findingIds) => get(casePath(caseId, '/drafts/prepare'), { findingIds: findingIds.join(',') });
export const createDraft = (caseId, body, key) => post(draftPath(caseId), body, key);
export const reviseDraft = (caseId, draftId, body, key) => post(draftPath(caseId, draftId), body, key);
export const submitDraft = (caseId, draftId, body, key) => post(draftPath(caseId, draftId, '/submit'), body, key);
export const decideDraft = (caseId, draftId, body, key) => post(draftPath(caseId, draftId, '/decision'), body, key);
