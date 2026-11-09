'use client';

import { Building2, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { PROVINCES, TIMEZONES } from '@/lib/regions';
import { RoleEditor } from '@/components/roles/RoleEditor';
import type { CustomRole, RoleCatalog } from '@/lib/customRoles';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

const PAY_KEYS = ['REGULAR', 'OVERTIME_1_5', 'OVERTIME_2_0', 'STAT_WORKED', 'STAT_HOLIDAY_PAY', 'SHIFT_PREMIUM', 'VACATION_PAY'] as const;

interface Facility { id: string; name: string; province: string; timezone: string; latitude: number | null; longitude: number | null; geoRadiusM: number; costCenter: string | null }
interface Override { id: string; province: string | null; ruleKey: string; value: unknown; effectiveFrom: string; effectiveTo: string | null; source: string }
interface Period { kind: 'TERM' | 'BREAK'; name: string; startsOn: string; endsOn: string }
interface Settings {
  organization: { name: string; subdomain: string; logoUrl: string | null; themeColors: { primary?: string } | null; defaultLocale: string; payWeekStartDay: number; vacationPayMode: string; payrollRetentionYears: number };
  facilities: Facility[];
  payCodes: Array<{ key: string; positionId: string | null; code: string }>;
  ruleOverrides: Override[];
  schoolCalendar: Array<Period & { id: string }>;
  allowedRuleKeys: string[];
}
interface Pool {
  id: string;
  name: string;
  facility: { name: string };
  configured: boolean;
  thresholds: { freeChlorineMinPpm: string | null; freeChlorineMaxPpm: string | null; combinedChlorineMaxPpm: string | null; phMin: string | null; phMax: string | null; source: string | null; bathersPerLifeguard: number | null };
}

type Tab = 'org' | 'facilities' | 'pools' | 'roles' | 'pay' | 'calendar' | 'rules';
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
const num = (f: FormData, k: string) => (str(f, k) === null ? null : Number(str(f, k)));

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <CardBody className="pt-3">{children}</CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const org = can('tenant.configure');
  const tabs: Tab[] = [...(org ? (['org', 'facilities'] as const) : []), ...(can('ops.configure') ? (['pools'] as const) : []), ...(org ? (['roles', 'pay', 'calendar', 'rules'] as const) : [])];
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'org');
  const settings = useQuery<Settings>(org ? '/api/settings' : null);

  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      {tabs.length > 1 ? (
        <div className="mb-6 overflow-x-auto pb-1">
          <Segmented label={t('settings.section')} value={tab} onChange={setTab} options={tabs.map((x) => ({ value: x, label: t(`settings.tabs.${x}`) }))} />
        </div>
      ) : null}
      {tab === 'pools' ? (
        <Pools />
      ) : tab === 'roles' ? (
        <div className="max-w-4xl">
          <CityRoles />
        </div>
      ) : settings.error ? (
        <ErrorNotice onRetry={settings.reload} />
      ) : !settings.data ? (
        <ListSkeleton rows={4} />
      ) : (
        <div className="grid max-w-4xl gap-6">
          {tab === 'org' ? <Organization s={settings.data} reload={settings.reload} /> : null}
          {tab === 'facilities' ? <Facilities s={settings.data} reload={settings.reload} /> : null}
          {tab === 'pay' ? <PayCodes s={settings.data} reload={settings.reload} /> : null}
          {tab === 'calendar' ? <SchoolCalendar s={settings.data} reload={settings.reload} /> : null}
          {tab === 'rules' ? <Rules s={settings.data} reload={settings.reload} /> : null}
        </div>
      )}
    </>
  );
}

interface Props { s: Settings; reload: () => Promise<void> }

