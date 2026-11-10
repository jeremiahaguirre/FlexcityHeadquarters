'use client';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export interface MultiOption { value: string; label: string; hint?: string; badge?: string }

/**
 * A dropdown to pick one or more options, with search once the list is long.
 * Submits like checkboxes: one hidden input per chosen value under `name`.
 */
export function MultiSelect({
  id,
  name,
  options,
  defaultValue = [],
  placeholder,
  disabled,
  onChange,
  'aria-describedby': describedBy,
}: {
  id?: string;
  name: string;
  options: MultiOption[];
  defaultValue?: string[];
  placeholder: string;
  disabled?: boolean;
  onChange?: (values: string[]) => void;
  'aria-describedby'?: string;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>(() => defaultValue.filter((v) => options.some((o) => o.value === v)));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = `${id ?? name}-list`;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const set = (next: string[]) => {
    setSelected(next);
    onChange?.(next);
  };
  const toggle = (v: string) => set(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const chosen = options.filter((o) => selected.includes(o.value));

  return (
    <div
      ref={wrap}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      {selected.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
      <button
        ref={button}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-describedby={describedBy}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex min-h-[3rem] w-full items-center gap-2 rounded-xl border border-field bg-panel px-3 py-2 text-left text-body transition-colors hover:border-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60',
          open && 'border-[rgb(var(--brand))]',
        )}
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {chosen.length ? (
            <>
              {chosen.slice(0, 4).map((o) => (
                <span key={o.value} className="inline-flex max-w-full items-center rounded-lg bg-brand/10 px-2 py-0.5 text-small font-semibold text-brand-text">
                  <span className="truncate">{o.label}</span>
                </span>
              ))}
              {chosen.length > 4 ? <span className="self-center text-small text-muted">{t('multiSelect.more', { count: chosen.length - 4 })}</span> : null}
            </>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </span>
        <ChevronDown className={cn('h-5 w-5 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-line bg-panel shadow-lift">
          {options.length > 6 ? (
            <div className="relative border-b border-line p-2">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('multiSelect.search')}
                aria-label={t('multiSelect.search')}
                className="h-10 w-full rounded-lg bg-surface pl-9 pr-3 text-small outline-none focus-visible:ring-2 focus-visible:ring-focus"
                autoFocus
              />
            </div>
          ) : null}
          <ul id={listId} role="listbox" aria-multiselectable="true" className="max-h-72 overflow-y-auto p-1.5">
            {!shown.length ? <li className="px-3 py-3 text-small text-muted">{t('multiSelect.noMatch')}</li> : null}
            {shown.map((o) => {
              const on = selected.includes(o.value);
              return (
                <li key={o.value} role="option" aria-selected={on}>
                  <button type="button" onClick={() => toggle(o.value)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface focus-visible:bg-surface focus-visible:outline-none">
                    <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border', on ? 'border-[rgb(var(--brand))] bg-[rgb(var(--brand))] text-brand-contrast' : 'border-line')}>
                      {on ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-small font-semibold">
                        {o.label}
                        {o.badge ? <span className="rounded-md bg-surface px-1.5 py-0.5 text-caption font-medium text-muted">{o.badge}</span> : null}
                      </span>
                      {o.hint ? <span className="block text-caption text-muted">{o.hint}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
            <span className="text-caption text-muted">{t('multiSelect.chosen', { count: selected.length })}</span>
            <span className="flex gap-1">
              {selected.length ? (
                <button type="button" onClick={() => set([])} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-small text-muted hover:bg-surface">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('multiSelect.clear')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                }}
                className="rounded-lg px-3 py-1 text-small font-semibold text-brand-text hover:bg-surface"
              >
                {t('multiSelect.done')}
              </button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
