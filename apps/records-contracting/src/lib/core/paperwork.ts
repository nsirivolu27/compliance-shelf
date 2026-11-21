/**
 * Agency paperwork for one case: which forms and reports are tracked, and which of the facts
 * each one needs are on file. Readiness is a count of facts. It is never a compliance rating.
 * Nothing here submits, signs, or files anything, and nothing here answers a disposal notice.
 * This file imports nothing. The case and the catalog are passed in.
 */

export type Row = Record<string, any>;
export type RequiredFact = { key: string; label: string; from: string; type: string };

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

/** Set by people only. "filed-by-agency" records that the agency filed it somewhere else. */
export const paperworkStatuses = ["not-started", "drafting", "ready-for-signature", "filed-by-agency"];
export const paperworkFamilies = ["records-transfer", "records-disposal", "records-reporting", "internal-control", "audit-follow-up", "privacy", "benefits-intake"];
export const paperworkScopes = ["government-wide", "va", "ssa"];
export const paperworkCadences = ["per-transfer", "per-notice", "per-schedule", "per-request", "per-recommendation", "per-system", "annual", "per-claim"];
export const worksheetLabel = "Draft worksheet. Not an official form. Not submitted.";

/** Where a fact's value comes from. Facts read from the case, a record, or a hold need a key this file knows how to read. */
const readableFacts: Record<string, string[]> = {
  case: ["transferring-office"],
  record: ["series-title", "records-description", "disposal-authority"],
  hold: ["no-active-hold"],
};
const factSources = ["case", "record", "hold", "evidence", "manual"];
const factTypes = ["text", "date"];
const catalogId = /^PW-[A-Z0-9-]{2,30}$/;
const factKey = /^[a-z][a-z0-9-]{1,39}$/;

