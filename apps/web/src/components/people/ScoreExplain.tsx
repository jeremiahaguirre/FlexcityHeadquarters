'use client';

import { Award, CalendarCheck, CalendarX2, Clock, RotateCcw, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDate } from '@/lib/format';
import { type FileEvent, type ReliabilityExplain, type ScoreChange, dayOf } from '@/lib/people';

const SHOWN = 6;
/** "+2" · "−2" with a real minus sign. */
export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/** The status pill for an event that isn't counted in full (or at all). */
export function EventStanding({ e }: { e: FileEvent }) {
  const { t } = useTranslation();
  const status = e.status ?? (e.counted ? 'COUNTED' : 'EXCUSED');
  if (status === 'COUNTED' || status === 'FADING') {
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        {status === 'FADING' ? <StatusPill tone="neutral">{t('reliability.status.FADING')}</StatusPill> : null}
        <span className={`tabular-nums text-small font-semibold ${e.points < 0 ? 'text-warn' : 'text-ok'}`}>{signed(e.points)}</span>
      </span>
    );
  }
  return <StatusPill tone="neutral">{t(`reliability.status.${status}`)}</StatusPill>;
}

/** A line under an event explaining its standing (fading, protected leave, the yearly restart, too old). */
export function eventNote(e: FileEvent, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  if (e.status === 'FADING' && e.basePoints !== undefined) return t('reliability.fadingNote', { full: signed(e.basePoints), now: signed(e.points) });
  if (e.status === 'PROTECTED') return t('reliability.protectedNote');
  if (e.status === 'RESTARTED') return t('reliability.restartedNote');
  if (e.status === 'AGED_OUT') return t('reliability.agedOutNote');
  return null;
}

/** How the score got here: the organization's rule, the yearly restart, the streak, and every change. */
export function ScoreExplain({ r, mine = false }: { r: ReliabilityExplain | undefined; mine?: boolean }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [all, setAll] = useState(false);
  if (!r) return null;
  const date = (iso: string) => formatDate(dayOf(iso), lng, 'dated');
  const month = (m: string) => new Intl.DateTimeFormat(lng, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`));
  const changes = [...r.changes].reverse();
  const shown = all ? changes : changes.slice(0, SHOWN);
  const left = r.rules.streakLength - (r.streak % r.rules.streakLength);

  const line = (c: ScoreChange) => {
    switch (c.kind) {
      case 'EVENT':
        return {
          icon: c.eventType === 'NO_SHOW' || c.eventType === 'MISSED_IN_SERVICE' ? <CalendarX2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />,
          text: `${t(`profile.events.${c.eventType}`)} · ${date(c.at)}`,
          sub: c.fading ? t('reliability.fadingShort', { days: r.rules.fullWeightDays }) : null,
        };
      case 'ON_TIME':
        return { icon: <CalendarCheck className="h-4 w-4" />, text: t('reliability.change.ON_TIME', { count: c.count ?? 0, month: month(c.month ?? c.at.slice(0, 7)) }), sub: t('reliability.capNote', { cap: r.rules.onTimeShiftMonthlyCap }) };
      case 'STREAK':
        return { icon: <TrendingUp className="h-4 w-4" />, text: t('reliability.change.STREAK', { count: c.count ?? r.rules.streakLength }), sub: date(c.at) };
      case 'CLEAN':
        return { icon: <TrendingUp className="h-4 w-4" />, text: t('reliability.change.CLEAN', { count: c.days ?? r.rules.cleanDays }), sub: date(c.at) };
      case 'COMMENDATION':
        return { icon: <Award className="h-4 w-4" />, text: `${t('reliability.change.COMMENDATION')} · ${date(c.at)}`, sub: null };
      default:
        return { icon: <RotateCcw className="h-4 w-4" />, text: t('reliability.change.RESTART', { date: date(c.at) }), sub: null };
    }
  };

  return (
    <section className="grid gap-3" aria-labelledby="score-explain">
      <div className="grid gap-1.5">
        <h3 id="score-explain" className="text-small font-semibold">{t('reliability.title')}</h3>
        <p className="text-caption text-muted">
          {t(`reliability.mode.${r.mode}`, { days: r.rules.windowDays, full: r.rules.fullWeightDays, next: r.nextRestartAt ? date(r.nextRestartAt) : '', since: date(r.countsFrom) })}
        </p>
        {r.restartedAt && r.mode !== 'GRADUAL' ? (
          <p className="flex items-center gap-1.5 text-caption font-semibold text-ink">
            <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('reliability.change.RESTART', { date: date(r.restartedAt) })}
          </p>
        ) : null}
        {r.mode !== 'RESET' && r.streak > 0 ? (
          <p className="text-caption text-ok">{t(mine ? 'reliability.streakMine' : 'reliability.streak', { count: r.streak, left, bonus: r.rules.streakBonus })}</p>
        ) : null}
      </div>
      {changes.length ? (
        <ul className="grid gap-1.5 text-small">
          {shown.map((c, i) => {
            const l = line(c);
            return (
              <li key={`${c.kind}${c.at}${i}`} className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 gap-2">
                  <span className="mt-0.5 shrink-0 text-muted" aria-hidden="true">{l.icon}</span>
                  <span className="min-w-0">
                    {l.text}
                    {l.sub ? <span className="block text-caption text-muted">{l.sub}</span> : null}
                  </span>
                </span>
                {c.kind === 'RESTART' ? null : (
                  <span className={`shrink-0 tabular-nums font-semibold ${c.applied < 0 || c.points < 0 ? 'text-warn' : 'text-ok'}`}>
                    {signed(c.kind === 'EVENT' ? c.points : c.applied)}
                    {c.kind !== 'EVENT' && c.applied !== c.points ? <span className="sr-only"> {t('reliability.atCap')}</span> : null}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-small text-muted">{t('reliability.nothing')}</p>
      )}
      {changes.length > SHOWN ? (
        <button type="button" className="min-h-[44px] justify-self-start text-caption font-semibold text-brand-text hover:underline" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? t('reliability.showFewer') : t('reliability.showAll', { count: changes.length })}
        </button>
      ) : null}
    </section>
  );
}
