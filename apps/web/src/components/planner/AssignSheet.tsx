'use client';

/**
 * A shift's sheet, the keyboard and phone way to assign: everyone in the department ranked by
 * the API's check (can work it, can with a warning, can't — with reasons), plus changing the
 * times, unassigning and the full details (cancel). Assigning re-checks on the server.
 */
import { ChevronDown, Clock, ListChecks, UserMinus } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { cn } from '@/lib/cn';
import { formatDate, formatHours, formatTimeRange } from '@/lib/format';
import { type BoardPerson, type BoardShift, type EligCache, endMinuteOf, hhmm, minuteOf, rankFor } from '@/lib/planner';
import { StatusMark, reasonsText } from './text';
import { posLabel } from './views';

export function AssignSheet({
  shift,
  people,
  cache,
  loading,
  onAssign,
  onUnassign,
  onTimes,
  onDetails,
  onClose,
}: {
  shift: BoardShift;
  people: BoardPerson[];
  cache: EligCache;
  loading: boolean;
  onAssign: (userId: string) => Promise<void>;
  onUnassign: () => Promise<void>;
  onTimes: (start: string, end: string) => Promise<void>;
  onDetails: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [busy, setBusy] = useState<string | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const [editTimes, setEditTimes] = useState(false);
  const ranked = useMemo(() => rankFor(people.filter((p) => p.id !== shift.userId), cache, shift.id), [people, cache, shift]);
  const can = ranked.filter((r) => r.cell.status !== 'block');
  const cannot = ranked.filter((r) => r.cell.status === 'block' && r.cell.reasons[0]?.code !== 'NOT_QUALIFIED_FOR_POSITION');
  const unqualified = ranked.length - can.length - cannot.length;
  const wrap = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const statusWord = (s: string) => t(`planner.status.${s}`);

  function saveTimes(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void wrap('times', () => onTimes(String(f.get('start')), String(f.get('end'))));
  }

  const row = (r: (typeof ranked)[number]) => (
    <li key={r.person.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <StatusMark status={r.cell.status} className="mt-0.5" />
        <div className="min-w-0">
          <p className="truncate text-small font-semibold">{r.person.name}</p>
          <p className="text-caption text-muted">
            <span className="sr-only">{statusWord(r.cell.status)}. </span>
            {r.cell.reasons.length ? reasonsText(t, lng, r.cell.reasons) : r.cell.status === 'unknown' ? t('planner.status.checking') : t('planner.people.hours', { hours: formatHours(r.person.scheduledHours, lng) })}
          </p>
        </div>
      </div>
      {r.cell.status !== 'block' ? (
        <Button size="sm" variant={r.cell.status === 'ok' ? 'primary' : 'secondary'} loading={busy === r.person.id} onClick={() => void wrap(r.person.id, () => onAssign(r.person.id))} aria-label={t('planner.assignName', { name: r.person.name })}>
          {t('builder.assign')}
        </Button>
      ) : null}
    </li>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={posLabel(lng, shift)}
      description={`${formatDate(shift.localStartsAt, lng, 'long')} · ${formatTimeRange(shift.localStartsAt, shift.localEndsAt, lng)} · ${shift.facility.name}`}
      closeLabel={t('common.close')}
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={shift.status === 'DRAFT' ? 'neutral' : 'brand'}>{t(`builder.status.${shift.status}`)}</StatusPill>
          {shift.assignee ? <StatusPill tone="ok">{shift.assignee.name}</StatusPill> : <StatusPill tone="new">{t('schedule.open')}</StatusPill>}
        </div>
        <div>
          <h3 className="mb-2 text-label uppercase text-muted">{t('planner.assignTitle')}</h3>
          <ul className="grid max-h-[22rem] gap-1.5 overflow-y-auto pr-1" aria-busy={loading}>
            {can.map(row)}
            {!can.length ? <p className="text-small text-muted">{loading ? t('planner.status.checking') : t('planner.noOneCan')}</p> : null}
          </ul>
          {cannot.length ? (
            <div className="mt-2">
              <button type="button" aria-expanded={showBlocked} onClick={() => setShowBlocked((v) => !v)} className="flex min-h-[44px] items-center gap-1 text-small font-semibold text-muted hover:text-ink">
                <ChevronDown className={cn('h-4 w-4 transition-transform', showBlocked && 'rotate-180')} aria-hidden="true" />
                {t('planner.cantCount', { count: cannot.length })}
              </button>
              {showBlocked ? <ul className="mt-1 grid gap-1.5">{cannot.map(row)}</ul> : null}
            </div>
          ) : null}
          {unqualified ? <p className="mt-1 text-caption text-muted">{t('planner.notApproved', { count: unqualified })}</p> : null}
        </div>
        {editTimes ? (
          <form onSubmit={saveTimes} className="grid gap-3 rounded-xl border border-line p-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('timeOff.startTime')}>{(p) => <Input {...p} type="time" step={900} name="start" defaultValue={hhmm(minuteOf(shift.localStartsAt))} required />}</Field>
              <Field label={t('timeOff.endTime')}>{(p) => <Input {...p} type="time" step={900} name="end" defaultValue={hhmm(endMinuteOf(shift.localStartsAt, shift.localEndsAt))} required />}</Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditTimes(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" loading={busy === 'times'}>
                {t('planner.saveTimes')}
              </Button>
            </div>
          </form>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <div className="flex flex-wrap gap-2">
            {shift.assignee ? (
              <Button variant="secondary" size="sm" icon={<UserMinus className="h-4 w-4" aria-hidden="true" />} loading={busy === 'none'} onClick={() => void wrap('none', onUnassign)}>
                {t('builder.unassign')}
              </Button>
            ) : null}
            {!editTimes ? (
              <Button variant="secondary" size="sm" icon={<Clock className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditTimes(true)}>
                {t('planner.changeTimes')}
              </Button>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" icon={<ListChecks className="h-4 w-4" aria-hidden="true" />} onClick={onDetails}>
            {t('planner.details')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
