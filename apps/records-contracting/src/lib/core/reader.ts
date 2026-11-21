/**
 * Reads the saved output of a document reading service into candidate fields.
 * The only shape understood today is an Amazon Textract AnalyzeDocument response (a list of blocks).
 * Everything in the output is untrusted data: text is copied as text and never acted on.
 * A candidate changes nothing by itself. A reviewer accepts it for one fact, or rejects it.
 * This file imports nothing and calls no service.
 */

export type Row = Record<string, any>;

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export const readerServices = ["amazon-textract"];
export const readerSources = ["service-capture", "shape-sample"];
/** Shown wherever an imported output appears, so a hand-written sample is never mistaken for a service result. */
export const readerLabels: Record<string, string> = {
  "shape-sample": "Sample in the service output shape. Not produced by the service.",
  "service-capture": "Captured from Amazon Textract on a synthetic document.",
};

const maxBlocks = 5000;
const maxCandidates = 200;
const knownTypes = ["PAGE", "LINE", "WORD", "KEY_VALUE_SET", "SELECTION_ELEMENT", "TABLE", "CELL", "MERGED_CELL", "TABLE_TITLE", "TABLE_FOOTER", "SIGNATURE", "QUERY", "QUERY_RESULT"];

/** The service reports confidence as a number from 0 to 100. Anything else is shown as not reported. */
const confidenceOf = (block: Row | undefined) => (typeof block?.Confidence === "number" && Number.isFinite(block.Confidence) && block.Confidence >= 0 && block.Confidence <= 100 ? block.Confidence : null);
const pageOf = (block: Row) => (Number.isSafeInteger(block.Page) && block.Page > 0 ? block.Page : 1);

/**
 * Turns one saved AnalyzeDocument response into candidates.
 * Offered: form fields that have a value, answered queries, and detected signatures.
 * Counted but not offered: table cells, empty fields, values too long to be a fact, and block types this reader does not know.
 */
export function parseReaderOutput(output: unknown) {
  if (!output || typeof output !== "object" || Array.isArray(output)) invalid("Reader output must be an object with a Blocks list");
  const blocks = (output as Row).Blocks;
  if (!Array.isArray(blocks) || !blocks.length) invalid("Reader output must list at least one block");
  if (blocks.length > maxBlocks) invalid(`Reader output holds more than ${maxBlocks} blocks. Import one document at a time.`, 413);
  const byId = new Map<string, Row>();
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block) || typeof block.Id !== "string" || !block.Id || typeof block.BlockType !== "string") invalid("Every block needs an Id and a BlockType");
    byId.set(block.Id, block);
  }
  const related = (block: Row, type: string): Row[] => (Array.isArray(block.Relationships) ? block.Relationships : [])
    .filter((entry: Row) => entry?.Type === type && Array.isArray(entry.Ids))
    .flatMap((entry: Row) => entry.Ids.map((id: unknown) => byId.get(id as string)).filter(Boolean)) as Row[];
  // The words under a block, in order. A checkbox reads as its selection state.
  const textOf = (block: Row) => related(block, "CHILD").map(child => {
    if (child.BlockType === "SELECTION_ELEMENT") return child.SelectionStatus === "SELECTED" ? "Selected" : "Not selected";
    return typeof child.Text === "string" ? child.Text : "";
  }).filter(Boolean).join(" ").trim();

  const counts = { blocks: blocks.length, fields: 0, emptyFields: 0, queryAnswers: 0, signatures: 0, tableCells: 0, skipped: 0, ignored: 0 };
  const candidates: Row[] = [];
  const offer = (kind: string, label: string, value: string | null, confidence: number | null, labelConfidence: number | null, page: number) => {
    if (label.length > 200 || (value !== null && value.length > 500) || candidates.length >= maxCandidates) { counts.skipped += 1; return false; }
    candidates.push({ id: `c-${candidates.length + 1}`, kind, label, value, confidence, labelConfidence, page });
    return true;
  };

  for (const block of blocks) {
    if (block.BlockType === "KEY_VALUE_SET" && Array.isArray(block.EntityTypes) && block.EntityTypes.includes("KEY")) {
      const label = textOf(block);
      const valueBlock = related(block, "VALUE")[0];
      const value = valueBlock ? textOf(valueBlock) : "";
      if (!label || !value) { counts.emptyFields += 1; continue; }
      if (offer("field", label, value, confidenceOf(valueBlock), confidenceOf(block), pageOf(block))) counts.fields += 1;
    } else if (block.BlockType === "QUERY") {
      const answer = related(block, "ANSWER")[0];
      const question = typeof block.Query?.Text === "string" ? block.Query.Text.trim() : "";
      const text = typeof answer?.Text === "string" ? answer.Text.trim() : "";
      if (!question || !text) continue;
      if (offer("query-answer", question, text, confidenceOf(answer), null, pageOf(block))) counts.queryAnswers += 1;
    } else if (block.BlockType === "SIGNATURE") {
      if (offer("signature", `Signature detected on page ${pageOf(block)}`, null, confidenceOf(block), null, pageOf(block))) counts.signatures += 1;
    } else if (block.BlockType === "CELL" || block.BlockType === "MERGED_CELL") counts.tableCells += 1;
    else if (!knownTypes.includes(block.BlockType) && !block.BlockType.startsWith("LAYOUT_")) counts.ignored += 1;
  }
  const declared = (output as Row).DocumentMetadata?.Pages;
  const pages = Number.isSafeInteger(declared) && declared > 0 ? declared : blocks.reduce((highest: number, block: Row) => Math.max(highest, pageOf(block)), 1);
  return { pages, counts, candidates };
}

