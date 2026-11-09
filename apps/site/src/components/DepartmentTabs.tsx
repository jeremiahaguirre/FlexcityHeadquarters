'use client';

import { Check } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';

type Dept = { icon: string; title: string; body: string; points: string[] };

/**
 * Departments as tabs. Without JavaScript every panel is shown one after the other and the
 * tab list is hidden (see globals.css); with it, arrow keys move between tabs.
 */
export function DepartmentTabs({ items, label }: { items: Dept[]; label: string }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const go = (i: number) => {
    const n = (i + items.length) % items.length;
    setActive(n);
    tabs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(items.length - 1); }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[21rem_1fr] lg:gap-8">
      <div role="tablist" aria-label={label} onKeyDown={onKey} className="tabs-nav scroll-x -mx-4 gap-2 px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-1.5 lg:px-0">
        {items.map((d, i) => (
          <button
            key={d.title}
            ref={(el) => { tabs.current[i] = el; }}
            type="button"
            role="tab"
            id={`dept-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`dept-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={cn(
              'group flex shrink-0 items-center gap-3 rounded-2xl border px-3.5 py-3 text-left text-small font-semibold transition-colors lg:px-4 lg:py-3.5 lg:text-body-strong',
              i === active ? 'border-brand bg-brand text-brand-contrast shadow-lift' : 'border-line bg-panel text-ink hover:border-brand/40 hover:bg-surface',
            )}
          >
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', i === active ? 'bg-white/15' : 'bg-brand/10 text-brand-text')}>
              <Icon name={d.icon} className="h-5 w-5" />
            </span>
            <span className="whitespace-nowrap lg:whitespace-normal">{d.title}</span>
            <span aria-hidden="true" className={cn('kicker-num ml-auto hidden text-caption lg:block', i === active ? 'text-white/80' : 'text-muted')}>0{i + 1}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-5">
        {items.map((d, i) => (
          <div
            key={d.title}
            role="tabpanel"
            id={`dept-panel-${i}`}
            aria-labelledby={`dept-tab-${i}`}
            data-tabpanel=""
            {...(i === active ? { 'data-active': '' } : {})}
            className="relative overflow-hidden rounded-3xl border border-line bg-panel p-6 shadow-card md:p-10"
          >
            <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 text-brand/[0.07]">
              <Icon name={d.icon} className="h-64 w-64" />
            </span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,rgb(var(--brand)),rgb(var(--chartreuse)))]" />
            <div className="relative max-w-2xl">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand text-brand-contrast shadow-lift">
                <Icon name={d.icon} className="h-7 w-7" />
              </span>
              <h3 className="mt-6 text-title [text-wrap:balance]">{d.title}</h3>
              <p className="mt-3 text-[1.0625rem] leading-7 text-muted">{d.body}</p>
              <ul className="mt-6 grid gap-3">
                {d.points.map((pt) => (
                  <li key={pt} className="flex gap-3 text-body-strong">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ok-bg text-ok">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
