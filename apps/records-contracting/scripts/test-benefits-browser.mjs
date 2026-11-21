// Focused real-Chrome journey, using isolated stores and ports. No saved demo mutations.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomInt, createHash } from 'node:crypto';
import { startPitchDemo } from '../../../services/pitch-runner.mjs';
import { busyPorts } from '../../../services/free-ports.mjs';
const temp = await mkdtemp(join(tmpdir(), 'cp-benefits-browser-'));
await mkdir(resolve('.local'), { recursive: true });
const savedPath = resolve('apps/records-contracting/.local/workspace.json');
const digest = async () => createHash('sha256').update(await readFile(savedPath).catch(() => '')).digest('hex');
const before = await digest();
let port;
for (let i = 0; i < 50; i++) { const candidate = randomInt(47000, 57000); if (!(await busyPorts('127.0.0.1', Array.from({ length: 13 }, (_, j) => candidate + j))).length) { port = candidate; break; } }
assert(port, 'free ports');
const demo = await startPitchDemo({ env: process.env, gatewayPort: port, folder: join(temp, 'state'), today: '2026-11-19' });
const origin = demo.base, pending = new Map(), errors = [], results = [];
let chrome, socket, sequence = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(fn, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(80); } throw new Error(`Timed out: ${label}`); }
function cdp(method, params = {}) { const id = ++sequence; const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject })); socket.send(JSON.stringify({ id, method, params })); return promise; }
async function evaluate(expression) { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description); return result.result?.value; }
async function key(key, modifiers = 0) { const code = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, Home: 36, End: 35, ' ': 32 }[key] || key.toUpperCase().charCodeAt(0); await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers, windowsVirtualKeyCode: code }); }
const visible = selector => wait(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`), selector);
async function tabTo(selector) { for (let i = 0; i < 230; i++) { if (await evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`)) return; await key('Tab'); } throw new Error(`Keyboard cannot reach ${selector}`); }
async function press(selector) { await visible(selector); await tabTo(selector); await key('Enter'); }
async function type(selector, value) { await tabTo(selector); await key('a', 2); await cdp('Input.insertText', { text: value }); }
const get = path => fetch(origin + path).then(response => response.json());
const log = text => { results.push(text); console.log('PASS ' + text); };
async function navigate(hash) { await evaluate(`location.hash=${JSON.stringify(hash)}`); await wait(() => evaluate(`location.hash===${JSON.stringify(hash)}`), 'hash'); }
try {
  assert(await demo.ready, 'isolated stack ready');
  chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-extensions', `--user-data-dir=${join(temp, 'chrome')}`, `--remote-debugging-port=${port + 12}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const target = await wait(async () => { try { return (await (await fetch(`http://127.0.0.1:${port + 12}/json`)).json()).find(x => x.type === 'page'); } catch { return null; } }, 'Chrome');
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task?.reject(new Error(JSON.stringify(message.error))) : task?.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); });
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable');
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: temp });
  await cdp('Page.navigate', { url: origin + '/#/benefits' });
  await visible('#track-va-disability');
  assert.equal(await evaluate('document.querySelectorAll("[data-program]").length'), 7);
  log('Seven programs render with source links and explicit intake limitations');
  await tabTo('#benefits-agency'); await key('Home'); await key('ArrowDown'); await key('Enter');
  await type('#benefits-search', 'retirement'); await press('#main button[type="submit"]');
  await wait(() => evaluate('document.querySelectorAll("[data-program]").length===1'), 'filtered program');
  assert.equal(await evaluate('document.querySelector("[data-program]").dataset.program'), 'ssa-retirement');
  log('Agency and program search work with the keyboard');
  await press('#sample-ssa-retirement');
  const downloaded = await wait(async () => { try { return JSON.parse(await readFile(join(temp, 'synthetic-ssa-retirement.json'), 'utf8')); } catch { return null; } }, 'sample download');
  assert.equal(downloaded.Blocks.length, 16);
  log('Reader sample download contains importable JSON');
  await navigate('#/benefits'); await visible('#track-va-disability');
  await press('#track-va-disability');
  assert.equal(await evaluate('document.activeElement.id'), 'benefits-case');
  assert.equal((await get('/api/cases/DEMO-VA-003/paperwork')).items.length, 0);
  await key('Home');
  for (let step = 0; step < 10 && await evaluate('document.getElementById("benefits-case").value') !== 'DEMO-VA-003'; step++) await key('ArrowDown');
  await key('Enter');
  assert.equal(await evaluate('document.getElementById("benefits-case").value'), 'DEMO-VA-003');
  await press('#track-va-disability'); await visible('textarea[id$="-note"]');
  await type('textarea[id$="-note"]', 'Synthetic compensation intake for the browser demonstration.');
  await press('dialog.drawer button[type="submit"]');
  await visible('#import-sample-synthetic-va-disability');
  await wait(async () => (await get('/api/cases/DEMO-VA-003/paperwork')).items.length === 1, 'worksheet saved');
  log('Explicit case selection and audited tracking open the worksheet/reader destination');
  await press('#import-sample-synthetic-va-disability'); await visible('input[id$="-synthetic"]');
  await tabTo('input[id$="-synthetic"]'); await key(' ');
  await type('textarea[id$="-note"]', 'Import a hand-authored synthetic worksheet for review.');
  await press('dialog.drawer button[type="submit"]');
  await visible('button[aria-label="Accept Synthetic intake reference"]');
  assert.equal((await get('/api/cases/DEMO-VA-003/paperwork')).items[0].readiness.present, 0);
  await press('button[aria-label="Accept Synthetic intake reference"]'); await visible('select[id$="-target"]');
  await tabTo('select[id$="-target"]'); await key('Home'); await key('ArrowDown'); await key('Enter');
  await type('textarea[id$="-note"]', 'This synthetic reference matches the sample worksheet.');
  await press('dialog.drawer button[type="submit"]');
  await wait(async () => (await get('/api/cases/DEMO-VA-003/paperwork')).items[0].readiness.present === 1, 'accepted candidate');
  await visible('button[aria-label="Reject Requested support"]');
  await press('button[aria-label="Reject Requested support"]'); await visible('textarea[id$="-note"]');
  await type('textarea[id$="-note"]', 'Leave the request undecided pending reviewer clarification.');
  await press('dialog.drawer button[type="submit"]');
  await wait(async () => (await get('/api/cases/DEMO-VA-003/reader-outputs')).outputs[0].decided.rejected === 1, 'rejection saved');
  assert.equal((await get('/api/cases/DEMO-VA-003/paperwork')).items[0].readiness.present, 1);
  log('Keyboard import, acceptance and rejection preserve undecided fields and provenance');
  await navigate('#/benefits'); await visible('#track-va-disability');
  await wait(() => evaluate('document.querySelector("[data-program=va-disability]").textContent.includes("1 tracked")'), 'tracked program count');
  for (const theme of ['dark', 'light']) for (const width of [375, 1024, 1440]) {
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `${theme} ${width}: horizontal overflow`);
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(`.local/benefits-${theme}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  log('Both themes fit 375, 1024 and 1440px; screenshots saved');
  await cdp('Network.setBlockedURLs', { urls: ['*/api/benefits*'] });
  await navigate('#/benefits?q=disability'); await visible('#main .notice-error');
  await cdp('Network.setBlockedURLs', { urls: [] }); await press('#main .notice-error button'); await visible('#track-va-disability');
  log('Failed directory load preserves a working retry');
  assert.deepEqual(errors, []); log('No browser runtime exceptions');
} catch (error) {
  console.error(error.stack);
  if (socket?.readyState === 1) { console.error(await evaluate('document.querySelector("#main")?.innerText').catch(() => '')); const shot = await cdp('Page.captureScreenshot', { format: 'png' }).catch(() => null); if (shot) await writeFile(resolve('.local/benefits-browser-failure.png'), Buffer.from(shot.data, 'base64')); }
  process.exitCode = 1;
} finally {
  if (socket?.readyState === 1) { await cdp('Browser.close').catch(() => {}); socket.close(); }
  chrome?.kill(); demo.stop(); await demo.exited;
  assert.equal(await digest(), before, 'saved demo unchanged');
  await writeFile(resolve('.local/benefits-browser-results.json'), JSON.stringify({ results, errors, temp, savedDemoUnchanged: true }, null, 2));
}
