'use client';

import { BadgeCheck, BriefcaseBusiness, ListPlus, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Input, Select } from '@/components/ui/Field';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import type { Departments } from '@/lib/departments';
import { useAction, useQuery } from '@/lib/useQuery';

export interface CatalogCert { id: string; tenantId: string | null; name: string; nameFr: string | null; issuingBody: string; validityMonths: number | null }
interface StarterCert { key: string; group: 'aquatics' | 'arena' | 'water' | 'wastewater' | 'licence'; name: string; nameFr: string; issuingBody: string; validityMonths: number | null; added: boolean }
interface CityPosition {
  id: string;
  name: string;
  nameFr: string | null;
  minimumAge: number | null;
  hoursOfService: { maxDailyHours?: number | null; minRestHours?: number | null; maxHoursIn7Days?: number | null } | null;
  departmentId: string | null;
  unpaidBreakMinutes: number | null;
  neverAlone: boolean;
  requirements: Array<{ certificationId: string }>;
}

const GROUPS = ['aquatics', 'arena', 'water', 'wastewater', 'licence'] as const;
const named = (lng: string) => (x: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name);

/**
 * Settings › Positions, for positions.manage holders: the certificate catalog (with a starter list
 * for arenas, water and wastewater plants and driver's licences) and the positions that require them.
 */
export function PositionsSettings() {
  const catalog = useQuery<CatalogCert[]>('/api/certifications');
  return (
    <div className="grid max-w-4xl gap-6">
      <CertCatalogCard catalog={catalog.data} error={!!catalog.error} reload={catalog.reload} />
      <PositionsCard catalog={catalog.data ?? []} />
    </div>
  );
}

