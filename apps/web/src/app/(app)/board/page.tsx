'use client';

import { CalendarPlus, HandHelping, Inbox } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PayPreview } from '@/components/PayPreview';
import { ShiftCard, type ShiftLike } from '@/components/ShiftCard';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { PageHeader } from '@/components/ui/PageHeader';
import { MyTrades } from '@/components/shiftboard/Trades';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { useQuery } from '@/lib/useQuery';

interface Offer {
  id: string;
  status: 'OPEN' | 'PENDING_APPROVAL';
  source: 'OPEN_SHIFT' | 'SWAP';
  shift: ShiftLike & { id: string; version: number };
}

export default function BoardPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const offers = useQuery<Offer[]>('/api/shiftboard/offers');
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string[] | null>(null);

  async function claim(o: Offer) {
    setBusy(o.id);
    try {
      const r = await api<{ outcome: 'ASSIGNED' | 'PENDING_APPROVAL'; overtimeHours?: string }>(`/api/offers/${o.id}/claim`, {
        method: 'POST',
        body: { expectedShiftVersion: o.shift.version },
      });
      if (r.outcome === 'ASSIGNED') toast(t('board.assigned'), 'ok');
      else toast(t('board.pendingApproval', { hours: r.overtimeHours }), 'info');
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setRefusal(((e.details as { blocks?: Array<{ code: string }> })?.blocks ?? []).map((b) => b.code));
      } else if (e instanceof ApiError && e.status === 409) toast(t('board.alreadyClaimed'), 'warn');
      else toast(t('common.error'), 'warn');
    } finally {
      setBusy(null);
      void offers.reload();
    }
  }

  return (
    <>
      <PageHeader title={t('board.title')} description={t('board.description')} />
      <div className="mb-6"><MyTrades /></div>
      {offers.loading ? (
        <ListSkeleton />
      ) : offers.error ? (
        <ErrorNotice onRetry={offers.reload} />
      ) : !offers.data?.length ? (
        <EmptyState icon={Inbox} title={t('board.empty')}>
          {t('board.emptyBody')}
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {offers.data.map((o) => (
            <ShiftCard
              key={o.id}
              shift={o.shift}
              aside={o.source === 'SWAP' ? <StatusPill tone="neutral">{t('board.swap')}</StatusPill> : <StatusPill tone="new" icon={<CalendarPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}>{t('board.open')}</StatusPill>}
              footer={
                o.status === 'PENDING_APPROVAL' ? (
                  <StatusPill tone="warn">{t('board.pendingBadge')}</StatusPill>
                ) : (
                  <>
                    <div className="mr-auto"><PayPreview offerId={o.id} /></div>
                    <Button icon={<HandHelping className="h-5 w-5" aria-hidden="true" />} loading={busy === o.id} disabled={busy !== null} onClick={() => void claim(o)}>
                      {t('board.claim')}
                    </Button>
                  </>
                )
              }
            />
          ))}
        </div>
      )}
      <Dialog
        open={refusal !== null}
        onClose={() => setRefusal(null)}
        title={t('board.notEligible')}
        description={t('board.notEligibleHelp')}
        closeLabel={t('common.close')}
        footer={<Button onClick={() => setRefusal(null)}>{t('common.ok')}</Button>}
      >
        <ul className="fh-stagger grid gap-2">
          {refusal?.map((code) => (
            <li key={code} className="flex gap-2 rounded-xl bg-warn-bg px-3 py-2 text-small text-ink">
              <span aria-hidden="true" className="text-warn">
                ▲
              </span>
              {t(`blocks.${code}`)}
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
