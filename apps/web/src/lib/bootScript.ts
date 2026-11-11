/**
 * The one inline script, run first thing in <body> before anything paints (app/layout.tsx).
 * Kept out of 'use client' modules: a server component importing a constant from one gets a
 * client reference, not the string (the script then rendered as a throwing function).
 */
export const SCHEME_KEY = 'fh-color-scheme';
/** Set once the app's header logo has drawn itself in this browser session (tab). */
export const LOGO_SEEN_KEY = 'fh-logo-seen';

/** A dark or light choice never flashes the other; the header logo draws in once per session. */
// One plain literal (the keys written out; a test checks them): the production minifier mangled the
// same script built from template literals.
export const BOOT_SCRIPT =
  "try{var s=localStorage.getItem('fh-color-scheme');if(s==='light'||s==='dark')document.documentElement.dataset.theme=s}catch(e){}try{if(sessionStorage.getItem('fh-logo-seen'))document.documentElement.dataset.logoSeen='1'}catch(e){}";
