'use client';

import { Hourglass } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useQuery } from '@/lib/useQuery';

export interface LieuPolicy { enabled: boolean; capHours: number; takeWithinMonths: number }
interface MyLieu { policy: LieuPolicy; bankOvertime: boolean; chosenAt: string | null; balance: number; available: number; expiring: number; history: Array<{ on: string; kind: 'BANKED' | 'TAKEN' | 'PAID_OUT' | 'ADJUSTED'; hours: number; note?: string }> }

const hrs = (n: number, lng: string) => n.toLocaleString(lng, { maximumFractionDigits: 2 });

/** The person's banked overtime and their choice to bank it. Hidden where the city doesn't use time in lieu and they have none. */
export function MyBankedTime() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const q = useQuery<MyLieu>('/api/me/lieu');
  const { run, busy } = useAction();
  const [confirm, setConfirm] = useState(false);
  const d = q.data;
  if (!d || (!d.policy.enabled && d.balance === 0)) return null;
  const choose = (bank: boolean) => run('choose', () => api('/api/me/lieu', { method: 'PUT', body: { bank } }), bank ? t('lieu.nowBanking') : t('lieu.nowPaid')).then(() => { setConfirm(false); void q.reload(); });

  return (
    <Card>
      <CardHeader title={t('lieu.title')} description={t('lieu.help', { cap: d.policy.capHours, months: d.policy.takeWithinMonths })} action={d.bankOvertime ? <StatusPill tone="ok">{t('lieu.banking')}</StatusPill> : undefined} />
      <CardBody className="grid gap-4 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-surface p-3"><p className="text-caption uppercase text-muted">{t('lieu.balance')}</p><p className="text-title text-ink">{t('lieu.hours', { n: hrs(d.balance, lng) })}</p></div>
          <div className="rounded-xl bg-surface p-3"><p className="text-caption uppercase text-muted">{t('lieu.available')}</p><p className="text-title text-ink">{t('lieu.hours', { n: hrs(Math.max(0, d.available), lng) })}</p></div>
        </div>
        {d.expiring > 0 ? <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-small text-ink">{t('lieu.expiring', { n: hrs(d.expiring, lng), months: d.policy.takeWithinMonths })}</p> : null}
        {d.policy.enabled ? (
          d.bankOvertime ? (
            <Button variant="secondary" className="justify-self-start" loading={busy === 'choose'} onClick={() => void choose(false)}>{t('lieu.stopBanking')}</Button>
          ) : (
            <Button variant="secondary" className="justify-self-start" icon={<Hourglass className="h-4 w-4" aria-hidden="true" />} onClick={() => setConfirm(true)}>{t('lieu.startBanking')}</Button>
          )
        ) : null}
        {d.history.length ? (
          <ul className="grid gap-1 text-small">
            {d.history.slice(0, 8).map((h, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-line py-1.5 last:border-0">
                <span className="text-ink">{t(`lieu.kinds.${h.kind}`)}{h.note ? <span className="text-muted"> · {h.note}</span> : null}<span className="block text-caption text-muted">{formatDate(h.on, lng)}</span></span>
                <span className={h.hours >= 0 ? 'font-semibold text-ok' : 'font-semibold text-ink'}>{h.hours > 0 ? '+' : ''}{hrs(h.hours, lng)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={t('lieu.agreeTitle')} closeLabel={t('common.cancel')}>
        <div className="grid gap-4">
          <p className="text-body text-ink">{t('lieu.agreeText', { cap: d.policy.capHours, months: d.policy.takeWithinMonths })}</p>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy === 'choose'} onClick={() => void choose(true)}>{t('lieu.agree')}</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

interface Row { userId: string; name: string; bankOvertime: boolean; balance: number; expiring: number }

/** HR: who banks overtime, balances, time held too long; corrections with a reason. */
export function LieuBalances() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const q = useQuery<{ policy: LieuPolicy; people: Row[] }>('/api/lieu');
  const { run, busy } = useAction();
  const [fixing, setFixing] = useState<Row | null>(null);
  const d = q.data;
  if (!d || (!d.policy.enabled && !d.people.length)) return null;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('fix', () => api(`/api/users/${fixing!.userId}/lieu/adjust`, { method: 'POST', body: { hours: Number(f.get('hours')), note: String(f.get('note')) } }), t('lieu.adjusted'));
    if (r !== undefined) { setFixing(null); await q.reload(); }
  }

  return (
    <Card>
      <CardHeader title={t('lieu.hrTitle')} description={d.policy.enabled ? t('lieu.hrHelp', { cap: d.policy.capHours, months: d.policy.takeWithinMonths }) : t('lieu.hrOff')} />
      <CardBody className="pt-2">
        {!d.people.length ? (
          <p className="text-small text-muted">{t('lieu.nobody')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-small">
              <thead className="text-caption uppercase text-muted"><tr><th className="py-2 pr-3 font-semibold">{t('lieu.person')}</th><th className="py-2 pr-3 font-semibold">{t('lieu.balance')}</th><th className="py-2 pr-3 font-semibold">{t('lieu.tooOld')}</th><th className="relative"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
              <tbody>
                {d.people.map((r) => (
                  <tr key={r.userId} className="border-t border-line">
                    <td className="py-2 pr-3 text-ink">{r.name}{r.bankOvertime ? <span className="block text-caption text-muted">{t('lieu.banking')}</span> : null}</td>
                    <td className="py-2 pr-3 font-semibold text-ink">{hrs(r.balance, lng)}</td>
                    <td className="py-2 pr-3">{r.expiring > 0 ? <StatusPill tone="warn">{hrs(r.expiring, lng)}</StatusPill> : '—'}</td>
                    <td className="py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setFixing(r)}>{t('lieu.adjust')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-caption text-muted">{t('lieu.payoutHint')}</p>
      </CardBody>
      <Dialog open={!!fixing} onClose={() => setFixing(null)} title={t('lieu.adjustTitle', { name: fixing?.name ?? '' })} closeLabel={t('common.cancel')}>
        <form onSubmit={(e) => void save(e)} className="grid gap-4">
          <Field label={t('lieu.adjustHours')} hint={t('lieu.adjustHoursHint')}>{(p) => <Input {...p} name="hours" type="number" step="0.25" min={-1000} max={1000} required className="w-40" />}</Field>
          <Field label={t('lieu.reason')}>{(p) => <Input {...p} name="note" required minLength={3} maxLength={200} />}</Field>
          <Button type="submit" className="justify-self-start" loading={busy === 'fix'}>{t('common.save')}</Button>
        </form>
      </Dialog>
    </Card>
  );
}
