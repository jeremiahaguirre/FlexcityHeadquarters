/**
 * Website analytics consent (PIPEDA; Quebec Law 25 s. 8.1: technology that could identify, locate or
 * profile a person is off by default). Vercel Web Analytics is cookieless and keeps no identifier past
 * a day, but we still keep it OFF until the visitor allows it.
 *
 * Page views are counted only when all of these hold:
 * - the browser sends neither Global Privacy Control (navigator.globalPrivacyControl) nor Do Not Track ("1");
 * - the visitor chose "Allow" (the consent bar or the footer's "Analytics" switch), remembered in localStorage.
 * Storage can be blocked (private windows): then nothing is counted, and nothing throws.
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

/** The state shown in the footer and the consent bar: 'unset' (not asked yet) counts nothing, like 'off'. */
export function analyticsState(nav: Nav | undefined, win: Win | undefined): 'on' | 'off' | 'unset' | 'signal' {
  if (privacySignal(nav, win)) return 'signal';
  const c = storedChoice(win);
  return c === 'on' ? 'on' : c === 'off' ? 'off' : 'unset';
}

/** Tells the consent bar and the footer switch that the choice changed (same page). */
export const CHOICE_EVENT = 'fh-analytics-choice';

/** Vercel Analytics `beforeSend`: drop the event unless analytics is on. */
export function beforeSend<T>(event: T): T | null {
  if (typeof window === 'undefined') return null;
  return analyticsState(navigator as Nav, window as unknown as Win) === 'on' ? event : null;
}
