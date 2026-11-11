'use client';

import { Analytics } from '@vercel/analytics/next';
import { beforeSend } from '@/lib/analyticsConsent';

/** Vercel Web Analytics (page views, no cookies), dropped when the visitor or their browser says no. */
export function SiteAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
