/**
 * The same check as the app's (apps/web/src/lib/browserCheck.ts, which explains it; a test keeps the two
 * identical). Supported: Chrome, Edge and Firefox 111 or newer, Safari 16.4 or newer (iOS/iPadOS 16.4),
 * Next.js 16's minimum. On an older browser it marks <html data-old-browser> before any of Next's
 * scripts run, and the CSS below swaps the page for the static notice (components/OldBrowser.tsx).
 * Plain ES5, no eval, no user-agent sniffing.
 */
export const OLD_BROWSER_ATTR = 'data-old-browser';

export const BROWSER_CHECK_SCRIPT =
  "(function(){var ok=true;try{new RegExp('(?<=a)b')}catch(e){ok=false}try{var c=window.CSS;if(!c||!c.supports||!c.supports('width','calc(1px * sin(1rad))')||!c.supports('container-type','inline-size'))ok=false}catch(e){}if(!ok)document.documentElement.setAttribute('data-old-browser',/\\/kiosk(\\/|$)/.test(location.pathname)?'kiosk':'')})();";

/** Hidden unless the check marked the page; then everything else in <body> is hidden. */
export const OLD_BROWSER_CSS =
  '#fh-old-browser{display:none}' +
  'html[data-old-browser] body>*{display:none!important}' +
  'html[data-old-browser] body>#fh-old-browser{display:block!important}' +
  '#fh-old-browser .fh-ob-kiosk{display:none}' +
  'html[data-old-browser=kiosk] #fh-old-browser .fh-ob-kiosk{display:block}' +
  'html[data-old-browser=kiosk] #fh-old-browser .fh-ob-update{display:none}';
