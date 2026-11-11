'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/apiError';
import { colon, compareValues } from '@/lib/trust';
import type { LucideIcon } from 'lucide-react';

/** The Trust area's sections, in menu order (also used by the Dev console's sidebar and command menu). */
export const TRUST_SECTIONS = [
  { href: '/platform/trust', key: 'overview', exact: true },
  { href: '/platform/trust/frameworks', key: 'frameworks' },
  { href: '/platform/trust/controls', key: 'controls' },
  { href: '/platform/trust/tests', key: 'tests' },
  { href: '/platform/trust/evidence', key: 'evidence' },
  { href: '/platform/trust/policies', key: 'policies' },
  { href: '/platform/trust/risks', key: 'risks' },
  { href: '/platform/trust/vendors', key: 'vendors' },
  { href: '/platform/trust/commitments', key: 'commitments' },
  { href: '/platform/trust/questionnaires', key: 'questionnaires' },
  { href: '/platform/trust/present', key: 'present' },
] as const;

/** Section tabs across the top of every Trust page (scrolls sideways on a phone). */
export function TrustTabs() {
  const { t } = useTranslation();
  const path = (usePathname() ?? '').replace(/\/$/, '').replace(/^.*?(\/platform)/, '$1');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [path]);
  // The app's segmented look (a surface track, the current section on a raised panel), as links,
  // on one line that scrolls sideways when it doesn't fit (never wraps).
  return (
    <nav aria-label={t('trust.nav')} className="mb-6">
      <div ref={ref} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-surface p-1 [scrollbar-width:none]">
        {TRUST_SECTIONS.map((s) => {
          const on = 'exact' in s && s.exact ? path === s.href : path === s.href || path.startsWith(`${s.href}/`);
          return (
            <Link key={s.href} href={s.href} aria-current={on ? 'page' : undefined} className={cn('inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg px-3.5 text-small font-semibold transition-colors sm:min-h-9', on ? 'bg-panel text-ink shadow-card' : 'text-muted hover:text-ink')}>
              {t(`trust.section.${s.key}`)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  /** For sorting and searching. */
  value: (r: T) => unknown;
  render?: (r: T) => ReactNode;
  className?: string;
  /** Left out of the phone card. */
  wide?: boolean;
}
export interface Filter<T> { key: string; label: string; options: Array<{ value: string; label: string }>; value: (r: T) => string | string[] }

/**
 * A Trust table: search, filters, sortable columns (aria-sort), a sticky header, and a row that
 * opens its detail. At phone width each row becomes a card.
 */
export function DataTable<T>({ rows, columns, filters = [], rowKey, onOpen, initialSort, emptyIcon, emptyTitle, label, toolbar }: {
  rows: T[];
  columns: Column<T>[];
  filters?: Filter<T>[];
  rowKey: (r: T) => string;
  onOpen?: (r: T) => void;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  emptyIcon: LucideIcon;
  emptyTitle: string;
  label: string;
  toolbar?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Record<string, string>>({});
  const [sort, setSort] = useState(initialSort ?? { key: columns[0]!.key, dir: 'asc' as const });
  const searchId = useId();
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase(i18n.language);
    const col = columns.find((c) => c.key === sort.key) ?? columns[0]!;
    return rows
      .filter((r) => filters.every((f) => !sel[f.key] || ([] as string[]).concat(f.value(r)).includes(sel[f.key]!)))
      .filter((r) => !needle || columns.some((c) => String(c.value(r) ?? '').toLocaleLowerCase(i18n.language).includes(needle)))
      .sort((a, b) => compareValues(col.value(a), col.value(b), i18n.language) * (sort.dir === 'asc' ? 1 : -1));
  }, [rows, columns, filters, sel, q, sort, i18n.language]);
  const toggle = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full sm:w-auto sm:min-w-[16rem] sm:flex-1">
          <label htmlFor={searchId} className="sr-only">{t('trust.table.search')}</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('trust.table.search')} className="h-11 pl-9" />
        </div>
        {filters.map((f) => (
          <div key={f.key} className="w-[calc(50%-0.25rem)] sm:w-auto sm:min-w-[11rem]">
            <Select aria-label={f.label} value={sel[f.key] ?? ''} onChange={(e) => setSel({ ...sel, [f.key]: e.target.value })} className="h-11">
              <option value="">{f.label}{colon(i18n.language)}{t('trust.table.all')}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
        ))}
        {toolbar}
      </div>
      <p className="text-caption text-muted" aria-live="polite">{t('trust.table.count', { shown: shown.length, total: rows.length })}</p>
      {!shown.length ? (
        <EmptyState icon={emptyIcon} title={emptyTitle} level={3} />
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full border-collapse text-left text-small">
                <caption className="sr-only">{label}</caption>
                <thead className="sticky top-0 z-10 bg-panel shadow-[0_1px_0_rgb(var(--line))]">
                  <tr>
                    {columns.map((c) => {
                      const on = sort.key === c.key;
                      const Icon = on ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <th key={c.key} scope="col" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-4 py-2 font-semibold text-muted', c.className)}>
                          <button type="button" onClick={() => toggle(c.key)} className="-mx-1 inline-flex min-h-[36px] items-center gap-1 rounded-md px-1 hover:text-ink">
                            {c.label}
                            <Icon className={cn('h-3.5 w-3.5', on ? 'text-ink' : 'opacity-40')} aria-hidden="true" />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={rowKey(r)} onClick={onOpen ? () => onOpen(r) : undefined} className={cn('border-t border-line align-top', onOpen && 'cursor-pointer hover:bg-surface/60')}>
                      {columns.map((c, i) => (
                        <td key={c.key} className={cn('px-4 py-3', c.className)}>
                          {i === 0 && onOpen ? (
                            <button type="button" onClick={(e) => (e.stopPropagation(), onOpen(r))} className="text-left font-semibold text-ink underline-offset-2 hover:underline">
                              {c.render ? c.render(r) : String(c.value(r) ?? '')}
                            </button>
                          ) : c.render ? c.render(r) : String(c.value(r) ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <ul className="grid gap-2 md:hidden" aria-label={label}>
            {shown.map((r) => (
              <li key={rowKey(r)}>
                <button type="button" onClick={onOpen ? () => onOpen(r) : undefined} className="block w-full rounded-xl2 border border-line bg-panel p-4 text-left shadow-card">
                  <span className="block text-body-strong text-ink">{columns[0]!.render ? columns[0]!.render(r) : String(columns[0]!.value(r) ?? '')}</span>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-small">
                    {columns.slice(1).filter((c) => !c.wide).map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="text-caption text-muted">{c.label}</dt>
                        <dd className="min-w-0 break-words">{c.render ? c.render(r) : String(c.value(r) ?? '—')}</dd>
                      </div>
                    ))}
                  </dl>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** A detail panel: from the right on larger screens, a bottom sheet on a phone. Esc and the backdrop close it. */
export function Drawer({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="fh-dialog m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border border-line bg-panel p-0 text-ink shadow-lift backdrop:bg-overlay/50 sm:ml-auto sm:mr-0 sm:mt-0 sm:h-dvh sm:max-h-none sm:w-[34rem] sm:rounded-none sm:rounded-l-3xl"
    >
      {open ? (
        <div className="flex min-h-full flex-col">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-panel px-5 py-4">
            <div className="min-w-0">
              <h2 id={`${id}-t`} className="text-heading [overflow-wrap:anywhere]">{title}</h2>
              {subtitle ? <div className="mt-1 text-small text-muted">{subtitle}</div> : null}
            </div>
            <button type="button" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })} className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="grid flex-1 content-start gap-5 px-5 py-5">{children}</div>
          {footer ? <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line bg-panel px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function Facts({ items }: { items: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="grid gap-3 text-small sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-caption text-muted">{k}</dt>
          <dd className="mt-0.5 break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Can't manage Trust" message for an action that needs trust.manage. */
export const errorText = (e: unknown, t: (k: string) => string) => (e instanceof ApiError && e.status === 403 && e.code === 'FORBIDDEN' ? t('trust.noManage') : e instanceof ApiError && e.status === 400 ? e.message : t('common.error'));

/** Dates in tables: YYYY-MM-DD → localized short date, or "—". */
export function useDate() {
  const { i18n } = useTranslation();
  return (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
}
