'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CityBrand } from '@/components/CoBrand';
import { AccessPanel } from '@/components/platform/AccessPanel';
import { BillingPanel } from '@/components/platform/BillingPanel';
import { PadPanel } from '@/components/platform/PadPanel';
import { FacilitiesPanel } from '@/components/platform/FacilitiesPanel';
import { FeaturesPanel } from '@/components/platform/FeaturesPanel';
import { ImportPanel } from '@/components/platform/ImportPanel';
import { OrganizationPanel } from '@/components/platform/OrganizationPanel';
import { PositionsPanel } from '@/components/platform/PositionsPanel';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Skeleton } from '@/components/ui/Skeleton';
import { PoolsEditor } from '@/components/pools/PoolsEditor';
import { RoleEditor } from '@/components/roles/RoleEditor';
import { type CityDetail, papi, usePlatformQuery } from '@/lib/platform';
import { DepartmentsEditor } from '@/components/DepartmentsEditor';
import { Select } from '@/components/ui/Field';
import { LifecyclePanel } from '@/components/platform/LifecyclePanel';

type Tab = 'org' | 'features' | 'access' | 'facilities' | 'pools' | 'positions' | 'roles' | 'import' | 'billing' | 'lifecycle';
const SECTIONS: Array<{ key: string; tabs: Tab[] }> = [
  { key: 'setup', tabs: ['org', 'facilities', 'pools', 'positions'] },
  { key: 'access', tabs: ['features', 'access', 'roles'] },
  { key: 'people', tabs: ['import'] },
  { key: 'money', tabs: ['billing'] },
  { key: 'account', tabs: ['lifecycle'] },
];

function City() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const city = usePlatformQuery<CityDetail>(id ? `/tenants/${id}` : null);
  const [tab, setTab] = useState<Tab>(() => (SECTIONS.flatMap((g) => g.tabs).includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'org'));
  if (city.error) return <ErrorNotice onRetry={city.reload} />;
  if (!city.data) return <Skeleton className="h-96" />;
  const c = city.data;
  const props = { id, city: c, reload: city.reload };
  return (
    <div className="grid gap-6">
      <Link href="/platform" className="flex w-fit items-center gap-1.5 rounded-lg text-small font-semibold text-brand-text hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('platform.cities')}
      </Link>
      <header className="flex flex-wrap items-center gap-4">
        {c.organization.logoUrl ? (
          <div className="grid h-14 place-items-center rounded-xl bg-panel px-3 shadow-sm">
            <CityBrand org={c.organization} size="md" />
          </div>
        ) : null}
        <div className="min-w-[14rem] flex-1">
          <h1 className="text-title [text-wrap:balance]">{c.organization.name}</h1>
          <p className="text-body text-muted">
            {t('platform.staffCount', { count: c.staff })} · {t('platform.facilityCount', { count: c.facilities.length })} · {t('platform.positionCount', { count: c.positions.length })}
          </p>
        </div>
        <a href={c.organization.signInUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-small font-semibold text-brand-text hover:bg-surface">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          {c.organization.signInUrl.replace(/^https?:\/\//, '').replace(/\/login$/, '')}
        </a>
      </header>
      {/* Phones: one menu. Wider screens: a settings rail beside the page, grouped. */}
      <div className="lg:hidden">
        <Select aria-label={t('settings.section')} value={tab} onChange={(e) => setTab(e.target.value as Tab)}>
          {SECTIONS.map((g) => (
            <optgroup key={g.key} label={t(`platform.railGroups.${g.key}`)}>
              {g.tabs.map((x) => <option key={x} value={x}>{t(`platform.tabs.${x}`)}</option>)}
            </optgroup>
          ))}
        </Select>
      </div>
      <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label={t('settings.section')} className="hidden lg:block">
        <div className="sticky top-24 grid gap-5">
          {SECTIONS.map((g) => (
            <div key={g.key}>
              <p className="mb-1 px-3 text-label uppercase text-muted">{t(`platform.railGroups.${g.key}`)}</p>
              <div className="grid gap-0.5">
                {g.tabs.map((x) => (
                  <button key={x} type="button" aria-current={tab === x ? 'page' : undefined} onClick={() => setTab(x)} className={`rounded-lg px-3 py-1.5 text-left text-small font-semibold transition-colors ${tab === x ? 'bg-brand/10 text-brand-text' : 'text-muted hover:bg-surface hover:text-ink'}`}>
                    {t(`platform.tabs.${x}`)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <div className="min-w-0 max-w-4xl">
        {tab === 'org' ? <OrganizationPanel {...props} /> : null}
        {tab === 'features' ? <FeaturesPanel {...props} /> : null}
        {tab === 'access' ? <AccessPanel {...props} /> : null}
        {tab === 'facilities' ? <FacilitiesPanel {...props} /> : null}
        {tab === 'pools' ? (
          <PoolsEditor
            pools={c.pools}
            facilities={c.facilities}
            save={(body, poolId) => (poolId ? papi(`/tenants/${id}/pools/${poolId}`, { method: 'PATCH', body }) : papi(`/tenants/${id}/pools`, { method: 'POST', body }))}
            reload={city.reload}
          />
        ) : null}
        {tab === 'positions' ? (
          <div className="grid gap-6">
            <DepartmentsEditor
              data={
                c.departmentSetup ?? {
                  departments: (c.departments ?? []).map((d) => ({ ...d, positions: c.positions.filter((p) => p.departmentId === d.id) })),
                  unassigned: c.positions.filter((p) => !p.departmentId),
                  limited: false,
                }
              }
              save={(did, body) => papi(did ? `/tenants/${id}/departments/${did}` : `/tenants/${id}/departments`, { method: did ? 'PUT' : 'POST', body })}
              remove={(did) => papi(`/tenants/${id}/departments/${did}`, { method: 'DELETE' })}
              reload={city.reload}
            />
            <PositionsPanel {...props} />
          </div>
        ) : null}
        {tab === 'roles' ? (
          <RoleEditor
            roles={c.customRoles}
            catalog={c.roleCatalog}
            positions={c.positions}
            facilities={c.facilities}
            departments={c.departments ?? []}
            save={(body, roleId) => (roleId ? papi(`/tenants/${id}/roles/${roleId}`, { method: 'PUT', body }) : papi(`/tenants/${id}/roles`, { method: 'POST', body }))}
            remove={(roleId) => papi(`/tenants/${id}/roles/${roleId}`, { method: 'DELETE' })}
            reload={city.reload}
          />
        ) : null}
        {tab === 'import' ? <ImportPanel {...props} /> : null}
        {tab === 'lifecycle' ? <LifecyclePanel id={id} subdomain={c.organization.subdomain} /> : null}
        {tab === 'billing' ? (
          <div className="grid gap-6">
            <BillingPanel {...props} />
            <PadPanel id={id} payor={c.organization.name} />
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );
}

export default function CityPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <City />
    </Suspense>
  );
}
