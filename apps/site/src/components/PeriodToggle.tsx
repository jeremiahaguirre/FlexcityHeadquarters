'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Monthly / yearly switch for the plan cards: sets data-period on the target, and the cards
 * show the matching price (both are in the page, so it works before scripts load).
 */
export function PeriodToggle({ target, label, monthly, yearly, save }: { target: string; label: string; monthly: string; yearly: string; save: string }) {
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const set = (p: 'month' | 'year') => {
    setPeriod(p);
    document.getElementById(target)?.setAttribute('data-period', p);
  };
  const btn = 'inline-flex h-10 items-center gap-2 rounded-full px-5 text-small font-semibold transition-colors';
  return (
    <div className="mb-8 flex flex-wrap items-center gap-3">
      <span className="text-small font-semibold text-muted" id={`${target}-period`}>{label}</span>
      <div role="group" aria-labelledby={`${target}-period`} className="inline-flex rounded-full border border-line bg-panel p-1 shadow-card">
        <button type="button" aria-pressed={period === 'month'} onClick={() => set('month')} className={cn(btn, period === 'month' ? 'bg-brand text-brand-contrast' : 'text-ink hover:bg-surface')}>{monthly}</button>
        <button type="button" aria-pressed={period === 'year'} onClick={() => set('year')} className={cn(btn, period === 'year' ? 'bg-brand text-brand-contrast' : 'text-ink hover:bg-surface')}>
          {yearly}
          <span className={cn('rounded-full px-2 py-0.5 text-[0.6875rem] font-bold', period === 'year' ? 'bg-[#C5F23A] text-[#14210A]' : 'bg-ok-bg text-ok')}>{save}</span>
        </button>
      </div>
    </div>
  );
}
