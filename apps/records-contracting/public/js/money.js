// Money in the browser. Dollars a person types become whole cents, and cents are shown as dollars.
// Only string and BigInt operations are used, so no amount passes through floating-point arithmetic.
// The server validates every amount again; this only helps a person type one correctly.

const dollarsPattern = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** "1,234.50", "$250000" or "0.07" as whole cents. Anything else, including negatives, is null. */
export function parseUsd(text) {
  if (typeof text !== 'string') return null;
  const match = dollarsPattern.exec(text.trim().replace(/^\$\s*/, ''));
  if (!match) return null;
  const cents = BigInt(`${match[1].replace(/,/g, '')}${(match[2] ?? '').padEnd(2, '0')}`);
  return cents > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(cents);
}

/** Cents as US dollars, for example 123456789 as $1,234,567.89. */
export function formatUsd(cents) {
  const value = BigInt(cents);
  const size = value < 0n ? -value : value;
  const dollars = (size / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0n ? '-' : ''}$${dollars}.${(size % 100n).toString().padStart(2, '0')}`;
}

/** Cents as an editable value without the dollar sign, for example 25000000 as 250,000.00. */
export const usdInput = cents => formatUsd(cents).replace('$', '');
