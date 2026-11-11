'use client';

/** The month and week views, and the shift card both use. Drop targets carry `data-drop`. */
import { Plus } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { formatDate, formatTime, formatTimeRange } from '@/lib/format';
import { type Board, type BoardShift, type MaybeCell, type Row, type Status, inRow } from '@/lib/planner';
import { StatusMark, dropTone } from './text';

export interface ViewProps {
  board: Board;
  days: string[];
  /** Status for a shift or a day while someone is being dragged or picked (null otherwise). */
  shiftStatus: ((shiftId: string) => MaybeCell) | null;
  dayStatus: ((date: string) => MaybeCell) | null;
  overKey: string;
  onShiftPointerDown: (e: React.PointerEvent, shift: BoardShift, mode: 'move' | 'start' | 'end') => void;
  onShiftActivate: (shift: BoardShift) => void;
  onDayActivate: (date: string, rowKey: string | null) => void;
  onAdd: (date: string, rowKey: string | null) => void;
  onOpenDay: (date: string) => void;
  picking: boolean;
}

/** "9–1 p.m." · "9 h–13 h": short enough for a month cell. */
export function shortRange(startIso: string, endIso: string, lng: string): string {
  const trim = (x: string) => x.replace(/:00(?=\D|$)/, '').replace(/(\d)([\s\u00a0]h)[\s\u00a0]00$/, '$1$2');
  const a = trim(formatTime(startIso, lng));
  const b = trim(formatTime(endIso, lng));
  const suffix = /[\s\u00a0]([ap]\.m\.)$/i;
  const sa = suffix.exec(a)?.[1];
  const sb = suffix.exec(b)?.[1];
  return sa && sa === sb ? `${a.replace(suffix, '')}–\u200b${b}` : `${a}–\u200b${b}`;
}

/** "Parkinson Recreation Centre" → "PRC" (the full name is in the card's title and label). */
export function abbreviate(name: string): string {
  const words = name.split(/[\s-]+/).filter((w) => /^[\p{L}\d]/u.test(w) && !/^(de|du|des|la|le|les|the|of|and|et)$/i.test(w));
  return words.length > 1 ? words.slice(0, 4).map((w) => w[0]!.toUpperCase()).join('') : name.slice(0, 10);
}

export const posLabel = (lng: string, s: Pick<BoardShift, 'customTitle' | 'position'>) => s.customTitle || (lng === 'fr-CA' && s.position.nameFr ? s.position.nameFr : s.position.name);
export const rowLabel = (lng: string, r: Row) => (lng === 'fr-CA' && r.label.nameFr ? r.label.nameFr : r.label.name);

