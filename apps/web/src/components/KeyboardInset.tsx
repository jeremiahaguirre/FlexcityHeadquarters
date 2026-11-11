'use client';

import { useEffect } from 'react';

/**
 * Tracks the phone's on-screen keyboard. iPhones don't resize the page when the
 * keyboard opens, so this measures how much of the screen it covers (from the
 * visual viewport) into --kb, and marks <html data-kb="open"> while it's up.
 * CSS then hides the bottom tab bar and lifts sheets and sticky bars above it.
 * Android (with interactive-widget=resizes-content) resizes instead, so --kb stays near 0
 * there but data-kb still flags that someone is typing.
 */
export function KeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const typing = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
      if (el.tagName !== 'INPUT') return false;
      return !['checkbox', 'radio', 'file', 'range', 'button', 'submit', 'reset', 'color'].includes((el as HTMLInputElement).type) && !(el as HTMLInputElement).readOnly;
    };
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
        root.style.setProperty('--kb', `${kb}px`);
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        const open = coarse && (kb > 120 || typing());
        if (open) root.dataset.kb = 'open';
        else delete root.dataset.kb;
        if (open) reveal();
      });
    };
    // Keep the field being typed in fully visible above the keyboard and below the header.
    const reveal = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !typing()) return;
      const r = el.getBoundingClientRect();
      const visible = vv ? vv.height : window.innerHeight;
      const top = el.closest('dialog') ? 8 : (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0) + 8;
      if (r.bottom > visible - 8 || r.top < top) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    const later = () => window.setTimeout(update, 350);
    document.addEventListener('focusin', update);
    document.addEventListener('focusin', later);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusin', later);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return null;
}
