/**
 * Supported browsers: Chrome, Edge and Firefox 111 or newer, Safari 16.4 or newer (iOS/iPadOS 16.4).
 * That is Next.js 16's minimum, and its own client code uses syntax older browsers can't even parse
 * (class static blocks), so there the page would show but nothing would respond. Instead, this check
 * runs first thing in <body>, before any of Next's scripts, and marks <html data-old-browser> on an
 * older browser; the CSS below then swaps the page for the static notice (components/OldBrowser.tsx).
 *
 * It has to run on the old browsers themselves, so it is one plain ES5 string (a test checks that):
 * no Next or React, no user-agent sniffing, and no eval or new Function (the app's script policy has
 * no 'unsafe-eval'). Three feature tests, each one tracking a browser's real minimum:
 * - RegExp lookbehind: Safari 16.4 (Chrome 62, Firefox 78), so Safari and iOS exactly at 16.4.
 * - CSS trigonometric functions, sin(): Chrome and Edge 111 (Firefox 108, Safari 15.4), so exactly 111.
 * - CSS container queries: Firefox 110 (Chrome 105, Safari 16). Nothing that only Firefox 111 added can
 *   be tested without a false alarm, so Firefox passes from 110, which runs Next 16's code anyway.
 * Every supported browser passes all three, so it never sees the notice. A check that throws for any
 * other reason counts as passed: a false alarm would lock people out of a working app.
 * On a facility kiosk (/kiosk) the attribute is "kiosk", and the notice tells staff to ask a supervisor.
 */
export const OLD_BROWSER_ATTR = 'data-old-browser';

// One plain literal, like BOOT_SCRIPT: the production minifier never touches it.
export const BROWSER_CHECK_SCRIPT =
  "(function(){var ok=true;try{new RegExp('(?<=a)b')}catch(e){ok=false}try{var c=window.CSS;if(!c||!c.supports||!c.supports('width','calc(1px * sin(1rad))')||!c.supports('container-type','inline-size'))ok=false}catch(e){}if(!ok)document.documentElement.setAttribute('data-old-browser',/\\/kiosk(\\/|$)/.test(location.pathname)?'kiosk':'')})();";

/**
 * Hidden unless the check marked the page; then everything else in <body> is hidden. Inline in the
 * page (not in the CSS bundle), so it can't depend on how the bundle is built for newer browsers.
 */
export const OLD_BROWSER_CSS =
  '#fh-old-browser{display:none}' +
  'html[data-old-browser] body>*{display:none!important}' +
  'html[data-old-browser] body>#fh-old-browser{display:block!important}' +
  '#fh-old-browser .fh-ob-kiosk{display:none}' +
  'html[data-old-browser=kiosk] #fh-old-browser .fh-ob-kiosk{display:block}' +
  'html[data-old-browser=kiosk] #fh-old-browser .fh-ob-update{display:none}';
