'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CityBrand } from '@/components/CoBrand';
import { BillingPanel } from '@/components/platform/BillingPanel';
import { FacilitiesPanel } from '@/components/platform/FacilitiesPanel';
import { FeaturesPanel } from '@/components/platform/FeaturesPanel';
import { ImportPanel } from '@/components/platform/ImportPanel';
import { OrganizationPanel } from '@/components/platform/OrganizationPanel';
import { PositionsPanel } from '@/components/platform/PositionsPanel';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { PoolsEditor } from '@/components/pools/PoolsEditor';
import { RoleEditor } from '@/components/roles/RoleEditor';
import { type CityDetail, papi, usePlatformQuery } from '@/lib/platform';

type Tab = 'org' | 'features' | 'facilities' | 'pools' | 'positions' | 'roles' | 'import' | 'billing';
const TABS: Tab[] = ['org', 'features', 'facilities', 'pools', 'positions', 'roles', 'import', 'billing'];

function City() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const city = usePlatformQuery<CityDetail>(id ? `/tenants/${id}` : null);
  const [tab, setTab] = useState<Tab>(() => (TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'org'));
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
        <div className="min-w-0 flex-1">
          <h1 className="text-title">{c.organization.name}</h1>
          <p className="text-body text-muted">
            {t('platform.staffCount', { count: c.staff })} · {t('platform.facilityCount', { count: c.facilities.length })} · {t('platform.positionCount', { count: c.positions.length })}
          </p>
        </div>
        <a href={c.organization.signInUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-small font-semibold text-brand-text hover:bg-surface">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          {c.organization.signInUrl.replace(/^https?:\/\//, '').replace(/\/login$/, '')}
        </a>
      </header>
      <div className="overflow-x-auto pb-1">
        <Segmented label={t('settings.section')} value={tab} onChange={setTab} options={TABS.map((x) => ({ value: x, label: t(`platform.tabs.${x}`) }))} />
      </div>
      <div className="max-w-4xl">
        {tab === 'org' ? <OrganizationPanel {...props} /> : null}
        {tab === 'features' ? <FeaturesPanel {...props} /> : null}
        {tab === 'facilities' ? <FacilitiesPanel {...props} /> : null}
        {tab === 'pools' ? (
          <PoolsEditor
            pools={c.pools}
            facilities={c.facilities}
            save={(body, poolId) => (poolId ? papi(`/tenants/${id}/pools/${poolId}`, { method: 'PATCH', body }) : papi(`/tenants/${id}/pools`, { method: 'POST', body }))}
            reload={city.reload}
          />
        ) : null}
        {tab === 'positions' ? <PositionsPanel {...props} /> : null}
        {tab === 'roles' ? (
          <RoleEditor
            roles={c.customRoles}
            catalog={c.roleCatalog}
            save={(body, roleId) => (roleId ? papi(`/tenants/${id}/roles/${roleId}`, { method: 'PUT', body }) : papi(`/tenants/${id}/roles`, { method: 'POST', body }))}
            remove={(roleId) => papi(`/tenants/${id}/roles/${roleId}`, { method: 'DELETE' })}
            reload={city.reload}
          />
        ) : null}
        {tab === 'import' ? <ImportPanel {...props} /> : null}
        {tab === 'billing' ? <BillingPanel {...props} /> : null}
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
