'use client';

import { useTranslation } from 'react-i18next';
import { type CitySummary, usePlatformQuery } from '@/lib/platform';

export const ROLES = ['HR_ADMIN', 'AQUATIC_SUPERVISOR', 'HEAD_LIFEGUARD', 'STAFF', 'FRONT_DESK', 'UNION_STEWARD', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];
export interface Ring { id: string; name: string; position: number; tenantIds: string[] }

/** A moment as the value of an <input type="datetime-local"> on this device. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => new Date(v).toISOString();
export const whenText = (iso: string, lang: string) => new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });

export const box = 'h-5 w-5 shrink-0 accent-[rgb(var(--brand))]';
export const chip = 'flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3 text-small has-[:checked]:border-brand/50 has-[:checked]:bg-brand/5';

/** Organizations (and, once there are any, release rings) a notice is for: all, or the ones ticked. */
export function AudiencePicker({ tenantIds, ringIds, onChange, rings = [] }: { tenantIds: string[]; ringIds: string[]; onChange: (v: { tenantIds: string[]; ringIds: string[] }) => void; rings?: Ring[] }) {
  const { t } = useTranslation();
  const cities = usePlatformQuery<CitySummary[]>('/tenants');
  const all = tenantIds.length === 0 && ringIds.length === 0;
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-small font-semibold text-ink">{t('updatesConsole.organizations')}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={chip}>
          <input type="radio" name="audience" className={box} checked={all} onChange={() => onChange({ tenantIds: [], ringIds: [] })} />
          {t('updatesConsole.allOrganizations')}
        </label>
        <label className={chip}>
          <input type="radio" name="audience" className={box} checked={!all} onChange={() => onChange({ tenantIds: cities.data?.[0] ? [cities.data[0].id] : [], ringIds: [] })} />
          {t('updatesConsole.someOrganizations')}
        </label>
      </div>
      {!all ? (
        <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-xl border border-line p-2">
          {rings.map((r) => (
            <label key={r.id} className={chip}>
              <input type="checkbox" className={box} checked={ringIds.includes(r.id)} onChange={(e) => onChange({ tenantIds, ringIds: toggle(ringIds, r.id, e.target.checked) })} />
              <span className="min-w-0 flex-1">{t('updatesConsole.ringOption', { name: r.name })}</span>
              <span className="text-caption text-muted">{t('updatesConsole.orgCount', { count: r.tenantIds.length })}</span>
            </label>
          ))}
          {(cities.data ?? []).map((c) => (
            <label key={c.id} className={chip}>
              <input type="checkbox" className={box} checked={tenantIds.includes(c.id)} onChange={(e) => onChange({ tenantIds: toggle(tenantIds, c.id, e.target.checked), ringIds })} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-caption text-muted">{c.subdomain}</span>
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

/** "All organizations" or "3 organizations". */
export function useAudienceText() {
  const { t } = useTranslation();
  return (tenantIds: string[]) => (tenantIds.length ? t('updatesConsole.orgCount', { count: tenantIds.length }) : t('updatesConsole.allOrganizations'));
}
