'use client';

import { useEffect, useState } from 'react';
import { analyticsState, saveChoice } from '@/lib/analyticsConsent';

/** Footer switch: count this browser's page views or not (GPC / Do Not Track turn it off for good). */
export function AnalyticsToggle({ label, on, off, signal }: { label: string; on: string; off: string; signal: string }) {
  const [state, setState] = useState<'on' | 'off' | 'signal' | null>(null);
  useEffect(() => setState(analyticsState(navigator, window)), []);
  if (state === null) return null;
  const checked = state === 'on';
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={state === 'signal'}
        aria-checked={checked}
        onChange={(e) => {
          const v = e.target.checked ? 'on' : 'off';
          saveChoice(window, v);
          setState(v);
        }}
        className="h-5 w-5 accent-[rgb(var(--brand))]"
      />
      <span>
        <span className="font-semibold text-ink">{label}</span>
        <span className="block">{state === 'signal' ? signal : checked ? on : off}</span>
      </span>
    </label>
  );
}
