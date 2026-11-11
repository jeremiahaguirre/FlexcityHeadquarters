'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Select } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

type Observance = 'STATUTORY' | 'NEXT_WEEKDAY';
type Choice = 'SUBSTITUTE' | 'PAY';
interface HolidaySettings {
  observance: Observance;
  offDayRule: Choice | null;
  provinces: Array<{ province: string; default: Choice | 'NONE'; allowed: Choice[]; source: string }>;
}

/** Payroll settings: which day a weekend holiday is observed, and what a holiday on someone's day off gives them. */
export function HolidayWeekendCard() {
  const { t } = useTranslation();
  const q = useQuery<HolidaySettings>('/api/settings/holidays');
  const { run, busy } = useAction();
  const [observance, setObservance] = useState<Observance>('STATUTORY');
  const [choice, setChoice] = useState<Choice | ''>('');
  useEffect(() => {
    if (!q.data) return;
    setObservance(q.data.observance);
    setChoice(q.data.offDayRule ?? '');
  }, [q.data]);
  if (!q.data) return null;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await run('save', () => api('/api/settings/holidays', { method: 'PUT', body: { observance, offDayRule: choice || null } }), t('holidayWeekend.saved'));
    await q.reload();
  }
  const options: Array<{ value: Observance; label: string; hint: string }> = [
    { value: 'STATUTORY', label: t('holidayWeekend.observanceStatutory'), hint: t('holidayWeekend.observanceStatutoryHint') },
    { value: 'NEXT_WEEKDAY', label: t('holidayWeekend.observanceWeekday'), hint: t('holidayWeekend.observanceWeekdayHint') },
  ];
  return (
    <Card>
      <CardHeader title={t('holidayWeekend.title')} description={t('holidayWeekend.help')} />
      <CardBody className="pt-3">
        <form onSubmit={(e) => void save(e)} className="grid gap-5">
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-small font-semibold text-ink">{t('holidayWeekend.observance')}</legend>
            {options.map((o) => (
              <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-small text-ink has-[:checked]:border-[rgb(var(--brand))]">
                <input type="radio" name="observance" value={o.value} checked={observance === o.value} onChange={() => setObservance(o.value)} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
                <span>
                  <span className="font-semibold">{o.label}</span>
                  <span className="block text-caption text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label={t('holidayWeekend.offDay')} hint={t('holidayWeekend.offDayHint')}>
            {(p) => (
              <Select {...p} value={choice} onChange={(e) => setChoice(e.target.value as Choice | '')}>
                <option value="">{t('holidayWeekend.offDayDefault')}</option>
                <option value="SUBSTITUTE">{t('holidayWeekend.offDaySUBSTITUTE')}</option>
                <option value="PAY">{t('holidayWeekend.offDayPAY')}</option>
              </Select>
            )}
          </Field>
          <div className="grid gap-2">
            <h3 className="text-small font-semibold text-ink">{t('holidayWeekend.provinceDefaults')}</h3>
            {q.data.provinces.length ? (
              <ul className="grid gap-2">
                {q.data.provinces.map((p) => (
                  <li key={p.province} className="rounded-xl bg-surface p-3 text-small text-ink">
                    {t(`holidayWeekend.rules.${p.province}`)}
                    {choice ? <span className="mt-1 block text-caption text-muted">{p.allowed.includes(choice) ? t('holidayWeekend.choiceAllowed') : t('holidayWeekend.choiceNotAllowed')}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-muted">{t('holidayWeekend.noFacilities')}</p>
            )}
            <p className="text-caption text-muted">{t('holidayWeekend.rules.FED')}</p>
          </div>
          <Button type="submit" className="justify-self-start" loading={busy === 'save'}>
            {t('common.save')}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
