/** Deterministic JSON: recursively sorted keys, original array order, JSON values. */
export function canonicalJson(value: unknown): string {
  // Match JSON wire semantics for omitted optional properties and array values.
  const normalized: unknown = JSON.parse(JSON.stringify(value));
  function serialize(item: unknown): string {
    if (Array.isArray(item)) return `[${item.map(serialize).join(',')}]`;
    if (item !== null && typeof item === 'object') {
      const row = item as Record<string, unknown>;
      return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${serialize(row[key])}`).join(',')}}`;
    }
    return JSON.stringify(item);
  }
  return serialize(normalized);
}
