/**
 * Passwords people pick first, and that attackers try first (from public breach-frequency lists),
 * plus the obvious ones for this product. Compared case-insensitively, ignoring digits and symbols
 * at the end ("Password2026!" is "password").
 */
const LIST = `password passw0rd p@ssword p@ssw0rd qwerty qwertyuiop asdfgh asdfghjkl zxcvbnm 123456 1234567 12345678 123456789 1234567890 0987654321
111111 000000 abc123 iloveyou admin administrator welcome letmein monkey dragon football baseball hockey soccer
sunshine princess master shadow superman batman trustno1 starwars whatever freedom secret login changeme default
summer winter spring autumn canada toronto montreal vancouver calgary ottawa edmonton winnipeg kelowna quebec
lifeguard swimming pool aquatics recreation flexcity flexcityhq headquarters municipal cityhall staff employee
maple leafs canucks oilers flames jets senators habs`;

const COMMON = new Set(LIST.split(/\s+/).filter(Boolean));
const core = (p: string) => p.toLowerCase().replace(/[^a-z]+$/, '').replace(/^[^a-z]+/, '');

/** True when the password is a well-known one, a repeated character or a keyboard run. */
export function isCommonPassword(password: string, email?: string): boolean {
  const p = password.toLowerCase();
  if (COMMON.has(p) || COMMON.has(core(p))) return true;
  if (/^(.)\1+$/.test(p)) return true;
  // Their own name from their email, with a number on the end.
  const local = email?.split('@')[0]?.toLowerCase().replace(/[^a-z]/g, '');
  if (local && local.length >= 3 && core(p).replace(/[^a-z]/g, '') === local) return true;
  return false;
}

const fold = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * True when the password contains the person's own details or their organization's name: their
 * email name, first or last name (3 letters or more), the organization's name or subdomain.
 * Accents, case and punctuation are ignored ("Jérémie-2026!" contains "jeremie").
 */
export function isPersonalPassword(password: string, about: { email?: string | null; firstName?: string | null; lastName?: string | null; organization?: string | null; subdomain?: string | null }): boolean {
  const p = fold(password);
  const parts = [about.email?.split('@')[0], about.firstName, about.lastName, about.subdomain, ...(about.organization ?? '').split(/\s+/).filter((w) => !/^(city|ville|of|de|du|la|le|the|town|municipality|county|district|regional|inc|ltd)$/i.test(w))]
    .map((x) => fold(x ?? ''))
    .filter((x) => x.length >= 3);
  return parts.some((x) => p.includes(x));
}
