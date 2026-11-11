'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Select } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { type RecoveryMode, type ScoreRules, dayOf } from '@/lib/people';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface Policy { mode: RecoveryMode; resetMonth: number; resetDay: number; timeZone: string; rules: ScoreRules; lastRestartAt: string | null; nextRestartAt: string | null }

const MODES: RecoveryMode[] = ['GRADUAL', 'RESET', 'BOTH'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** HR: how the advisory reliability score recovers (gradually, a yearly restart, or both). */
export function ReliabilityCard() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { can } = useSession();
  const q = useQuery<Policy>(can('reliability.read') ? '/api/settings/reliability' : null);
  const { run, busy } = useAction();
  const [mode, setMode] = useState<RecoveryMode>('GRADUAL');
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  useEffect(() => {
    if (!q.data) return;
    setMode(q.data.mode);
    setMonth(q.data.resetMonth);
    setDay(q.data.resetDay);
  }, [q.data]);
  if (!q.data) return null;
  const p = q.data;
  const r = p.rules;
  const resets = mode !== 'GRADUAL';
  const monthName = (m: number) => new Intl.DateTimeFormat(lng, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, m - 1, 15)));
  const changed = mode !== p.mode || (resets && (month !== p.resetMonth || day !== p.resetDay));

  return (
    <Card>
      <CardHeader title={t('reliability.settings.title')} description={t('reliability.settings.help')} />
      <CardBody className="grid gap-4 pt-2">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-small font-semibold">{t('reliability.settings.how')}</legend>
          {MODES.map((m) => (
            <label key={m} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-small ${mode === m ? 'border-brand bg-surface' : 'border-line'}`}>
              <input type="radio" name="reliability-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
              <span className="min-w-0">
                <span className="font-semibold">{t(`reliability.settings.modes.${m}`)}</span>
                {m === 'GRADUAL' ? <span className="text-muted"> · {t('reliability.settings.default')}</span> : null}
                <span className="block text-caption text-muted">
                  {t(`reliability.settings.modeHelp.${m}`, { days: r.windowDays, full: r.fullWeightDays, onTime: r.onTimeShift, cap: r.onTimeShiftMonthlyCap, streak: r.streakLength, bonus: r.streakBonus, clean: r.cleanDays, cleanBonus: r.cleanBonus })}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {resets ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('reliability.settings.month')} hint={t('reliability.settings.dateHelp')}>
              {(f) => (
                <Select
                  {...f}
                  value={month}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    setMonth(m);
                    setDay((d) => Math.min(d, DAYS_IN[m - 1]!));
                  }}
                >
                  {DAYS_IN.map((_, i) => (
                    <option key={i} value={i + 1}>{monthName(i + 1)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('reliability.settings.day')} hint={month === 2 && day === 29 ? t('reliability.settings.leap') : undefined}>
              {(f) => (
                <Select {...f} value={day} onChange={(e) => setDay(Number(e.target.value))}>
                  {Array.from({ length: DAYS_IN[month - 1]! }, (_, i) => (
                    <option key={i} value={i + 1}>{i + 1}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        ) : null}
        {!changed && p.nextRestartAt && resets ? (
          <p className="text-caption text-muted">
            {t('reliability.settings.next', { last: p.lastRestartAt ? formatDate(dayOf(p.lastRestartAt), lng, 'dated') : '', next: formatDate(dayOf(p.nextRestartAt), lng, 'dated') })}
          </p>
        ) : null}
        <p className="text-caption text-muted">{t('reliability.settings.records')}</p>
        <div>
          <Button
            disabled={!changed}
            loading={busy === 'save'}
            onClick={() => void run('save', () => api('/api/settings/reliability', { method: 'PUT', body: { mode, resetMonth: month, resetDay: day } }), t('reliability.settings.saved')).then(() => q.reload())}
          >
            {t('reliability.settings.save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
