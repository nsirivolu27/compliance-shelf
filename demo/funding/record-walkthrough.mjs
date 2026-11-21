// Records the funding walkthrough (demo/funding/walkthrough.md) as a video, without FFmpeg.
//
// What it is: an automated, continuous capture of the application's own browser viewport. A script drives a
// headless Chrome through the walkthrough in real time. Chrome's screencast frames are drawn onto a canvas in a
// second headless Chrome and encoded as they arrive by that browser's built-in recorder (H.264 MP4).
// Captions are drawn under the viewport, and a ring marks each click. There is no narration audio.
// What it is not: a person operating the application, a desktop screen recording, or a sequence of prepared screenshots.
//
// It starts its own isolated demo (default port 5817, data in a new temporary folder) and stops only what it started.
// Usage from the repository root: node demo/funding/record-walkthrough.mjs   (PORT and CHROME_PATH are optional)

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { root } from '../../services/config.mjs';
import { busyPorts } from '../../services/free-ports.mjs';
import { demoFolder } from '../../services/demo-folder.mjs';
import { startPitchDemo } from '../../services/pitch-runner.mjs';
import { seedContractReview } from '../../services/contract-review-seed.mjs';
import { completeContractReview } from '../../services/contract-review-completion.mjs';
import { seedFunding } from '../../services/funding-seed.mjs';

const WIDTH = 1280, HEIGHT = 720, CAPTION = 124, MAX_SECONDS = 300;
const gatewayPort = Number(process.env.PORT || 5817);
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const outputFolder = resolve(root, 'output/funding-walkthrough');
const videoName = 'compliance-platform-funding-walkthrough.mp4';
const firstRationale = 'Baseline documented by the completed review; monitoring fits the remaining budget.';
const secondRationale = 'Trying the redesign request after the monitoring approval.';
const pause = ms => new Promise(done => setTimeout(done, ms));
const quote = value => JSON.stringify(value);

// ---------- Browser plumbing ----------

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((done, failed) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', failed, { once: true }); });
  let sequence = 0;
  const pending = new Map(), listeners = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) { listeners.get(message.method)?.(message.params); return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.failed(new Error(`${entry.method}: ${JSON.stringify(message.error)}`)); else entry.done(message.result);
  });
  // A command whose reply never arrives fails with its name, instead of leaving the recording waiting.
  const send = (method, params = {}, timeout = 30000) => new Promise((done, failed) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); failed(new Error(`No reply from the browser to ${method} within ${timeout} ms`)); }, timeout);
    pending.set(id, { done, failed, timer, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, timeout) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  return { send, evaluate, on: (method, handler) => listeners.set(method, handler), close: () => socket.close() };
}

