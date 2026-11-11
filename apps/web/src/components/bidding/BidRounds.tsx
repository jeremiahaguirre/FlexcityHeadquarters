'use client';

import { ArrowLeft, CheckCheck, ListOrdered, Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { type RoundDetail, type RoundHead, type RoundStatus, itemWhen, outcomeText } from '@/lib/bidding';
import { formatDate, formatMoment } from '@/lib/format';
import { useLiveChange } from '@/lib/useLiveChange';
import { plusDays, todayIso, useAction, useQuery } from '@/lib/useQuery';
import { HowItWorks, ItemLine } from './MyBids';

interface Named { id: string; name: string; nameFr: string | null }
interface Options { departments: Array<Named & { useSeniority: boolean }>; positions: Array<Named & { departmentId: string | null }>; templates: Array<{ id: string; name: string; validFrom: string | null; validTo: string | null; positionIds: string[] }>; seniorityBasis: 'DATE' | 'HOURS' }
interface List { rounds: Array<RoundHead & { items: number; bidders: number }>; canManage: boolean; canConfigure: boolean; seniorityBasis: 'DATE' | 'HOURS' }

const TONE: Record<RoundStatus, 'ok' | 'pending' | 'brand' | 'neutral'> = { OPEN: 'ok', REVIEW: 'pending', AWARDED: 'brand', CANCELLED: 'neutral' };
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function NewRound({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const o = useQuery<Options>(open ? '/api/bids/options' : null);
  const { run, busy } = useAction();
  const [kind, setKind] = useState<'SHIFTS' | 'LINES'>('LINES');
  const [name, setName] = useState('');
  const [positionIds, setPositionIds] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [from, setFrom] = useState(plusDays(todayIso(), 21));
  const [to, setTo] = useState(plusDays(todayIso(), 35));
  const [opensAt, setOpensAt] = useState(local(new Date(Date.now() + 5 * 60_000)));
  const [closesAt, setClosesAt] = useState(local(new Date(Date.now() + 7 * 86_400_000)));
  const [max, setMax] = useState(1);
  const [basis, setBasis] = useState<'DATE' | 'HOURS' | ''>('');
  const label = (x: Named) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  useEffect(() => {
    const tpl = o.data?.templates.find((x) => x.id === templateId);
    if (tpl) {
      setPositionIds(tpl.positionIds);
      if (tpl.validFrom) setFrom(tpl.validFrom);
      if (tpl.validTo) setTo(plusDays(tpl.validTo, 1));
    }
  }, [templateId, o.data]);
  const valid = name.trim().length >= 2 && positionIds.length > 0 && (kind === 'SHIFTS' || templateId) && to > from && closesAt > opensAt;
  const create = () =>
    void run('create', () => api<{ id: string }>('/api/bids/rounds', { method: 'POST', body: { name, kind, positionIds, templateId: kind === 'LINES' ? templateId : undefined, from, to, opensAt: new Date(opensAt).toISOString(), closesAt: new Date(closesAt).toISOString(), maxAwardsPerPerson: max, ...(basis ? { seniorityBasis: basis } : {}) } }), t('bids.created')).then((r) => {
      if (r) {
        onCreated(r.id);
        onClose();
      }
    });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('bids.newRound')}
      description={t('bids.newRoundHelp')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={busy === 'create'} disabled={!valid} onClick={create}>{t('bids.openRound')}</Button>
        </>
      }
    >
      {!o.data ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-4">
          <Field label={t('bids.roundName')} hint={t('bids.roundNameHint')}>{(p) => <Input {...p} value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label={t('bids.kind')}>
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as 'SHIFTS' | 'LINES')}>
                <option value="LINES">{t('bids.kindLines')}</option>
                <option value="SHIFTS">{t('bids.kindShifts')}</option>
              </Select>
            )}
          </Field>
          <p className="-mt-2 text-caption text-muted">{t(kind === 'LINES' ? 'bids.linesHelp' : 'bids.shiftsHelp')}</p>
          {kind === 'LINES' ? (
            <Field label={t('bids.template')}>
              {(p) => (
                <Select {...p} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">{t('bids.pickTemplate')}</option>
                  {o.data!.templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={t('bids.positions')} hint={t('bids.positionsHint')}>
            {(p) => <MultiSelect key={`${kind}-${templateId}`} id={p.id} name="positions" options={o.data!.positions.map((x) => ({ value: x.id, label: label(x) }))} defaultValue={positionIds} placeholder={t('bids.pickPositions')} onChange={setPositionIds} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('bids.from')}>{(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
            <Field label={t('bids.to')}>{(p) => <Input {...p} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('bids.opensAt')}>{(p) => <Input {...p} type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />}</Field>
            <Field label={t('bids.closesAt')} hint={t('bids.closesHint')}>{(p) => <Input {...p} type="datetime-local" value={closesAt} min={opensAt} onChange={(e) => setClosesAt(e.target.value)} />}</Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('bids.maxAwardsLabel')}>{(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={20} value={max} onChange={(e) => setMax(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />}</Field>
            <Field label={t('bids.basis')}>
              {(p) => (
                <Select {...p} value={basis} onChange={(e) => setBasis(e.target.value as 'DATE' | 'HOURS' | '')}>
                  <option value="">{t('bids.basisDefault', { basis: t(`bids.basis${o.data!.seniorityBasis}`) })}</option>
                  <option value="DATE">{t('bids.basisDATE')}</option>
                  <option value="HOURS">{t('bids.basisHOURS')}</option>
                </Select>
              )}
            </Field>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Override({ round, itemId, onClose, onDone }: { round: RoundDetail; itemId: string | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const current = round.awards.find((x) => x.itemId === itemId);
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    setUserId(current?.userId ?? '');
    setReason('');
  }, [itemId, current?.userId]);
  const item = round.items.find((i) => i.id === itemId);
  return (
    <Dialog
      open={itemId !== null}
      onClose={onClose}
      title={t('bids.changeAward')}
      description={t('bids.changeAwardHelp')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={busy === 'o'} disabled={reason.trim().length < 5 || userId === (current?.userId ?? '')} onClick={() => void run('o', () => api(`/api/bids/rounds/${round.id}/awards/${itemId}`, { method: 'PUT', body: { userId: userId || null, reason } }), t('bids.changed')).then((r) => { if (r) { onDone(); onClose(); } })}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="grid gap-4">
        {item ? <p className="rounded-xl bg-surface p-3 text-small"><ItemLine item={item} /></p> : null}
        <Field label={t('bids.giveTo')}>
          {(p) => (
            <Select {...p} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{t('bids.nobody')}</option>
              {round.eligible.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('bids.reason')} hint={t('bids.reasonHint')}>{(p) => <Textarea {...p} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const q = useQuery<RoundDetail>(`/api/bids/rounds/${id}`);
  const { run, busy } = useAction();
  const [changing, setChanging] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  useLiveChange('bids', () => void q.reload());
  if (!q.data) return <Skeleton className="h-64" />;
  const r = q.data;
  const manage = r.access === 'manage';
  const closed = r.status === 'REVIEW' || r.status === 'AWARDED';
  const award = (itemId: string) => r.awards.find((x) => x.itemId === itemId);
  const itemById = new Map(r.items.map((i) => [i.id, i]));
  return (
    <div className="grid gap-4">
      <Button variant="ghost" size="sm" className="justify-self-start" icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />} onClick={onBack}>{t('bids.allRounds')}</Button>
      <Card className="max-w-4xl">
        <CardHeader title={r.name} description={`${t(`bids.status.${r.status}`)} · ${t('bids.closesOn', { when: formatMoment(r.closesAt, lng) })} · ${t(r.seniorityBasis === 'DATE' ? 'bids.basisDATE' : 'bids.basisHOURS')}`} action={<StatusPill tone={TONE[r.status]}>{t(`bids.status.${r.status}`)}</StatusPill>} />
        <CardBody className="grid gap-3 pt-1">
          <p className="text-small">{t('bids.counts', { items: r.items.length, bidders: r.bidders, eligible: r.eligibleCount })}</p>
          {!manage ? <p className="rounded-xl bg-surface p-3 text-small">{t('bids.observerNote')}</p> : null}
          <HowItWorks round={r} />
          {manage && r.status === 'REVIEW' ? (
            <div className="flex flex-wrap gap-2">
              <Button icon={<CheckCheck className="h-4 w-4" aria-hidden="true" />} onClick={() => setConfirming(true)}>{t('bids.confirm')}</Button>
              <Button variant="ghost" loading={busy === 'cancel'} onClick={() => void run('cancel', () => api(`/api/bids/rounds/${r.id}/cancel`, { method: 'POST' }), t('bids.cancelled')).then(() => q.reload())}>{t('bids.cancelRound')}</Button>
            </div>
          ) : manage && r.status === 'OPEN' ? (
            <Button variant="ghost" className="justify-self-start" loading={busy === 'cancel'} onClick={() => void run('cancel', () => api(`/api/bids/rounds/${r.id}/cancel`, { method: 'POST' }), t('bids.cancelled')).then(() => q.reload())}>{t('bids.cancelRound')}</Button>
          ) : null}
        </CardBody>
      </Card>
      <Card className="max-w-4xl">
        <CardHeader title={closed ? t('bids.awardsTitle') : t('bids.itemsTitle')} description={closed ? t('bids.awardsHelp') : t('bids.itemsHelp')} />
        <CardBody className="pt-1">
          <ul className="grid gap-2">
            {r.items.map((it) => {
              const a = award(it.id);
              return (
                <li key={it.id} className="grid gap-2 rounded-xl bg-surface p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <ItemLine item={it} />
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {closed ? (
                      a ? (
                        <span className="text-small">
                          <span className="font-semibold">{a.name}</span>
                          {a.overridden ? <span className="block text-caption text-warn">{t('bids.overriddenBy', { by: a.by ?? '', reason: a.reason ?? '' })}</span> : <span className="block text-caption text-muted">{t('bids.wonAs', { rank: a.choiceRank ?? '—', pass: a.pass })}</span>}
                        </span>
                      ) : (
                        <span className="text-small text-muted">{t('bids.toBoard')}</span>
                      )
                    ) : (
                      <span className="text-small text-muted">{t('bids.ranked', { count: it.choices ?? 0 })}</span>
                    )}
                    {manage && r.status === 'REVIEW' ? <Button size="sm" variant="secondary" onClick={() => setChanging(it.id)}>{t('bids.change')}</Button> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
      {closed ? (
        <Card className="max-w-4xl">
          <CardHeader title={t('bids.orderTitle')} description={t('bids.orderHelp')} />
          <CardBody className="pt-1">
            <ol className="grid gap-2">
              {r.order.map((e) => (
                <li key={e.userId} className="grid gap-1 rounded-xl border border-line p-3">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{e.rank}. {e.name}</span>
                    <span className="text-caption text-muted">{r.seniorityBasis === 'DATE' ? t('bids.seniorityLine', { date: e.seniorityDate ? formatDate(e.seniorityDate, lng, 'dated') : t('bids.noDate'), hours: e.seniorityHours.toLocaleString(lng) }) : t('bids.seniorityLineHours', { date: e.seniorityDate ? formatDate(e.seniorityDate, lng, 'dated') : t('bids.noDate'), hours: e.seniorityHours.toLocaleString(lng) })}</span>
                  </p>
                  <ul className="grid gap-1 text-small">
                    {e.outcomes.map((o) => {
                      const it = itemById.get(o.itemId);
                      return it ? (
                        <li key={o.itemId} className="flex flex-wrap items-center gap-2">
                          <span className="text-caption text-muted">#{o.rank ?? '—'}</span>
                          <span className="min-w-0">{itemWhen(it, lng, t('shiftTemplates.everyDay'))} · {it.facility}</span>
                          <StatusPill tone={o.result === 'AWARDED' ? 'ok' : o.result === 'NOT_ELIGIBLE' ? 'warn' : 'neutral'}>{outcomeText(o, t)}</StatusPill>
                        </li>
                      ) : null;
                    })}
                  </ul>
                </li>
              ))}
            </ol>
            {r.order.length ? <p className="mt-3 text-caption text-muted">{t('bids.tieNote')}</p> : <p className="text-small text-muted">{t('bids.nobodyBid')}</p>}
          </CardBody>
        </Card>
      ) : null}
      {manage ? <Override round={r} itemId={changing} onClose={() => setChanging(null)} onDone={() => void q.reload()} /> : null}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('bids.confirmTitle')}
        description={t('bids.confirmHelp')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button loading={busy === 'confirm'} onClick={() => void run('confirm', () => api<{ assigned: number; posted: number; dropped: number }>(`/api/bids/rounds/${r.id}/confirm`, { method: 'POST' })).then((x) => { setConfirming(false); if (x) void q.reload(); })}>{t('bids.confirm')}</Button>
          </>
        }
      />
    </div>
  );
}

/** Managers (their departments' rounds) and union stewards (closed rounds, read-only). */
export function BidRounds() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const params = useSearchParams();
  const q = useQuery<List>('/api/bids/rounds');
  const { run, busy } = useAction();
  const [selected, setSelected] = useState<string | null>(params.get('round'));
  const [creating, setCreating] = useState(false);
  useLiveChange('bids', () => void q.reload());
  const rounds = useMemo(() => q.data?.rounds ?? [], [q.data]);
  if (selected) return <Detail id={selected} onBack={() => { setSelected(null); void q.reload(); }} />;
  if (!q.data) return <Skeleton className="h-64" />;
  return (
    <div className="grid gap-4">
      {q.data.canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setCreating(true)}>{t('bids.newRound')}</Button>
        </div>
      ) : null}
      {q.data.canConfigure ? (
        <Card className="max-w-3xl">
          <CardBody className="grid gap-2">
            <Field label={t('bids.orgBasis')} hint={t('bids.orgBasisHint')}>
              {(p) => (
                <Select {...p} value={q.data!.seniorityBasis} disabled={busy === 'basis'} onChange={(e) => void run('basis', () => api('/api/bids/settings', { method: 'PUT', body: { seniorityBasis: e.target.value } }), t('bids.basisSaved')).then(() => q.reload())}>
                  <option value="DATE">{t('bids.basisDATE')}</option>
                  <option value="HOURS">{t('bids.basisHOURS')}</option>
                </Select>
              )}
            </Field>
          </CardBody>
        </Card>
      ) : null}
      {!rounds.length ? (
        <EmptyState icon={ListOrdered} title={t(q.data.canManage ? 'bids.noRounds' : 'bids.noClosedRounds')}>{t(q.data.canManage ? 'bids.noRoundsHelp' : 'bids.noClosedRoundsHelp')}</EmptyState>
      ) : (
        <ul className="grid max-w-3xl gap-3">
          {rounds.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setSelected(r.id)} className="grid w-full gap-1 rounded-2xl border border-line bg-panel p-4 text-left shadow-card transition-colors hover:border-brand/50">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body-strong">{r.name}</span>
                  <StatusPill tone={TONE[r.status]}>{t(`bids.status.${r.status}`)}</StatusPill>
                </span>
                <span className="text-small text-muted">
                  {t(r.kind === 'LINES' ? 'bids.kindLines' : 'bids.kindShifts')} · {t('bids.listCounts', { items: r.items, bidders: r.bidders })} · {r.status === 'OPEN' ? t('bids.closesOn', { when: formatMoment(r.closesAt, lng) }) : formatDate(r.closesAt.slice(0, 10), lng, 'dated')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <NewRound open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setSelected(id); void q.reload(); }} />
    </div>
  );
}
