/** Content is untrusted source material, never an instruction to a tool or model. */
export function validateDocument(input: unknown) {
  function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Expected a document object');
  const row = input as Record<string, unknown>;
  for (const key of Object.keys(row)) if (!['caseId', 'title', 'filename', 'mediaType', 'content', 'note'].includes(key)) fail(`Unsupported field: ${key}`);
  const text = (key: string, max: number, min = 1) => {
    const value = row[key];
    if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(`${key} must contain ${min}–${max} characters`);
    return value.trim();
  };
  const caseId = text('caseId', 100);
  if (!/^[A-Za-z0-9_-]+$/.test(caseId)) fail('Invalid case ID');
  const filename = text('filename', 160);
  if (/[\\/\x00-\x1f]/.test(filename)) fail('filename must be a display name, not a path');
  const mediaType = text('mediaType', 100);
  if (!['text/plain', 'text/markdown', 'application/json'].includes(mediaType)) fail('Supported content types: text/plain, text/markdown, application/json. PDF/OCR is not connected.', 415);
  if (typeof row.content !== 'string' || !row.content.trim() || row.content.length > 262144 || row.content.includes('\0')) fail('Supply nonempty text content without NUL bytes, up to 256 KiB');
  const content = row.content.replace(/\r\n?/g, '\n');
  if (mediaType === 'application/json') { try { JSON.parse(content); } catch { fail('Document content is not valid JSON'); } }
  return { caseId, title: text('title', 200), filename, mediaType, content, note: text('note', 2000, 10) };
}

export function extractSpans(content: string) {
  const spans = [];
  let offset = 0;
  let line = 1;
  while (offset < content.length) {
    let end = Math.min(offset + 1200, content.length);
    if (end < content.length) {
      const boundary = content.lastIndexOf('\n', end - 1);
      if (boundary >= offset) end = boundary + 1;
      // Do not split a Unicode surrogate pair at a fixed-width boundary.
      const last = content.charCodeAt(end - 1);
      if (last >= 0xD800 && last <= 0xDBFF) end--;
    }
    const text = content.slice(offset, end);
    const newlines = (text.match(/\n/g) ?? []).length;
    spans.push({ id: `span-${spans.length + 1}`, startOffset: offset, endOffset: end, startLine: line, endLine: line + newlines - (text.endsWith('\n') ? 1 : 0), text });
    line += newlines;
    offset = end;
  }
  return spans;
}
