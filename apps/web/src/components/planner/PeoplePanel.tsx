'use client';

/**
 * Availability cards for everyone who can be scheduled in the department: positions and
 * certifications, hours this period against their target, availability and time off for the
 * days in view, and whether they confirmed availability for the plan-ahead window. Drag a card
 * (or several, ticked) onto the schedule; tap or press Enter to pick them and then choose a shift.
 * The list is windowed so a department of a few hundred stays smooth.
 */
import { CalendarCheck, Search } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Select } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { formatHours, formatTimeRange } from '@/lib/format';
import { type BoardPerson, type Named, type PeopleFilter, type PeopleSort, filterPeople, hhmm, hoursShare, isOffAllDay } from '@/lib/planner';

const ROW = 124;

export interface PanelProps {
  people: BoardPerson[];
  positions: Named[];
  days: string[];
  focusDay: string;
  selected: ReadonlySet<string>;
  picking: readonly string[] | null;
  /** A shift is being dragged: the panel takes it back (unassign). */
  shiftDragging: boolean;
  dropOver: boolean;
  onToggle: (id: string) => void;
  onPick: (id: string) => void;
  onDragStart: (e: React.PointerEvent, id: string) => void;
  onOrder: (ids: string[]) => void;
  /** Fixed height for the scroller (desktop column) or a sheet's. */
  height: string;
}

export function PeoplePanel(p: PanelProps) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [filter, setFilter] = useState<PeopleFilter>({ query: '', positionId: '', availableOn: null, underTarget: false });
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sort, setSort] = useState<PeopleSort>('hours');
  const list = useMemo(() => filterPeople(p.people, { ...filter, availableOn: availableOnly ? p.focusDay : null }, sort), [p.people, filter, availableOnly, p.focusDay, sort]);
  const { onOrder } = p;
  useEffect(() => onOrder(list.map((x) => x.id)), [list, onOrder]);

  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [viewH, setViewH] = useState(800);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(top / ROW) - 4);
  const last = Math.min(list.length, Math.ceil((top + viewH) / ROW) + 4);
  const posName = (x: Named) => (lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const posById = useMemo(() => new Map(p.positions.map((x) => [x.id, x])), [p.positions]);

  return (
    <section
      aria-label={t('planner.people.title')}
      data-drop={p.shiftDragging ? 'panel' : undefined}
      className={cn('flex min-w-0 flex-col rounded-xl2 border bg-panel transition-colors', p.dropOver ? 'border-brand bg-brand/5' : 'border-line')}
    >
      <div className="grid gap-2 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-body-strong">{t('planner.people.title')}</h2>
          <span className="text-caption text-muted">{t('planner.people.count', { count: list.length })}</span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input type="search" aria-label={t('planner.people.search')} placeholder={t('planner.people.search')} value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} className="pl-9" autoComplete="off" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select aria-label={t('planner.people.position')} value={filter.positionId} onChange={(e) => setFilter({ ...filter, positionId: e.target.value })}>
            <option value="">{t('planner.people.allPositions')}</option>
            {p.positions.map((x) => (
              <option key={x.id} value={x.id}>
                {posName(x)}
              </option>
            ))}
          </Select>
          <Select aria-label={t('planner.people.sort')} value={sort} onChange={(e) => setSort(e.target.value as PeopleSort)}>
            <option value="hours">{t('planner.people.fewest')}</option>
            <option value="name">{t('planner.people.name')}</option>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip on={availableOnly} onClick={() => setAvailableOnly((v) => !v)}>
            {t('planner.people.availableOn')}
          </Chip>
          <Chip on={filter.underTarget} onClick={() => setFilter({ ...filter, underTarget: !filter.underTarget })}>
            {t('planner.people.underTarget')}
          </Chip>
        </div>
        {p.shiftDragging ? <p className="rounded-lg bg-surface px-2 py-1.5 text-caption text-muted">{t('planner.people.dropToUnassign')}</p> : null}
      </div>
      <div ref={scroller} onScroll={(e) => setTop(e.currentTarget.scrollTop)} style={{ height: p.height }} className="relative overflow-y-auto overscroll-contain" role="list" aria-label={t('planner.people.list')}>
        <div style={{ height: list.length * ROW }} className="relative">
          {list.slice(first, last).map((person, i) => (
            <div key={person.id} role="listitem" className="absolute inset-x-0 px-2 py-1" style={{ top: (first + i) * ROW, height: ROW }}>
              <PersonCard
                person={person}
                days={p.days}
                focusDay={p.focusDay}
                selected={p.selected.has(person.id)}
                picked={!!p.picking?.includes(person.id)}
                posNames={person.positionIds.map((id) => posById.get(id)).filter((x): x is Named => !!x).map(posName)}
                onToggle={p.onToggle}
                onPick={p.onPick}
                onDragStart={p.onDragStart}
              />
            </div>
          ))}
        </div>
        {!list.length ? <p className="p-4 text-small text-muted">{t('planner.people.none')}</p> : null}
      </div>
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn('min-h-[44px] rounded-full border px-3 text-caption font-semibold sm:min-h-[36px]', on ? 'border-brand bg-brand/10 text-brand-text' : 'border-line text-muted hover:text-ink')}>
      {children}
    </button>
  );
}

