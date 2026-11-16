'use client';

import { CalendarPlus, ChevronLeft, Layers, Pencil, Plus, Send, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { type Campaign, type LessonSet, PATTERNS, type SwimLevel, addDaysIso, ageRange, campaignBody, cents, hhmm, levelBody, money, toLocalDateTime, toMinutes } from '@/lib/programs';
import { useAction, useQuery } from '@/lib/useQuery';
import { dateFormat, formatInstant } from '@/lib/format';

const STATUS_TONE: Record<Campaign['status'], Tone> = { DRAFT: 'pending', PUBLISHED: 'ok', CLOSED: 'warn' };
const DOW = [0, 1, 2, 3, 4, 5, 6];
const KINDS = ['LESSONS', 'SWIM_CLUB', 'CAMP', 'OTHER'] as const;

/** Planners at any facility (pool, arena, community centre) plan lessons, clubs and camps: levels, campaigns, sets. */
export default function ProgramsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Programs />
    </Suspense>
  );
}

function Programs() {
  const { t } = useTranslation();
  const id = useSearchParams().get('id');
  const [tab, setTab] = useState<'campaigns' | 'levels'>('campaigns');
  if (id) return <CampaignDetail id={id} />;
  return (
    <div className="grid gap-6">
      <PageHeader title={t('programs.title')} description={t('programs.description')} />
      <div className="max-w-xs"><Segmented label={t('programs.title')} value={tab} onChange={setTab} options={[{ value: 'campaigns', label: t('programs.campaigns') }, { value: 'levels', label: t('programs.levels') }]} /></div>
      {tab === 'campaigns' ? <Campaigns /> : <Levels />}
    </div>
  );
}

/** The campaign's details, for a new campaign or an edit (French name included, for families signing up in French). */
function CampaignFields({ c }: { c?: Campaign }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('programs.campaignName')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={80} placeholder={t('programs.campaignPlaceholder')} defaultValue={c?.name} />}</Field>
        <Field label={t('programs.campaignNameFr')} hint={t('common.optional')}>{(p) => <Input {...p} name="nameFr" maxLength={80} lang="fr-CA" defaultValue={c?.nameFr ?? ''} />}</Field>
      </div>
      <Field label={t('programs.kindLabel')}>{(p) => <Select {...p} name="kind" defaultValue={c?.kind ?? 'LESSONS'}>{KINDS.map((k) => <option key={k} value={k}>{t(`programs.kind.${k}`)}</option>)}</Select>}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('programs.startsOn')}>{(p) => <Input {...p} name="startsOn" type="date" required defaultValue={c?.startsOn} />}</Field>
        <Field label={t('programs.endsOn')}>{(p) => <Input {...p} name="endsOn" type="date" required defaultValue={c?.endsOn} />}</Field>
        <Field label={t('programs.regOpens')} hint={t('common.optional')}>{(p) => <Input {...p} name="opens" type="datetime-local" defaultValue={toLocalDateTime(c?.registrationOpensAt ?? null)} />}</Field>
        <Field label={t('programs.regCloses')} hint={t('common.optional')}>{(p) => <Input {...p} name="closes" type="datetime-local" defaultValue={toLocalDateTime(c?.registrationClosesAt ?? null)} />}</Field>
      </div>
      <Field label={t('programs.skip')} hint={t('programs.skipHint')}>{(p) => <Input {...p} name="skip" placeholder="2027-02-16, 2027-04-02" defaultValue={c?.skipDates.join(', ')} />}</Field>
      <Field label={t('programs.notes')} hint={t('common.optional')}>{(p) => <Textarea {...p} name="notes" maxLength={1000} rows={2} defaultValue={c?.notes ?? ''} />}</Field>
    </>
  );
}

