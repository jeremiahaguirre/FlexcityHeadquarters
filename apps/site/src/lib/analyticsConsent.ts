/**
 * Website analytics opt-out (PIPEDA / Quebec Law 25: the visitor can refuse; Vercel Web Analytics
 * is cookieless and keeps no identifier past a day, but people still get a simple off switch).
 *
 * Page views are counted unless any of these says no:
 * - the browser sends Global Privacy Control (navigator.globalPrivacyControl) or Do Not Track ("1");
 * - the visitor turned the footer's "Analytics" switch off (remembered in localStorage).
 * Storage can be blocked (private windows): then only the signals decide, and nothing throws.
 */
export const ANALYTICS_KEY = 'fh-analytics';

type Nav = { globalPrivacyControl?: boolean; doNotTrack?: string | null; msDoNotTrack?: string | null };
type Win = { doNotTrack?: string | null; localStorage?: Pick<Storage, 'getItem' | 'setItem'> };

/** True when the browser asks sites not to track (GPC or DNT). */
export function privacySignal(nav: Nav | undefined, win?: Win): boolean {
  if (!nav) return false;
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || nav.msDoNotTrack === '1' || win?.doNotTrack === '1';
}

export function storedChoice(win: Win | undefined): 'on' | 'off' | null {
  try {
    const v = win?.localStorage?.getItem(ANALYTICS_KEY);
    return v === 'off' || v === 'on' ? v : null;
  } catch {
    return null;
  }
}

export function saveChoice(win: Win | undefined, v: 'on' | 'off'): void {
  try {
    win?.localStorage?.setItem(ANALYTICS_KEY, v);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

/** The state shown in the footer, and whether page views are sent. */
export function analyticsState(nav: Nav | undefined, win: Win | undefined): 'on' | 'off' | 'signal' {
  if (privacySignal(nav, win)) return 'signal';
  return storedChoice(win) === 'off' ? 'off' : 'on';
}

/** Vercel Analytics `beforeSend`: drop the event unless analytics is on. */
export function beforeSend<T>(event: T): T | null {
  if (typeof window === 'undefined') return null;
  return analyticsState(navigator as Nav, window as unknown as Win) === 'on' ? event : null;
}