const PersonCard = memo(function PersonCard({
  person,
  days,
  focusDay,
  selected,
  picked,
  posNames,
  onToggle,
  onPick,
  onDragStart,
}: {
  person: BoardPerson;
  days: string[];
  focusDay: string;
  selected: boolean;
  picked: boolean;
  posNames: string[];
  onToggle: (id: string) => void;
  onPick: (id: string) => void;
  onDragStart: (e: React.PointerEvent, id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const share = hoursShare(person);
  const over = person.targetHours !== null && person.scheduledHours > person.targetHours;
  const dept = person.fromDepartment ? (lng === 'fr-CA' && person.fromDepartment.nameFr ? person.fromDepartment.nameFr : person.fromDepartment.name) : null;
  const windows = person.availability[focusDay];
  const off = isOffAllDay(person, focusDay);
  const time = (m: number) => `2000-01-01T${hhmm(Math.min(m, 1439))}:00`;
  const availText = off
    ? t('planner.people.off')
    : windows?.length
      ? t('planner.people.available', { times: windows.map(([s, e]) => (s <= 0 && e >= 1440 ? t('planner.people.allDay') : formatTimeRange(time(s), e >= 1440 ? '2000-01-01T23:59:00' : time(e), lng))).join(', ') })
      : person.hasAvailability
        ? t('planner.people.notAvailable')
        : t('planner.people.noAvailability');
  const hoursLabel = person.targetHours !== null ? t('planner.people.hoursOf', { hours: formatHours(person.scheduledHours, lng), target: formatHours(person.targetHours, lng) }) : t('planner.people.hours', { hours: formatHours(person.scheduledHours, lng) });
  return (
    <div
      className={cn(
        'flex h-full gap-2 rounded-xl border bg-panel p-2 transition-colors',
        picked ? 'border-brand ring-2 ring-brand/40' : selected ? 'border-brand/60 bg-brand/5' : 'border-line hover:border-brand/40',
      )}
    >
      <label className="-m-1 grid h-11 w-9 shrink-0 cursor-pointer place-items-center" title={t('planner.people.select', { name: person.name })}>
        <input type="checkbox" checked={selected} onChange={() => onToggle(person.id)} className="h-4 w-4 accent-[rgb(var(--brand))]" aria-label={t('planner.people.select', { name: person.name })} />
      </label>
      <button
        type="button"
        onPointerDown={(e) => onDragStart(e, person.id)}
        onClick={() => onPick(person.id)}
        aria-pressed={picked}
        aria-label={`${person.name}. ${hoursLabel}. ${availText}.${dept ? ` ${t('planner.people.from', { department: dept })}.` : ''} ${t('planner.people.pickHint')}`}
        className="min-w-0 flex-1 cursor-grab touch-manipulation text-left active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-[0.7rem] font-bold text-brand-text">
            {person.initials}
          </span>
          <span className="truncate text-small font-semibold">{person.name}</span>
          {person.availabilityCurrent ? <CalendarCheck className="h-4 w-4 shrink-0 text-ok" aria-label={t('planner.people.confirmed')} /> : null}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1 overflow-hidden" style={{ maxHeight: '1.25rem' }}>
          {dept ? <span className="rounded-full bg-new-bg px-1.5 text-[0.7rem] font-semibold leading-5 text-new">{t('planner.people.from', { department: dept })}</span> : null}
          {posNames.slice(0, 2).map((n) => (
            <span key={n} className="truncate rounded-full bg-surface px-1.5 text-[0.7rem] font-semibold leading-5 text-muted">
              {n}
            </span>
          ))}
          {person.certifications.slice(0, 1).map((c) => (
            <span key={c.id} className="truncate rounded-full border border-line px-1.5 text-[0.7rem] leading-5 text-muted">
              {lng === 'fr-CA' && c.nameFr ? c.nameFr : c.name}
            </span>
          ))}
          {person.certifications.length > 1 ? <span className="text-[0.7rem] leading-5 text-muted">+{person.certifications.length - 1}</span> : null}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface" aria-hidden="true">
            {share !== null ? <div className={cn('h-full rounded-full', over ? 'bg-warn' : 'bg-brand')} style={{ width: `${Math.max(4, share * 100)}%` }} /> : null}
          </div>
          <span className={cn('shrink-0 text-[0.7rem] tabular-nums', over ? 'font-semibold text-warn' : 'text-muted')}>{hoursLabel}</span>
        </div>
        {days.length === 7 ? <WeekStrip person={person} days={days} /> : null}
        <p className={cn('mt-1 truncate text-[0.75rem]', off ? 'font-semibold text-danger' : windows?.length ? 'text-ok' : 'text-muted')}>{availText}</p>
      </button>
    </div>
  );
});

/** Seven tiny bars: availability (green) and time off (red) per day of the week in view. */
function WeekStrip({ person, days }: { person: BoardPerson; days: string[] }) {
  return (
    <div className="mt-1 grid grid-cols-7 gap-0.5" aria-hidden="true">
      {days.map((d) => (
        <div key={d} className="relative h-1.5 overflow-hidden rounded-sm bg-surface">
          {(person.availability[d] ?? []).map(([s, e]) => (
            <span key={`a${s}`} className="absolute inset-y-0 bg-ok/60" style={{ left: `${(s / 1440) * 100}%`, width: `${((Math.min(e, 1440) - s) / 1440) * 100}%` }} />
          ))}
          {(person.timeOff[d] ?? []).map(([s, e]) => (
            <span key={`o${s}`} className="absolute inset-y-0 bg-danger/80" style={{ left: `${(s / 1440) * 100}%`, width: `${((e - s) / 1440) * 100}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
