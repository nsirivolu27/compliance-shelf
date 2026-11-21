/** Pure, bounded list queries. Filters never change the underlying findings. */
export function parseListQuery(entries: Iterable<[string, string]>) {
  const query: Record<string, string> = Object.create(null);
  for (const [key, value] of entries) {
    if (Object.hasOwn(query, key)) throw Object.assign(new Error(`Repeated query parameter: ${key}`), { status: 400 });
    query[key] = value;
  }
  return query;
}

export function queryPage<T extends object>(rows: T[], query: Record<string, string>, options: {
  revision: number;
  textFields: (keyof T)[];
  filters: Partial<Record<keyof T, readonly string[] | null>>;
}) {
  const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
  const permitted = ['asOf', 'q', 'limit', 'offset', 'workspaceRevision', ...Object.keys(options.filters)];
  for (const key of Object.keys(query)) if (!permitted.includes(key)) fail(`Unknown query parameter: ${key}`);
  const integer = (name: string, fallback: number, max: number) => {
    if (!(name in query)) return fallback;
    if (!/^\d+$/.test(query[name])) fail(`${name} must be a nonnegative integer`);
    const value = Number(query[name]);
    if (!Number.isSafeInteger(value) || value > max) fail(`${name} is out of range`);
    return value;
  };
  const limit = integer('limit', 50, 100);
  if (limit === 0) fail('limit must be between 1 and 100');
  const offset = integer('offset', 0, Number.MAX_SAFE_INTEGER);
  const revision = integer('workspaceRevision', options.revision, Number.MAX_SAFE_INTEGER);
  if (revision !== options.revision) {
    throw Object.assign(new Error('Workspace changed. Reload the list from its first page.'), { status: 409, currentRevision: options.revision });
  }
  const search = (query.q ?? '').trim().toLowerCase();
  if (search.length > 200) fail('Search text must be at most 200 characters');
  let matches = rows;
  for (const key of Object.keys(options.filters) as (keyof T)[]) {
    const value = query[String(key)];
    if (value === undefined) continue;
    const allowed = options.filters[key];
    if (!value.trim() || (allowed && !allowed.includes(value))) fail(`Invalid ${String(key)} filter`);
    matches = matches.filter(row => String(row[key]) === value);
  }
  if (search) matches = matches.filter(row => options.textFields.some(key => String(row[key] ?? '').toLowerCase().includes(search)));
  const page = matches.slice(offset, offset + limit);
  return { items: page, pagination: { total: matches.length, offset, limit, nextOffset: offset + page.length < matches.length ? offset + page.length : null, workspaceRevision: options.revision } };
}
