/**
 * The marketing website opens the demo with `?back=<its address>`; the demo then shows a
 * "Back to the website" button for the rest of the visit. Opened directly (the GitHub Pages
 * test address), there's no `back` and no button.
 *
 * Only the website's own addresses are accepted, so the link can't be pointed elsewhere.
 * NEXT_PUBLIC_SITE_HOSTS (comma-separated) replaces the default list.
 */
const KEY = 'fh-demo-back';
const DEFAULT_HOSTS = ['flexcity-headquarters-iota.vercel.app', 'flexcityheadquarters.ca', 'flexcityheadquarters.com', 'localhost', '127.0.0.1'];

export function allowedBack(raw: string | null, hosts = process.env.NEXT_PUBLIC_SITE_HOSTS): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  if (u.username || u.password) return null;
  const list = hosts ? hosts.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) : DEFAULT_HOSTS;
  const host = u.hostname.toLowerCase();
  const ok = list.some((h) => host === h || host.endsWith(`.${h}`)) || (!hosts && /^flexcity[a-z0-9-]*\.vercel\.app$/.test(host));
  return ok ? u.toString() : null;
}

/** The website address to go back to, remembered for this tab's visit. */
export function demoBackUrl(): string | null {
  try {
    const fromLink = allowedBack(new URLSearchParams(window.location.search).get('back'));
    if (fromLink) sessionStorage.setItem(KEY, fromLink);
    return fromLink ?? allowedBack(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}
