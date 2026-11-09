'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/StatusPill';
import { papi } from '@/lib/platform';
import { useAction } from '@/lib/useQuery';
import type { PanelProps } from './types';

/** Grouped as people see them in the app. */
const GROUPS: Array<{ key: string; features: string[] }> = [
  { key: 'scheduling', features: ['shiftBoard', 'scheduleAssistant', 'availability', 'timeOff', 'lessons'] },
  { key: 'time', features: ['timeclock', 'payroll'] },
  { key: 'deck', features: ['poolChemistry', 'statusBoard', 'incidents'] },
  { key: 'people', features: ['discipline', 'reliability', 'jobs', 'union'] },
  { key: 'communication', features: ['emailNotifications'] },
];

export function FeaturesPanel({ id, city, reload }: PanelProps) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(key: string, on: boolean) {
    setPending(key);
    await run(key, () => papi(`/tenants/${id}`, { method: 'PATCH', body: { features: { [key]: on } } }), t(on ? 'platform.featureOn' : 'platform.featureOff', { name: t(`platform.features.${key}.name`) }));
    await reload();
    setPending(null);
  }

  return (
    <div className="grid gap-6">
      <p className="text-small text-muted">{t('platform.featuresHelp')}</p>
      {GROUPS.map((g) => (
        <Card key={g.key}>
          <CardHeader title={t(`platform.featureGroups.${g.key}`)} />
          <CardBody className="pt-2">
            <ul className="divide-y divide-line">
              {g.features
                .filter((k) => k in city.features)
                .map((k) => {
                  const on = city.features[k]!;
                  const label = t(`platform.features.${k}.name`);
                  return (
                    <li key={k} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-body-strong">
                          {label}
                          {on !== city.featureDefaults[k] ? <StatusPill tone="neutral">{t('platform.changedFromDefault')}</StatusPill> : null}
                        </p>
                        <p className="text-small text-muted">{t(`platform.features.${k}.help`)}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={label}
                        disabled={pending === k}
                        onClick={() => void toggle(k, !on)}
                        className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-brand' : 'bg-line'}`}
                      >
                        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-6' : 'left-1'}`} />
                      </button>
                    </li>
                  );
                })}
            </ul>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