function objectOf(value: unknown, name: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object`);
  return value as Row;
}

function textOf(value: unknown, name: string, max: number, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) invalid(`${name} must be ${min} to ${max} characters`);
  return (value as string).trim();
}

function realDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function noteOf(row: Row): string {
  if (typeof row.note !== "string" || row.note.trim().length < 10 || row.note.length > 2000) invalid("Provide a note of 10 to 2000 characters");
  return row.note.trim();
}

function onlyFields(row: Row, allowed: string[]) {
  for (const key of Object.keys(row)) if (!allowed.includes(key)) invalid(`Unsupported field: ${key.slice(0, 40)}`);
}

/**
 * Checks the shipped catalog once at startup and returns a clean copy.
 * An entry marked "seen" must cite the page it was read on. Anything else is a "candidate".
 */
export function validateCatalog(input: unknown): Row[] {
  const file = objectOf(input, "catalog");
  if (!Array.isArray(file.entries) || !file.entries.length || file.entries.length > 200) invalid("catalog must list 1 to 200 entries");
  const entries: Row[] = [];
  for (const raw of file.entries) {
    const row = objectOf(raw, "catalog entry");
    onlyFields(row, ["id", "title", "formNumber", "family", "scope", "preparedBy", "receivedBy", "cadence", "requiredFacts", "sourceUrl", "verification", "checkedOn", "note", "benefit"]);
    if (typeof row.id !== "string" || !catalogId.test(row.id)) invalid("catalog entry id must look like PW-SF135");
    if (entries.some(entry => entry.id === row.id)) invalid(`catalog entry id is repeated: ${row.id}`);
    if (!paperworkFamilies.includes(row.family)) invalid(`${row.id}: family is not supported`);
    if (!paperworkScopes.includes(row.scope)) invalid(`${row.id}: scope is not supported`);
    if (!paperworkCadences.includes(row.cadence)) invalid(`${row.id}: cadence is not supported`);
    if (!["seen", "candidate"].includes(row.verification)) invalid(`${row.id}: verification must be seen or candidate`);
    if (!realDate(row.checkedOn)) invalid(`${row.id}: checkedOn must be a real YYYY-MM-DD date`);
    const sourceUrl = row.sourceUrl == null ? null : textOf(row.sourceUrl, `${row.id} sourceUrl`, 500);
    if (sourceUrl && !/^https:\/\/[A-Za-z0-9.-]+(?:[/?#][^\s@]*)?$/.test(sourceUrl)) invalid(`${row.id}: sourceUrl must be an https address`);
    if (row.verification === "seen" && !sourceUrl) invalid(`${row.id}: an entry marked seen needs a sourceUrl`);

    const requiredFacts: RequiredFact[] = [];
    if (!Array.isArray(row.requiredFacts) || row.requiredFacts.length > 20) invalid(`${row.id}: requiredFacts must list 0 to 20 facts`);
    for (const rawFact of row.requiredFacts) {
      const fact = objectOf(rawFact, "required fact");
      onlyFields(fact, ["key", "label", "from", "type"]);
      if (typeof fact.key !== "string" || !factKey.test(fact.key)) invalid(`${row.id}: fact key must be lowercase letters, digits, or hyphens`);
      if (requiredFacts.some(existing => existing.key === fact.key)) invalid(`${row.id}: fact key is repeated: ${fact.key}`);
      if (!factSources.includes(fact.from)) invalid(`${row.id}: fact from must be one of ${factSources.join(", ")}`);
      if (readableFacts[fact.from] && !readableFacts[fact.from].includes(fact.key)) invalid(`${row.id}: this system cannot read ${fact.key} from the ${fact.from}`);
      const type = fact.type ?? "text";
      if (!factTypes.includes(type)) invalid(`${row.id}: fact type must be text or date`);
      requiredFacts.push({ key: fact.key, label: textOf(fact.label, "fact label", 120), from: fact.from, type });
    }
    let benefit: Row | undefined;
    if (row.benefit !== undefined) {
      const meta = objectOf(row.benefit, "benefit");
      onlyFields(meta, ["programId", "program", "team", "purpose", "sourceId", "sampleId", "guidanceUrl"]);
      if (row.family !== "benefits-intake" || !["va", "ssa"].includes(row.scope)) invalid("benefit metadata needs benefits-intake and an SSA or VA scope");
      benefit = {};
      for (const key of ["programId", "sourceId", "sampleId"]) {
        if (typeof meta[key] !== "string" || !/^[a-z][a-z0-9-]{1,79}$/.test(meta[key])) invalid(`benefit ${key} must be a lowercase identifier`);
        benefit[key] = meta[key];
      }
      for (const key of ["program", "team"]) benefit[key] = textOf(meta[key], `benefit ${key}`, 120);
      benefit.purpose = textOf(meta.purpose, "benefit purpose", 1000);
      if (typeof meta.guidanceUrl !== "string" || !/^https:\/\/www\.(ssa|va)\.gov\//.test(meta.guidanceUrl) || /\s/.test(meta.guidanceUrl)) invalid("benefit guidanceUrl must be an official SSA or VA https URL");
      benefit.guidanceUrl = meta.guidanceUrl;
      if (entries.some(entry => entry.benefit?.programId === benefit!.programId)) invalid("benefit programId is repeated");
    } else if (row.family === "benefits-intake") invalid("benefits-intake needs benefit metadata");
    entries.push({
      ...(benefit ? { benefit } : {}),
      id: row.id, title: textOf(row.title, `${row.id} title`, 200), formNumber: row.formNumber == null ? null : textOf(row.formNumber, `${row.id} formNumber`, 40),
      family: row.family, scope: row.scope, preparedBy: textOf(row.preparedBy, `${row.id} preparedBy`, 200), receivedBy: textOf(row.receivedBy, `${row.id} receivedBy`, 200),
      cadence: row.cadence, requiredFacts, sourceUrl, verification: row.verification, checkedOn: row.checkedOn, note: textOf(row.note, `${row.id} note`, 1000),
      // "readiness" entries have facts this system can count. "catalog-only" entries are listed and dated, nothing more.
      mode: requiredFacts.length ? "readiness" : "catalog-only",
      needsRecord: requiredFacts.some(fact => fact.from === "record" || fact.from === "hold"),
    });
  }
  return entries;
}

/** A fact read from the case itself. Unknown stays unknown: no value means missing. */
function caseFact(key: string, item: Row) {
  if (key === "transferring-office") return { value: item.businessUnit?.trim() || null, detail: "The case names no business unit. Enter the office here." };
  return { value: null, detail: "Not on file." };
}

/** A fact read from the linked record. A schedule nobody confirmed is not a disposal authority. */
function recordFact(key: string, record: Row | null) {
  if (!record) return { value: null, detail: "No record is linked to this paperwork." };
  if (key === "series-title" || key === "records-description") return { value: record.title?.trim() || null, detail: "The linked record has no title." };
  if (key === "disposal-authority") {
    const schedule = record.schedule;
    if (!schedule) return { value: null, detail: "No schedule is on file for the linked record." };
    if (!schedule.confirmed) return { value: null, detail: "A schedule is on file and a records officer has not confirmed it." };
    return { value: `${schedule.authority}${schedule.itemNumber ? `, item ${schedule.itemNumber}` : ""}`, detail: "" };
  }
  return { value: null, detail: "Not on file." };
}

function factState(fact: RequiredFact, paperwork: Row, item: Row, record: Row | null) {
  const base = { key: fact.key, label: fact.label, from: fact.from, type: fact.type };
  const row = (state: string, value: string | null, origin: string | null, detail: string, stored: Row | null = null) => ({ ...base, state, value, origin, by: stored?.by ?? null, at: stored?.at ?? null, detail });
  const stored: Row | null = paperwork.facts?.[fact.key] ?? null;

  // Hold status comes only from the record's hold review. It can be read, never entered.
  if (fact.from === "hold") {
    if (!record) return row("missing", null, null, "No record is linked to this paperwork.");
    if (record.hold === "active") return row("blocked", "Active hold", "record", "An active hold applies to the linked record. The record is preserved and this paperwork cannot move forward.");
    if (record.hold === "none") return row("present", "No hold applies", "record", "The latest hold review states that no hold applies.");
    return row("missing", null, null, "No hold review has stated whether a hold applies.");
  }
  // Completion evidence is a reference already on the case, and it counts only once a reviewer verified it.
  if (fact.from === "evidence") {
    if (!stored) return row("missing", null, null, "No evidence reference is linked.");
    const evidence = (item.evidence ?? []).find((entry: Row) => entry.id === stored.value);
    if (!evidence) return row("missing", stored.value, stored.origin, "The linked evidence reference is no longer on this case.", stored);
    if (!evidence.verified) return row("missing", stored.value, stored.origin, "The linked evidence reference has not been verified.", stored);
    return row("present", stored.value, stored.origin, "", stored);
  }
  // A value a person entered or accepted wins over one read from the case or record.
  if (stored) return row("present", stored.value, stored.origin, "", stored);
  if (fact.from === "manual") return row("missing", null, null, "Not entered yet.");
  const found = fact.from === "case" ? caseFact(fact.key, item) : recordFact(fact.key, record);
  return found.value ? row("present", found.value, fact.from, "") : row("missing", null, null, found.detail);
}

/**
 * Which required facts are on file for one paperwork item.
 * state: "blocked" when an active hold applies, "incomplete" when a fact is missing,
 * "facts-complete" when every fact is on file, "not-tracked" for catalog-only entries.
 * overdue: a stored due date has passed and no one has recorded that the agency filed it.
 */
export function paperworkReadiness(paperwork: Row, entry: Row | null, item: Row, asOf: string) {
  const record = paperwork.recordId ? (item.records ?? []).find((candidate: Row) => candidate.id === paperwork.recordId) ?? null : null;
  const expectedFacts = [...(entry?.requiredFacts ?? [])];
  // A benefits worksheet may optionally reference a record. Its hold must still be reviewed.
  if (entry?.benefit && paperwork.recordId) expectedFacts.push({ key: 'no-active-hold', label: 'Hold review for the linked record', from: 'hold', type: 'text' });
  const facts = expectedFacts.map((fact: RequiredFact) => factState(fact, paperwork, item, record));
  const present = facts.filter((fact: Row) => fact.state === "present").length;
  const state = !facts.length ? "not-tracked" : facts.some((fact: Row) => fact.state === "blocked") ? "blocked" : present < facts.length ? "incomplete" : "facts-complete";
  const overdue = typeof paperwork.dueDate === "string" && paperwork.dueDate < asOf && paperwork.status !== "filed-by-agency";
  // A status a person set earlier can stop matching the facts, for example when a hold is placed later. Say so.
  let attention: string | null = null;
  const lead = paperwork.status === "ready-for-signature" ? "Marked ready for signature" : paperwork.status === "filed-by-agency" ? "Recorded as filed" : null;
  if (lead && state === "blocked") attention = `${lead}, and an active hold now applies to the linked record. Take it to the hold owner before anything else happens.`;
  else if (lead && state === "incomplete") attention = `${lead}, and a required fact is no longer on file.`;
  return { state, present, required: facts.length, summary: facts.length ? `${present} of ${facts.length} facts present` : "Listed only. No facts are counted for this entry.", overdue, attention, facts };
}

/** Validates a new paperwork item for a case. It starts as "not-started" with no facts. */
export function newPaperworkItem(input: unknown, item: Row, catalog: Row[], context: { id: string; now: string; actor: string }) {
  const row = objectOf(input, "request");
  onlyFields(row, ["expectedRevision", "paperworkId", "recordId", "dueDate", "note"]);
  const note = noteOf(row);
  const entry = catalog.find(candidate => candidate.id === row.paperworkId);
  if (!entry) invalid("That paperwork is not in the catalog");
  if ((item.paperwork ?? []).length >= 50) invalid("A case holds at most 50 paperwork items", 409);
  let recordId: string | null = null;
  if (row.recordId != null) {
    if (!(item.records ?? []).some((record: Row) => record.id === row.recordId)) invalid("Record not found", 404);
    recordId = row.recordId;
  } else if (entry!.needsRecord) invalid("This paperwork is about one record. Choose the record it covers.");
  if (row.dueDate != null && !realDate(row.dueDate)) invalid("dueDate must be a real YYYY-MM-DD date");
  const paperwork = { id: context.id, paperworkId: entry!.id as string, recordId, status: "not-started", dueDate: (row.dueDate ?? null) as string | null, reference: null as string | null, facts: {} as Row, createdAt: context.now, createdBy: context.actor, updatedAt: context.now, updatedBy: context.actor };
  return { paperwork, note };
}

const snapshot = (paperwork: Row) => ({ id: paperwork.id, paperworkId: paperwork.paperworkId, status: paperwork.status, dueDate: paperwork.dueDate, reference: paperwork.reference, facts: Object.fromEntries(Object.entries(paperwork.facts ?? {}).map(([key, fact]) => [key, (fact as Row).value])) });

/** Checks one fact value against its definition and returns the stored form. */
function storedFact(fact: RequiredFact, value: unknown, item: Row, origin: string, context: { now: string; actor: string }) {
  if (fact.from === "hold") invalid("Hold status comes from the hold review on the record. It cannot be entered here.");
  const text = textOf(value, fact.label, 500);
  if (fact.type === "date" && !realDate(text)) invalid(`${fact.label} must be a real YYYY-MM-DD date`);
  if (fact.from === "evidence" && !(item.evidence ?? []).some((entry: Row) => entry.id === text)) invalid(`${fact.label} must be an evidence reference on this case`);
  return { value: text, origin, by: context.actor, at: context.now };
}

/**
 * Applies a person's change to one paperwork item: facts, status, due date, or reference.
 * An active hold on the linked record blocks "ready-for-signature" and "filed-by-agency".
 * "filed-by-agency" always needs a reference, the same way releasing a hold does.
 */
export function changePaperworkItem(input: unknown, item: Row, catalog: Row[], itemId: string, context: { now: string; actor: string; asOf: string }) {
  const row = objectOf(input, "request");
  onlyFields(row, ["expectedRevision", "note", "status", "reference", "dueDate", "facts"]);
  const existing = (item.paperwork ?? []).find((candidate: Row) => candidate.id === itemId);
  if (!existing) invalid("Paperwork item not found", 404);
  const note = noteOf(row);
  if (!["status", "reference", "dueDate", "facts"].some(key => key in row)) invalid("Provide a change: status, reference, dueDate, or facts");
  const entry = catalog.find(candidate => candidate.id === existing.paperworkId) ?? null;
  const next: Row = { ...existing, facts: { ...(existing.facts ?? {}) } };

  if ("facts" in row) {
    const facts = objectOf(row.facts, "facts");
    for (const [key, value] of Object.entries(facts)) {
      const fact = (entry?.requiredFacts ?? []).find((candidate: RequiredFact) => candidate.key === key);
      if (!fact) invalid(`${key.slice(0, 40)} is not a fact this paperwork needs`);
      if (value === null) delete next.facts[key];
      else next.facts[key] = storedFact(fact, value, item, "manual", context);
    }
  }
  if ("dueDate" in row) {
    if (row.dueDate !== null && !realDate(row.dueDate)) invalid("dueDate must be a real YYYY-MM-DD date");
    next.dueDate = row.dueDate;
  }
  if ("reference" in row) next.reference = row.reference === null ? null : textOf(row.reference, "reference", 1000, 3);
  if ("status" in row) {
    if (!paperworkStatuses.includes(row.status)) invalid(`status must be one of: ${paperworkStatuses.join(", ")}`);
    const readiness = paperworkReadiness(next, entry, item, context.asOf);
    const forward = row.status === "ready-for-signature" || row.status === "filed-by-agency";
    if (forward && readiness.state === "blocked") invalid("An active hold applies to the linked record. This paperwork cannot move forward until a hold review releases the hold.", 409);
    if (row.status === "ready-for-signature" && readiness.state === "incomplete") {
      const missing = readiness.required - readiness.present;
      invalid(`${missing} required fact${missing === 1 ? " is" : "s are"} missing. Record ${missing === 1 ? "it" : "them"} before marking this ready for signature.`, 409);
    }
    next.status = row.status;
  }
  if (next.status === "filed-by-agency" && !next.reference) invalid("Recording that the agency filed this needs a reference, such as a receipt or tracking number.");
  next.updatedAt = context.now; next.updatedBy = context.actor;
  return { paperwork: next, change: { command: "paperwork-changed", note, before: snapshot(existing), after: snapshot(next) } };
}

/** Checks a value a reviewer accepted from a document reader, the same way a typed value is checked. */
export function acceptedFact(entry: Row | null, key: string, value: unknown, item: Row, context: { now: string; actor: string }) {
  const fact = (entry?.requiredFacts ?? []).find((candidate: RequiredFact) => candidate.key === key);
  if (!fact) invalid(`${String(key).slice(0, 40)} is not a fact this paperwork needs`);
  if (fact!.from === "evidence") invalid("Evidence of completion is linked from the case. It cannot be filled from a document reader.");
  return storedFact(fact!, value, item, "reader", context);
}

/** A printable draft of one item: every required fact with its value, where it came from, and what is missing. */
export function paperworkWorksheet(paperwork: Row, entry: Row | null, item: Row, asOf: string, generatedAt: string) {
  const readiness = paperworkReadiness(paperwork, entry, item, asOf);
  const record = paperwork.recordId ? (item.records ?? []).find((candidate: Row) => candidate.id === paperwork.recordId) ?? null : null;
  return {
    label: worksheetLabel, paperworkId: paperwork.paperworkId, title: entry?.title ?? "No longer in the catalog", formNumber: entry?.formNumber ?? null,
    verification: entry?.verification ?? "candidate", sourceUrl: entry?.sourceUrl ?? null,
    caseId: item.id, caseTitle: item.title, organization: item.agency ?? null, businessUnit: item.businessUnit ?? null,
    record: record ? { id: record.id, title: record.title } : null,
    status: paperwork.status, dueDate: paperwork.dueDate, reference: paperwork.reference,
    readiness: { state: readiness.state, present: readiness.present, required: readiness.required, summary: readiness.summary, attention: readiness.attention },
    rows: readiness.facts.map((fact: Row) => ({ key: fact.key, label: fact.label, value: fact.value, state: fact.state, origin: fact.origin, detail: fact.detail })),
    asOf, generatedAt,
    limitation: entry?.benefit ? "Synthetic benefits intake worksheet only. Its project-defined fields are not a complete official application checklist. Facts present and ready-for-signature do not establish eligibility, application completeness, a funding decision or payment. Nothing is submitted. Use the current official agency guidance with an authorized reviewer." : "This worksheet gathers facts recorded in this system so a person can complete the official form. Check every line against the current form and the source records. Nothing here was sent to any agency, and nothing here answers a disposal notice.",
  };
}
