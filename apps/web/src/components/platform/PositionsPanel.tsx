'use client';

import { BriefcaseBusiness, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { type PositionRow, papi } from '@/lib/platform';
import { useAction } from '@/lib/useQuery';
import type { PanelProps } from './types';

export function PositionsPanel({ id, city, reload }: PanelProps) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<PositionRow | 'new' | null>(null);
  const current = editing === 'new' ? null : editing;
  const name = (x: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const certName = (cid: string) => {
    const c = city.certifications.find((x) => x.id === cid);
    return c ? name(c) : '';
  };

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const age = String(f.get('age') ?? '').trim();
    const body = {
      name: String(f.get('name')).trim(),
      nameFr: String(f.get('nameFr') ?? '').trim() || null,
      minimumAge: age ? Number(age) : null,
      requiredCertificationIds: f.getAll('certs').map(String),
    };
    const r = await run('pos', () => (current ? papi(`/tenants/${id}/positions/${current.id}`, { method: 'PUT', body }) : papi(`/tenants/${id}/positions`, { method: 'POST', body })), t('platform.positionSaved'));
    if (r !== undefined) {
      setEditing(null);
      await reload();
    }
  }

  return (
    <Card>
      <CardHeader
        title={t('platform.positions')}
        description={t('platform.positionsHelp')}
        action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('platform.addPosition')}</Button>}
      />
      <CardBody className="pt-3">
        {!city.positions.length ? (
          <EmptyState icon={BriefcaseBusiness} title={t('platform.noPositions')}>{t('platform.noPositionsHelp')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {city.positions.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setEditing(p)} className="grid w-full gap-0.5 rounded-lg py-3 text-left hover:bg-surface/60">
                  <span className="text-body-strong">
                    {name(p)}
                    {p.nameFr && lng !== 'fr-CA' ? <span className="font-normal text-muted"> · {p.nameFr}</span> : null}
                  </span>
                  <span className="text-small text-muted">
                    {[
                      p.requiredCertificationIds.length ? p.requiredCertificationIds.map(certName).join(', ') : t('platform.noCertsRequired'),
                      p.minimumAge ? t('platform.minAgeShort', { age: p.minimumAge }) : null,
                      t('platform.staffCount', { count: p.staff }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? name(current) : t('platform.addPosition')} description={t('platform.positionHelp')} closeLabel={t('common.close')}>
        <form key={current?.id ?? 'new'} onSubmit={(e) => void save(e)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('platform.positionName')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={80} defaultValue={current?.name ?? ''} placeholder="Lifeguard" />}</Field>
            <Field label={t('platform.positionNameFr')} hint={t('jobs.optional')}>{(p) => <Input {...p} name="nameFr" maxLength={80} defaultValue={current?.nameFr ?? ''} placeholder="Sauveteur" />}</Field>
          </div>
          <Field label={t('platform.minAge')} hint={t('platform.minAgeHint')}>
            {(p) => (
              <div className="w-28">
                <Input {...p} name="age" type="number" min={12} max={25} defaultValue={current?.minimumAge ?? ''} />
              </div>
            )}
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-small font-semibold">{t('platform.requiredCerts')}</legend>
            {city.certifications.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-small">
                <input type="checkbox" name="certs" value={c.id} defaultChecked={current?.requiredCertificationIds.includes(c.id)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                {name(c)}
              </label>
            ))}
          </fieldset>
          <Button type="submit" loading={busy === 'pos'}>
            {t('common.save')}
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}
