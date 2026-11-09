'use client';

import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { type Facility, papi } from '@/lib/platform';
import { PROVINCES, TIMEZONES } from '@/lib/regions';
import { useAction } from '@/lib/useQuery';
import type { PanelProps } from './types';

export function FacilitiesPanel({ id, city, reload }: PanelProps) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<Facility | 'new' | null>(null);
  const current = editing === 'new' ? null : editing;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    const n = (k: string) => (s(k) === null ? null : Number(s(k)));
    const body = { name: s('name'), province: s('province'), timezone: s('tz'), latitude: n('lat'), longitude: n('lng'), geoRadiusM: n('radius'), costCenter: s('cc') };
    const r = await run('fac', () => (current ? papi(`/tenants/${id}/facilities/${current.id}`, { method: 'PATCH', body }) : papi(`/tenants/${id}/facilities`, { method: 'POST', body })), t('profile.saved'));
    if (r !== undefined) {
      setEditing(null);
      await reload();
    }
  }

  return (
    <Card>
      <CardHeader
        title={t('settings.facilities')}
        description={t('settings.facilitiesHelp')}
        action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('settings.addFacility')}</Button>}
      />
      <CardBody className="pt-3">
        <ul className="divide-y divide-line">
          {city.facilities.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => setEditing(f)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg py-3 text-left hover:bg-surface/60">
                <span>
                  <span className="block text-body-strong">{f.name}</span>
                  <span className="text-small text-muted">
                    {f.province} · {f.timezone.replace('America/', '').replace('_', ' ')} · {f.costCenter ?? t('settings.noCostCentre')}
                  </span>
                </span>
                {f.latitude === null ? <StatusPill tone="neutral">{t('settings.noGeofence')}</StatusPill> : <StatusPill tone="ok">{t('settings.geofence', { m: f.geoRadiusM })}</StatusPill>}
              </button>
            </li>
          ))}
        </ul>
      </CardBody>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? current.name : t('settings.addFacility')} closeLabel={t('common.close')}>
        <form key={current?.id ?? 'new'} onSubmit={(e) => void save(e)} className="grid gap-4">
          <Field label={t('settings.facilityName')}>{(p) => <Input {...p} name="name" required minLength={2} defaultValue={current?.name ?? ''} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.province')}>
              {(p) => (
                <Select {...p} name="province" defaultValue={current?.province ?? 'BC'}>
                  {PROVINCES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('settings.timezone')}>
              {(p) => (
                <Select {...p} name="tz" defaultValue={current?.timezone ?? 'America/Vancouver'}>
                  {[...new Set([...(current ? [current.timezone] : []), ...TIMEZONES])].map((x) => (
                    <option key={x} value={x}>
                      {x.replace('America/', '').replace('_', ' ')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('settings.costCentre')} hint={t('settings.costCentreHint')}>{(p) => <Input {...p} name="cc" defaultValue={current?.costCenter ?? ''} />}</Field>
            <Field label={t('settings.radius')} hint={t('settings.radiusHint')}>{(p) => <Input {...p} name="radius" type="number" min={25} max={2000} required defaultValue={current?.geoRadiusM ?? 150} />}</Field>
            <Field label={t('settings.latitude')}>{(p) => <Input {...p} name="lat" inputMode="decimal" defaultValue={current?.latitude ?? ''} />}</Field>
            <Field label={t('settings.longitude')}>{(p) => <Input {...p} name="lng" inputMode="decimal" defaultValue={current?.longitude ?? ''} />}</Field>
          </div>
          <Button type="submit" loading={busy === 'fac'}>
            {t('common.save')}
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}