function launchChrome(debugPort, profile) {
  return spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, `--window-size=${WIDTH},${HEIGHT + 100}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
}

async function firstPage(debugPort) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(target => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* the browser is still starting */ }
    await pause(200);
  }
  throw new Error(`Chrome did not open its debugging port ${debugPort}. Set CHROME_PATH if Chrome is installed elsewhere.`);
}

// Runs in the recording browser: draws the latest frame, the caption and the click ring, and encodes the canvas.
const recorderPage = `(() => {
  const W = ${WIDTH}, H = ${HEIGHT}, C = ${CAPTION};
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H + C; document.body.append(canvas);
  const context = canvas.getContext('2d');
  let frame = null, caption = '', ring = null, tick = 0, startedAt = 0;
  const wrap = (text, x, y, width, lineHeight, maxLines) => {
    const words = text.split(' '); let line = '', lines = 0;
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (context.measureText(next).width > width && line) { context.fillText(line, x, y + lines * lineHeight); lines += 1; line = word; if (lines >= maxLines) return; }
      else line = next;
    }
    if (line && lines < maxLines) context.fillText(line, x, y + lines * lineHeight);
  };
  const draw = () => {
    context.fillStyle = '#111418'; context.fillRect(0, 0, W, H + C);
    if (frame) context.drawImage(frame, 0, 0, W, H);
    if (ring && performance.now() - ring.at < 900) {
      context.beginPath(); context.arc(ring.x, ring.y, 18, 0, Math.PI * 2);
      context.fillStyle = 'rgba(45, 114, 210, 0.35)'; context.fill(); context.lineWidth = 3; context.strokeStyle = '#ffffff'; context.stroke();
    }
    context.fillStyle = '#0b0d10'; context.fillRect(0, H, W, C);
    context.fillStyle = '#2d72d2'; context.fillRect(0, H, W, 2);
    context.textBaseline = 'top';
    context.fillStyle = '#f6f7f9'; context.font = '20px "Segoe UI", Arial, sans-serif';
    wrap(caption, 24, H + 14, W - 48, 25, 3);
    context.fillStyle = '#b4bcc8'; context.font = '13px "Segoe UI", Arial, sans-serif';
    context.fillText('Automated capture of the running prototype. Fictional data. Simulated decisions; no payment is sent.', 24, H + C - 22);
    // One pixel changes on every draw, so the encoder receives a frame even while the screen is still and time stays real.
    context.fillStyle = (tick++ % 2) ? '#0b0d10' : '#0d0f12'; context.fillRect(W - 2, H + C - 2, 2, 2);
  };
  const type = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(candidate => MediaRecorder.isTypeSupported(candidate));
  const media = new MediaRecorder(canvas.captureStream(10), { mimeType: type, videoBitsPerSecond: 2400000 });
  const chunks = []; media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  window.rec = {
    type, frames: 0,
    start() { startedAt = performance.now(); draw(); media.start(1000); this.timer = setInterval(draw, 100); },
    seconds() { return (performance.now() - startedAt) / 1000; },
    push(data) { return new Promise(done => { const image = new Image(); image.onload = () => { frame = image; this.frames += 1; done(true); }; image.onerror = () => done(false); image.src = 'data:image/jpeg;base64,' + data; }); },
    caption(text) { caption = text; },
    click(x, y) { ring = { x, y, at: performance.now() }; },
    async stop() { clearInterval(this.timer); await new Promise(done => { media.onstop = done; media.stop(); }); this.blob = new Blob(chunks, { type }); return this.blob.size; },
    async read(offset, length) { const bytes = new Uint8Array(await this.blob.slice(offset, offset + length).arrayBuffer()); let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(text); },
    playback() { return new Promise(done => { const video = document.createElement('video'); video.muted = true; video.onloadedmetadata = () => done({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }); video.onerror = () => done({ error: String(video.error && video.error.message) }); video.src = URL.createObjectURL(this.blob); }); },
  };
  return type;
})()`;

// ---------- The recording ----------

if ((await busyPorts('127.0.0.1', Array.from({ length: 8 }, (_, index) => gatewayPort + index))).length) {
  console.error(`Ports ${gatewayPort} to ${gatewayPort + 7} are in use. Set PORT to another free block of eight. Nothing was started.`);
  process.exit(1);
}
const work = await mkdtemp(join(tmpdir(), 'cp-funding-video-'));
const downloads = join(work, 'downloads');
await mkdir(downloads, { recursive: true });
let debugPort = 9500 + Math.floor(Math.random() * 300);
while ((await busyPorts('127.0.0.1', [debugPort, debugPort + 1])).length) debugPort += 2;

let demo, appChrome, recorderChrome, app, recorder;
const timeline = [];
try {
  const folder = await demoFolder('funding-video');
  const today = new Date().toISOString().slice(0, 10);
  demo = await startPitchDemo({ env: process.env, gatewayPort, folder, today, seed: async context => {
    const initial = await seedContractReview(context);
    await completeContractReview({ ...context, caseId: initial.caseId });
    return { ...initial, funding: await seedFunding({ ...context, vaCaseId: initial.caseId }) };
  } });
  const seeded = await demo.ready;
  if (!seeded) throw new Error('The isolated demo did not start');
  const base = demo.base;

  appChrome = launchChrome(debugPort, join(work, 'app-profile'));
  recorderChrome = launchChrome(debugPort + 1, join(work, 'recorder-profile'));
  app = await connect(await firstPage(debugPort));
  recorder = await connect(await firstPage(debugPort + 1));
  const chromeVersion = (await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()).Browser;
  const videoType = await recorder.evaluate(recorderPage);
  if (!videoType?.startsWith('video/mp4')) console.log(`This Chrome cannot record MP4 here; recording ${videoType} instead.`);

  await app.send('Page.enable');
  await app.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await app.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

  // Frames are forwarded one at a time; while one is in flight only the newest waiting frame is kept.
  let waiting = null, forwarding = false, received = 0;
  app.on('Page.screencastFrame', params => {
    received += 1;
    app.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
    waiting = params.data;
    if (forwarding) return;
    forwarding = true;
    (async () => { while (waiting) { const data = waiting; waiting = null; await recorder.evaluate(`rec.push(${quote(data)})`).catch(() => {}); } forwarding = false; })();
  });

  const waitFor = async (expression, label, timeout = 20000) => {
    for (const end = Date.now() + timeout; Date.now() < end; await pause(120)) if (await app.evaluate(`Boolean(${expression})`).catch(() => false)) return;
    throw new Error(`Timed out waiting for: ${label}`);
  };
  const show = async expression => {
    await waitFor(expression, expression.slice(0, 90));
    await app.evaluate(`(${expression}).scrollIntoView({ block: 'center', behavior: 'smooth' })`);
    await pause(750);
  };
  const click = async expression => {
    await show(expression);
    const { x, y } = await app.evaluate(`(() => { const box = (${expression}).getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
    await recorder.evaluate(`rec.click(${x}, ${y})`);
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await pause(300);
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await pause(450);
  };
  const typeText = async text => { for (const character of text) { await app.send('Input.insertText', { text: character }); await pause(28); } };
  const press = async (key, code) => {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code });
  };
  const caption = async (text, run) => {
    const start = await recorder.evaluate('rec.seconds()');
    await recorder.evaluate(`rec.caption(${quote(text)})`);
    await run();
    timeline.push({ start, end: await recorder.evaluate('rec.seconds()'), text });
  };
  // Element lookups, written as expressions the page evaluates.
  const withText = (selector, text) => `[...document.querySelectorAll(${quote(selector)})].find(element => element.textContent.trim() === ${quote(text)})`;
  const startingWith = (selector, text) => `[...document.querySelectorAll(${quote(selector)})].find(element => element.textContent.trim().startsWith(${quote(text)}))`;
  const smallestWith = (scope, text) => `[...document.querySelectorAll(${quote(scope + ' *')})].filter(element => element.textContent.includes(${quote(text)})).sort((a, b) => a.textContent.length - b.textContent.length)[0]`;
  const request = title => `[...document.querySelectorAll('.funding-request')].find(item => item.querySelector('.funding-request-title strong')?.textContent === ${quote(title)})`;
  const inRequest = (title, label) => `[...(${request(title)})?.querySelectorAll('button') ?? []].find(button => button.textContent.trim() === ${quote(label)})`;
  const drawerClosed = `!document.querySelector('dialog.drawer[open]')`;
  const caseTitle = 'VA regional services portal';

  await recorder.evaluate('rec.start()');
  await app.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });

  await caption('This is an automated capture of the running prototype, with captions and no voice. Every case, document, budget and role is fictional. Compliance Platform connects a decision to the documents behind it.', async () => {
    await app.send('Page.navigate', { url: `${base}/#/cases` });
    await waitFor(`[...document.querySelectorAll('#main a')].some(link => link.textContent.includes(${quote(caseTitle)}))`, 'the case list');
    await pause(6500);
    await click(`[...document.querySelectorAll('#main a')].find(link => link.textContent.includes(${quote(caseTitle)}))`);
    await waitFor(withText('#main button', 'Accessibility evidence covers the delivered build'), 'the case findings');
    await pause(6000);
  });

  await caption('The first evaluation covered build 1.1, the delivery was build 1.2, and two keyboard defects were open. The reviewer recorded that this was not enough evidence. That earlier review is still on file.', async () => {
    await click(withText('#main button', 'Accessibility evidence covers the delivered build'));
    await waitFor(`document.querySelector('.inspector')?.textContent.includes('Unresolved keyboard defects')`, 'the review panel');
    await pause(2500);
    await show(smallestWith('.inspector', 'Unresolved keyboard defects at the close of testing'));
    await pause(7500);
    await click(startingWith('.inspector summary', 'Earlier reviews'));
    await show(smallestWith('.inspector', 'Scripted initial review'));
    await pause(9000);
  });

  await caption('The final retest on build 1.2.1 passed both defects. The current decision is: enough evidence for this check. The handoff note has been reviewed.', async () => {
    await show(smallestWith('.inspector', 'KB-01 and KB-02 passed the final retest'));
    await pause(7000);
    await show(smallestWith('.inspector', 'Scripted final review'));
    await pause(6500);
    await click(withText('.inspector button', 'Close'));
    await click(startingWith('.tabs a', 'Review drafts'));
    await waitFor(`document.querySelector('#main')?.textContent.includes('Completed evidence review')`, 'the review drafts');
    await pause(6000);
  });

  await caption('Finishing the review does not release the records. The delivery records stay under their hold, and nothing here can be destroyed.', async () => {
    await click(startingWith('.tabs a', 'Records'));
    await waitFor(`document.querySelector('#main')?.textContent.includes('Blocked by active hold')`, 'the records tab');
    await pause(9500);
  });

  await caption('Funding is planned the same way. This fictional VA budget has $1,200,000 available, $500,000 approved and $700,000 remaining. The proposal is a separate next phase: monitoring after release. The completed review documents the baseline. It does not show that any monitoring was done.', async () => {
    await click(`document.querySelector('.sidebar a[data-route="funding"]')`);
    await waitFor(request('Post-release accessibility monitoring'), 'the funding page');
    await show(`document.querySelector('.funding-figures')`);
    await pause(8000);
    await show(`(${request('Post-release accessibility monitoring')}).querySelector('.funding-support')`);
    await pause(14000);
  });

  await caption('Approving needs a rationale. Approved allocations become $920,000 and $280,000 remains. This is a simulated planning decision. No payment is sent.', async () => {
    await click(inRequest('Post-release accessibility monitoring', 'Approve allocation'));
    await waitFor(`document.querySelector('dialog.drawer[open] textarea')`, 'the approval form');
    await pause(3500);
    await click(`document.querySelector('dialog.drawer[open] textarea')`);
    await typeText(firstRationale);
    await pause(1500);
    await click(`document.querySelector('dialog.drawer[open] button[type="submit"]')`);
    await waitFor(drawerClosed, 'the approval to save');
    await waitFor(`document.querySelector('.funding-figures')?.textContent.includes('$280,000.00')`, 'the new totals');
    await show(`document.querySelector('.funding-figures')`);
    await pause(8500);
  });

  await caption('A $900,000 request now exceeds what is left by $620,000. The server refuses it. Nothing changes, and what was typed is kept.', async () => {
    await show(`(${request('Full portal redesign')}).querySelector('.funding-request-side')`);
    await pause(4500);
    await click(inRequest('Full portal redesign', 'Approve allocation'));
    await waitFor(`document.querySelector('dialog.drawer[open] textarea')`, 'the second approval form');
    await pause(3000);
    await click(`document.querySelector('dialog.drawer[open] textarea')`);
    await typeText(secondRationale);
    await pause(1000);
    await click(`document.querySelector('dialog.drawer[open] button[type="submit"]')`);
    await waitFor(`document.querySelector('dialog.drawer[open] .form-messages')?.textContent.includes('exceed the remaining budget by $620,000.00')`, 'the refusal');
    await show(`document.querySelector('dialog.drawer[open] .form-messages')`);
    await pause(10000);
    await click(withText('dialog.drawer[open] button', 'Cancel'));
    await click(withText('dialog.drawer[open] .discard-bar button', 'Discard'));
    await waitFor(drawerClosed, 'the form to close');
  });

  await caption('An earlier $250,000 approval was reversed before this session. Both the approval and the reversal are kept. That amount was already part of the $700,000 at the start.', async () => {
    await click(inRequest('Duplicate screen-reader retest', 'Decision history'));
    await waitFor(`document.querySelector('dialog.passage-dialog[open] .funding-history')`, 'the decision history');
    await pause(3500);
    await show(`document.querySelector('dialog.passage-dialog[open] .funding-history li:nth-child(3)')`);
    await pause(5000);
    await show(`document.querySelector('dialog.passage-dialog[open] .funding-history li:last-child')`);
    await pause(6500);
    await click(withText('dialog.passage-dialog[open] button', 'Close'));
  });

  await caption('SSA has its own budget. The two agencies are never added together.', async () => {
    await show(`document.getElementById('funding-filter-agency')`);
    for (let presses = 0; presses < 2; presses++) {
      await app.evaluate(`document.getElementById('funding-filter-agency').focus()`);
      await press('ArrowDown', 40);
      await pause(900);
    }
    await waitFor(`location.hash.includes('agency=ssa') && document.querySelector('.funding-figures')?.textContent.includes('$800,000.00')`, 'the SSA budget');
    await show(`document.querySelector('.funding-figures')`);
    await pause(8500);
  });

  await caption('The decision travels with the audit handoff: in the case packet and in the audit export.', async () => {
    await click(`document.querySelector('.sidebar a[data-route="cases"]')`);
    await waitFor(`[...document.querySelectorAll('#main a')].some(link => link.textContent.includes(${quote(caseTitle)}))`, 'the case list');
    await click(`[...document.querySelectorAll('#main a')].find(link => link.textContent.includes(${quote(caseTitle)}))`);
    await waitFor(startingWith('.tabs a', 'Case file'), 'the case tabs');
    await click(startingWith('.tabs a', 'Case file'));
    await waitFor(`document.getElementById('download-packet') && !document.getElementById('download-packet').disabled`, 'the case packet');
    await click(`document.getElementById('download-packet')`);
    await pause(4500);
    if (!(await app.evaluate(`document.getElementById('nav-more').open`))) await click(`document.querySelector('#nav-more > summary')`);
    await click(`document.querySelector('.sidebar a[data-route="export"]')`);
    await waitFor(`${withText('#main button', 'Download JSON packet')} && !(${withText('#main button', 'Download JSON packet')}).disabled`, 'the audit export');
    await click(withText('#main button', 'Download JSON packet'));
    await pause(5500);
  });

  await caption('Allocations are simulated planning decisions on fictional budgets. The shared demo login does not identify an approver, and nothing here decides anyone\'s benefits.', async () => {
    await pause(13000);
  });

  await app.send('Page.stopScreencast');
  await pause(400);
  const bytes = await recorder.evaluate('rec.stop()', 60000);
  const playback = await recorder.evaluate('rec.playback()', 60000);
  const parts = [];
  for (let offset = 0; offset < bytes; offset += 400000) parts.push(Buffer.from(await recorder.evaluate(`rec.read(${offset}, 400000)`, 60000), 'base64'));
  const video = Buffer.concat(parts);
  const extension = videoType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const fileName = videoName.replace(/mp4$/, extension);

  // The two files the walkthrough downloads are checked for the decision that was just recorded.
  const saved = (await readdir(downloads)).filter(name => name.endsWith('.json'));
  const read = async match => JSON.parse(await readFile(join(downloads, saved.find(name => match.test(name))), 'utf8'));
  const packet = await read(/case packet/i), exported = await read(/audit-packet/i);
  const decision = packet.fundingAllocations?.find(item => item.destination === 'Post-release accessibility monitoring')?.history.at(-1);
  const checks = {
    downloadedFiles: saved.length,
    packetHoldsDecision: decision?.action === 'approve' && decision.rationale === firstRationale && decision.remainingAfterCents === 28_000_000,
    exportHoldsDecision: exported.events.some(event => event.action === 'funding-allocation-decided' && event.details.action === 'approve' && event.details.rationale === firstRationale),
    exportTotals: exported.fundingSummary.budgets.map(budget => `${budget.agency}: approved ${budget.totals.approvedCents}, remaining ${budget.totals.remainingCents}`),
    refusedAttemptRecorded: exported.events.some(event => JSON.stringify(event.details ?? {}).includes(secondRationale)),
  };
  if (!checks.packetHoldsDecision || !checks.exportHoldsDecision || checks.refusedAttemptRecorded) throw new Error(`The downloaded files do not match the walkthrough: ${JSON.stringify(checks)}`);
  if (playback.error || !(playback.duration > 60) || playback.duration >= MAX_SECONDS) throw new Error(`The recording is not usable: ${JSON.stringify(playback)}`);

  await mkdir(outputFolder, { recursive: true });
  await writeFile(join(outputFolder, fileName), video);
  const stamp = seconds => { const whole = Math.floor(seconds); return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(Math.round((seconds - whole) * 1000)).padStart(3, '0').slice(0, 3)}`; };
  await writeFile(join(outputFolder, 'captions.vtt'), `WEBVTT\n\n${timeline.map((entry, index) => `${index + 1}\n${stamp(entry.start)} --> ${stamp(entry.end)}\n${entry.text}\n`).join('\n')}`);
  await writeFile(join(outputFolder, 'transcript.txt'), timeline.map(entry => `[${stamp(entry.start).slice(3, 8)}] ${entry.text}`).join('\n\n') + '\n');
  const details = {
    file: fileName, recordedAt: new Date().toISOString(), kind: 'automated continuous capture of the application viewport, encoded in real time; captions, no audio',
    notA: ['person operating the application', 'desktop screen recording', 'sequence of prepared screenshots'],
    durationSeconds: Number(playback.duration.toFixed(1)), width: playback.width, height: playback.height, type: videoType, bytes: video.length,
    sha256: createHash('sha256').update(video).digest('hex'), framesCaptured: received, browser: chromeVersion, node: process.version, checks, timeline,
  };
  await writeFile(join(outputFolder, 'recording.json'), JSON.stringify(details, null, 2));
  console.log(`Recorded ${join(outputFolder, fileName)}`);
  console.log(`Duration ${details.durationSeconds} s, ${playback.width}x${playback.height}, ${videoType}, ${video.length} bytes, ${received} frames captured.`);
  console.log(`Downloaded files checked: ${JSON.stringify(checks)}`);
} catch (error) {
  console.error(`RECORDING FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Only what this script started is stopped: its two browsers and its own demo.
  for (const session of [app, recorder]) { await session?.send('Browser.close', {}, 4000).catch(() => {}); session?.close(); }
  for (const chrome of [appChrome, recorderChrome]) if (chrome && chrome.exitCode === null) chrome.kill();
  if (demo) { demo.stop(); await demo.exited; }
  await pause(800);
  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
}
