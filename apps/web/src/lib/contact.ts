/**
 * A contact address that isn't real yet: empty, or on a reserved example domain (RFC 2606/6761:
 * ".example", "example.com/.org/.net"), as the API's development defaults are. Customer-facing
 * screens never show one: they leave the line out or use wording without an address.
 * Same rule as isPlaceholderContact in apps/api/src/config.ts.
 */
export function isPlaceholderContact(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().replace(/^mailto:/i, '').toLowerCase();
  if (!v) return true;
  const domain = v.includes('@') ? v.slice(v.lastIndexOf('@') + 1) : v;
  return /(^|\.)example$/.test(domain) || /(^|\.)example\.(com|org|net)$/.test(domain);
}

/** The address, or null when it is a placeholder. */
export function realContact(value: string | null | undefined): string | null {
  return isPlaceholderContact(value) ? null : (value ?? '').trim();
}
