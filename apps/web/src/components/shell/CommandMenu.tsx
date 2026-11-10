'use client';

import { CornerDownLeft, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';

export interface Destination { href: string; label: string; group: string; icon: ComponentType<{ className?: string }> }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Ctrl/⌘ K anywhere: type a few letters, press Enter. Long menus stop being something to scan. */
export function CommandMenu({ destinations, compact = false }: { destinations: Destination[]; compact?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQ('');
      setI(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo(() => {
    const f = fold(q.trim());
    if (!f) return destinations;
    return destinations
      .map((d) => ({ d, score: fold(d.label).startsWith(f) ? 0 : fold(d.label).includes(f) ? 1 : fold(d.group).includes(f) ? 2 : 9 }))
      .filter((x) => x.score < 9)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.d);
  }, [q, destinations]);

  const go = (d: Destination | undefined) => {
    if (!d) return;
    setOpen(false);
    router.push(d.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('jump.open')}
        className={cn(
          'flex items-center gap-2 rounded-xl text-small text-muted transition-colors hover:text-ink',
          compact ? 'h-10 w-10 justify-center hover:bg-surface' : 'h-10 w-full max-w-xs border border-line bg-panel px-3 hover:border-ink/20',
        )}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!compact ? (
          <>
            <span className="flex-1 text-left">{t('jump.placeholder')}</span>
            <kbd className="rounded-md border border-line bg-surface px-1.5 text-caption font-semibold">{mac ? '⌘' : 'Ctrl'} K</kbd>
          </>
        ) : null}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('jump.title')} closeLabel={t('common.close')}>
        <div className="grid gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setI(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setI((x) => Math.min(x + 1, results.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setI((x) => Math.max(x - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  go(results[i]);
                }
              }}
              role="combobox"
              aria-expanded="true"
              aria-controls="jump-list"
              aria-activedescendant={results[i] ? `jump-${i}` : undefined}
              aria-label={t('jump.placeholder')}
              placeholder={t('jump.placeholder')}
              className="h-11 w-full rounded-xl border border-line bg-panel pl-9 pr-3 text-body outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <ul id="jump-list" role="listbox" className="-mx-1 max-h-[50vh] overflow-y-auto">
            {results.map((d, n) => (
              <li key={d.href} id={`jump-${n}`} role="option" aria-selected={n === i}>
                <button
                  type="button"
                  onMouseEnter={() => setI(n)}
                  onClick={() => go(d)}
                  className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', n === i ? 'bg-brand/10 text-brand-text' : 'text-ink')}
                >
                  <d.icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 text-small font-semibold">{d.label}</span>
                  <span className="text-caption text-muted">{d.group}</span>
                  {n === i ? <CornerDownLeft className="h-3.5 w-3.5 text-muted" aria-hidden="true" /> : null}
                </button>
              </li>
            ))}
            {!results.length ? <li className="px-3 py-6 text-center text-small text-muted">{t('jump.none')}</li> : null}
          </ul>
        </div>
      </Dialog>
    </>
  );
}
