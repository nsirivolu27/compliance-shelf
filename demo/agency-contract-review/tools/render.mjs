// Renders the Markdown companions in ../text to PDF originals in ../originals.
// Dependency-free: a small Markdown subset (headings, paragraphs, bold, italic,
// inline code, bullet and numbered lists, pipe tables, horizontal rules) is
// converted to print HTML, then printed with Chrome headless.
//
// Usage: node tools/render.mjs
// Optional: set CHROME_PATH to override the default Chrome location.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const BANNER = 'SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD.';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_DIR = join(ROOT, 'text');
const OUT_DIR = join(ROOT, 'originals');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE_PATTERN = /^(SYN-VAP-DOC-\d{2})_v(\d+\.\d+)\.md$/;

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

const isTableSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const isBullet = (line) => /^\s*[-*]\s+/.test(line);
const isNumbered = (line) => /^\s*\d+[.)]\s+/.test(line);

function renderTable(lines) {
  const head = splitRow(lines[0]);
  const body = lines.slice(2).map(splitRow);
  const th = head.map((c) => `<th>${inline(c)}</th>`).join('');
  const rows = body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('\n');
  return `<table class="data"><thead><tr>${th}</tr></thead><tbody>\n${rows}\n</tbody></table>`;
}

function markdownToHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i += 1; continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i += 1; continue; }
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i]); i += 1; }
      out.push(renderTable(block));
      continue;
    }
    if (isBullet(line) || isNumbered(line)) {
      const ordered = isNumbered(line);
      const items = [];
      while (i < lines.length && (ordered ? isNumbered(lines[i]) : isBullet(lines[i]))) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, ''));
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^#{1,4}\s/.test(lines[i])
      && !isBullet(lines[i]) && !isNumbered(lines[i]) && !lines[i].trim().startsWith('|')) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

const CSS = `
@page { size: Letter; margin: 14mm 18mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Georgia, "Times New Roman", serif; font-size: 10.5pt; line-height: 1.42; color: #111; }
.banner-top, .banner-bottom { position: fixed; left: 0; right: 0; text-align: center;
  font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; font-weight: bold; letter-spacing: 0.02em; color: #7a0000; }
.banner-top { top: 0; border-bottom: 1px solid #7a0000; padding-bottom: 2mm; }
.banner-bottom { bottom: 0; border-top: 1px solid #7a0000; padding-top: 1.5mm; }
.banner-bottom .docref { display: block; font-weight: normal; color: #333; margin-top: 0.6mm; }
table.page { width: 100%; border-collapse: collapse; }
table.page > thead td { height: 11mm; }
table.page > tfoot td { height: 14mm; }
h1 { font-size: 16pt; margin: 2mm 0 3mm; line-height: 1.2; }
h2 { font-size: 12.5pt; margin: 5mm 0 2mm; border-bottom: 0.6pt solid #999; padding-bottom: 0.8mm; break-after: avoid; }
h3 { font-size: 11pt; margin: 4mm 0 1.5mm; break-after: avoid; }
h4 { font-size: 10.5pt; margin: 3mm 0 1mm; break-after: avoid; }
p { margin: 0 0 2.2mm; }
ul, ol { margin: 0 0 2.5mm 6mm; padding-left: 4mm; }
li { margin-bottom: 0.8mm; }
code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; }
hr { border: 0; border-top: 0.6pt solid #999; margin: 4mm 0; }
table.data { width: 100%; border-collapse: collapse; margin: 1.5mm 0 3.5mm; font-family: Arial, Helvetica, sans-serif; font-size: 8.8pt; line-height: 1.3; }
table.data th, table.data td { border: 0.6pt solid #777; padding: 1.2mm 1.6mm; vertical-align: top; text-align: left; }
table.data th { background: #e8e8e8; }
table.data tr { break-inside: avoid; }
`;

function buildHtml(markdown, docId, version) {
  const lines = markdown.split('\n');
  if (lines[0] !== BANNER) throw new Error(`${docId} v${version}: first line is not the banner`);
  const title = (lines.find((l) => l.startsWith('# ')) || docId).replace(/^#\s+/, '');
  const body = markdownToHtml(lines.slice(1).join('\n'));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(`${docId} v${version} — ${title}`)}</title>
<style>${CSS}</style></head>
<body>
<div class="banner-top">${BANNER}</div>
<div class="banner-bottom">${BANNER}<span class="docref">${docId} v${version} · Fictional document for a local prototype demonstration</span></div>
<table class="page"><thead><tr><td></td></tr></thead>
<tfoot><tr><td></td></tr></tfoot>
<tbody><tr><td>
${body}
</td></tr></tbody></table>
</body></html>`;
}

function renderAll() {
  mkdirSync(OUT_DIR, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'syn-vap-render-'));
  const profileDir = join(workDir, 'chrome-profile');
  const files = readdirSync(TEXT_DIR).filter((f) => FILE_PATTERN.test(f)).sort();
  if (files.length === 0) throw new Error('No companions found in text/');
  try {
    for (const file of files) {
      const [, docId, version] = FILE_PATTERN.exec(file);
      const markdown = readFileSync(join(TEXT_DIR, file), 'utf8').replace(/\r\n/g, '\n');
      const htmlPath = join(workDir, file.replace(/\.md$/, '.html'));
      writeFileSync(htmlPath, buildHtml(markdown, docId, version), 'utf8');
      const outPath = join(OUT_DIR, basename(file, '.md') + '.pdf');
      execFileSync(CHROME, [
        '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--no-first-run',
        `--user-data-dir=${profileDir}`, `--print-to-pdf=${outPath}`, pathToFileURL(htmlPath).href,
      ], { stdio: 'pipe', timeout: 90000 });
      const size = statSync(outPath).size;
      if (size === 0) throw new Error(`Empty PDF for ${file}`);
      console.log(`rendered ${basename(outPath)} (${size} bytes)`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

renderAll();
