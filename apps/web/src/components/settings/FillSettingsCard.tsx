'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PrioritySliders } from '@/components/FillSchedule';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { api } from '@/lib/api';
import { type Horizon, HORIZONS, type Toggles, type Weights } from '@/lib/fill';
import { useAction, useQuery } from '@/lib/useQuery';

interface Settings { organization: { planAheadWeeks: Horizon; weights: Weights; toggles: Toggles; limits: { maxConsecutiveDays: number; maxDailyHours: number } }; seniorityOn: boolean }

/**
 * The organization's "Plan ahead" window (how far ahead staff keep availability current, and the
 * default for Fill the schedule) and the assistant's default priorities. Departments can set
 * their own in the Fill sheet.
 */
export function FillSettingsCard() {
  const { t } = useTranslation();
  const q = useQuery<Settings>('/api/schedule/fill/settings');
  const { run, busy } = useAction();
  const [s, setS] = useState<Settings['organization'] | null>(null);
  useEffect(() => {
    if (q.data) setS(q.data.organization);
  }, [q.data]);
  if (!q.data || !s) return null;
  return (
    <Card>
      <CardHeader title={t('fill.settings.title')} description={t('fill.settings.help')} />
      <CardBody className="grid gap-5 pt-2">
        <div className="grid gap-1.5">
          <p className="text-small font-semibold">{t('fill.settings.planAhead')}</p>
          <Segmented label={t('fill.settings.planAhead')} value={String(s.planAheadWeeks) as `${Horizon}`} onChange={(v) => setS({ ...s, planAheadWeeks: Number(v) as Horizon })} options={HORIZONS.map((h) => ({ value: String(h) as `${Horizon}`, label: t(`fill.horizon.${h}`) }))} />
          <p className="text-caption text-muted">{t('fill.settings.planAheadHelp')}</p>
        </div>
        <div className="grid gap-2">
          {(['keepAssigned', 'avoidOvertime', 'spreadWeekends', 'sameFacility'] as const).map((k) => (
            <label key={k} className="flex min-h-11 items-start gap-3 text-small">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={s.toggles[k]} onChange={(e) => setS({ ...s, toggles: { ...s.toggles, [k]: e.target.checked } })} />
              <span>
                <span className="block font-semibold">{t(`fill.toggle.${k}`)}</span>
                <span className="text-caption text-muted">{t(`fill.toggleHelp.${k}`)}</span>
              </span>
            </label>
          ))}
        </div>
        <PrioritySliders weights={s.weights} onChange={(weights) => setS({ ...s, weights })} showSeniority={q.data.seniorityOn} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fill.settings.maxDays')}>
            {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={13} value={s.limits.maxConsecutiveDays} onChange={(e) => setS({ ...s, limits: { ...s.limits, maxConsecutiveDays: Number(e.target.value) } })} />}
          </Field>
          <Field label={t('fill.settings.maxHours')}>
            {(p) => <Input {...p} type="number" inputMode="decimal" min={4} max={24} value={s.limits.maxDailyHours} onChange={(e) => setS({ ...s, limits: { ...s.limits, maxDailyHours: Number(e.target.value) } })} />}
          </Field>
        </div>
        <Button
          className="justify-self-start"
          loading={busy === 'save'}
          onClick={() => void run('save', () => api('/api/schedule/fill/settings', { method: 'PUT', body: { departmentId: null, ...s } }), t('fill.savedDefaults')).then(() => q.reload())}
        >
          {t('common.save')}
        </Button>
      </CardBody>
    </Card>
  );
}
