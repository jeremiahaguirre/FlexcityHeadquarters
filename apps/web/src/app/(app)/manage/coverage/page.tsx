'use client';

import { AlertTriangle, CheckCircle2, Plus, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
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
import { hhmm, toMinutes } from '@/lib/programs';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';
import { dateFormat } from '@/lib/format';

interface Rule { id: string; facilityId: string; name: string; certificationId: string; minCount: number; daysOfWeek: number[]; startMinute: number; endMinute: number; note: string | null; active: boolean }
interface Gap { ruleId: string; rule: string; facilityId: string; date: string; from: string; to: string; have: number; need: number }
/** Common rules a city starts from; the certificate is picked from the city's own list. */
const TEMPLATES = ['icePlant', 'waterOro', 'wastewaterOro', 'poolLead'] as const;

/** Certificates that must be on duty, and where the next week's schedule falls short. */
export default function CoveragePage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { can } = useSession();
  const today = new Date().toISOString().slice(0, 10);
  const rules = useQuery<Rule[]>('/api/coverage/rules');
  const gaps = useQuery<Gap[]>(`/api/coverage/gaps?from=${today}&days=7`);
  const facilities = useQuery<Array<{ id: string; name: string; timezone: string }>>('/api/facilities');
  const certs = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/certifications');
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const manage = can('coverage.manage');
  const dow = (d: number) => dateFormat(lng, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + d)));
  const fac = (id: string) => facilities.data?.find((f) => f.id === id);
  const time = (iso: string, tz?: string) => dateFormat(lng, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
  const certName = (id: string) => {
    const c = certs.data?.find((x) => x.id === id);
    return c ? (lng === 'fr-CA' && c.nameFr ? c.nameFr : c.name) : '';
  };

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    let end = toMinutes(s('end'));
    const start = toMinutes(s('start'));
    if (end <= start) end += 1440; // overnight window
    const body = { facilityId: s('facility'), name, certificationId: s('cert'), minCount: Number(s('min') || 1), daysOfWeek: days, startMinute: start, endMinute: end, note: s('note') || null };
    if ((await run('add', () => api('/api/coverage/rules', { method: 'POST', body }), t('coverage.added'))) !== undefined) {
      setAdding(false);
      await Promise.all([rules.reload(), gaps.reload()]);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={t('coverage.title')} description={t('coverage.description')} actions={manage ? <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => { setName(''); setAdding(true); }}>{t('coverage.add')}</Button> : null} />
      <Card>
        <CardHeader title={t('coverage.gaps')} description={t('coverage.gapsHelp')} />
        <CardBody className="pt-2">
          {!gaps.data || !facilities.data ? <Skeleton className="h-24" /> : !rules.data?.length ? (
            <p className="text-small text-muted">{t('coverage.noRulesYet')}</p>
          ) : !gaps.data.length ? (
            <p className="flex items-center gap-2 text-small font-semibold text-ok"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />{t('coverage.allCovered')}</p>
          ) : (
            <ul className="divide-y divide-line text-small">
              {gaps.data.map((g, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" /><span><span className="font-semibold">{g.rule}</span><span className="block text-caption text-muted">{fac(g.facilityId)?.name} · {time(g.from, fac(g.facilityId)?.timezone)} – {time(g.to, fac(g.facilityId)?.timezone)}</span></span></span>
                  <StatusPill tone="warn">{t('coverage.have', { have: g.have, need: g.need })}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('coverage.rules')} />
        <CardBody className="pt-2">
          {!rules.data ? <Skeleton className="h-24" /> : !rules.data.length ? <EmptyState icon={ShieldCheck} title={t('coverage.none')}>{t('coverage.noneHelp')}</EmptyState> : (
            <ul className="divide-y divide-line text-small">
              {rules.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span><span className="font-semibold">{r.name}</span><span className="block text-caption text-muted">{fac(r.facilityId)?.name} · {t('coverage.atLeast', { count: r.minCount, cert: certName(r.certificationId) })} · {r.daysOfWeek.map(dow).join(' ')} {hhmm(r.startMinute % 1440)}–{hhmm(r.endMinute % 1440)}{r.endMinute > 1440 ? ` ${t('coverage.nextDay')}` : ''}</span>{r.note ? <span className="block text-caption">{r.note}</span> : null}</span>
                  {manage ? <Button size="sm" variant="ghost" loading={busy === r.id} onClick={() => void run(r.id, () => api(`/api/coverage/rules/${r.id}`, { method: 'PATCH', body: { active: !r.active } })).then(() => Promise.all([rules.reload(), gaps.reload()]))}>{r.active ? t('coverage.pause') : t('coverage.resume')}</Button> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <p className="text-caption text-muted">{t('coverage.foot')}</p>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('coverage.add')} description={t('coverage.addHelp')} closeLabel={t('common.cancel')}>
        {!facilities.data || !certs.data ? <Skeleton className="h-32" /> : (
          <form className="grid gap-4" onSubmit={(e) => void add(e)}>
            <div className="flex flex-wrap gap-2">{TEMPLATES.map((k) => <Button key={k} size="sm" variant="secondary" onClick={() => setName(t(`coverage.templates.${k}`))}>{t(`coverage.templates.${k}`)}</Button>)}</div>
            <Field label={t('coverage.name')}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('programs.facility')}>{(p) => <Select {...p} name="facility" required>{facilities.data!.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
              <Field label={t('coverage.cert')} hint={t('coverage.certHint')}>{(p) => <Select {...p} name="cert" required>{certs.data!.map((c) => <option key={c.id} value={c.id}>{lng === 'fr-CA' && c.nameFr ? c.nameFr : c.name}</option>)}</Select>}</Field>
              <Field label={t('coverage.from')}>{(p) => <Input {...p} name="start" type="time" required defaultValue="06:00" />}</Field>
              <Field label={t('coverage.to')} hint={t('coverage.toHint')}>{(p) => <Input {...p} name="end" type="time" required defaultValue="23:00" />}</Field>
              <Field label={t('coverage.min')}>{(p) => <Input {...p} name="min" type="number" min={1} max={20} defaultValue={1} />}</Field>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('programs.days')}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => setDays((x) => (x.includes(d) ? (x.length > 1 ? x.filter((y) => y !== d) : x) : [...x, d]))} className={`h-10 min-w-[3rem] rounded-xl border px-2 text-small font-semibold ${days.includes(d) ? 'border-brand bg-brand/10 text-brand-text' : 'border-line text-muted'}`}>{dow(d)}</button>)}
            </div>
            <Field label={t('coverage.note')} hint={t('coverage.noteHint')}>{(p) => <Input {...p} name="note" maxLength={300} />}</Field>
            <Button type="submit" loading={busy === 'add'} className="justify-self-start">{t('coverage.add')}</Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
