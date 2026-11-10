'use client';

import { ArrowLeftRight, CalendarX2, Check, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { dateFormat } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface TShift { id: string; startsAt: string; endsAt: string; position: string; positionFr: string | null; facility: string; timezone: string }
interface Side { userId: string; name: string; shift: TShift | null }
type Status = 'PROPOSED' | 'ACCEPTED' | 'APPROVED' | 'DECLINED' | 'DENIED' | 'CANCELLED' | 'EXPIRED';
export interface Trade { id: string; status: Status; note: string | null; decisionNote: string | null; from: Side; to: Side; check?: { from?: { overtimeHours: string }; to?: { overtimeHours: string } } | null }
interface Option extends TShift { person: string }

const TONE: Record<Status, Tone> = { PROPOSED: 'new', ACCEPTED: 'warn', APPROVED: 'ok', DECLINED: 'neutral', DENIED: 'neutral', CANCELLED: 'neutral', EXPIRED: 'neutral' };

function useWhen() {
  const { i18n } = useTranslation();
  const lng = i18n.language;
  return (s: { startsAt: string; endsAt: string; timezone: string }) => {
    const day = dateFormat(lng, { timeZone: s.timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(s.startsAt));
    const time = dateFormat(lng, { timeZone: s.timezone, hour: 'numeric', minute: '2-digit' });
    return `${day} · ${time.format(new Date(s.startsAt))}–${time.format(new Date(s.endsAt))}`;
  };
}

function ShiftLine({ s }: { s: TShift | null }) {
  const { i18n } = useTranslation();
  const when = useWhen();
  if (!s) return <span className="text-muted">—</span>;
  return (
    <span className="block">
      <span className="font-semibold text-ink">{when(s)}</span>
      <span className="block text-small text-muted">{(i18n.language === 'fr-CA' && s.positionFr) || s.position} · {s.facility}</span>
    </span>
  );
}

/** Pick one of someone else's shifts to trade mine for. */
export function TradeDialog({ shiftId, onClose, onDone }: { shiftId: string | null; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const when = useWhen();
  const options = useQuery<Option[]>(shiftId ? `/api/me/trades/options?shiftId=${shiftId}` : null);
  const { run, busy } = useAction();
  const [pick, setPick] = useState<string | null>(null);
  async function propose(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get('note') ?? '').trim();
    const r = await run('propose', () => api('/api/me/trades', { method: 'POST', body: { myShiftId: shiftId, theirShiftId: pick, note: note || null } }), t('trades.proposed'));
    if (r !== undefined) { setPick(null); onDone(); }
  }
  return (
    <Dialog open={!!shiftId} onClose={() => { setPick(null); onClose(); }} title={t('trades.title')} description={t('trades.pickHelp')} closeLabel={t('common.close')}>
      {options.loading ? (
        <Skeleton className="h-40" />
      ) : !options.data?.length ? (
        <div className="grid justify-items-start gap-4">
          <p className="flex items-start gap-3 rounded-xl bg-surface p-3 text-small text-muted"><CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('trades.noOptions')}</p>
          <Button variant="secondary" onClick={() => { setPick(null); onClose(); }}>{t('common.close')}</Button>
        </div>
      ) : (
        <form onSubmit={(e) => void propose(e)} className="grid gap-4">
          <fieldset className="grid max-h-72 gap-2 overflow-y-auto">
            <legend className="sr-only">{t('trades.title')}</legend>
            {options.data.map((o) => (
              <label key={o.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${pick === o.id ? 'border-brand bg-brand/5' : 'border-line'}`}>
                <input type="radio" name="shift" value={o.id} checked={pick === o.id} onChange={() => setPick(o.id)} className="mt-1 h-4 w-4 accent-[rgb(var(--brand))]" />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{when(o)}</span>
                  <span className="block text-small text-muted">{(i18n.language === 'fr-CA' && o.positionFr) || o.position} · {o.facility} · {o.person}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label={t('trades.note')}>{(p) => <Input {...p} name="note" maxLength={300} placeholder={t('trades.notePlaceholder')} />}</Field>
          <p className="text-caption text-muted">{t('trades.howItWorks')}</p>
          <Button type="submit" disabled={!pick} loading={busy === 'propose'} icon={<ArrowLeftRight className="h-4 w-4" aria-hidden="true" />} className="justify-self-start">{t('trades.ask')}</Button>
        </form>
      )}
    </Dialog>
  );
}

/** My trades: ones waiting for me, ones I asked for, and how recent ones ended. */
export function MyTrades({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation();
  const { me } = useSession();
  const q = useQuery<Trade[]>('/api/me/trades');
  const { run, busy } = useAction();
  if (!q.data?.length) return null;
  const act = (id: string, what: 'accept' | 'decline' | 'cancel', msg: string) => run(`${what}${id}`, () => api(`/api/me/trades/${id}/${what}`, { method: 'POST' }), msg).then(() => { void q.reload(); onChanged?.(); });
  return (
    <Card>
      <CardHeader title={t('trades.mine')} description={t('trades.mineHelp')} />
      <CardBody className="grid gap-3 pt-2">
        {q.data.map((tr) => {
          const incoming = tr.to.userId === me?.id;
          const other = incoming ? tr.from : tr.to;
          const give = incoming ? tr.to.shift : tr.from.shift;
          const get = incoming ? tr.from.shift : tr.to.shift;
          return (
            <div key={tr.id} className="grid gap-2 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-small text-muted">{incoming ? t('trades.fromThem', { name: other.name }) : t('trades.withThem', { name: other.name })}</p>
                <StatusPill tone={TONE[tr.status]}>{t(`trades.status.${tr.status}`)}</StatusPill>
              </div>
              <div className="grid gap-2 text-small sm:grid-cols-2">
                <div><p className="text-caption uppercase text-muted">{t('trades.youGive')}</p><ShiftLine s={give} /></div>
                <div><p className="text-caption uppercase text-muted">{t('trades.youTake')}</p><ShiftLine s={get} /></div>
              </div>
              {tr.note ? <p className="text-small text-ink">“{tr.note}”</p> : null}
              {tr.decisionNote ? <p className="text-small text-muted">{t('trades.supervisorSaid', { note: tr.decisionNote })}</p> : null}
              <div className="flex flex-wrap gap-2">
                {incoming && tr.status === 'PROPOSED' ? (
                  <>
                    <Button size="sm" icon={<Check className="h-4 w-4" aria-hidden="true" />} loading={busy === `accept${tr.id}`} onClick={() => void act(tr.id, 'accept', t('trades.accepted'))}>{t('trades.accept')}</Button>
                    <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" aria-hidden="true" />} loading={busy === `decline${tr.id}`} onClick={() => void act(tr.id, 'decline', t('trades.declined'))}>{t('trades.decline')}</Button>
                  </>
                ) : null}
                {!incoming && (tr.status === 'PROPOSED' || tr.status === 'ACCEPTED') ? <Button size="sm" variant="ghost" loading={busy === `cancel${tr.id}`} onClick={() => void act(tr.id, 'cancel', t('trades.cancelled'))}>{t('trades.cancel')}</Button> : null}
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

/** Supervisors: trades both people agreed to. */
export function TradeApprovals() {
  const { t } = useTranslation();
  const q = useQuery<Trade[]>('/api/trades');
  const { run, busy } = useAction();
  if (q.loading) return <Skeleton className="h-40" />;
  if (!q.data?.length) return <EmptyState icon={ArrowLeftRight} title={t('trades.noneToApprove')}>{t('trades.noneToApproveBody')}</EmptyState>;
  const decide = (id: string, decision: 'APPROVE' | 'DENY') => run(`${decision}${id}`, () => api(`/api/trades/${id}/decision`, { method: 'POST', body: { decision } }), decision === 'APPROVE' ? t('trades.approved') : t('trades.denied')).then(() => q.reload());
  return (
    <div className="grid gap-3">
      {q.data.map((tr) => {
        const ot = (h?: string) => (h && Number(h) > 0 ? h : null);
        return (
          <Card key={tr.id}>
            <CardBody className="grid gap-3">
              <div className="grid gap-3 text-small sm:grid-cols-2">
                <div><p className="text-caption uppercase text-muted">{t('trades.takes', { name: tr.from.name })}</p><ShiftLine s={tr.to.shift} />{ot(tr.check?.from?.overtimeHours) ? <StatusPill tone="warn">{t('trades.overtime', { h: tr.check!.from!.overtimeHours })}</StatusPill> : null}</div>
                <div><p className="text-caption uppercase text-muted">{t('trades.takes', { name: tr.to.name })}</p><ShiftLine s={tr.from.shift} />{ot(tr.check?.to?.overtimeHours) ? <StatusPill tone="warn">{t('trades.overtime', { h: tr.check!.to!.overtimeHours })}</StatusPill> : null}</div>
              </div>
              {tr.note ? <p className="text-small text-ink">“{tr.note}”</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<Check className="h-4 w-4" aria-hidden="true" />} loading={busy === `APPROVE${tr.id}`} onClick={() => void decide(tr.id, 'APPROVE')}>{t('trades.approve')}</Button>
                <Button size="sm" variant="ghost" loading={busy === `DENY${tr.id}`} onClick={() => void decide(tr.id, 'DENY')}>{t('trades.deny')}</Button>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