function CertCatalogCard({ catalog, error, reload }: { catalog: CatalogCert[] | null | undefined; error: boolean; reload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const name = named(i18n.language);
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<CatalogCert | 'new' | null>(null);
  const [starter, setStarter] = useState(false);
  const current = editing === 'new' ? null : editing;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const months = String(f.get('validity') ?? '').trim();
    const body = { name: String(f.get('name')).trim(), nameFr: String(f.get('nameFr') ?? '').trim() || null, issuingBody: String(f.get('issuingBody')).trim(), validityMonths: months ? Number(months) : null };
    const r = await run('cert', () => api(current ? `/api/certifications/${current.id}` : '/api/certifications', { method: current ? 'PATCH' : 'POST', body }), t('catalog.saved'));
    if (r !== undefined) {
      setEditing(null);
      await reload();
    }
  }

  return (
    <Card>
      <CardHeader
        title={t('catalog.title')}
        description={t('catalog.help')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<ListPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setStarter(true)}>
              {t('catalog.starter')}
            </Button>
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>
              {t('catalog.add')}
            </Button>
          </div>
        }
      />
      <CardBody className="pt-3">
        {error ? (
          <ErrorNotice onRetry={reload} />
        ) : !catalog ? (
          <ListSkeleton rows={3} />
        ) : !catalog.length ? (
          <EmptyState icon={BadgeCheck} title={t('catalog.empty')}>{t('catalog.emptyHelp')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {catalog.map((c) => (
              <li key={c.id}>
                <button type="button" disabled={!c.tenantId} onClick={() => setEditing(c)} className="grid w-full gap-0.5 rounded-lg py-3 text-left enabled:hover:bg-surface/60">
                  <span className="text-body-strong">{name(c)}</span>
                  <span className="text-small text-muted">
                    {[c.issuingBody, c.validityMonths ? t('catalog.validFor', { count: c.validityMonths }) : t('catalog.noExpiry'), c.tenantId ? null : t('catalog.shared')].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? name(current) : t('catalog.add')} description={t('catalog.formHelp')} closeLabel={t('common.close')}>
        <form key={current?.id ?? 'new'} onSubmit={(e) => void save(e)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('catalog.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={120} defaultValue={current?.name ?? ''} />}</Field>
            <Field label={t('catalog.nameFr')} hint={t('jobs.optional')}>{(p) => <Input {...p} name="nameFr" maxLength={120} defaultValue={current?.nameFr ?? ''} />}</Field>
          </div>
          <Field label={t('catalog.issuingBody')}>{(p) => <Input {...p} name="issuingBody" required minLength={2} maxLength={120} defaultValue={current?.issuingBody ?? ''} />}</Field>
          <Field label={t('catalog.validity')} hint={t('catalog.validityHint')}>
            {(p) => (
              <div className="w-28">
                <Input {...p} name="validity" type="number" min={1} max={120} defaultValue={current?.validityMonths ?? ''} />
              </div>
            )}
          </Field>
          <Button type="submit" loading={busy === 'cert'}>
            {t('common.save')}
          </Button>
        </form>
      </Dialog>
      {starter ? <StarterDialog onClose={() => setStarter(false)} onAdded={reload} /> : null}
    </Card>
  );
}

function StarterDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const fr = i18n.language === 'fr-CA';
  const list = useQuery<StarterCert[]>('/api/certifications/starter');
  const { run, busy } = useAction();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  async function add() {
    const r = await run('starter', () => api<{ added: number }>('/api/certifications/starter', { method: 'POST', body: { keys: picked } }));
    if (r !== undefined) {
      await onAdded();
      onClose();
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('catalog.starter')}
      description={t('catalog.starterHelp')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!picked.length} loading={busy === 'starter'} onClick={() => void add()}>
            {t('catalog.addPicked', { count: picked.length })}
          </Button>
        </>
      }
    >
      {list.error ? (
        <ErrorNotice onRetry={list.reload} />
      ) : !list.data ? (
        <ListSkeleton rows={4} />
      ) : (
        <div className="grid gap-4">
          {GROUPS.map((g) => (
            <fieldset key={g} className="grid gap-2">
              <legend className="mb-1 text-small font-semibold">{t(`catalog.groups.${g}`)}</legend>
              {list.data!
                .filter((c) => c.group === g)
                .map((c) => (
                  <label key={c.key} className="flex items-start gap-2 text-small">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" disabled={c.added} checked={c.added || picked.includes(c.key)} onChange={() => toggle(c.key)} />
                    <span>
                      {fr ? c.nameFr : c.name}
                      <span className="block text-caption text-muted">{[c.issuingBody, c.added ? t('catalog.alreadyAdded') : null].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                ))}
            </fieldset>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function PositionsCard({ catalog }: { catalog: CatalogCert[] }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const name = named(lng);
  const positions = useQuery<CityPosition[]>('/api/positions');
  const departments = useQuery<Departments>('/api/departments');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<CityPosition | 'new' | null>(null);
  const current = editing === 'new' ? null : editing;
  const certName = new Map(catalog.map((c) => [c.id, name(c)]));
  const deptName = new Map((departments.data?.departments ?? []).map((d) => [d.id, name(d)]));

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => (String(f.get(k) ?? '').trim() ? Number(f.get(k)) : null);
    const hos = { maxDailyHours: n('hosDaily'), minRestHours: n('hosRest'), maxHoursIn7Days: n('hosWeek') };
    const body = {
      name: String(f.get('name')).trim(),
      nameFr: String(f.get('nameFr') ?? '').trim() || null,
      minimumAge: n('age'),
      departmentId: String(f.get('department') ?? '') || null,
      requiredCertificationIds: f.getAll('required').map(String),
      hoursOfService: hos.maxDailyHours || hos.minRestHours || hos.maxHoursIn7Days ? hos : null,
      unpaidBreakMinutes: n('break'),
      neverAlone: f.get('neverAlone') === 'on',
    };
    const r = await run('pos', () => api(current ? `/api/positions/${current.id}` : '/api/positions', { method: current ? 'PUT' : 'POST', body }), t('platform.positionSaved'));
    if (r !== undefined) {
      setEditing(null);
      await Promise.all([positions.reload(), departments.reload()]);
    }
  }

  return (
    <Card>
      <CardHeader
        title={t('platform.positions')}
        description={t('settings.positionsHelp')}
        action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('platform.addPosition')}</Button>}
      />
      <CardBody className="pt-3">
        {positions.error ? (
          <ErrorNotice onRetry={positions.reload} />
        ) : !positions.data ? (
          <ListSkeleton rows={3} />
        ) : !positions.data.length ? (
          <EmptyState icon={BriefcaseBusiness} title={t('platform.noPositions')}>{t('settings.noPositionsHelp')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {positions.data.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setEditing(p)} className="grid w-full gap-0.5 rounded-lg py-3 text-left hover:bg-surface/60">
                  <span className="text-body-strong">{name(p)}</span>
                  <span className="text-small text-muted">
                    {[
                      p.departmentId ? deptName.get(p.departmentId) : null,
                      p.requirements.length ? p.requirements.map((r) => certName.get(r.certificationId) ?? '').filter(Boolean).join(', ') : t('platform.noCertsRequired'),
                      p.minimumAge ? t('platform.minAgeShort', { age: p.minimumAge }) : null,
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
            <Field label={t('platform.positionName')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={80} defaultValue={current?.name ?? ''} />}</Field>
            <Field label={t('platform.positionNameFr')} hint={t('jobs.optional')}>{(p) => <Input {...p} name="nameFr" maxLength={80} defaultValue={current?.nameFr ?? ''} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.positionDepartment')}>
              {(p) => (
                <Select {...p} name="department" defaultValue={current?.departmentId ?? ''}>
                  <option value="">{t('settings.noDepartment')}</option>
                  {(departments.data?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {name(d)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('platform.minAge')} hint={t('platform.minAgeHint')}>{(p) => <Input {...p} name="age" type="number" min={12} max={25} defaultValue={current?.minimumAge ?? ''} />}</Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-small font-semibold">{t('platform.requiredCerts')}</legend>
            {!catalog.length ? <p className="text-caption text-muted">{t('settings.addCertsFirst')}</p> : null}
            {catalog.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-small">
                <input type="checkbox" name="required" value={c.id} defaultChecked={current?.requirements.some((r) => r.certificationId === c.id)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                {name(c)}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.unpaidBreak')} hint={t('settings.unpaidBreakHint')}>{(p) => <Input {...p} name="break" type="number" min={0} max={240} defaultValue={current?.unpaidBreakMinutes ?? ''} />}</Field>
            <label className="flex items-center gap-2 self-end pb-2 text-small">
              <input type="checkbox" name="neverAlone" defaultChecked={current?.neverAlone ?? false} className="h-5 w-5 accent-[rgb(var(--brand))]" />
              {t('settings.neverAlone')}
            </label>
          </div>
          <fieldset className="grid gap-2 rounded-xl border border-line p-3">
            <legend className="px-1 text-small font-semibold">{t('platform.hos')}</legend>
            <p className="text-caption text-muted">{t('platform.hosHelp')}</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('platform.hosDaily')}>{(p) => <Input {...p} name="hosDaily" type="number" min={1} max={24} step="0.5" defaultValue={current?.hoursOfService?.maxDailyHours ?? ''} />}</Field>
              <Field label={t('platform.hosRest')}>{(p) => <Input {...p} name="hosRest" type="number" min={1} max={24} step="0.5" defaultValue={current?.hoursOfService?.minRestHours ?? ''} />}</Field>
              <Field label={t('platform.hosWeek')}>{(p) => <Input {...p} name="hosWeek" type="number" min={1} max={168} defaultValue={current?.hoursOfService?.maxHoursIn7Days ?? ''} />}</Field>
            </div>
          </fieldset>
          <Button type="submit" loading={busy === 'pos'}>
            {t('common.save')}
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}
