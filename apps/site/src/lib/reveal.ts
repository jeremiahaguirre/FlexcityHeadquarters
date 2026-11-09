import type { CSSProperties } from 'react';

/**
 * Runs before first paint. Marks the page as "JavaScript is running" so the CSS may hide
 * [data-reveal] elements until they scroll into view. If the observer below never starts
 * (script error, slow network), the mark is removed and everything shows.
 */
export const REVEAL_BOOT = `(function(){var d=document.documentElement;d.classList.add('js');setTimeout(function(){if(!window.__fhReveal)d.classList.remove('js')},3000)})()`;

/** Spread onto any element to fade and slide it up as it enters the screen. `i` staggers a grid. */
export const reveal = (i = 0) => ({ 'data-reveal': '', style: { '--i': i % 3 } as CSSProperties });
