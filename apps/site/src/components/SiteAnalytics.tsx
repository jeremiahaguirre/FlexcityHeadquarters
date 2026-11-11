'use client';

import { Analytics } from '@vercel/analytics/next';
import { useEffect, useState } from 'react';
import { CHOICE_EVENT, analyticsState, beforeSend } from '@/lib/analyticsConsent';

/**
 * Vercel Web Analytics (page views, no cookies), loaded only once the visitor allows it and never
 * with GPC / Do Not Track: before that, not even its script is requested. beforeSend checks again
 * on every event, so turning the footer switch off stops counting at once.
 */
export function SiteAnalytics() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn((v) => v || analyticsState(navigator, window) === 'on');
    read();
    window.addEventListener(CHOICE_EVENT, read);
    return () => window.removeEventListener(CHOICE_EVENT, read);
  }, []);
  return on ? <Analytics beforeSend={beforeSend} /> : null;
}