function isoMoment(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

/**
 * Validates an import request and returns what is stored: the parsed candidates, the counts,
 * and a digest of the output. The raw output itself is not kept.
 * Only synthetic documents may be imported, and the request has to say so.
 */
export function newReaderOutput(input: unknown, context: { id: string; now: string; actor: string; sha256: string }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Expected a JSON object");
  const row = input as Row;
  for (const key of Object.keys(row)) if (!["expectedRevision", "title", "service", "source", "capturedAt", "synthetic", "note", "output"].includes(key)) invalid(`Unsupported field: ${key.slice(0, 40)}`);
  if (typeof row.note !== "string" || row.note.trim().length < 10 || row.note.length > 2000) invalid("Provide a note of 10 to 2000 characters");
  if (typeof row.title !== "string" || !row.title.trim() || row.title.length > 200) invalid("title must be 1 to 200 characters");
  if (!readerServices.includes(row.service)) invalid(`service must be one of: ${readerServices.join(", ")}`);
  if (!readerSources.includes(row.source)) invalid(`source must be one of: ${readerSources.join(", ")}`);
  if (row.synthetic !== true) invalid("Only synthetic documents may be imported. Set synthetic to true to confirm the document contains no real personal or agency data.");
  const capturedAt = row.capturedAt ?? null;
  if (row.source === "service-capture" && !isoMoment(capturedAt)) invalid("A service capture needs capturedAt as a UTC time, for example 2026-11-19T20:00:00Z");
  if (row.source === "shape-sample" && capturedAt !== null) invalid("A sample was not captured from the service, so it has no capturedAt");
  const parsed = parseReaderOutput(row.output);
  return {
    output: {
      id: context.id, title: row.title.trim(), service: row.service as string, source: row.source as string, label: readerLabels[row.source], capturedAt: capturedAt as string | null, synthetic: true,
      sha256: context.sha256, importedAt: context.now, importedBy: context.actor, pages: parsed.pages, counts: parsed.counts,
      candidates: parsed.candidates.map(candidate => ({ ...candidate, decision: null as Row | null })),
    },
    note: row.note.trim(),
  };
}

/**
 * Validates a reviewer's decision on one candidate. A candidate is decided once.
 * Accepting names the paperwork item and the fact it fills. Rejecting names nothing.
 * The caller checks the value against the fact before anything is written.
 */
export function decideCandidate(input: unknown, readerOutput: Row, candidateId: string, context: { now: string; actor: string }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Expected a JSON object");
  const row = input as Row;
  for (const key of Object.keys(row)) if (!["expectedRevision", "decision", "target", "note"].includes(key)) invalid(`Unsupported field: ${key.slice(0, 40)}`);
  if (typeof row.note !== "string" || row.note.trim().length < 10 || row.note.length > 2000) invalid("Provide a note of 10 to 2000 characters");
  if (row.decision !== "accept" && row.decision !== "reject") invalid("decision must be accept or reject");
  const candidate = (readerOutput.candidates ?? []).find((entry: Row) => entry.id === candidateId);
  if (!candidate) invalid("Candidate not found", 404);
  if (candidate.decision) invalid(`This candidate was already ${candidate.decision.decision}. A candidate is decided once.`, 409);
  let target: { itemId: string; factKey: string } | null = null;
  if (row.decision === "accept") {
    if (candidate.kind === "signature") invalid("A detected signature shows that a signature appears on the page. It cannot fill a fact.");
    const wanted = row.target;
    if (!wanted || typeof wanted !== "object" || Array.isArray(wanted) || typeof wanted.itemId !== "string" || typeof wanted.factKey !== "string" || Object.keys(wanted).length !== 2) invalid("Accepting a candidate needs a target with itemId and factKey");
    target = { itemId: wanted.itemId, factKey: wanted.factKey };
  } else if (row.target !== undefined) invalid("A rejection has no target");
  const decision = { decision: row.decision === "accept" ? "accepted" : "rejected", note: row.note.trim(), at: context.now, by: context.actor, ...(target ? { target } : {}) };
  return { candidate: { ...candidate, decision }, target, note: row.note.trim() };
}