export const ShiftChip = memo(function ShiftChip({
  shift,
  status,
  over,
  compact,
  showPlace,
  showPosition = true,
  onPointerDown,
  onActivate,
}: {
  shift: BoardShift;
  status: Status | null;
  over: boolean;
  compact?: boolean;
  showPlace?: boolean;
  showPosition?: boolean;
  onPointerDown: ViewProps['onShiftPointerDown'];
  onActivate: (s: BoardShift) => void;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const name = shift.assignee?.name ?? t('schedule.open');
  const when = formatTimeRange(shift.localStartsAt, shift.localEndsAt, lng);
  return (
    <button
      type="button"
      data-drop={`shift|${shift.id}`}
      onPointerDown={(e) => onPointerDown(e, shift, 'move')}
      onClick={() => onActivate(shift)}
      aria-label={`${when}, ${posLabel(lng, shift)}, ${showPlace ? `${shift.facility.name}, ` : ''}${name}${shift.status === 'DRAFT' ? `, ${t('builder.status.DRAFT')}` : ''}`}
      className={cn(
        'w-full min-w-0 touch-manipulation rounded-lg border text-left transition-[box-shadow,background-color,border-color] duration-100',
        compact ? 'px-1.5 py-0.5' : 'px-1.5 py-1.5',
        shift.status === 'DRAFT' ? 'border-dashed border-muted/50 bg-surface/60' : 'border-line bg-panel',
        !shift.assignee && 'border-new/50 bg-new-bg/40',
        status && dropTone[status],
        over && 'scale-[1.02] shadow-lift',
        'hover:border-brand/50',
      )}
    >
      <span className={cn('flex min-w-0 items-center gap-1', compact ? 'text-[0.7rem] leading-4' : 'text-caption')}>
        {status ? <StatusMark status={status} className="h-3.5 w-3.5" /> : null}
        {/* One line, short form ("9–5 p.m.", "9 h–17 h"). */}
        <span className={cn('min-w-0 truncate whitespace-nowrap font-semibold tabular-nums', !compact && 'text-[0.75rem] tracking-tight')}>{shortRange(shift.localStartsAt, shift.localEndsAt, lng).replace('\u200b', '')}</span>
      </span>
      {!compact && (showPosition || showPlace) ? (
        <span className="block truncate text-caption text-muted" title={showPlace ? shift.facility.name : undefined}>
          {[showPosition ? posLabel(lng, shift) : null, showPlace ? abbreviate(shift.facility.name) : null].filter(Boolean).join(' · ')}
        </span>
      ) : null}
      {/* The name in full: up to two lines. */}
      <span className={cn('block font-semibold', compact ? 'truncate text-[0.7rem] leading-4' : 'line-clamp-2 break-words text-caption leading-4', shift.assignee ? 'text-ink' : 'text-new')}>{name}</span>
    </button>
  );
});

const MAX_IN_CELL = 3;

export function MonthView(p: ViewProps & { month: string; focusDay: string; onFocusDay: (d: string) => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const byDay = useMemo(() => {
    const m = new Map<string, BoardShift[]>();
    for (const s of p.board.shifts) {
      const d = s.localStartsAt.slice(0, 10);
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return m;
  }, [p.board.shifts]);
  const weekdays = p.days.slice(0, 7).map((d) => formatDate(`${d}T12:00:00`, lng).split(/[ ,.]/)[0]);
  const showPlace = p.board.facilities.length > 1;
  const focusList = byDay.get(p.focusDay) ?? [];
  return (
    <div>
      <div role="table" aria-label={t('planner.views.month')} className="overflow-hidden rounded-xl2 border border-line bg-panel">
        <div role="row" className="grid grid-cols-7 border-b border-line bg-surface/60">
          {weekdays.map((w, i) => (
            <div key={i} role="columnheader" className="px-1 py-1.5 text-center text-caption font-semibold uppercase text-muted">
              {w}
            </div>
          ))}
        </div>
        {Array.from({ length: p.days.length / 7 }, (_, w) => (
          <div key={w} role="row" className="grid grid-cols-7">
            {p.days.slice(w * 7, w * 7 + 7).map((d) => {
              const list = byDay.get(d) ?? [];
              const inMonth = d.startsWith(p.month);
              const ds = p.dayStatus?.(d) ?? null;
              const isToday = d === p.board.range.today;
              const key = `day|${d}|`;
              return (
                <div
                  key={d}
                  role="cell"
                  data-drop={key}
                  aria-label={formatDate(`${d}T12:00:00`, lng, 'long')}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (p.picking) p.onDayActivate(d, null);
                    else p.onFocusDay(d);
                  }}
                  className={cn(
                    'relative min-h-[4.25rem] min-w-0 border-b border-r border-line p-1 transition-colors sm:min-h-[7.5rem]',
                    !inMonth && 'bg-surface/40',
                    d === p.focusDay && 'max-sm:bg-brand/5',
                    ds && dropTone[ds.status],
                    p.overKey === key && 'z-10',
                  )}
                >
                  <div className="pointer-events-none flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => (p.picking ? p.onDayActivate(d, null) : window.matchMedia('(min-width: 640px)').matches ? p.onOpenDay(d) : p.onFocusDay(d))}
                      className={cn('pointer-events-auto grid h-8 min-w-8 place-items-center rounded-full px-1 text-caption font-semibold tabular-nums', isToday ? 'bg-brand text-brand-contrast' : inMonth ? 'text-ink hover:bg-surface' : 'text-muted')}
                      aria-label={p.picking ? t('planner.pick.newOn', { day: formatDate(`${d}T12:00:00`, lng, 'long') }) : t('planner.openDay', { day: formatDate(`${d}T12:00:00`, lng, 'long') })}
                    >
                      {Number(d.slice(8))}
                    </button>
                    {ds ? <StatusMark status={ds.status} className="h-3.5 w-3.5" /> : null}
                    {list.length ? (
                      <span className="text-[0.7rem] font-semibold text-muted sm:hidden" aria-hidden="true">
                        {list.length}
                      </span>
                    ) : null}
                  </div>
                  {/* Phones: dots; the chosen day's shifts are listed below the grid. */}
                  <div className="pointer-events-none mt-1 flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                    {list.slice(0, 6).map((s) => (
                      <span key={s.id} className={cn('h-1.5 w-1.5 rounded-full', s.assignee ? 'bg-brand' : 'bg-new')} />
                    ))}
                  </div>
                  <div className="mt-0.5 hidden gap-0.5 sm:grid">
                    {list.slice(0, MAX_IN_CELL).map((s) => (
                      <ShiftChip key={s.id} shift={s} compact showPlace={showPlace} status={p.shiftStatus?.(s.id).status ?? null} over={p.overKey === `shift|${s.id}`} onPointerDown={p.onShiftPointerDown} onActivate={p.onShiftActivate} />
                    ))}
                    {list.length > MAX_IN_CELL ? (
                      <button type="button" onClick={() => p.onOpenDay(d)} className="rounded px-1 text-left text-[0.7rem] font-semibold text-brand-text hover:underline">
                        {t('planner.more', { count: list.length - MAX_IN_CELL })}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <section aria-label={formatDate(`${p.focusDay}T12:00:00`, lng, 'long')} className="mt-3 grid gap-1.5 sm:hidden">
        <div className="flex items-center justify-between">
          <h3 className="text-body-strong">{formatDate(`${p.focusDay}T12:00:00`, lng, 'long')}</h3>
          <button type="button" onClick={() => p.onAdd(p.focusDay, null)} aria-label={t('builder.addOn', { day: formatDate(`${p.focusDay}T12:00:00`, lng) })} className="grid h-11 w-11 place-items-center rounded-xl text-muted hover:bg-surface hover:text-ink">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {focusList.map((s) => (
          <ShiftChip key={s.id} shift={s} showPlace={showPlace} status={p.shiftStatus?.(s.id).status ?? null} over={false} onPointerDown={p.onShiftPointerDown} onActivate={p.onShiftActivate} />
        ))}
        {!focusList.length ? <p className="text-small text-muted">{t('builder.noShifts')}</p> : null}
      </section>
    </div>
  );
}

export function WeekView(p: ViewProps & { rows: Row[] }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const showPlace = p.board.facilities.length > 1;
  const byDay = useMemo(() => {
    const m = new Map<string, BoardShift[]>();
    for (const s of p.board.shifts) m.set(s.localStartsAt.slice(0, 10), [...(m.get(s.localStartsAt.slice(0, 10)) ?? []), s]);
    return m;
  }, [p.board.shifts]);
  const chip = (s: BoardShift, inRows = false) => <ShiftChip key={s.id} shift={s} compact={false} showPlace={showPlace && !(inRows && p.rows[0]?.facilityId)} showPosition={!(inRows && p.rows[0]?.positionId)} status={p.shiftStatus?.(s.id).status ?? null} over={p.overKey === `shift|${s.id}`} onPointerDown={p.onShiftPointerDown} onActivate={p.onShiftActivate} />;
  const dayLabel = (d: string) => formatDate(`${d}T12:00:00`, lng);
  return (
    <>
      {/* Desktop: rows × days */}
      <div role="table" aria-label={t('planner.views.week')} className="hidden overflow-x-auto rounded-xl2 border border-line bg-panel lg:block">
        <div role="row" className="grid min-w-[40rem] grid-cols-[5.5rem_repeat(7,minmax(4.75rem,1fr))] border-b border-line bg-surface/60">
          <div role="columnheader" className="px-2 py-2 text-caption font-semibold text-muted" />
          {p.days.map((d) => (
            <div key={d} role="columnheader" className="flex items-center justify-between px-2 py-1">
              <button type="button" onClick={() => p.onOpenDay(d)} className={cn('rounded px-1 text-small font-bold hover:underline', d === p.board.range.today && 'text-brand-text')}>
                {dayLabel(d)}
              </button>
            </div>
          ))}
        </div>
        {p.rows.map((r) => (
          <div key={r.key} role="row" className="grid min-w-[40rem] grid-cols-[5.5rem_repeat(7,minmax(4.75rem,1fr))] border-b border-line last:border-b-0">
            <div role="rowheader" className="break-words px-2 py-2 text-small font-semibold" title={rowLabel(lng, r)}>
              {rowLabel(lng, r)}
            </div>
            {p.days.map((d) => {
              const list = (byDay.get(d) ?? []).filter((s) => inRow(s, r));
              const key = `day|${d}|${r.key}`;
              const ds = p.dayStatus?.(d) ?? null;
              return (
                <div
                  key={d}
                  role="cell"
                  data-drop={key}
                  aria-label={`${rowLabel(lng, r)}, ${formatDate(`${d}T12:00:00`, lng, 'long')}`}
                  onClick={(e) => {
                    if (e.target === e.currentTarget && p.picking) p.onDayActivate(d, r.key);
                  }}
                  className={cn('group relative grid min-h-[5rem] content-start gap-1 border-l border-line p-1 transition-colors', ds && dropTone[ds.status])}
                >
                  {list.map((x) => chip(x, true))}
                  <button
                    type="button"
                    onClick={() => (p.picking ? p.onDayActivate(d, r.key) : p.onAdd(d, r.key))}
                    aria-label={p.picking ? t('planner.pick.newOn', { day: `${rowLabel(lng, r)}, ${dayLabel(d)}` }) : t('builder.addOn', { day: `${rowLabel(lng, r)}, ${dayLabel(d)}` })}
                    className="grid h-7 place-items-center rounded-lg text-muted opacity-0 hover:bg-surface hover:text-ink focus:opacity-100 group-hover:opacity-100"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {/* Phones and tablets: one section per day */}
      <div className="grid gap-3 lg:hidden">
        {p.days.map((d) => {
          const list = byDay.get(d) ?? [];
          const key = `day|${d}|`;
          const ds = p.dayStatus?.(d) ?? null;
          return (
            <section
              key={d}
              data-drop={key}
              aria-label={formatDate(`${d}T12:00:00`, lng, 'long')}
              className={cn('rounded-xl2 border bg-panel p-2', d === p.board.range.today ? 'border-brand/50' : 'border-line', ds && dropTone[ds.status])}
            >
              <header className="flex items-center justify-between gap-2 px-1 pb-1">
                <button type="button" onClick={() => p.onOpenDay(d)} className={cn('flex min-h-[44px] items-center gap-1.5 text-small font-bold', d === p.board.range.today && 'text-brand-text')}>
                  {ds ? <StatusMark status={ds.status} /> : null}
                  {dayLabel(d)}
                </button>
                <button
                  type="button"
                  onClick={() => (p.picking ? p.onDayActivate(d, null) : p.onAdd(d, null))}
                  aria-label={p.picking ? t('planner.pick.newOn', { day: dayLabel(d) }) : t('builder.addOn', { day: dayLabel(d) })}
                  className="grid h-11 w-11 place-items-center rounded-xl text-muted hover:bg-surface hover:text-ink"
                >
                  <Plus className="h-5 w-5" aria-hidden="true" />
                </button>
              </header>
              <div className="grid gap-1.5 sm:grid-cols-2">{list.map((x) => chip(x))}</div>
              {!list.length ? <p className="px-1 pb-1 text-caption text-muted">{t('builder.noShifts')}</p> : null}
            </section>
          );
        })}
      </div>
    </>
  );
}

