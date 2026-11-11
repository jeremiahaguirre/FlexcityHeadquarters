'use client';

import { ArrowDown, ArrowUp, ListOrdered, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { type BidItem, type MyRound, itemSpan, itemWhen, move, ordinal, outcomeText } from '@/lib/bidding';
import { formatDate, formatInstant, formatMoment } from '@/lib/format';
import { useLiveChange } from '@/lib/useLiveChange';
import { useAction, useQuery } from '@/lib/useQuery';

export function ItemLine({ item }: { item: BidItem }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const pos = lng === 'fr-CA' && item.position.nameFr ? item.position.nameFr : item.position.name;
  const span = itemSpan(item, lng, t);
  return (
    <span className="grid min-w-0">
      <span className="font-semibold">{itemWhen(item, lng, t('shiftTemplates.everyDay'))}</span>
      <span className="text-small text-muted">
        {pos} · {item.facility}
        {span ? ` · ${span}` : ''}
      </span>
    </span>
  );
}

/** How the order and awarding work, in plain words (always one tap away). */
export function HowItWorks({ round }: { round: Pick<MyRound, 'seniorityBasis' | 'maxAwardsPerPerson'> }) {
  const { t } = useTranslation();
  return (
    <details className="rounded-2xl bg-surface p-3 text-small">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">{t('bids.howTitle')}</summary>
      <ol className="mt-2 grid list-decimal gap-1 pl-5">
        <li>{t(round.seniorityBasis === 'DATE' ? 'bids.howOrderDate' : 'bids.howOrderHours')}</li>
        <li>{t('bids.howAward', { count: round.maxAwardsPerPerson })}</li>
        <li>{t('bids.howEligible')}</li>
        <li>{t('bids.howReview')}</li>
        <li>{t('bids.howRest')}</li>
      </ol>
    </details>
  );
}

function RoundCard({ round, onSaved }: { round: MyRound; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { run, busy } = useAction();
  const [ranked, setRanked] = useState<string[]>(round.myChoices);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setRanked(round.myChoices);
    setDirty(false);
  }, [round.myChoices]);
  const now = Date.now();
  const open = round.status === 'OPEN' && Date.parse(round.opensAt) <= now && now < Date.parse(round.closesAt);
  const upcoming = round.status === 'OPEN' && Date.parse(round.opensAt) > now;
  const byId = new Map(round.items.map((i) => [i.id, i]));
  const unranked = round.items.filter((i) => !ranked.includes(i.id));
  const set = (next: string[]) => {
    setRanked(next);
    setDirty(true);
  };
  const s = round.seniority;
  const status = open ? (
    <StatusPill tone="ok">{t('bids.openUntil', { when: formatMoment(round.closesAt, lng) })}</StatusPill>
  ) : upcoming ? (
    <StatusPill tone="pending">{t('bids.opensOn', { when: formatMoment(round.opensAt, lng) })}</StatusPill>
  ) : round.status === 'REVIEW' ? (
    <StatusPill tone="pending">{t('bids.inReview')}</StatusPill>
  ) : round.status === 'AWARDED' ? (
    <StatusPill tone="brand">{t('bids.awardedStatus')}</StatusPill>
  ) : (
    <StatusPill tone="neutral">{t('bids.closed')}</StatusPill>
  );
  return (
    <Card className="max-w-3xl">
      <CardHeader title={round.name} description={round.rangeFrom && round.rangeTo ? t('bids.season', { from: formatDate(round.rangeFrom, lng, 'dated'), to: formatDate(round.rangeTo, lng, 'dated') }) : t(round.kind === 'LINES' ? 'bids.kindLines' : 'bids.kindShifts')} action={status} />
      <CardBody className="grid gap-4 pt-1">
        <div className="rounded-2xl border border-line p-3">
          <p className="text-body-strong">{t('bids.myPlace', { place: ordinal(s.rank, lng), count: s.of })}</p>
          <p className="text-small text-muted">
            {round.seniorityBasis === 'DATE'
              ? t('bids.byDate', { date: s.seniorityDate ? formatDate(s.seniorityDate, lng, 'dated') : t('bids.noDate') })
              : t('bids.byHours', { hours: s.seniorityHours.toLocaleString(lng) })}
            {' '}
            {t('bids.maxAwards', { count: round.maxAwardsPerPerson })}
          </p>
        </div>
        <HowItWorks round={round} />
        {round.result ? (
          <section className="grid gap-2" aria-labelledby={`res-${round.id}`}>
            <h3 id={`res-${round.id}`} className="text-body-strong">{round.result.awarded.length ? t('bids.youGot', { count: round.result.awarded.length }) : t('bids.youGotNone')}</h3>
            <ul className="grid gap-2">
              {round.result.outcomes.map((o) => {
                const it = byId.get(o.itemId);
                if (!it) return null;
                return (
                  <li key={o.itemId} className="grid gap-1 rounded-xl bg-surface px-3 py-2 sm:grid-cols-[2rem_1fr_auto] sm:items-center">
                    <span className="text-caption font-semibold text-muted">{o.rank ? `#${o.rank}` : '—'}</span>
                    <ItemLine item={it} />
                    <StatusPill tone={o.result === 'AWARDED' ? 'ok' : o.result === 'NOT_ELIGIBLE' ? 'warn' : 'neutral'}>{outcomeText(o, t)}</StatusPill>
                  </li>
                );
              })}
            </ul>
            {round.result.awarded.length ? <p className="text-caption text-muted">{t('bids.onSchedule')}</p> : <p className="text-caption text-muted">{t('bids.boardHint')}</p>}
          </section>
        ) : (
          <>
            <section className="grid gap-2" aria-labelledby={`rank-${round.id}`}>
              <h3 id={`rank-${round.id}`} className="text-body-strong">{t('bids.myRanking')}</h3>
              {ranked.length ? (
                <ol className="grid gap-2">
                  {ranked.map((id, i) => {
                    const it = byId.get(id);
                    if (!it) return null;
                    return (
                      <li key={id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-caption font-bold text-brand-contrast" aria-hidden="true">{i + 1}</span>
                        <span className="min-w-0 flex-1 basis-48"><ItemLine item={it} /></span>
                        {open ? (
                          <span className="ml-auto flex shrink-0">
                            <Button variant="ghost" size="sm" className="h-11 w-11 px-0" aria-label={t('bids.moveUp', { n: i + 1 })} disabled={i === 0} icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />} onClick={() => set(move(ranked, i, -1))} />
                            <Button variant="ghost" size="sm" className="h-11 w-11 px-0" aria-label={t('bids.moveDown', { n: i + 1 })} disabled={i === ranked.length - 1} icon={<ArrowDown className="h-4 w-4" aria-hidden="true" />} onClick={() => set(move(ranked, i, 1))} />
                            <Button variant="ghost" size="sm" className="h-11 w-11 px-0" aria-label={t('bids.remove', { n: i + 1 })} icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={() => set(ranked.filter((x) => x !== id))} />
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-small text-muted">{open ? t('bids.noneRanked') : upcoming ? t('bids.notYet') : t('bids.didntBid')}</p>
              )}
              {open ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button loading={busy === 'save'} disabled={!dirty} onClick={() => void run('save', () => api(`/api/me/bids/${round.id}/choices`, { method: 'PUT', body: { itemIds: ranked } }), t('bids.saved')).then((r) => { if (r) { setDirty(false); onSaved(); } })}>{t('bids.save')}</Button>
                  <span className="text-caption text-muted">{t('bids.changeUntil', { when: formatInstant(round.closesAt, lng, 'dated') })}</span>
                </div>
              ) : round.status === 'REVIEW' ? (
                <p className="text-small text-muted">{t('bids.reviewHint')}</p>
              ) : null}
            </section>
            {open && unranked.length ? (
              <section className="grid gap-2" aria-labelledby={`avail-${round.id}`}>
                <h3 id={`avail-${round.id}`} className="text-body-strong">{t(round.kind === 'LINES' ? 'bids.linesToRank' : 'bids.shiftsToRank')}</h3>
                <ul className="grid gap-2">
                  {unranked.map((it) => (
                    <li key={it.id} className="flex items-center gap-2 rounded-xl bg-surface p-2">
                      <span className="min-w-0 flex-1 pl-1"><ItemLine item={it} /></span>
                      <Button size="sm" variant="secondary" className="min-h-11 shrink-0" disabled={ranked.length >= round.maxChoices} icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => set([...ranked, it.id])}>{t('bids.add')}</Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** Staff: rounds I can bid in, my ranking, my place in the seniority order, and the results with reasons. */
export function MyBids() {
  const { t } = useTranslation();
  const q = useQuery<MyRound[]>('/api/me/bids');
  useLiveChange('bids', () => void q.reload());
  if (!q.data) return <Skeleton className="h-64" />;
  if (!q.data.length) return <EmptyState icon={ListOrdered} title={t('bids.noneOpen')}>{t('bids.noneOpenHelp')}</EmptyState>;
  return (
    <div className="grid gap-4">
      {q.data.map((r) => (
        <RoundCard key={r.id} round={r} onSaved={() => void q.reload()} />
      ))}
    </div>
  );
}
