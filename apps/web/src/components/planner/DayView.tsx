'use client';

/**
 * The day as a horizontal timeline per row (position or facility): shift bars labelled with who
 * works them, the forecast's suggested staff per hour behind them (gaps tinted), and a line at the
 * current time. Drag a person onto the timeline to start a shift there (15-minute steps), drag a
 * bar to move it (or to another row), drag its edges to change the times. The timeline scrolls
 * sideways inside its own box on a phone.
 */
import { AlertTriangle } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatTime, formatTimeRange } from '@/lib/format';
import { type Axis, type BoardShift, type Row, type Status, axisFor, axisWidth, endMinuteOf, hhmm, inRow, lanes, minuteOf, minutesToX, mondayOf, staffedByHour } from '@/lib/planner';
import { StatusMark, dropTone } from './text';
import { type ViewProps, posLabel, rowLabel } from './views';

const LANE = 40;

interface ForecastWeek { days: Array<{ date: string; hours: Array<{ hour: number; needed: number; open: boolean | null }> }> }
export interface BarPreview { shiftId: string; row: string; start: number; end: number; status: Status }

export function DayView(p: ViewProps & { rows: Row[]; day: string; preview: BarPreview | null; facilityId: string | null }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [px, setPx] = useState(64);
  useEffect(() => {
    const fit = () => setPx(window.innerWidth < 640 ? 48 : 64);
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const today = p.board.shifts.filter((s) => s.localStartsAt.startsWith(p.day));
  const axis = useMemo(() => axisFor(today, px), [today, px]);
  const width = axisWidth(axis);
  const hours = Array.from({ length: axis.endHour - axis.startHour }, (_, i) => axis.startHour + i);
  const now = useNow(p.board.range.timezone);
  const showNow = p.day === p.board.range.today && now >= axis.startHour * 60 && now <= axis.endHour * 60;
  const forecast = useForecast(p.rows, p.facilityId ?? p.board.facilities[0]?.id ?? null, p.day);

  // Open at the facility's opening hours (the first hour the forecast needs anyone), else an hour
  // before the first shift, else 6 a.m.; the whole day stays a scroll away.
  const scroller = useRef<HTMLDivElement>(null);
  const opening = useMemo(() => {
    const hs = Object.values(forecast).flatMap((m) => Object.keys(m).map(Number));
    return hs.length ? Math.min(...hs) * 60 : null;
  }, [forecast]);
  const first = today.length ? Math.min(...today.map((s) => minuteOf(s.localStartsAt))) : null;
  const target = opening ?? (first !== null ? Math.max(0, first - 60) : 6 * 60);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, minutesToX(target - 30, axis));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.day, axis.startHour, px, target]);
  return (
    <div className="rounded-xl2 border border-line bg-panel">
      <div ref={scroller} className="overflow-x-auto overscroll-x-contain" role="region" aria-label={t('planner.day.timeline')} tabIndex={0}>
        <div style={{ width: width + 128 }} className="relative">
          <div className="sticky top-0 z-20 flex border-b border-line bg-panel/95">
            <div className="sticky left-0 z-10 w-32 shrink-0 bg-panel px-2 py-1.5 text-caption font-semibold text-muted">{p.rows[0]?.facilityId && !p.rows[0]?.positionId ? t('planner.day.rowsFacility') : t('planner.day.rowsPosition')}</div>
            <div className="relative h-8" style={{ width }} aria-hidden="true">
              {hours.map((h) => (
                <span key={h} className="absolute top-1.5 -translate-x-1/2 text-[0.7rem] tabular-nums text-muted" style={{ left: minutesToX(h * 60, axis) }}>
                  {h === axis.startHour ? '' : formatTime(`2000-01-01T${hhmm(h * 60)}:00`, lng).replace(/:00(?=\D|$)/, '').replace(/(\d)[\s\u00a0]h[\s\u00a0]00$/, '$1 h')}
                </span>
              ))}
            </div>
          </div>
          {p.rows.map((r) => {
            const list = today.filter((s) => inRow(s, r));
            const items = list.map((s) => ({ id: s.id, start: minuteOf(s.localStartsAt), end: endMinuteOf(s.localStartsAt, s.localEndsAt), shift: s }));
            const { lane, count } = lanes(items);
            const height = Math.max(1, count + (p.preview?.row === r.key && !list.some((s) => s.id === p.preview!.shiftId) ? 1 : 0)) * LANE + 12;
            const need = forecast[r.key];
            const staffed = staffedByHour(list, axis);
            const key = `time|${p.day}|${r.key}`;
            const ds = p.dayStatus?.(p.day) ?? null;
            return (
              <div key={r.key} className="flex border-b border-line last:border-b-0">
                <div className="sticky left-0 z-10 w-32 shrink-0 border-r border-line bg-panel px-2 py-2">
                  <p className="truncate text-small font-semibold">{rowLabel(lng, r)}</p>
                  {need ? <p className="text-[0.7rem] text-muted">{t('planner.day.forecast')}</p> : null}
                </div>
                <div
                  data-drop={key}
                  data-axis={JSON.stringify(axis)}
                  onClick={(e) => {
                    if (e.target === e.currentTarget && p.picking) p.onDayActivate(p.day, r.key);
                  }}
                  className={cn('relative', p.overKey === key && ds && dropTone[ds.status])}
                  style={{ width, height }}
                  aria-label={`${rowLabel(lng, r)}`}
                >
                  {/* Hour grid and the forecast's suggested staff: tinted where fewer are scheduled. */}
                  {hours.map((h, i) => {
                    const n = need?.[h] ?? 0;
                    const gap = n - (staffed[i] ?? 0);
                    return (
                      <div key={h} className={cn('pointer-events-none absolute inset-y-0 border-l border-line/60', n > 0 && (gap > 0 ? 'bg-warn-bg/60' : 'bg-ok-bg/30'))} style={{ left: minutesToX(h * 60, axis), width: axis.pxPerHour }} title={n ? t('planner.day.need', { need: n, have: staffed[i] ?? 0 }) : undefined}>
                        {n > 0 && gap > 0 ? <span className="absolute right-1 top-0.5 text-[0.65rem] font-bold text-warn">{t('planner.day.short', { count: gap })}</span> : null}
                      </div>
                    );
                  })}
                  {need ? <NeedLine need={need} axis={axis} height={height} /> : null}
                  {items.map((it) => (
                    <Bar
                      key={it.id}
                      shift={it.shift}
                      start={it.start}
                      end={it.end}
                      lane={lane[it.id]!}
                      axis={axis}
                      status={p.shiftStatus?.(it.id).status ?? null}
                      over={p.overKey === `shift|${it.id}`}
                      ghost={p.preview?.shiftId === it.id}
                      onPointerDown={p.onShiftPointerDown}
                      onActivate={p.onShiftActivate}
                    />
                  ))}
                  {p.preview && p.preview.row === r.key ? (
                    <div className={cn('pointer-events-none absolute rounded-lg border-2 border-dashed', dropTone[p.preview.status])} style={{ left: minutesToX(p.preview.start, axis), width: minutesToX(p.preview.end, axis) - minutesToX(p.preview.start, axis), top: 6 + (lane[p.preview.shiftId] ?? count) * LANE, height: LANE - 6 }}>
                      <span className="absolute -top-0.5 left-1 rounded bg-panel px-1 text-[0.7rem] font-bold tabular-nums">{`${formatTime(`2000-01-01T${hhmm(p.preview.start)}:00`, lng)}–${formatTime(`2000-01-01T${hhmm(p.preview.end)}:00`, lng)}`}</span>
                    </div>
                  ) : null}
                  {showNow ? <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-danger/70" style={{ left: minutesToX(now, axis) }} aria-hidden="true" /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!today.length ? <p className="border-t border-line p-3 text-small text-muted">{t('planner.day.empty')}</p> : null}
    </div>
  );
}

const Bar = memo(function Bar({
  shift,
  start,
  end,
  lane,
  axis,
  status,
  over,
  ghost,
  onPointerDown,
  onActivate,
}: {
  shift: BoardShift;
  start: number;
  end: number;
  lane: number;
  axis: Axis;
  status: Status | null;
  over: boolean;
  ghost: boolean;
  onPointerDown: ViewProps['onShiftPointerDown'];
  onActivate: (s: BoardShift) => void;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const left = minutesToX(start, axis);
  const width = Math.max(24, minutesToX(end, axis) - left);
  const name = shift.assignee?.name ?? t('schedule.open');
  const when = formatTimeRange(shift.localStartsAt, shift.localEndsAt, lng);
  return (
    <div className={cn('absolute', ghost && 'opacity-40')} style={{ left, width, top: 6 + lane * LANE, height: LANE - 6 }}>
      <button
        type="button"
        data-drop={`shift|${shift.id}`}
        onPointerDown={(e) => onPointerDown(e, shift, 'move')}
        onClick={() => onActivate(shift)}
        aria-label={`${when}, ${posLabel(lng, shift)}, ${name}${shift.status === 'DRAFT' ? `, ${t('builder.status.DRAFT')}` : ''}${shift.warnings?.length ? `, ${shift.warnings.map((w) => t(`planner.warn.${w.code}`, { a: w.n[0], b: w.n[1] })).join(', ')}` : ''}`}
        className={cn(
          'flex h-full w-full touch-manipulation items-center gap-1 overflow-hidden rounded-lg border px-2 text-left text-caption shadow-card',
          shift.assignee ? 'border-brand/40 bg-brand/15 text-ink' : 'border-new/50 bg-new-bg text-new',
          shift.status === 'DRAFT' && 'border-dashed',
          status && dropTone[status],
          over && 'shadow-lift',
          'cursor-grab active:cursor-grabbing',
        )}
      >
        {status ? <StatusMark status={status} className="h-3.5 w-3.5" /> : null}
        {shift.warnings?.length ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" /> : null}
        <span className="truncate font-semibold">{name}</span>
        <span className="hidden truncate text-[0.7rem] text-muted sm:inline">{when}</span>
      </button>
      {/* Resize handles: mouse and pen only (keyboard and phones change times in the shift sheet). */}
      <span aria-hidden="true" onPointerDown={(e) => onPointerDown(e, shift, 'start')} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-lg hover:bg-brand/40 [@media(pointer:coarse)]:hidden" />
      <span aria-hidden="true" onPointerDown={(e) => onPointerDown(e, shift, 'end')} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-lg hover:bg-brand/40 [@media(pointer:coarse)]:hidden" />
    </div>
  );
});

/** A thin step line at the suggested staff count, scaled to the row (behind the bars). */
function NeedLine({ need, axis, height }: { need: Record<number, number>; axis: Axis; height: number }) {
  const max = Math.max(1, ...Object.values(need));
  const y = (n: number) => height - 4 - (n / max) * (height - 12);
  let d = '';
  for (let h = axis.startHour; h < axis.endHour; h++) {
    const x0 = minutesToX(h * 60, axis);
    const x1 = minutesToX((h + 1) * 60, axis);
    const yy = y(need[h] ?? 0);
    d += `${d ? 'L' : 'M'}${x0},${yy}L${x1},${yy}`;
  }
  return (
    <svg className="pointer-events-none absolute inset-0" width={axisWidth(axis)} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke="rgb(var(--brand))" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="4 3" />
    </svg>
  );
}

/** Minutes after midnight now, in the facility's time zone; ticks each minute. */
function useNow(tz: string) {
  const read = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
    return Number(parts.find((x) => x.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((x) => x.type === 'minute')?.value ?? 0);
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setNow(read()), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tz]);
  return now;
}

/** Suggested staff per hour for each position row (the forecast screen's numbers). */
function useForecast(rows: Row[], facilityId: string | null, day: string): Record<string, Record<number, number>> {
  const [out, setOut] = useState<Record<string, Record<number, number>>>({});
  const week = mondayOf(day);
  const key = rows.map((r) => r.key).join(',');
  useEffect(() => {
    let alive = true;
    setOut({});
    if (!facilityId) return;
    const wanted = rows.filter((r) => r.positionId).slice(0, 8);
    void Promise.all(
      wanted.map(async (r) => {
        try {
          const f = await api<ForecastWeek>(`/api/forecast?facilityId=${r.facilityId ?? facilityId}&weekStart=${week}&positionId=${r.positionId}`);
          const d = f.days?.find((x) => x.date === day);
          if (!d) return null;
          const m: Record<number, number> = {};
          for (const h of d.hours) if (h.needed > 0) m[h.hour] = h.needed;
          return Object.keys(m).length ? ([r.key, m] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((rs) => {
      if (alive) setOut(Object.fromEntries(rs.filter((x): x is readonly [string, Record<number, number>] => !!x)));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, facilityId, week, day]);
  return out;
}
