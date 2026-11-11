'use client';

import { CalendarCog, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';
import { type Crew, type GenerateResult, type PatternDay, type PresetKey, type RotationTemplate, type RotationsView, cycleGrid, numOrNull } from '@/lib/workRules';

interface Named { id: string; name: string; nameFr: string | null }
interface Person { id: string; name: string; status: string; positions: Array<{ id: string }> }

const plus = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const CELL: Record<string, string> = {
  day: 'bg-brand/15 text-brand-text',
  evening: 'bg-accent/20 text-ink',
  night: 'bg-ink/80 text-panel',
  off: 'bg-surface text-muted',
};

/** One row per crew, one square per day of the cycle. */
export function CycleGrid({ t: tpl }: { t: Pick<RotationTemplate, 'cycleDays' | 'pattern' | 'crews'> }) {
  const { t } = useTranslation();
  const rows = cycleGrid(tpl);
  return (
    <div className="max-w-full overflow-x-auto" role="table" aria-label={t('rotations.gridLabel')}>
      <div className="grid w-max gap-1" role="rowgroup">
        {rows.map((r) => (
          <div key={r.crew} className="flex items-center gap-1" role="row">
            <span className="w-14 shrink-0 truncate text-caption font-semibold" role="rowheader">{t('rotations.crewName', { name: r.crew })}</span>
            {r.days.map((d, i) => (
              <span key={i} role="cell" title={`${t('rotations.dayN', { n: i + 1 })}: ${t(`rotations.label.${d ?? 'day'}`)}`} className={`grid h-6 w-6 place-items-center rounded text-[0.65rem] font-semibold ${CELL[d ?? 'day']}`}>
                {d === 'off' ? null : t(`rotations.short.${d ?? 'day'}`)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Editor({ open, onClose, initial, presets, facilities, positions, departments, people, onSaved }: { open: boolean; onClose: () => void; initial: RotationTemplate | null; presets: RotationsView['presets']; facilities: Named[]; positions: Array<Named & { departmentId: string | null }>; departments: Named[]; people: Person[]; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const blank = (): Omit<RotationTemplate, 'id'> => ({ name: '', departmentId: null, facilityId: facilities[0]?.id ?? '', positionId: positions[0]?.id ?? '', cycleDays: presets[0]!.cycleDays, anchorDate: today(), pattern: presets[0]!.pattern, crews: presets[0]!.crews, unpaidBreakMinutes: 30, active: true });
  const [v, setV] = useState<Omit<RotationTemplate, 'id'>>(initial ?? blank());
  useEffect(() => setV(initial ?? blank()), [initial, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = (x: { name: string; nameFr: string | null }) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const qualified = people.filter((p) => p.status === 'ACTIVE' && p.positions.some((x) => x.id === v.positionId));
  const setPattern = (i: number, patch: Partial<PatternDay>) => setV({ ...v, pattern: v.pattern.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const setCrew = (i: number, patch: Partial<Crew>) => setV({ ...v, crews: v.crews.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const save = () =>
    void run('save', () => api(initial ? `/api/schedule/rotations/${(initial as RotationTemplate).id}` : '/api/schedule/rotations', { method: initial ? 'PUT' : 'POST', body: { ...v, departmentId: positions.find((p) => p.id === v.positionId)?.departmentId ?? null } }), t('rotations.saved')).then((r) => {
      if (r !== undefined) {
        onSaved();
        onClose();
      }
    });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? t('rotations.edit') : t('rotations.new')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={busy === 'save'} disabled={v.name.trim().length < 2 || !v.pattern.length} onClick={save}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="grid gap-4">
        {!initial ? (
          <Field label={t('rotations.preset')} hint={t('rotations.presetHelp')}>
            {(p) => (
              <Select {...p} defaultValue={presets[0]!.key} onChange={(e) => {
                const pr = presets.find((x) => x.key === (e.target.value as PresetKey))!;
                setV({ ...v, cycleDays: pr.cycleDays, pattern: pr.pattern, crews: pr.crews, name: v.name || t(`rotations.presets.${pr.key}`) });
              }}>
                {presets.map((x) => <option key={x.key} value={x.key}>{t(`rotations.presets.${x.key}`)}</option>)}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label={t('rotations.name')}>{(p) => <Input {...p} value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('rotations.facility')}>{(p) => <Select {...p} value={v.facilityId} onChange={(e) => setV({ ...v, facilityId: e.target.value })}>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
          <Field label={t('rotations.position')} hint={departments.find((d) => d.id === positions.find((p) => p.id === v.positionId)?.departmentId) ? label(departments.find((d) => d.id === positions.find((p) => p.id === v.positionId)?.departmentId)!) : undefined}>
            {(p) => <Select {...p} value={v.positionId} onChange={(e) => setV({ ...v, positionId: e.target.value, crews: v.crews.map((c) => ({ ...c, userIds: [] })) })}>{positions.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</Select>}
          </Field>
          <Field label={t('rotations.anchor')} hint={t('rotations.anchorHelp')}>{(p) => <Input {...p} type="date" value={v.anchorDate} onChange={(e) => setV({ ...v, anchorDate: e.target.value })} />}</Field>
          <Field label={t('rotations.cycleDays')} hint={t('rotations.cycleDaysHelp')}>{(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={84} value={v.cycleDays} onChange={(e) => setV({ ...v, cycleDays: Math.max(1, Math.min(84, Number(e.target.value) || 1)), pattern: v.pattern.filter((x) => x.day < (Number(e.target.value) || 1)) })} />}</Field>
          <Field label={t('rotations.break')}>{(p) => <Input {...p} type="number" inputMode="numeric" min={0} max={240} step={5} value={v.unpaidBreakMinutes ?? ''} onChange={(e) => setV({ ...v, unpaidBreakMinutes: numOrNull(e.target.value) })} />}</Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-small font-semibold">{t('rotations.pattern')}</legend>
          <p className="text-caption text-muted">{t('rotations.patternHelp')}</p>
          {v.pattern.map((p, i) => (
            <div key={i} className="grid grid-cols-[4.5rem_1fr_1fr_auto] items-end gap-2">
              <Field label={t('rotations.day')}>{(f) => <Select {...f} value={p.day} onChange={(e) => setPattern(i, { day: Number(e.target.value) })}>{Array.from({ length: v.cycleDays }, (_, d) => <option key={d} value={d}>{d + 1}</option>)}</Select>}</Field>
              <Field label={t('rotations.start')}>{(f) => <Input {...f} type="time" value={p.start} onChange={(e) => setPattern(i, { start: e.target.value })} />}</Field>
              <Field label={t('rotations.end')}>{(f) => <Input {...f} type="time" value={p.end} onChange={(e) => setPattern(i, { end: e.target.value, label: e.target.value <= p.start ? 'night' : p.label === 'night' ? 'day' : p.label })} />}</Field>
              <Button variant="ghost" size="sm" aria-label={t('rotations.removeDay', { n: p.day + 1 })} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setV({ ...v, pattern: v.pattern.filter((_, k) => k !== i) })} />
            </div>
          ))}
          <Button size="sm" variant="secondary" className="justify-self-start" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setV({ ...v, pattern: [...v.pattern, { day: Math.min(v.cycleDays - 1, (v.pattern.at(-1)?.day ?? -1) + 1), start: v.pattern.at(-1)?.start ?? '07:00', end: v.pattern.at(-1)?.end ?? '19:00', label: v.pattern.at(-1)?.label ?? 'day' }] })}>{t('rotations.addDay')}</Button>
        </fieldset>
        <fieldset className="grid gap-3">
          <legend className="text-small font-semibold">{t('rotations.crews')}</legend>
          <p className="text-caption text-muted">{t('rotations.crewsHelp')}</p>
          {v.crews.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-2xl border border-line p-3">
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <Field label={t('rotations.crew')}>{(f) => <Input {...f} value={c.name} maxLength={40} onChange={(e) => setCrew(i, { name: e.target.value })} />}</Field>
                <Field label={t('rotations.offset')}>{(f) => <Input {...f} type="number" inputMode="numeric" min={0} max={83} value={c.offsetDays} onChange={(e) => setCrew(i, { offsetDays: Number(e.target.value) || 0 })} />}</Field>
                <Field label={t('rotations.openSlots')}>{(f) => <Input {...f} type="number" inputMode="numeric" min={0} max={20} value={c.openSlots} onChange={(e) => setCrew(i, { openSlots: Number(e.target.value) || 0 })} />}</Field>
                <Button variant="ghost" size="sm" disabled={v.crews.length < 2} aria-label={t('rotations.removeCrew', { name: c.name })} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setV({ ...v, crews: v.crews.filter((_, k) => k !== i) })} />
              </div>
              <Field label={t('rotations.people')}>
                {(f) => <MultiSelect key={`${v.positionId}-${i}`} id={f.id} name={`crew-${i}`} options={qualified.map((p) => ({ value: p.id, label: p.name }))} defaultValue={c.userIds} placeholder={t('rotations.pickPeople')} onChange={(ids) => setCrew(i, { userIds: ids })} />}
              </Field>
            </div>
          ))}
          <Button size="sm" variant="secondary" className="justify-self-start" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setV({ ...v, crews: [...v.crews, { name: String.fromCharCode(65 + v.crews.length), offsetDays: 0, userIds: [], openSlots: 0 }] })}>{t('rotations.addCrew')}</Button>
        </fieldset>
        <CycleGrid t={v} />
      </div>
    </Dialog>
  );
}

/** "Generate shifts" from the active templates for a range: preview the counts, then create the drafts. */
export function GeneratePanel({ templateIds, departmentId, from: from0, to: to0, onDone }: { templateIds?: string[]; departmentId?: string; from?: string; to?: string; onDone?: (r: GenerateResult) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [from, setFrom] = useState(from0 ?? today());
  const [to, setTo] = useState(to0 ?? plus(today(), 14));
  const [preview, setPreview] = useState<GenerateResult | null>(null);
  const [done, setDone] = useState<GenerateResult | null>(null);
  const body = { templateIds, departmentId, from, to };
  useEffect(() => {
    setPreview(null);
    setDone(null);
  }, [from, to]);
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('rotations.from')}>{(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label={t('rotations.to')} hint={t('rotations.toHelp')}>{(p) => <Input {...p} type="date" value={to} min={plus(from, 1)} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
      {preview && !done ? <p className="text-small" role="status">{t('rotations.previewCounts', { create: preview.items.filter((i) => i.status !== 'existing' && i.status !== 'holiday').length, existing: preview.existing, holidays: preview.holidays })}</p> : null}
      {done ? (
        <p className="text-small" role="status">
          {t('rotations.doneCounts', { created: done.created, assigned: done.assigned, open: done.open })}
          {done.items.some((i) => i.reason && i.reason !== 'BEYOND_PLAN_AHEAD') ? <span className="block text-caption text-muted">{t('rotations.someOpen')}</span> : null}
          {done.items.some((i) => i.reason === 'BEYOND_PLAN_AHEAD') ? <span className="block text-caption text-muted">{t('rotations.beyondPlanAhead')}</span> : null}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy === 'preview'} onClick={() => void run('preview', () => api<GenerateResult>('/api/schedule/rotations/generate', { method: 'POST', body: { ...body, dryRun: true } })).then((r) => r && setPreview(r))}>{t('rotations.preview')}</Button>
        <Button loading={busy === 'gen'} icon={<CalendarCog className="h-4 w-4" aria-hidden="true" />} onClick={() => void run('gen', () => api<GenerateResult>('/api/schedule/rotations/generate', { method: 'POST', body })).then((r) => {
          if (r) {
            setDone(r);
            onDone?.(r);
          }
        })}>{t('rotations.generate')}</Button>
      </div>
    </div>
  );
}

/** Rotation templates: patterns people work in turn, and "Generate shifts" from them. */
export function Rotations() {
  const { t, i18n } = useTranslation();
  const q = useQuery<RotationsView>('/api/schedule/rotations');
  const facilities = useQuery<Named[]>('/api/facilities');
  const positions = useQuery<Array<Named & { departmentId: string | null }>>('/api/positions');
  const departments = useQuery<{ departments: Named[] }>('/api/departments');
  const people = useQuery<Person[]>('/api/users?status=ACTIVE');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<RotationTemplate | null | 'new'>(null);
  const [generating, setGenerating] = useState<RotationTemplate | 'all' | null>(null);
  const label = (x: { name: string; nameFr: string | null }) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const ready = q.data && facilities.data && positions.data;
  const deptList = useMemo(() => departments.data?.departments ?? [], [departments.data]);
  if (!ready) return <Skeleton className="h-64" />;
  const pos = (id: string) => positions.data!.find((p) => p.id === id);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('rotations.new')}</Button>
        {q.data!.templates.length ? <Button variant="secondary" icon={<CalendarCog className="h-4 w-4" aria-hidden="true" />} onClick={() => setGenerating('all')}>{t('rotations.generateAll')}</Button> : null}
      </div>
      {!q.data!.templates.length ? (
        <EmptyState icon={CalendarCog} title={t('rotations.none')}>{t('rotations.noneHelp')}</EmptyState>
      ) : (
        q.data!.templates.map((tpl) => (
          <Card key={tpl.id}>
            <CardHeader
              title={tpl.name}
              description={`${pos(tpl.positionId) ? label(pos(tpl.positionId)!) : ''} · ${facilities.data!.find((f) => f.id === tpl.facilityId)?.name ?? ''} · ${t('rotations.cycleOf', { count: tpl.cycleDays })}`}
              action={tpl.active ? null : <StatusPill tone="neutral">{t('rotations.inactive')}</StatusPill>}
            />
            <CardBody className="grid gap-3 pt-1">
              <CycleGrid t={tpl} />
              <p className="text-caption text-muted">{tpl.crews.map((c) => t('rotations.crewSummary', { name: c.name, count: c.userIds.length, open: c.openSlots })).join(' · ')}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setGenerating(tpl)} icon={<CalendarCog className="h-4 w-4" aria-hidden="true" />}>{t('rotations.generate')}</Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(tpl)}>{t('common.edit')}</Button>
                <Button size="sm" variant="ghost" loading={busy === tpl.id} onClick={() => void run(tpl.id, () => api(`/api/schedule/rotations/${tpl.id}`, { method: 'DELETE' }), t('rotations.deleted')).then(() => q.reload())}>{t('rotations.delete')}</Button>
              </div>
            </CardBody>
          </Card>
        ))
      )}
      <Editor open={editing !== null} onClose={() => setEditing(null)} initial={editing === 'new' ? null : editing} presets={q.data!.presets} facilities={facilities.data!} positions={positions.data!} departments={deptList} people={people.data ?? []} onSaved={() => void q.reload()} />
      <Dialog open={generating !== null} onClose={() => setGenerating(null)} title={t('rotations.generateTitle')} description={t('rotations.generateHelp')} closeLabel={t('common.close')}>
        {generating ? <GeneratePanel templateIds={generating === 'all' ? undefined : [generating.id]} /> : null}
      </Dialog>
    </div>
  );
}
