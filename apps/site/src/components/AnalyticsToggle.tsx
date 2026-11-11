'use client';

import { useEffect, useState } from 'react';
import { CHOICE_EVENT, analyticsState, saveChoice } from '@/lib/analyticsConsent';

/** Footer switch: count this browser's page views or not. Off until allowed; GPC / Do Not Track keep it off. */
export function AnalyticsToggle({ label, on, off, signal }: { label: string; on: string; off: string; signal: string }) {
  const [state, setState] = useState<'on' | 'off' | 'unset' | 'signal' | null>(null);
  useEffect(() => {
    const read = () => setState(analyticsState(navigator, window));
    read();
    window.addEventListener(CHOICE_EVENT, read);
    return () => window.removeEventListener(CHOICE_EVENT, read);
  }, []);
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
          window.dispatchEvent(new Event(CHOICE_EVENT));
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
