'use client';

import { BookOpenCheck, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { dateFormat } from '@/lib/format';
import { formatLocal } from '@/lib/localTime';
import { useAction, useQuery } from '@/lib/useQuery';
import { type DepartmentRules, type LateChange, type OrgRules, PREMIUM_PRESETS, type PremiumKind, type PremiumRule, type WorkRulesView, clock, numOrNull, windowMinutes } from '@/lib/workRules';

const box = 'mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]';

function Check({ checked, onChange, label, help, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string; disabled?: boolean }) {
  return (
    <label className="flex min-h-11 items-start gap-3 text-small">
      <input type="checkbox" className={box} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-semibold">{label}</span>
        {help ? <span className="text-caption text-muted">{help}</span> : null}
      </span>
    </label>
  );
}

/** A number that may be left blank (null = the organization's, or the law's). */
function Num({ label, hint, value, onChange, min, max, step = 'any', placeholder, disabled }: { label: string; hint?: ReactNode; value: number | null | undefined; onChange: (v: number | null) => void; min?: number; max?: number; step?: string; placeholder?: string; disabled?: boolean }) {
  return (
    <Field label={label} hint={hint}>
      {(p) => <Input {...p} type="number" inputMode="decimal" min={min} max={max} step={step} placeholder={placeholder} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(numOrNull(e.target.value))} />}
    </Field>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <legend className="text-small font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Breaks, call-in, notice and standby: the organization's values, or a department's over them. */
function RulesForm({ value, onChange, inherit, disabled, payDisabled }: { value: OrgRules | DepartmentRules; onChange: (v: OrgRules | DepartmentRules) => void; inherit?: OrgRules; disabled?: boolean; payDisabled?: boolean }) {
  const { t } = useTranslation();
  const v = value as DepartmentRules;
  const set = <K extends keyof DepartmentRules>(k: K, patch: NonNullable<DepartmentRules[K]>) => onChange({ ...value, [k]: { ...(v[k] ?? {}), ...patch } } as OrgRules);
  const ph = (n: number | null | undefined) => (inherit ? (n === null || n === undefined ? t('workRules.inheritNone') : t('workRules.inherit', { value: n })) : undefined);
  const pay = disabled || payDisabled;
  return (
    <div className="grid gap-5">
      <Section title={t('workRules.breaks.title')}>
        <p className="text-caption text-muted">{t('workRules.breaks.help')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Num label={t('workRules.breaks.after')} hint={t('workRules.breaks.afterHelp')} value={v.breaks?.breakAfterHours} onChange={(n) => set('breaks', { breakAfterHours: n })} min={1} max={12} placeholder={ph(inherit?.breaks.breakAfterHours) ?? t('workRules.byProvince')} disabled={disabled} />
        </div>
        <Check checked={v.breaks?.warnMissing ?? inherit?.breaks.warnMissing ?? true} onChange={(c) => set('breaks', { warnMissing: c })} label={t('workRules.breaks.warn')} help={t('workRules.breaks.warnHelp')} disabled={disabled} />
      </Section>
      <Section title={t('workRules.callIn.title')}>
        <p className="text-caption text-muted">{t('workRules.callIn.help')}</p>
        <Check checked={v.callIn?.enabled ?? inherit?.callIn.enabled ?? true} onChange={(c) => set('callIn', { enabled: c })} label={t('workRules.callIn.enabled')} disabled={pay} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Num label={t('workRules.callIn.minHours')} hint={t('workRules.callIn.minHoursHelp')} value={v.callIn?.minHours} onChange={(n) => set('callIn', { minHours: n })} min={0} max={8} placeholder={ph(inherit?.callIn.minHours) ?? t('workRules.byProvince')} disabled={pay} />
        </div>
      </Section>
      <Section title={t('workRules.notice.title')}>
        <p className="text-caption text-muted">{t('workRules.notice.help')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Num label={t('workRules.notice.postDays')} hint={t('workRules.notice.postDaysHelp')} value={v.notice?.postDaysAhead} onChange={(n) => set('notice', { postDaysAhead: n })} min={0} max={90} step="1" placeholder={ph(inherit?.notice.postDaysAhead) ?? t('workRules.off')} disabled={pay} />
          <Num label={t('workRules.notice.lateHours')} hint={t('workRules.notice.lateHoursHelp')} value={v.notice?.lateChangeHours} onChange={(n) => set('notice', { lateChangeHours: n })} min={0} max={720} placeholder={ph(inherit?.notice.lateChangeHours) ?? t('workRules.off')} disabled={pay} />
          <Field label={t('workRules.notice.kind')}>
            {(p) => (
              <Select {...p} disabled={pay} value={v.notice?.premiumKind ?? ''} onChange={(e) => set('notice', { premiumKind: (e.target.value || undefined) as 'multiplier' | 'flat' })}>
                {inherit ? <option value="">{t('workRules.inheritChoice', { value: t(`workRules.notice.kinds.${inherit.notice.premiumKind}`) })}</option> : null}
                <option value="multiplier">{t('workRules.notice.kinds.multiplier')}</option>
                <option value="flat">{t('workRules.notice.kinds.flat')}</option>
              </Select>
            )}
          </Field>
          {(v.notice?.premiumKind ?? inherit?.notice.premiumKind ?? 'multiplier') === 'multiplier' ? (
            <Num label={t('workRules.notice.multiplier')} hint={t('workRules.notice.multiplierHelp')} value={v.notice?.multiplier} onChange={(n) => set('notice', { multiplier: n ?? undefined })} min={1} max={3} placeholder={ph(inherit?.notice.multiplier)} disabled={pay} />
          ) : (
            <Num label={t('workRules.notice.flat')} value={v.notice?.flatAmount} onChange={(n) => set('notice', { flatAmount: n ?? undefined })} min={0} max={1000} placeholder={ph(inherit?.notice.flatAmount)} disabled={pay} />
          )}
        </div>
      </Section>
      <Section title={t('workRules.standby.title')}>
        <p className="text-caption text-muted">{t('workRules.standby.help')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Num label={t('workRules.standby.perDay')} value={v.standby?.perDay} onChange={(n) => set('standby', { perDay: n })} min={0} max={1000} placeholder={ph(inherit?.standby.perDay) ?? t('workRules.off')} disabled={pay} />
          <Num label={t('workRules.standby.hoursPerDay')} hint={t('workRules.standby.hoursPerDayHelp')} value={v.standby?.hoursPerDay} onChange={(n) => set('standby', { hoursPerDay: n })} min={0} max={24} placeholder={ph(inherit?.standby.hoursPerDay) ?? t('workRules.off')} disabled={pay} />
          <Num label={t('workRules.standby.percent')} value={v.standby?.percent} onChange={(n) => set('standby', { percent: n })} min={0} max={200} placeholder={ph(inherit?.standby.percent) ?? t('workRules.off')} disabled={pay} />
          <Num label={t('workRules.standby.callbackMin')} hint={t('workRules.standby.callbackMinHelp')} value={v.standby?.callbackMinHours} onChange={(n) => set('standby', { callbackMinHours: n })} min={0} max={8} placeholder={ph(inherit?.standby.callbackMinHours)} disabled={pay} />
          <Num label={t('workRules.standby.callbackMultiplier')} value={v.standby?.callbackMultiplier} onChange={(n) => set('standby', { callbackMultiplier: n ?? undefined })} min={1} max={3} placeholder={ph(inherit?.standby.callbackMultiplier)} disabled={pay} />
        </div>
      </Section>
    </div>
  );
}

function ProvinceCard({ data }: { data: WorkRulesView }) {
  const { t } = useTranslation();
  const rows = [...data.provinces, { province: 'FED', ...data.federal }];
  return (
    <Card>
      <CardHeader title={t('workRules.law.title')} description={t('workRules.law.help')} />
      <CardBody className="pt-1">
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.province} className="grid gap-1 py-3 text-small sm:grid-cols-[6rem_1fr_1fr] sm:gap-4">
              <span className="font-semibold">{t(`workRules.law.jurisdiction.${r.province}`, { defaultValue: r.province })}</span>
              <span>
                {r.mealBreak ? t(r.mealBreak.everyHours ? 'workRules.law.breakEvery' : 'workRules.law.break', { minutes: r.mealBreak.minutes, hours: r.mealBreak.afterHours }) : t('workRules.law.noBreak')}
                {r.mealBreak ? <span className="block text-caption text-muted">{r.mealBreak.source}</span> : null}
              </span>
              <span>
                {r.reportingPay ? (r.reportingPay.longShiftMinHours ? t('workRules.law.callInLong', { hours: r.reportingPay.minHours, long: r.reportingPay.longShiftMinHours, over: r.reportingPay.longShiftOverHours }) : t('workRules.law.callIn', { hours: r.reportingPay.minHours })) : t('workRules.law.noCallIn')}
                {r.reportingPay ? <span className="block text-caption text-muted">{r.reportingPay.source}</span> : null}
                {r.mealBreak?.counselVerify || r.reportingPay?.counselVerify ? <StatusPill tone="warn" className="mt-1">{t('workRules.law.counsel')}</StatusPill> : null}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

const DAYS = [0, 1, 2, 3, 4, 5, 6];

function PremiumDialog({ rule, open, onClose, onSave, data }: { rule: PremiumRule | null; open: boolean; onClose: () => void; onSave: (r: PremiumRule) => void; data: WorkRulesView }) {
  const { t, i18n } = useTranslation();
  const [r, setR] = useState<PremiumRule | null>(rule);
  const [unit, setUnit] = useState<'perHour' | 'percent'>(rule?.percent ? 'percent' : 'perHour');
  useEffect(() => {
    setR(rule);
    setUnit(rule?.percent ? 'percent' : 'perHour');
  }, [rule]);
  if (!r) return null;
  const dow = (d: number) => dateFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + d)));
  const label = (x: { name: string; nameFr: string | null }) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const amount = unit === 'percent' ? r.percent : r.perHour;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('workRules.premiums.edit')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => onSave({ ...r, perHour: unit === 'perHour' ? r.perHour : null, percent: unit === 'percent' ? r.percent : null })} disabled={!r.name.trim() || !amount}>{t('workRules.done')}</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t('workRules.premiums.name')}>{(p) => <Input {...p} value={r.name} maxLength={80} onChange={(e) => setR({ ...r, name: e.target.value })} />}</Field>
        <Field label={t('workRules.premiums.nameFr')}>{(p) => <Input {...p} lang="fr" value={r.nameFr ?? ''} maxLength={80} onChange={(e) => setR({ ...r, nameFr: e.target.value || null })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('workRules.premiums.from')}>{(p) => <Input {...p} type="time" value={clock(r.startMinute)} onChange={(e) => setR({ ...r, ...windowMinutes(e.target.value, clock(r.endMinute)) })} />}</Field>
          <Field label={t('workRules.premiums.to')} hint={r.endMinute > 1440 ? t('workRules.premiums.pastMidnight') : undefined}>{(p) => <Input {...p} type="time" value={clock(r.endMinute % 1440 === 0 && r.endMinute > 0 ? 0 : r.endMinute)} onChange={(e) => setR({ ...r, ...windowMinutes(clock(r.startMinute), e.target.value) })} />}</Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-small font-semibold">{t('workRules.premiums.days')}</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <label key={d} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3 text-small font-semibold ${r.days.includes(d) ? 'border-brand bg-brand/10 text-brand-text' : 'border-line text-muted'}`}>
                <input type="checkbox" className="sr-only" checked={r.days.includes(d)} onChange={(e) => setR({ ...r, days: e.target.checked ? [...r.days, d].sort() : r.days.filter((x) => x !== d) })} />
                {dow(d)}
              </label>
            ))}
          </div>
          <p className="text-caption text-muted">{t('workRules.premiums.daysHelp')}</p>
        </fieldset>
        <Check checked={r.holidaysOnly} onChange={(c) => setR({ ...r, holidaysOnly: c })} label={t('workRules.premiums.holidaysOnly')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('workRules.premiums.unit')}>
            {(p) => (
              <Select {...p} value={unit} onChange={(e) => setUnit(e.target.value as 'perHour' | 'percent')}>
                <option value="perHour">{t('workRules.premiums.perHour')}</option>
                <option value="percent">{t('workRules.premiums.percent')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('workRules.premiums.amount')}>{(p) => <Input {...p} type="number" inputMode="decimal" min={0} step="any" value={amount ?? ''} onChange={(e) => setR({ ...r, [unit]: numOrNull(e.target.value) })} />}</Field>
        </div>
        <Field label={t('workRules.premiums.departments')} hint={t('workRules.premiums.allHelp')}>
          {(p) => (
            <Select {...p} value={r.departmentIds[0] ?? ''} onChange={(e) => setR({ ...r, departmentIds: e.target.value ? [e.target.value] : [] })}>
              <option value="">{t('workRules.premiums.allDepartments')}</option>
              {data.departments.map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('workRules.premiums.position')}>
          {(p) => (
            <Select {...p} value={r.positionIds[0] ?? ''} onChange={(e) => setR({ ...r, positionIds: e.target.value ? [e.target.value] : [] })}>
              <option value="">{t('workRules.premiums.allPositions')}</option>
              {data.positions.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function PremiumsCard({ data, reload }: { data: WorkRulesView; reload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const [list, setList] = useState(data.organization.premiums);
  const [editing, setEditing] = useState<PremiumRule | null>(null);
  useEffect(() => setList(data.organization.premiums), [data]);
  const dow = (d: number) => dateFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + d)));
  const add = (kind: PremiumKind) => {
    const base = kind === 'custom' ? { ...PREMIUM_PRESETS.evening, kind } : PREMIUM_PRESETS[kind];
    setEditing({ ...base, id: `${kind}-${Date.now().toString(36)}`, name: t(`workRules.premiums.kinds.${kind}`), nameFr: null });
  };
  const save = (next: PremiumRule[]) => void run('premiums', () => api('/api/schedule/work-rules', { method: 'PUT', body: { premiums: next } }), t('workRules.saved')).then(reload);
  const name = (r: PremiumRule) => (i18n.language === 'fr-CA' && r.nameFr ? r.nameFr : r.name);
  return (
    <Card>
      <CardHeader title={t('workRules.premiums.title')} description={t('workRules.premiums.help')} />
      <CardBody className="grid gap-4 pt-1">
        {list.length ? (
          <ul className="divide-y divide-line">
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-small">
                <div className="min-w-0">
                  <p className="font-semibold">{name(r)} {r.active ? null : <StatusPill tone="neutral">{t('workRules.premiums.inactive')}</StatusPill>}</p>
                  <p className="text-caption text-muted">
                    {`${clock(r.startMinute)}–${clock(r.endMinute)}`} · {r.days.length ? r.days.map(dow).join(', ') : t('workRules.premiums.everyDay')}
                    {r.holidaysOnly ? ` · ${t('workRules.premiums.holidaysOnly')}` : ''} · {r.percent ? t('workRules.premiums.showPercent', { n: r.percent }) : t('workRules.premiums.showPerHour', { n: r.perHour })}
                  </p>
                </div>
                {data.canConfigure ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>{t('common.edit')}</Button>
                    <Button size="sm" variant="ghost" aria-label={t('workRules.premiums.remove', { name: name(r) })} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => save(list.filter((x) => x.id !== r.id))} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted">{t('workRules.premiums.none')}</p>
        )}
        {data.canConfigure ? (
          <div className="flex flex-wrap gap-2">
            {(['evening', 'night', 'weekend', 'holiday', 'custom'] as const).map((k) => (
              <Button key={k} size="sm" variant="secondary" loading={busy === 'premiums'} icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => add(k)}>{t(`workRules.premiums.kinds.${k}`)}</Button>
            ))}
          </div>
        ) : null}
        <p className="text-caption text-muted">{t('workRules.premiums.manualNote')}</p>
        <PremiumDialog
          rule={editing}
          open={!!editing}
          data={data}
          onClose={() => setEditing(null)}
          onSave={(r) => {
            const next = list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r];
            setEditing(null);
            save(next);
          }}
        />
      </CardBody>
    </Card>
  );
}

function DepartmentCard({ data, reload }: { data: WorkRulesView; reload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const [id, setId] = useState(data.departments[0]?.id ?? '');
  const d = data.departments.find((x) => x.id === id);
  const [own, setOwn] = useState<DepartmentRules>(d?.own ?? {});
  const [limits, setLimits] = useState<{ maxConsecutiveDays?: number | null; maxDailyHours?: number | null }>(d?.limits ?? {});
  const [federal, setFederal] = useState<boolean | null>(d?.federallyRegulated ?? null);
  useEffect(() => {
    setOwn(d?.own ?? {});
    setLimits(d?.limits ?? {});
    setFederal(d?.federallyRegulated ?? null);
  }, [d]);
  if (!data.departments.length) return null;
  const label = (x: { name: string; nameFr: string | null }) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const configure = data.canConfigure;
  async function save() {
    // Drop blanks so they fall back to the organization's.
    const clean = <T extends Record<string, unknown>>(o?: T) => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')) : undefined);
    const body = configure ? { breaks: clean(own.breaks), callIn: clean(own.callIn), notice: clean(own.notice), standby: clean(own.standby) } : { breaks: clean(own.breaks) };
    const ok = await run('dept', async () => {
      await api(`/api/schedule/work-rules/departments/${id}`, { method: 'PUT', body: { reset: true } }).catch(() => undefined);
      await api(`/api/schedule/work-rules/departments/${id}`, { method: 'PUT', body });
      if (configure) {
        const l = clean(limits);
        await api('/api/schedule/fill/settings', { method: 'PUT', body: { departmentId: id, ...(l && Object.keys(l).length ? { limits: l } : {}), federallyRegulated: federal } });
      }
    }, t('workRules.saved'));
    if (ok !== undefined) await reload();
  }
  return (
    <Card>
      <CardHeader title={t('workRules.department.title')} description={t('workRules.department.help')} />
      <CardBody className="grid gap-5 pt-1">
        <Field label={t('workRules.department.choose')}>
          {(p) => (
            <Select {...p} value={id} onChange={(e) => setId(e.target.value)}>
              {data.departments.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
            </Select>
          )}
        </Field>
        {d ? (
          <>
            <RulesForm value={own} onChange={(v) => setOwn(v as DepartmentRules)} inherit={data.organization} payDisabled={!configure} />
            <Section title={t('workRules.department.limits')}>
              <p className="text-caption text-muted">{t('workRules.department.limitsHelp')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Num label={t('fill.settings.maxDays')} value={limits.maxConsecutiveDays} onChange={(n) => setLimits({ ...limits, maxConsecutiveDays: n })} min={1} max={12} step="1" placeholder={t('workRules.inherit', { value: data.organizationLimits.maxConsecutiveDays })} disabled={!configure} />
                <Num label={t('fill.settings.maxHours')} value={limits.maxDailyHours} onChange={(n) => setLimits({ ...limits, maxDailyHours: n })} min={4} max={24} placeholder={t('workRules.inherit', { value: data.organizationLimits.maxDailyHours })} disabled={!configure} />
                <Field label={t('fill.settings.federal')} hint={t('fill.settings.federalHelp')}>
                  {(p) => (
                    <Select {...p} disabled={!configure} value={federal === null ? '' : String(federal)} onChange={(e) => setFederal(e.target.value === '' ? null : e.target.value === 'true')}>
                      <option value="">{t('workRules.inheritChoice', { value: data.organizationFederal ? t('workRules.yes') : t('workRules.no') })}</option>
                      <option value="true">{t('workRules.yes')}</option>
                      <option value="false">{t('workRules.no')}</option>
                    </Select>
                  )}
                </Field>
              </div>
              <p className="text-caption text-muted">{t('workRules.department.effective', { days: d.effectiveLimits.maxConsecutiveDays, hours: d.effectiveLimits.maxDailyHours, federal: d.effectiveFederal ? t('workRules.yes') : t('workRules.no') })}</p>
            </Section>
            {!configure ? <p className="text-caption text-muted">{t('workRules.department.onlyBreaks')}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button loading={busy === 'dept'} onClick={() => void save()}>{t('common.save')}</Button>
              {configure ? <Button variant="ghost" loading={busy === 'reset'} onClick={() => void run('reset', () => api(`/api/schedule/work-rules/departments/${id}`, { method: 'PUT', body: { reset: true } }), t('workRules.saved')).then(reload)}>{t('workRules.department.reset')}</Button> : null}
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

function PositionsCard({ data, reload }: { data: WorkRulesView; reload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const [edits, setEdits] = useState<Record<string, { unpaidBreakMinutes: number | null; neverAlone: boolean }>>({});
  if (!data.positions.length) return null;
  const label = (x: { name: string; nameFr: string | null }) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  return (
    <Card>
      <CardHeader title={t('workRules.positions.title')} description={t('workRules.positions.help')} />
      <CardBody className="pt-1">
        <ul className="divide-y divide-line">
          {data.positions.map((p) => {
            const e = edits[p.id] ?? { unpaidBreakMinutes: p.unpaidBreakMinutes, neverAlone: p.neverAlone };
            const dirty = e.unpaidBreakMinutes !== p.unpaidBreakMinutes || e.neverAlone !== p.neverAlone;
            return (
              <li key={p.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_9rem_auto_auto] sm:items-end">
                <p className="text-small font-semibold sm:self-center">{label(p)}</p>
                <Num label={t('workRules.positions.break')} value={e.unpaidBreakMinutes} onChange={(n) => setEdits({ ...edits, [p.id]: { ...e, unpaidBreakMinutes: n } })} min={0} max={240} step="5" placeholder={t('workRules.positions.noBreak')} />
                <Check checked={e.neverAlone} onChange={(c) => setEdits({ ...edits, [p.id]: { ...e, neverAlone: c } })} label={t('workRules.positions.neverAlone')} />
                <Button size="sm" variant="secondary" disabled={!dirty} loading={busy === p.id} onClick={() => void run(p.id, () => api(`/api/schedule/work-rules/positions/${p.id}`, { method: 'PATCH', body: e }), t('workRules.saved')).then(reload)}>{t('common.save')}</Button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-caption text-muted">{t('workRules.positions.foot')}</p>
      </CardBody>
    </Card>
  );
}

function LateChangesCard({ canWaive }: { canWaive: boolean }) {
  const { t, i18n } = useTranslation();
  const [range] = useState(() => ({ from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() }));
  const q = useQuery<LateChange[]>(`/api/schedule/changes?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
  const { run, busy } = useAction();
  const fmt = (iso: string | null) => (iso ? formatLocal(iso, i18n.language, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  return (
    <Card>
      <CardHeader title={t('workRules.changes.title')} description={t('workRules.changes.help')} />
      <CardBody className="pt-1">
        {!q.data ? (
          <Skeleton className="h-20" />
        ) : !q.data.length ? (
          <p className="text-small text-muted">{t('workRules.changes.none')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-small">
                <div className="min-w-0">
                  <p className="font-semibold">{c.person} · {t(`workRules.changes.kind.${c.kind}`)}</p>
                  <p className="text-caption text-muted">
                    {c.facility} · {c.oldStartsAt ? fmt(c.oldStartsAt) : ''}{c.oldStartsAt && c.newStartsAt ? ' → ' : ''}{c.newStartsAt ? fmt(c.newStartsAt) : ''}
                  </p>
                  <p className="text-caption text-muted">{t('workRules.changes.notice', { hours: c.noticeHours, required: c.requiredHours ?? 0 })}{c.premiumHours ? ` · ${t('workRules.changes.premiumHours', { hours: c.premiumHours, m: c.multiplier })}` : ''}{c.flatAmount ? ` · ${t('workRules.changes.flat', { amount: c.flatAmount })}` : ''}</p>
                </div>
                {c.waived ? (
                  <StatusPill tone="neutral">{t('workRules.changes.waived')}</StatusPill>
                ) : canWaive && (c.premiumHours || c.flatAmount) ? (
                  <Button size="sm" variant="ghost" loading={busy === c.id} onClick={() => void run(c.id, () => api(`/api/schedule/changes/${c.id}/waive`, { method: 'POST', body: { reason: t('workRules.changes.waiveReason') } }), t('workRules.changes.waivedToast')).then(() => q.reload())}>{t('workRules.changes.waive')}</Button>
                ) : (
                  <StatusPill tone="warn">{t('workRules.changes.due')}</StatusPill>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Work rules: what the law asks, the organization's rules, departments' agreements, positions, late changes. */
export default function WorkRulesPage() {
  const { t } = useTranslation();
  const q = useQuery<WorkRulesView>('/api/schedule/work-rules');
  const { run, busy } = useAction();
  const [org, setOrg] = useState<OrgRules | null>(null);
  useEffect(() => {
    if (q.data) setOrg(q.data.organization);
  }, [q.data]);
  if (q.error) return <EmptyState icon={BookOpenCheck} title={t('common.error')} level={1} />;
  if (!q.data || !org) return <Skeleton className="h-96" />;
  const data = q.data;
  return (
    <div className="grid gap-6">
      <PageHeader title={t('workRules.title')} description={t('workRules.description')} />
      <ProvinceCard data={data} />
      <Card>
        <CardHeader title={t('workRules.org.title')} description={t('workRules.org.help')} />
        <CardBody className="grid gap-5 pt-1">
          <RulesForm value={org} onChange={(v) => setOrg(v as OrgRules)} disabled={!data.canConfigure} />
          {data.canConfigure ? (
            <Button className="justify-self-start" loading={busy === 'org'} onClick={() => void run('org', () => api('/api/schedule/work-rules', { method: 'PUT', body: { breaks: org.breaks, callIn: org.callIn, notice: org.notice, standby: org.standby } }), t('workRules.saved')).then(() => q.reload())}>
              {t('common.save')}
            </Button>
          ) : null}
        </CardBody>
      </Card>
      <PremiumsCard data={data} reload={q.reload} />
      <DepartmentCard data={data} reload={q.reload} />
      <PositionsCard data={data} reload={q.reload} />
      <LateChangesCard canWaive={data.canConfigure} />
    </div>
  );
}
