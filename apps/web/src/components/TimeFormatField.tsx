'use client';

import { useTranslation } from 'react-i18next';
import { Field, Select } from '@/components/ui/Field';

/** The city's clock: 12-hour, 24-hour, or the language's usual style. Shows an example of each. */
export function TimeFormatField({ value }: { value?: string }) {
  const { t, i18n } = useTranslation();
  const sample = (hourCycle?: 'h12' | 'h23') =>
    new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC', ...(hourCycle ? { hourCycle } : {}) }).format(new Date('2026-01-01T14:30:00Z'));
  return (
    <Field label={t('settings.timeFormat')} hint={t('settings.timeFormatHint')}>
      {(p) => (
        <Select {...p} name="timeFormat" defaultValue={value ?? 'auto'}>
          <option value="auto">{t('settings.timeFormatAuto')}</option>
          <option value="12h">{t('settings.timeFormat12', { example: sample('h12') })}</option>
          <option value="24h">{t('settings.timeFormat24', { example: sample('h23') })}</option>
        </Select>
      )}
    </Field>
  );
}