function Campaigns() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const list = useQuery<Campaign[]>('/api/campaigns');
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const date = (d: string) => formatInstant(d, i18n.language);
  const named = (c: Campaign) => (i18n.language === 'fr-CA' && c.nameFr ? c.nameFr : c.name);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await run('create', () => api<{ id: string }>('/api/campaigns', { method: 'POST', body: campaignBody(new FormData(e.currentTarget)) }), t('programs.created'));
    // In the app, not a page load: the demo lives under a base path.
    if (r) router.push(`/manage/programs?id=${r.id}`);
  }
  return (
    <Card>
      <CardHeader title={t('programs.campaigns')} description={t('programs.campaignsHelp')} action={<Button size="sm" icon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpen(true)}>{t('programs.newCampaign')}</Button>} />
      <CardBody className="pt-2">
        {!list.data ? <Skeleton className="h-32" /> : !list.data.length ? (
          <EmptyState icon={Layers} title={t('programs.noCampaigns')}>{t('programs.noCampaignsHelp')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((c) => (
              <li key={c.id}>
                <Link href={`/manage/programs?id=${c.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg py-3 hover:bg-surface/60">
                  <span>
                    <span className="block font-semibold">{named(c)}</span>
                    <span className="text-caption text-muted">{t(`programs.kind.${c.kind}`)} · {date(c.startsOn)} – {date(c.endsOn)} · {t('programs.setCount', { count: c.setCount ?? 0 })}</span>
                  </span>
                  <StatusPill tone={STATUS_TONE[c.status]}>{t(`programs.status.${c.status}`)}</StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('programs.newCampaign')} description={t('programs.newCampaignHelp')} closeLabel={t('common.cancel')}>
        <form className="grid gap-4" onSubmit={(e) => void create(e)}>
          <CampaignFields />
          <Button type="submit" loading={busy === 'create'} className="justify-self-start">{t('programs.createCampaign')}</Button>
        </form>
      </Dialog>
    </Card>
  );
}

function CampaignDetail({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const router = useRouter();
  const c = useQuery<Campaign>(`/api/campaigns/${id}`);
  const levels = useQuery<SwimLevel[]>('/api/swim-levels');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/positions');
  const { run, busy } = useAction();
  /** The set being edited, or 'new' to add one. */
  const [setForm, setSetForm] = useState<LessonSet | 'new' | null>(null);
  const [days, setDays] = useState<number[]>([1]);
  const [roster, setRoster] = useState<LessonSet | null>(null);
  const [removing, setRemoving] = useState<LessonSet | null>(null);
  const [editingCampaign, setEditingCampaign] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const list = useQuery<Array<{ id: string; swimmerName: string; status: string; safetyNote: string | null; ageOverride: string | null }>>(roster ? `/api/registrations?setId=${roster.id}` : null);
  const date = (d: string) => formatInstant(d, lng);
  const dow = (d: number) => dateFormat(lng, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + d)));
  const label = (x: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const editingSet = setForm && setForm !== 'new' ? setForm : null;

  async function saveSet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const level = levels.data?.find((l) => l.id === s('level'));
    const start = toMinutes(s('start'));
    const startsOn = s('startsOn');
    const body = {
      facilityId: s('facility'), positionId: s('position'), levelId: level?.id ?? null, name: s('name') || null,
      daysOfWeek: days, startMinute: start, endMinute: s('end') ? toMinutes(s('end')) : start + (level?.durationMinutes ?? 30),
      startsOn, endsOn: editingSet ? s('endsOn') : addDaysIso(startsOn, Number(s('weeks')) * 7 - 1),
      capacity: s('capacity') ? Number(s('capacity')) : undefined,
      priceCents: cents(s('price')) ?? 0,
      memberPriceCents: cents(s('memberPrice')),
    };
    const done = editingSet
      ? await run('set', () => api(`/api/campaigns/${id}/sets/${editingSet.id}`, { method: 'PATCH', body }), t('programs.setSaved'))
      : await run('set', () => api(`/api/campaigns/${id}/sets`, { method: 'POST', body }), t('programs.setAdded'));
    if (done !== undefined) {
      setSetForm(null);
      await c.reload();
    }
  }
  async function removeSet() {
    if ((await run('removeSet', () => api(`/api/campaigns/${id}/sets/${removing!.id}`, { method: 'DELETE' }), t('programs.setRemoved'))) !== undefined) {
      setRemoving(null);
      await c.reload();
    }
  }
  async function saveCampaign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if ((await run('campaign', () => api(`/api/campaigns/${id}`, { method: 'PATCH', body: campaignBody(new FormData(e.currentTarget)) }), t('programs.campaignSaved'))) !== undefined) {
      setEditingCampaign(false);
      await c.reload();
    }
  }
  async function deleteCampaign() {
    if ((await run('deleteCampaign', () => api(`/api/campaigns/${id}`, { method: 'DELETE' }), t('programs.campaignDeleted'))) !== undefined) router.push('/manage/programs');
  }
  const act = (a: 'publish' | 'close' | 'reopen') => void run(a, () => api(`/api/campaigns/${id}/${a}`, { method: 'POST' }), t(`programs.done.${a}`)).then(() => c.reload());
  const pattern = (k: string) => setDays(k === 'weekly' ? [days[0] ?? 1] : PATTERNS[k]!);
  const openSet = (s: LessonSet | 'new') => {
    setDays(s === 'new' ? [1] : s.daysOfWeek);
    setSetForm(s);
  };

  if (!c.data) return <Skeleton className="h-96" />;
  const k = c.data;
  const hasPeople = (k.sets ?? []).some((s) => s.enrolled + s.waitlisted > 0);
  return (
    <div className="grid gap-6">
      <Link href="/manage/programs" className="inline-flex items-center gap-1 text-small font-semibold text-brand-text hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{t('programs.campaigns')}</Link>
      <PageHeader
        title={label(k)}
        description={`${t(`programs.kind.${k.kind}`)} · ${date(k.startsOn)} – ${date(k.endsOn)}${k.skipDates.length ? ` · ${t('programs.skipping', { dates: k.skipDates.map(date).join(', ') })}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={STATUS_TONE[k.status]}>{t(`programs.status.${k.status}`)}</StatusPill>
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditingCampaign(true)}>{t('programs.editCampaign')}</Button>
            {k.status === 'DRAFT' && !hasPeople ? <Button variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setDeleting(true)}>{t('programs.deleteCampaign')}</Button> : null}
            {k.status === 'DRAFT' ? <Button loading={busy === 'publish'} icon={<Send className="h-4 w-4" aria-hidden="true" />} onClick={() => act('publish')}>{t('programs.publish')}</Button> : null}
            {k.status === 'PUBLISHED' ? <Button variant="secondary" loading={busy === 'close'} onClick={() => act('close')}>{t('programs.close')}</Button> : null}
            {k.status === 'CLOSED' ? <Button variant="secondary" loading={busy === 'reopen'} onClick={() => act('reopen')}>{t('programs.reopen')}</Button> : null}
          </div>
        }
      />
      {k.status === 'DRAFT' ? <p className="rounded-xl bg-surface px-4 py-3 text-small text-muted">{t('programs.draftNote')}</p> : null}
      <Card>
        <CardHeader title={t('programs.sets')} description={t('programs.setsHelp')} action={k.status !== 'CLOSED' ? <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => openSet('new')}>{t('programs.addSet')}</Button> : null} />
        <CardBody className="pt-2">
          {!k.sets?.length ? <EmptyState icon={Layers} title={t('programs.noSets')}>{t('programs.noSetsHelp')}</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-small">
                <thead className="text-left text-caption text-muted"><tr>{['set', 'when', 'ages', 'spots', 'price', ''].map((h) => <th key={h} className="py-2 pr-3 font-semibold">{h ? t(`programs.col.${h}`) : ''}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {k.sets.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2.5 pr-3 font-semibold">{s.name}</td>
                      <td className="py-2.5 pr-3">{s.daysOfWeek.map(dow).join(' ')} · {hhmm(s.startMinute)}–{hhmm(s.endMinute)}<span className="block text-caption text-muted">{date(s.startsOn)} – {date(s.endsOn)} · {t('programs.sessions', { count: s.sessions })}</span></td>
                      <td className="py-2.5 pr-3">{ageRange(s.minAgeMonths, s.maxAgeMonths, t)}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{s.enrolled}/{s.capacity}{s.waitlisted ? <span className="block text-caption text-warn">{t('programs.waiting', { count: s.waitlisted })}</span> : null}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{money(s.priceCents, lng)}{s.memberPriceCents != null ? <span className="block text-caption text-muted">{t('programs.memberPrice', { price: money(s.memberPriceCents, lng) })}</span> : null}</td>
                      <td className="py-2.5">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="ghost" icon={<Users className="h-4 w-4" aria-hidden="true" />} onClick={() => setRoster(s)}>{t('programs.classList')}</Button>
                          {k.status !== 'CLOSED' ? <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} aria-label={t('programs.editSetOne', { name: s.name })} onClick={() => openSet(s)}>{t('common.edit')}</Button> : null}
                          {s.enrolled + s.waitlisted === 0 ? <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} aria-label={t('programs.removeSetOne', { name: s.name })} onClick={() => setRemoving(s)}>{t('programs.removeSet')}</Button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Dialog open={!!setForm} onClose={() => setSetForm(null)} title={editingSet ? t('programs.editSet') : t('programs.addSet')} description={editingSet ? (editingSet.enrolled ? t('programs.editSetHelp', { count: editingSet.enrolled }) : undefined) : t('programs.addSetHelp')} closeLabel={t('common.cancel')}>
        {!levels.data || !facilities.data || !positions.data ? <Skeleton className="h-40" /> : (
          <form key={editingSet?.id ?? 'new'} className="grid gap-4" onSubmit={(e) => void saveSet(e)}>
            <Field label={t('programs.level')} hint={!levels.data.length ? t('programs.noLevelsHint') : undefined}>
              {(p) => (
                <Select {...p} name="level" defaultValue={editingSet?.levelId ?? ''}>
                  <option value="">{t('programs.noLevel')}</option>
                  {[...new Set(levels.data!.filter((l) => l.active || l.id === editingSet?.levelId).map((l) => l.program))].map((prog) => (
                    <optgroup key={prog} label={prog}>
                      {levels.data!.filter((l) => l.program === prog && (l.active || l.id === editingSet?.levelId)).map((l) => <option key={l.id} value={l.id}>{label(l)} · {ageRange(l.minAgeMonths, l.maxAgeMonths, t)}</option>)}
                    </optgroup>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('programs.setName')} hint={t('programs.setNameHint')}>{(p) => <Input {...p} name="name" maxLength={80} defaultValue={editingSet?.name ?? ''} />}</Field>
            <fieldset className="grid gap-2">
              <legend className="text-small font-semibold">{t('programs.pattern')}</legend>
              <div className="flex flex-wrap gap-2">{Object.keys(PATTERNS).map((pk) => <Button key={pk} size="sm" variant="secondary" onClick={() => pattern(pk)}>{t(`programs.patterns.${pk}`)}</Button>)}</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('programs.days')}>
                {DOW.map((d) => (
                  <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => setDays((x) => (x.includes(d) ? (x.length > 1 ? x.filter((y) => y !== d) : x) : [...x, d].sort()))} className={`h-10 min-w-[3rem] rounded-xl border px-2 text-small font-semibold ${days.includes(d) ? 'border-brand bg-brand/10 text-brand-text' : 'border-line text-muted'}`}>{dow(d)}</button>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label={t('programs.firstDay')}>{(p) => <Input {...p} name="startsOn" type="date" required defaultValue={editingSet?.startsOn ?? k.startsOn} />}</Field>
              {editingSet ? (
                <Field label={t('programs.lastDay')}>{(p) => <Input {...p} name="endsOn" type="date" required defaultValue={editingSet.endsOn} />}</Field>
              ) : (
                <Field label={t('programs.weeks')}>{(p) => <Select {...p} name="weeks" defaultValue="8">{[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((w) => <option key={w} value={w}>{t('programs.weeksN', { count: w })}</option>)}</Select>}</Field>
              )}
              <Field label={t('programs.start')}>{(p) => <Input {...p} name="start" type="time" required defaultValue={editingSet ? hhmm(editingSet.startMinute) : '17:00'} />}</Field>
              <Field label={t('programs.end')} hint={t('programs.endHint')}>{(p) => <Input {...p} name="end" type="time" defaultValue={editingSet ? hhmm(editingSet.endMinute) : undefined} />}</Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label={t('programs.facility')}>{(p) => <Select {...p} name="facility" required defaultValue={editingSet?.facilityId}>{facilities.data!.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
              <Field label={t('programs.instructor')}>{(p) => <Select {...p} name="position" required defaultValue={editingSet?.positionId}>{positions.data!.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</Select>}</Field>
              <Field label={t('programs.capacity')} hint={editingSet ? t('programs.capacityEditHint', { count: editingSet.enrolled }) : t('programs.capacityHint')}>{(p) => <Input {...p} name="capacity" type="number" min={Math.max(1, editingSet?.enrolled ?? 1)} max={60} defaultValue={editingSet?.capacity} />}</Field>
              <div />
              <Field label={t('programs.price')}>{(p) => <Input {...p} name="price" inputMode="decimal" required placeholder="95.00" defaultValue={editingSet?.priceCents != null ? (editingSet.priceCents / 100).toFixed(2) : undefined} />}</Field>
              <Field label={t('programs.memberPriceLabel')} hint={t('common.optional')}>{(p) => <Input {...p} name="memberPrice" inputMode="decimal" placeholder="80.00" defaultValue={editingSet?.memberPriceCents != null ? (editingSet.memberPriceCents / 100).toFixed(2) : ''} />}</Field>
            </div>
            <Button type="submit" loading={busy === 'set'} className="justify-self-start">{editingSet ? t('common.save') : t('programs.addSet')}</Button>
          </form>
        )}
      </Dialog>

      <Dialog open={!!removing} onClose={() => setRemoving(null)} title={t('programs.removeSetTitle', { name: removing?.name ?? '' })} description={t('programs.removeSetHelp')} closeLabel={t('common.cancel')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" loading={busy === 'removeSet'} onClick={() => void removeSet()}>{t('programs.removeSet')}</Button>
          <Button variant="secondary" onClick={() => setRemoving(null)}>{t('common.cancel')}</Button>
        </div>
      </Dialog>

      <Dialog open={editingCampaign} onClose={() => setEditingCampaign(false)} title={t('programs.editCampaign')} closeLabel={t('common.cancel')}>
        <form className="grid gap-4" onSubmit={(e) => void saveCampaign(e)}>
          <CampaignFields c={k} />
          <Button type="submit" loading={busy === 'campaign'} className="justify-self-start">{t('common.save')}</Button>
        </form>
      </Dialog>

      <Dialog open={deleting} onClose={() => setDeleting(false)} title={t('programs.deleteCampaignTitle', { name: k.name })} description={t('programs.deleteCampaignHelp')} closeLabel={t('common.cancel')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" loading={busy === 'deleteCampaign'} onClick={() => void deleteCampaign()}>{t('programs.deleteCampaign')}</Button>
          <Button variant="secondary" onClick={() => setDeleting(false)}>{t('common.cancel')}</Button>
        </div>
      </Dialog>

      <Dialog open={!!roster} onClose={() => setRoster(null)} title={roster?.name ?? ''} description={roster ? t('programs.rosterHelp', { enrolled: roster.enrolled, capacity: roster.capacity }) : ''} closeLabel={t('common.close')}>
        {!list.data ? <Skeleton className="h-24" /> : !list.data.length ? <p className="text-small text-muted">{t('programs.nobodyYet')}</p> : (
          <ol className="divide-y divide-line text-small">
            {list.data.map((r, n) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="mr-2 tabular-nums text-muted">{n + 1}</span><span className="font-semibold">{r.swimmerName}</span>{r.safetyNote ? <span className="ml-2 text-caption text-warn">{r.safetyNote}</span> : null}</span>
                {r.status === 'WAITLISTED' ? <StatusPill tone="warn">{t('programs.waitlisted')}</StatusPill> : null}
              </li>
            ))}
          </ol>
        )}
      </Dialog>
    </div>
  );
}

function Levels() {
  const { t, i18n } = useTranslation();
  const q = useQuery<SwimLevel[]>('/api/swim-levels');
  const presets = useQuery<Array<{ key: string; program: string; levels: number; advanced: Array<{ name: string; note: string | null }> }>>('/api/swim-levels/presets');
  const { run, busy } = useAction();
  const [pick, setPick] = useState('LIFESAVING');
  const [advanced, setAdvanced] = useState(true);
  /** The level being edited, or 'new' for one of the city's own. */
  const [editing, setEditing] = useState<SwimLevel | 'new' | null>(null);
  const chosen = presets.data?.find((p) => p.key === pick);
  const load = () => void run('preset', () => api<{ added: number }>('/api/swim-levels/presets', { method: 'POST', body: { preset: pick, advanced } }), t('programs.levelsAdded')).then(() => q.reload());
  const programs = [...new Set((q.data ?? []).map((l) => l.program))];
  const current = editing && editing !== 'new' ? editing : null;
  const years = (m: number | null | undefined) => (m == null ? '' : String(Math.floor(m / 12)));
  const months = (m: number | null | undefined) => (m == null ? '' : String(m % 12));
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = levelBody(new FormData(e.currentTarget));
    const done = current
      ? await run('level', () => api(`/api/swim-levels/${current.id}`, { method: 'PATCH', body }), t('programs.levelSaved'))
      : await run('level', () => api('/api/swim-levels', { method: 'POST', body }), t('programs.levelAdded'));
    if (done !== undefined) {
      setEditing(null);
      await q.reload();
    }
  }
  return (
    <Card>
      <CardHeader title={t('programs.levels')} description={t('programs.levelsHelp')} action={<Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('programs.newLevel')}</Button>} />
      <CardBody className="grid gap-4 pt-2">
        <div className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label={t('programs.loadLevels')} hint={chosen ? t('programs.presetCount', { count: chosen.levels }) : undefined}>
            {(p) => (
              <Select {...p} value={pick} onChange={(e) => setPick(e.target.value)}>
                {(presets.data ?? []).map((x) => <option key={x.key} value={x.key}>{t(`programs.preset.${x.key}`, { defaultValue: x.program })}</option>)}
              </Select>
            )}
          </Field>
          <Button loading={busy === 'preset'} disabled={!presets.data} onClick={load}>{t('programs.load')}</Button>
          {chosen?.advanced.length ? (
            <label className="flex items-start gap-2 text-small sm:col-span-2">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
              <span><span className="font-semibold">{t('programs.includeAdvanced')}</span><span className="block text-caption text-muted">{chosen.advanced.map((a) => (a.note ? `${a.name} (${a.note})` : a.name)).join(' · ')}</span></span>
            </label>
          ) : null}
        </div>
        <p className="rounded-xl bg-surface px-4 py-3 text-caption text-muted">{t('programs.levelsNote')}</p>
        {!q.data ? <Skeleton className="h-32" /> : !q.data.length ? <EmptyState icon={Layers} title={t('programs.noLevels')}>{t('programs.noLevelsHelp')}</EmptyState> : programs.map((p) => (
          <div key={p}>
            <h3 className="mb-2 text-small font-semibold uppercase tracking-wide text-muted">{p}</h3>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {q.data!.filter((l) => l.program === p).map((l) => (
                <li key={l.id} className={`flex items-start justify-between gap-2 rounded-xl border border-line px-3 py-2 text-small ${l.active ? '' : 'opacity-70'}`}>
                  <span className="min-w-0">
                    <span className="font-semibold">{i18n.language === 'fr-CA' && l.nameFr ? l.nameFr : l.name}</span>
                    {!l.active ? <StatusPill tone="neutral" className="ml-2">{t('programs.levelRetired')}</StatusPill> : null}
                    <span className="block text-caption text-muted">{ageRange(l.minAgeMonths, l.maxAgeMonths, t)} · {t('programs.ratio', { n: l.ratio })} · {t('programs.minutes', { n: l.durationMinutes })}{l.parentInWater ? ` · ${t('programs.parentInWater')}` : ''}</span>
                  </span>
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} aria-label={t('programs.editLevelOne', { name: l.name })} onClick={() => setEditing(l)}>{t('common.edit')}</Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardBody>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={current ? t('programs.editLevel') : t('programs.newLevel')} description={t('programs.levelFormHelp')} closeLabel={t('common.cancel')}>
        <form key={current?.id ?? 'new'} className="grid gap-4" onSubmit={(e) => void save(e)}>
          <Field label={t('programs.program')} hint={t('programs.programHint')}>{(p) => <Input {...p} name="program" required minLength={2} maxLength={60} list="programs-known" defaultValue={current?.program} />}</Field>
          <datalist id="programs-known">{programs.map((x) => <option key={x} value={x} />)}</datalist>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('programs.levelName')}>{(p) => <Input {...p} name="name" required maxLength={60} defaultValue={current?.name} />}</Field>
            <Field label={t('programs.levelNameFr')} hint={t('common.optional')}>{(p) => <Input {...p} name="nameFr" maxLength={60} lang="fr-CA" defaultValue={current?.nameFr ?? ''} />}</Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-small font-semibold">{t('programs.youngest')}</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('programs.years')}>{(p) => <Input {...p} name="minYears" type="number" min={0} max={100} defaultValue={years(current?.minAgeMonths ?? 0)} />}</Field>
              <Field label={t('programs.monthsLabel')}>{(p) => <Input {...p} name="minMonths" type="number" min={0} max={11} defaultValue={months(current?.minAgeMonths ?? 0)} />}</Field>
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="text-small font-semibold">{t('programs.oldest')}</legend>
            <p className="text-caption text-muted">{t('programs.oldestHint')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('programs.years')}>{(p) => <Input {...p} name="maxYears" type="number" min={0} max={100} defaultValue={years(current?.maxAgeMonths)} />}</Field>
              <Field label={t('programs.monthsLabel')}>{(p) => <Input {...p} name="maxMonths" type="number" min={0} max={11} defaultValue={months(current?.maxAgeMonths)} />}</Field>
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('programs.ratioLabel')} hint={t('programs.ratioHint')}>{(p) => <Input {...p} name="ratio" type="number" required min={1} max={30} defaultValue={current?.ratio ?? 8} />}</Field>
            <Field label={t('programs.durationLabel')}>{(p) => <Input {...p} name="duration" type="number" required min={10} max={240} step={5} defaultValue={current?.durationMinutes ?? 30} />}</Field>
          </div>
          <label className="flex items-start gap-2 text-small">
            <input type="checkbox" name="parentInWater" defaultChecked={current?.parentInWater ?? false} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
            <span className="font-semibold">{t('programs.parentInWaterLabel')}</span>
          </label>
          <label className="flex items-start gap-2 text-small">
            <input type="checkbox" name="active" defaultChecked={current?.active ?? true} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
            <span><span className="font-semibold">{t('programs.levelActive')}</span><span className="block text-caption text-muted">{t('programs.levelActiveHelp')}</span></span>
          </label>
          <Button type="submit" loading={busy === 'level'} className="justify-self-start">{current ? t('common.save') : t('programs.newLevel')}</Button>
        </form>
      </Dialog>
    </Card>
  );
}
