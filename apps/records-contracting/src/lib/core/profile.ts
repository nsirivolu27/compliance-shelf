/**
 * Pure validation for a workspace profile: who the workspace belongs to and
 * which evidence checks new cases are screened against.
 * A profile only names checks and cites sources. It never carries scores,
 * thresholds, or anything that could mark a case compliant.
 * This file imports nothing; the built-in source IDs are passed in.
 */

export type ProfileSource = { id: string; title: string; url: string; locator: string; scope: string; checkedOn: string };
export type Profile = {
  organization: { name: string; kind: "agency" | "company" | "other" };
  checkSet: { id: string; name: string; checks: { kind: string; title: string; sourceIds: string[] }[]; policySourceIds: string[]; recordsSourceIds: string[]; expectedRecords?: { kind: string; title: string; sourceIds: string[] }[]; paperwork?: string[] };
  sources: ProfileSource[];
  businessUnit?: string;
  family?: string;
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function objectOf(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function onlyFields(row: Record<string, unknown>, allowed: string[], name: string) {
  for (const key of Object.keys(row)) if (!allowed.includes(key)) invalid(`Unsupported ${name} field: ${key.slice(0, 40)}`);
}

function textOf(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid(`${name} must be 1 to ${max} characters`);
  return (value as string).trim();
}

const slug = /^[a-z][a-z0-9-]{1,39}$/;
function slugOf(value: unknown, name: string): string {
  if (typeof value !== "string" || !slug.test(value)) invalid(`${name} must be 2 to 40 lowercase letters, digits, or hyphens, starting with a letter`);
  return value as string;
}

function realDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function listOf(value: unknown, name: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(`${name} must list ${min} to ${max} items`);
  return value as unknown[];
}

/** Checks a profile and returns a clean copy. Every cited source must exist. */
export function validateProfile(input: unknown, builtInSourceIds: string[]): Profile {
  const row = objectOf(input, "profile");
  onlyFields(row, ["organization", "checkSet", "sources", "businessUnit", "family"], "profile");
  // Optional scope labels. Omitted or null means absent; anything else must be real text.
  const labelOf = (value: unknown, name: string, max: number) => value === undefined || value === null ? {} : { [name]: textOf(value, name, max) };
  const labels = { ...labelOf(row.businessUnit, "businessUnit", 120), ...labelOf(row.family, "family", 80) } as { businessUnit?: string; family?: string };

  const organizationRow = objectOf(row.organization, "organization");
  onlyFields(organizationRow, ["name", "kind"], "organization");
  if (!["agency", "company", "other"].includes(organizationRow.kind as string)) invalid("organization kind must be agency, company, or other");
  const organization = { name: textOf(organizationRow.name, "organization name", 200), kind: organizationRow.kind as Profile["organization"]["kind"] };

  const sources: ProfileSource[] = [];
  for (const entry of listOf(row.sources ?? [], "sources", 0, 50)) {
    const source = objectOf(entry, "source");
    onlyFields(source, ["id", "title", "url", "locator", "scope", "checkedOn"], "source");
    const id = slugOf(source.id, "source id");
    if (builtInSourceIds.includes(id) || sources.some(existing => existing.id === id)) invalid(`Source id is already in use: ${id}`);
    const url = textOf(source.url, "source url", 500);
    // A plain https address: a host name, an optional port and path, and no sign-in part.
    if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?#][^\s@]*)?$/.test(url)) invalid("source url must be an https address without credentials");
    if (!realDate(source.checkedOn)) invalid("source checkedOn must be a real YYYY-MM-DD date");
    sources.push({ id, title: textOf(source.title, "source title", 200), url, locator: textOf(source.locator, "source locator", 500), scope: textOf(source.scope, "source scope", 1000), checkedOn: source.checkedOn as string });
  }
  const known = [...builtInSourceIds, ...sources.map(source => source.id)];
  const sourceIdsOf = (value: unknown, name: string) => {
    const ids = listOf(value, name, 1, 10).map(id => {
      if (typeof id !== "string" || !known.includes(id)) invalid(`${name} cites a source that is not defined`);
      return id as string;
    });
    if (new Set(ids).size !== ids.length) invalid(`${name} repeats a source`);
    return ids;
  };

  const checkSetRow = objectOf(row.checkSet, "checkSet");
  onlyFields(checkSetRow, ["id", "name", "checks", "policySourceIds", "recordsSourceIds", "expectedRecords", "paperwork"], "checkSet");
  const checks: Profile["checkSet"]["checks"] = [];
  for (const entry of listOf(checkSetRow.checks, "checks", 1, 20)) {
    const check = objectOf(entry, "check");
    onlyFields(check, ["kind", "title", "sourceIds"], "check");
    const kind = slugOf(check.kind, "check kind");
    if (checks.some(existing => existing.kind === kind)) invalid(`Check kind is repeated: ${kind}`);
    checks.push({ kind, title: textOf(check.title, "check title", 200), sourceIds: sourceIdsOf(check.sourceIds, "check sourceIds") });
  }
  // Record types the organization expects a case to hold. Optional. An expected type with no inventoried
  // record is reported as a documentation gap; it is never treated as proof that a record must exist.
  const expectedRecords: NonNullable<Profile["checkSet"]["expectedRecords"]> = [];
  for (const entry of listOf(checkSetRow.expectedRecords ?? [], "expectedRecords", 0, 20)) {
    const expected = objectOf(entry, "expected record");
    onlyFields(expected, ["kind", "title", "sourceIds"], "expected record");
    const kind = slugOf(expected.kind, "expected record kind");
    if (expectedRecords.some(existing => existing.kind === kind)) invalid(`Expected record kind is repeated: ${kind}`);
    expectedRecords.push({ kind, title: textOf(expected.title, "expected record title", 200), sourceIds: sourceIdsOf(expected.sourceIds, "expected record sourceIds") });
  }
  // Paperwork catalog entries to offer on a new case. Optional. A suggestion only: nothing is added to a case
  // until a person adds it, and the list says nothing about what an office must file.
  const paperwork: string[] = [];
  for (const entry of listOf(checkSetRow.paperwork ?? [], "paperwork", 0, 20)) {
    if (typeof entry !== "string" || !/^PW-[A-Z0-9-]{2,30}$/.test(entry)) invalid("paperwork must list catalog ids such as PW-SF135");
    if (paperwork.includes(entry)) invalid(`paperwork repeats an entry: ${entry}`);
    paperwork.push(entry);
  }
  const checkSet = {
    id: slugOf(checkSetRow.id, "checkSet id"), name: textOf(checkSetRow.name, "checkSet name", 200), checks,
    policySourceIds: sourceIdsOf(checkSetRow.policySourceIds, "policySourceIds"),
    recordsSourceIds: sourceIdsOf(checkSetRow.recordsSourceIds, "recordsSourceIds"),
    ...(expectedRecords.length ? { expectedRecords } : {}),
    ...(paperwork.length ? { paperwork } : {}),
  };
  return { organization, checkSet, sources, ...labels };
}
