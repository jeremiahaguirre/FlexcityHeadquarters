'use client';

import { Building2, ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CityBrand } from '@/components/CoBrand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { formatDate } from '@/lib/format';
import { type CitySummary, papi, usePlatformQuery } from '@/lib/platform';
import { PROVINCES, TIMEZONES } from '@/lib/regions';

export default function CitiesPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const router = useRouter();
  const toast = useToast();
  const cities = usePlatformQuery<CitySummary[]>('/tenants');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const shown = (cities.data ?? []).filter((c) => `${c.name} ${c.subdomain}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const adminEmail = s('adminEmail');
    setBusy(true);
    try {
      const r = await papi<{ id: string }>('/tenants', {
        method: 'POST',
        body: {
          name: s('name'),
          subdomain: s('subdomain').toLowerCase(),
          defaultLocale: s('locale'),
          facility: { name: s('facility'), province: s('province'), timezone: s('tz'), latitude: null, longitude: null, geoRadiusM: 150, costCenter: s('costCentre') || null },
          admin: adminEmail ? { firstName: s('adminFirst'), lastName: s('adminLast'), email: adminEmail } : null,
        },
      });
      toast(t('platform.created'), 'ok');
      router.push(`/platform/city?id=${r.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? t(`platform.errors.${err.code}`, { defaultValue: err.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('platform.citiesTitle')}
        description={t('platform.citiesHelp')}
        actions={
          <Button icon={<Plus className="h-5 w-5" aria-hidden="true" />} onClick={() => setAdding(true)}>
            {t('platform.newCity')}
          </Button>
        }
      />
      <div className="mb-4 max-w-sm">
        <Input aria-label={t('platform.searchCities')} placeholder={t('platform.searchCities')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {cities.loading && !cities.data ? (
        <ListSkeleton rows={3} />
      ) : !shown.length ? (
        <EmptyState icon={Building2} title={t('platform.noCities')} />
      ) : (
        <Card className="divide-y divide-line">
          {shown.map((c) => (
            <Link key={c.id} href={`/platform/city?id=${c.id}`} className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface/60 sm:gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface sm:w-24 sm:px-2">
                {c.logoUrl ? <CityBrand org={c} size="sm" /> : <Building2 className="h-5 w-5 text-muted" aria-hidden="true" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-strong">{c.name}</p>
                <p className="truncate text-small text-muted">
                  {t('platform.staffCount', { count: c.staff })} · {t('platform.facilityCount', { count: c.facilities })}<span className="hidden sm:inline"> · {c.subdomain} · {t('platform.since', { date: formatDate(c.createdAt, lng, 'dated') })}</span>
                </p>
              </div>
              <span className="hidden text-caption text-muted sm:inline">{t('platform.featuresOn', { on: c.featuresOn, total: c.featuresTotal })}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          ))}
        </Card>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} title={t('platform.newCity')} description={t('platform.newCityHelp')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void create(e)} className="grid gap-4">
          <Field label={t('platform.orgName')}>{(p) => <Input {...p} name="name" required minLength={2} placeholder="City of Lakeview" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('platform.subdomain')} hint={t('platform.subdomainHint')}>
              {(p) => <Input {...p} name="subdomain" required pattern="[a-z][a-z0-9\-]{1,30}[a-z0-9]" placeholder="lakeview" autoCapitalize="none" spellCheck={false} />}
            </Field>
            <Field label={t('settings.defaultLanguage')}>
              {(p) => (
                <Select {...p} name="locale" defaultValue="en-CA">
                  <option value="en-CA">English</option>
                  <option value="fr-CA">Français</option>
                </Select>
              )}
            </Field>
          </div>
          <fieldset className="grid gap-4 rounded-xl bg-surface p-4">
            <legend className="px-1 text-small font-semibold">{t('platform.firstFacility')}</legend>
            <Field label={t('settings.facilityName')}>{(p) => <Input {...p} name="facility" required minLength={2} placeholder="Lakeview Aquatic Centre" />}</Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('settings.province')}>
                {(p) => (
                  <Select {...p} name="province" defaultValue="BC">
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
                  <Select {...p} name="tz" defaultValue="America/Vancouver">
                    {TIMEZONES.map((x) => (
                      <option key={x} value={x}>
                        {x.replace('America/', '').replace('_', ' ')}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('settings.costCentre')}>{(p) => <Input {...p} name="costCentre" />}</Field>
            </div>
          </fieldset>
          <fieldset className="grid gap-4 rounded-xl bg-surface p-4">
            <legend className="px-1 text-small font-semibold">{t('platform.firstAdmin')}</legend>
            <p className="text-small text-muted">{t('platform.firstAdminHelp')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('staff.firstName')}>{(p) => <Input {...p} name="adminFirst" />}</Field>
              <Field label={t('staff.lastName')}>{(p) => <Input {...p} name="adminLast" />}</Field>
            </div>
            <Field label={t('login.email')}>{(p) => <Input {...p} name="adminEmail" type="email" />}</Field>
          </fieldset>
          <Button type="submit" loading={busy} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>
            {t('platform.createCity')}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
