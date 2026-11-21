// Application shell: routing, the screening date, the connection notice, and the mobile menu.
// Each view loads its own data from the API, so no page depends on one large upfront request.

import * as api from './api.js';
import { h, pageHeader, emptyState, loadingState, errorState, announce, rememberChecks } from './dom.js';
import { setupAgent } from './agent.js';
import * as dashboard from './views/dashboard.js';
import * as cases from './views/cases.js';
import * as workbench from './views/workbench.js';
import * as evidence from './views/evidence.js';
import * as documents from './views/documents.js';
import * as records from './views/records.js';
import * as tasks from './views/tasks.js';
import * as activity from './views/activity.js';
import * as audit from './views/audit.js';
import * as video from './views/video.js';
import * as awards from './views/awards.js';
import * as sources from './views/sources.js';
import * as statusView from './views/status.js';
import * as profileView from './views/profile.js';
import * as gaps from './views/gaps.js';
import * as planning from './views/planning.js';
import * as paperwork from './views/paperwork.js';
import * as benefits from './views/benefits.js';
import * as funding from './views/funding.js';
import * as auditReport from './views/audit-report.js';
import { routeNames } from './routes.js';

const views = { workbench, overview: dashboard, cases, gaps, paperwork, benefits, funding, planning, evidence, documents, records, tasks, activity, auditreport: auditReport, export: audit, status: statusView, video, awards, sources, profile: profileView };

// Addresses from the earlier version of the interface still work.
const renamed = { dashboard: 'overview', contracting: 'cases', findings: 'workbench', reviews: 'workbench', audit: 'export' };

const main = document.getElementById('main');
const asOfInput = document.getElementById('asof-input');
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');
const connectionBar = document.getElementById('connection-bar');
const themeToggle = document.getElementById('theme-toggle');
themeToggle.addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  themeToggle.setAttribute('aria-pressed', String(light));
});

// Sources and tool descriptions are fixed reference data, loaded once.
const ctx = { sources: [], builtInSources: [], tools: [] };
let current = null;
let agent = null;

function currentRoute() {
  const [path, queryText = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const name = renamed[parts[0]] || parts[0] || 'workbench';
  return { name, parts: parts.slice(1), query: Object.fromEntries(new URLSearchParams(queryText)) };
}

function keyFor(route) {
  if (route.name === 'records' && route.parts[2] === 'file') return `record-file/${route.parts[0]}/${route.parts[1]}`;
  return route.name === 'cases' && route.parts[0] ? `cases/${route.parts[0]}` : route.name;
}

function render({ fresh = false } = {}) {
  const route = currentRoute();
  for (const link of document.querySelectorAll('.sidebar a[data-route]')) {
    if (link.dataset.route === route.name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  // When the page shown lives under More tools, open that group so its link is visible.
  const moreTools = document.getElementById('nav-more');
  if (moreTools?.querySelector('a[aria-current="page"]')) moreTools.open = true;
  agent?.followRoute(route);

  // Moving between tabs of the same case keeps the loaded case instead of starting over.
  if (!fresh && current?.update && current.key === keyFor(route)) {
    current.update(route);
    return false;
  }

  // Only names on the shared route list can be shown.
  const view = routeNames.includes(route.name) ? views[route.name] : null;
  current = view ? view.create(route, ctx) : {
    key: 'missing',
    el: h('div', null, pageHeader('Page not found'),
      emptyState('There is nothing at this address.', null, h('a', { class: 'button', href: '#/workbench' }, 'Go to the workbench'))),
  };
  main.replaceChildren(current.el);
  return true;
}

async function start() {
  main.replaceChildren(loadingState('Loading workspace…'));
  try {
    const reference = await api.getReference();
    ctx.sources = reference.sources;
    ctx.builtInSources = reference.sources.filter(source => (reference.builtInSourceIds ?? []).includes(source.id));
    ctx.tools = reference.tools;
    // Labels for any checks a loaded profile or a stored case brings with it.
    rememberChecks(reference.profile?.checkSet.checks);
    for (const item of reference.cases) rememberChecks(item.checkSet?.checks);
  } catch (error) {
    main.replaceChildren(pageHeader('Workspace unavailable'), errorState(error, start));
    return;
  }
  agent = agent || setupAgent(ctx);
  render({ fresh: true });
  showServiceSummary();
}

window.addEventListener('hashchange', () => {
  if (!agent) return;
  setMenu(false);
  if (render()) {
    window.scrollTo(0, 0);
    document.getElementById('page-title')?.focus();
  }
});

// ---------- Service summary in the top bar ----------

const serviceLink = document.getElementById('service-link');

async function showServiceSummary() {
  const summary = await statusView.serviceSummary();
  serviceLink.textContent = summary.text;
  serviceLink.className = `status status-${summary.tone}`;
}

// ---------- Screening date ----------

function applyAsOf(value) {
  api.setAsOf(value);
  if (!agent) return;
  render({ fresh: true });
  announce(value ? `Screening date set to ${value}.` : 'Screening date set to today.');
}

asOfInput.addEventListener('change', () => applyAsOf(asOfInput.value));
document.getElementById('asof-reset').addEventListener('click', () => {
  asOfInput.value = '';
  applyAsOf('');
});
document.getElementById('asof-form').addEventListener('submit', event => event.preventDefault());

// ---------- Mobile menu ----------

function setMenu(open) {
  sidebar.classList.toggle('menu-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
}
menuToggle.addEventListener('click', () => setMenu(!sidebar.classList.contains('menu-open')));

// ---------- Connection notice ----------

let healthTimer = null;

api.onConnectionChange(online => {
  connectionBar.hidden = online;
  clearInterval(healthTimer);
  if (online) {
    announce('The local server is responding again.');
    showServiceSummary();
    if (!agent) start();
  } else {
    // Keep checking quietly until the server answers. Nothing on the page is reloaded.
    healthTimer = setInterval(api.checkHealth, 5000);
  }
});
document.getElementById('connection-retry').addEventListener('click', api.checkHealth);

start();
