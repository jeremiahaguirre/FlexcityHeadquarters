/**
 * Takes personal information and secrets out of text and objects before they leave FH (error
 * reports). Errors are written by code, but their messages can quote what someone typed, a URL
 * with a token in it, or a database value: anything that looks like an email address, a phone
 * number, a SIN or card number, a token or a password is replaced by a placeholder.
 */

type Replacement = string | ((match: string) => string);

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

const PATTERNS: Array<[RegExp, Replacement]> = [
  // Authorization headers and bearer tokens, in any spelling.
  [/\b(authorization|cookie|set-cookie)\b(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+(?:\s+[^\s,;]+)?)/gi, '$1$2[redacted]'],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [token]'],
  // key=value / "key": "value" for secret-sounding keys.
  [/\b([\w-]*(?:password|passwd|pwd|secret|token|api[_-]?key|signature|otp|pin)[\w-]*)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,;"']+)/gi, '$1$2[redacted]'],
  // JSON web tokens and other long opaque strings.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[token]'],
  // (Record ids, which are UUIDs, stay: they identify a row, not a person.)
  [/\b[A-Za-z0-9_-]{32,}\b/g, (m) => (UUID.test(m) ? m : '[token]')],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // Card numbers (13 to 19 digits, spaced or not), then SIN-like (3-3-3) numbers.
  [/\b(?:\d[ -]?){12,18}\d\b/g, '[number]'],
  [/\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g, '[number]'],
  // North American phone numbers.
  [/(?:\+?1[ .-]?)?\(?\b\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g, '[phone]'],
];

export function scrubText(text: string): string {
  let out = text;
  for (const [re, to] of PATTERNS) out = typeof to === 'string' ? out.replace(re, to) : out.replace(re, to);
  return out;
}

/** Keys whose values are never sent, whatever they hold. */
const SECRET_KEY = /pass|secret|token|authorization|cookie|session|api[_-]?key|signature|^sin$|social|ssn|email|phone|mobile|birth|dob|address|bank|account|iban|transit|card|^name$|first_?name|last_?name|full_?name/i;

/** A deep copy of `value` with secret-sounding keys dropped and every string scrubbed. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 100)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : scrubValue(v, depth + 1);
    return out;
  }
  return value;
}

/** A URL path with ids, numbers and long segments replaced: "/manage/people/5f…/edit" → "/manage/people/:id/edit". */
export function scrubPath(path: string): string {
  const [p = ''] = path.split(/[?#]/);
  return (
    p
      .split('/')
      .map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) || /\d/.test(seg) || seg.length > 40 || /[@%]/.test(seg) ? ':id' : seg))
      .join('/')
      .slice(0, 200) || '/'
  );
}