function Organization({ s, reload }: Props) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const o = s.organization;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(
      'org',
      () =>
        api('/api/settings', {
          method: 'PATCH',
          body: {
            name: str(f, 'name'),
            logoUrl: str(f, 'logoUrl'),
            themeColors: { primary: str(f, 'primary') },
            defaultLocale: str(f, 'locale'),
            payWeekStartDay: num(f, 'payWeek'),
            vacationPayMode: str(f, 'vacation'),
            payrollRetentionYears: num(f, 'retention'),
          },
        }),
      t('profile.saved'),
    );
    await reload();
  }
  const days = Array.from({ length: 7 }, (_, i) => i);
  return (
    <Section title={t('settings.org')} description={t('settings.orgHelp', { host: typeof window === 'undefined' ? o.subdomain : window.location.host })}>
      <form onSubmit={(e) => void save(e)} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('settings.orgName')}>{(p) => <Input {...p} name="name" required defaultValue={o.name} />}</Field>
          <Field label={t('settings.defaultLanguage')}>
            {(p) => (
              <Select {...p} name="locale" defaultValue={o.defaultLocale}>
                <option value="en-CA">English</option>
                <option value="fr-CA">Français</option>
              </Select>
            )}
          </Field>
          <Field label={t('settings.payWeek')} hint={t('settings.payWeekHint')}>
            {(p) => (
              <Select {...p} name="payWeek" defaultValue={String(o.payWeekStartDay)}>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {t(`settings.days.${d}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('settings.vacation')}>
            {(p) => (
              <Select {...p} name="vacation" defaultValue={o.vacationPayMode}>
                <option value="PAY_EACH_PERIOD">{t('settings.vacationModes.PAY_EACH_PERIOD')}</option>
                <option value="ACCRUE">{t('settings.vacationModes.ACCRUE')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('settings.retention')} hint={t('settings.retentionHint')}>{(p) => <Input {...p} name="retention" type="number" min={6} max={15} defaultValue={o.payrollRetentionYears} />}</Field>
          <Field label={t('settings.brandColour')} hint={t('settings.brandColourHint')}>
            {(p) => (
              <div className="w-24">
                <Input {...p} name="primary" type="color" defaultValue={o.themeColors?.primary ?? '#0f766e'} className="h-12 cursor-pointer p-1" />
              </div>
            )}
          </Field>
        </div>
        <Field label={t('settings.logoUrl')} hint={t('settings.logoUrlHint')}>{(p) => <Input {...p} name="logoUrl" type="url" placeholder="https://" defaultValue={o.logoUrl ?? ''} />}</Field>
        <Button type="submit" className="justify-self-start" loading={busy === 'org'}>
          {t('common.save')}
        </Button>
      </form>
    </Section>
  );
}

function Facilities({ s, reload }: Props) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<Facility | 'new' | null>(null);
  const current = editing === 'new' ? null : editing;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: str(f, 'name'), province: str(f, 'province'), timezone: str(f, 'tz'), latitude: num(f, 'lat'), longitude: num(f, 'lng'), geoRadiusM: num(f, 'radius'), costCenter: str(f, 'cc') };
    const r = await run('fac', () => (current ? api(`/api/settings/facilities/${current.id}`, { method: 'PATCH', body }) : api('/api/settings/facilities', { method: 'POST', body })), t('profile.saved'));
    if (r !== undefined) {
      setEditing(null);
      await reload();
    }
  }
  return (
    <Section
      title={t('settings.facilities')}
      description={t('settings.facilitiesHelp')}
      action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('settings.addFacility')}</Button>}
    >
      {!s.facilities.length ? (
        <EmptyState icon={Building2} title={t('settings.noFacilities')} />
      ) : (
        <ul className="divide-y divide-line">
          {s.facilities.map((f) => (
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
      )}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? current.name : t('settings.addFacility')} closeLabel={t('common.close')}>
        <form key={current?.id ?? 'new'} onSubmit={(e) => void save(e)} className="grid gap-4">
          <Field label={t('settings.facilityName')}>{(p) => <Input {...p} name="name" required defaultValue={current?.name ?? ''} />}</Field>
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
            <Field label={t('settings.latitude')}>{(p) => <Input {...p} name="lat" inputMode="decimal" defaultValue={current?.latitude ?? ''} placeholder="49.8880" />}</Field>
            <Field label={t('settings.longitude')}>{(p) => <Input {...p} name="lng" inputMode="decimal" defaultValue={current?.longitude ?? ''} placeholder="-119.4960" />}</Field>
          </div>
          <Button type="submit" loading={busy === 'fac'}>
            {t('common.save')}
          </Button>
        </form>
      </Dialog>
    </Section>
  );
}

function Pools() {
  const { t } = useTranslation();
  const pools = useQuery<Pool[]>('/api/ops/pools');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<Pool | null>(null);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const f = new FormData(e.currentTarget);
    const body = {
      freeChlorineMinPpm: str(f, 'fcMin'),
      freeChlorineMaxPpm: str(f, 'fcMax'),
      combinedChlorineMaxPpm: str(f, 'ccMax'),
      phMin: str(f, 'phMin'),
      phMax: str(f, 'phMax'),
      bathersPerLifeguard: num(f, 'ratio'),
      thresholdSource: str(f, 'source'),
    };
    const r = await run('pool', () => api(`/api/ops/pools/${editing.id}/thresholds`, { method: 'PUT', body }), t('profile.saved'));
    if (r !== undefined) {
      setEditing(null);
      await pools.reload();
    }
  }
  const th = editing?.thresholds;
  return (
    <div className="grid max-w-4xl gap-6">
      <Section title={t('settings.pools')} description={t('settings.poolsHelp')}>
        {pools.loading ? (
          <ListSkeleton rows={3} />
        ) : (
          <ul className="divide-y divide-line">
            {pools.data?.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setEditing(p)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg py-3 text-left hover:bg-surface/60">
                  <span>
                    <span className="block text-body-strong">{p.name}</span>
                    <span className="text-small text-muted">
                      {p.facility.name}
                      {p.configured ? ` · ${t('settings.poolSummary', { fcMin: p.thresholds.freeChlorineMinPpm ?? '—', fcMax: p.thresholds.freeChlorineMaxPpm ?? '—', phMin: p.thresholds.phMin ?? '—', phMax: p.thresholds.phMax ?? '—' })}` : ''}
                    </span>
                  </span>
                  {p.configured ? <StatusPill tone="ok">{t('settings.configured')}</StatusPill> : <StatusPill tone="warn">{t('settings.notConfigured')}</StatusPill>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.name ?? ''} description={t('settings.thresholdsHelp')} closeLabel={t('common.close')}>
        <form key={editing?.id} onSubmit={(e) => void save(e)} className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('settings.fcMin')}>{(p) => <Input {...p} name="fcMin" inputMode="decimal" defaultValue={th?.freeChlorineMinPpm ?? ''} />}</Field>
            <Field label={t('settings.fcMax')}>{(p) => <Input {...p} name="fcMax" inputMode="decimal" defaultValue={th?.freeChlorineMaxPpm ?? ''} />}</Field>
            <Field label={t('settings.phMin')}>{(p) => <Input {...p} name="phMin" inputMode="decimal" defaultValue={th?.phMin ?? ''} />}</Field>
            <Field label={t('settings.phMax')}>{(p) => <Input {...p} name="phMax" inputMode="decimal" defaultValue={th?.phMax ?? ''} />}</Field>
            <Field label={t('settings.ccMax')}>{(p) => <Input {...p} name="ccMax" inputMode="decimal" defaultValue={th?.combinedChlorineMaxPpm ?? ''} />}</Field>
            <Field label={t('settings.ratio')}>{(p) => <Input {...p} name="ratio" type="number" min={1} max={500} defaultValue={th?.bathersPerLifeguard ?? ''} />}</Field>
          </div>
          <Field label={t('settings.source')} hint={t('settings.sourceHint')}>{(p) => <Input {...p} name="source" required minLength={3} defaultValue={th?.source ?? ''} />}</Field>
          <Button type="submit" loading={busy === 'pool'}>
            {t('common.save')}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

function PayCodes({ s, reload }: Props) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const positionRows = s.payCodes.filter((c) => c.positionId !== null);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const rows = PAY_KEYS.map((key) => ({ key, positionId: null, code: str(f, key) })).filter((r) => r.code);
    await run('pay', () => api('/api/settings/pay-codes', { method: 'PUT', body: [...rows, ...positionRows] }), t('profile.saved'));
    await reload();
  }
  const code = (key: string) => s.payCodes.find((c) => c.key === key && c.positionId === null)?.code ?? '';
  return (
    <Section title={t('settings.payCodes')} description={t('settings.payCodesHelp')}>
      <form onSubmit={(e) => void save(e)} className="grid gap-4">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {PAY_KEYS.map((k) => (
            <Field key={k} label={t(`settings.payKeys.${k}`)}>
              {(p) => <Input {...p} name={k} defaultValue={code(k)} className="font-mono" />}
            </Field>
          ))}
        </div>
        {positionRows.length ? <p className="text-small text-muted">{t('settings.positionCodes', { count: positionRows.length })}</p> : null}
        <Button type="submit" className="justify-self-start" loading={busy === 'pay'}>
          {t('common.save')}
        </Button>
      </form>
    </Section>
  );
}

function SchoolCalendar({ s, reload }: Props) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [rows, setRows] = useState<Period[]>([]);
  useEffect(() => setRows(s.schoolCalendar.map(({ kind, name, startsOn, endsOn }) => ({ kind, name, startsOn, endsOn }))), [s.schoolCalendar]);
  const set = (i: number, patch: Partial<Period>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  async function save(e: FormEvent) {
    e.preventDefault();
    await run('cal', () => api('/api/settings/school-calendar', { method: 'PUT', body: rows }), t('profile.saved'));
    await reload();
  }
  return (
    <Section title={t('settings.calendar')} description={t('settings.calendarHelp')}>
      <form onSubmit={(e) => void save(e)} className="grid gap-4">
        {!rows.length ? <p className="text-small text-muted">{t('settings.calendarEmpty')}</p> : null}
        {rows.map((r, i) => (
          <fieldset key={i} className="grid gap-3 rounded-xl bg-surface p-3 sm:grid-cols-[8rem_1fr_9.5rem_9.5rem_auto] sm:items-end">
            <legend className="sr-only">{r.name || t('settings.period')}</legend>
            <Field label={t('settings.kind')}>
              {(p) => (
                <Select {...p} value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Period['kind'] })}>
                  <option value="TERM">{t('settings.kinds.TERM')}</option>
                  <option value="BREAK">{t('settings.kinds.BREAK')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('settings.periodName')}>{(p) => <Input {...p} required minLength={2} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />}</Field>
            <Field label={t('settings.from')}>{(p) => <Input {...p} type="date" required value={r.startsOn} onChange={(e) => set(i, { startsOn: e.target.value })} />}</Field>
            <Field label={t('settings.to')}>{(p) => <Input {...p} type="date" required min={r.startsOn} value={r.endsOn} onChange={(e) => set(i, { endsOn: e.target.value })} />}</Field>
            <Button variant="ghost" size="sm" aria-label={t('settings.remove')} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
              <span className="sm:sr-only">{t('settings.remove')}</span>
            </Button>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setRows((x) => [...x, { kind: 'BREAK', name: '', startsOn: '', endsOn: '' }])}>
            {t('settings.addPeriod')}
          </Button>
          <Button type="submit" loading={busy === 'cal'}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Rules({ s, reload }: Props) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const keys = s.allowedRuleKeys.filter((k) => k !== 'vacation.tiers');
  const [ruleKey, setRuleKey] = useState(keys[0] ?? '');
  const d = (x: string) => formatDate(`${x}T12:00:00`, lng, 'dated');
  const shown = (v: unknown) => (v === 'stacked' || v === 'greater_of' ? t(`settings.methods.${v}`) : Array.isArray(v) ? t('settings.tiersValue', { count: v.length }) : v === null ? t('settings.noLimit') : String(v));
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = ruleKey === 'overtime.method' ? str(f, 'value') : num(f, 'value');
    const r = await run(
      'rule',
      () => api('/api/settings/rule-overrides', { method: 'POST', body: { province: str(f, 'province'), ruleKey, value, effectiveFrom: str(f, 'from'), effectiveTo: str(f, 'to'), source: str(f, 'source') } }),
      t('settings.ruleAdded'),
    );
    if (r !== undefined) {
      setAdding(false);
      await reload();
    }
  }
  return (
    <Section
      title={t('settings.rules')}
      description={t('settings.rulesHelp')}
      action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('settings.addRule')}</Button>}
    >
      {!s.ruleOverrides.length ? (
        <p className="text-small text-muted">{t('settings.noRules')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {s.ruleOverrides.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="text-body-strong">
                  {t(`settings.ruleKeys.${o.ruleKey}`)}: {shown(o.value)}
                </p>
                <p className="text-small text-muted">
                  {o.province ?? t('settings.allProvinces')} · {d(o.effectiveFrom)} – {o.effectiveTo ? d(o.effectiveTo) : t('settings.noEnd')} · {o.source}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                loading={busy === o.id}
                onClick={() => void run(o.id, () => api(`/api/settings/rule-overrides/${o.id}`, { method: 'DELETE' }), t('settings.ruleRemoved')).then(reload)}
              >
                {t('settings.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('settings.addRule')} description={t('settings.addRuleHelp')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void add(e)} className="grid gap-4">
          <Field label={t('settings.rule')}>
            {(p) => (
              <Select {...p} value={ruleKey} onChange={(e) => setRuleKey(e.target.value)}>
                {keys.map((k) => (
                  <option key={k} value={k}>
                    {t(`settings.ruleKeys.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.value')} hint={ruleKey === 'overtime.method' ? undefined : t('settings.valueHint')}>
              {(p) =>
                ruleKey === 'overtime.method' ? (
                  <Select {...p} name="value">
                    <option value="stacked">{t('settings.methods.stacked')}</option>
                    <option value="greater_of">{t('settings.methods.greater_of')}</option>
                  </Select>
                ) : (
                  <Input {...p} name="value" inputMode="decimal" required placeholder="7.5" />
                )
              }
            </Field>
            <Field label={t('settings.province')}>
              {(p) => (
                <Select {...p} name="province" defaultValue="">
                  <option value="">{t('settings.allProvinces')}</option>
                  {PROVINCES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('settings.from')}>{(p) => <Input {...p} name="from" type="date" required />}</Field>
            <Field label={t('settings.to')} hint={t('settings.toHint')}>{(p) => <Input {...p} name="to" type="date" />}</Field>
          </div>
          <Field label={t('settings.agreementSource')} hint={t('settings.agreementSourceHint')}>{(p) => <Input {...p} name="source" required minLength={3} placeholder="CBA art. 14.02" />}</Field>
          <Button type="submit" loading={busy === 'rule'}>
            {t('settings.addRule')}
          </Button>
        </form>
      </Dialog>
    </Section>
  );
}

function CityRoles() {
  const roles = useQuery<{ roles: CustomRole[]; catalog: RoleCatalog }>('/api/roles');
  if (!roles.data) return <ListSkeleton rows={3} />;
  return (
    <RoleEditor
      roles={roles.data.roles}
      catalog={roles.data.catalog}
      save={(body, id) => (id ? api(`/api/roles/${id}`, { method: 'PUT', body }) : api('/api/roles', { method: 'POST', body }))}
      remove={(id) => api(`/api/roles/${id}`, { method: 'DELETE' })}
      reload={roles.reload}
    />
  );
}
