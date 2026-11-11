'use client';

/**
 * Publishing drafts, with a check first: required-coverage gaps the schedule would leave (e.g. no
 * certified operator in responsible charge), people who can no longer work a draft (a certificate
 * lapsed since), and federal 96-hour notice. Nothing to warn about: one tap publishes. Otherwise
 * the warnings are listed and "Publish anyway" needs a ticked confirmation (the API records it).
 */
import { AlertTriangle, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatTimeRange } from '@/lib/format';

export interface PublishGroup { facilityId: string; from: string; to: string; shiftIds: string[]; timezone: string }
interface Gap { ruleId: string; rule: string; date: string; from: string; to: string; have: number; need: number; localFrom?: string; localTo?: string }
interface Check { gaps: Gap[]; ineligible: Array<{ shiftId: string; name: string; codes: string[] }>; federalNotice: { count: number; hours: number } | null }

/** A UTC instant as facility-local "YYYY-MM-DDTHH:mm:00" (what the formatters take). */
function localOf(utc: string, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`;
}

export function PublishDialog({ open, groups, onClose, onPublished }: { open: boolean; groups: PublishGroup[]; onClose: () => void; onPublished: (r: { published: number; posted: number }) => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = groups.reduce((s, g) => s + g.shiftIds.length, 0);
  const tzOf = (fid: string) => groups.find((g) => g.facilityId === fid)?.timezone ?? 'America/Toronto';

  useEffect(() => {
    if (!open) return;
    setCheck(null);
    setError(null);
    setConfirmed(false);
    let live = true;
    void (async () => {
      try {
        const all: Check & { gaps: Array<Gap & { facilityId: string }> } = { gaps: [], ineligible: [], federalNotice: null };
        for (const g of groups) {
          const r = await api<Check & { gaps: Gap[] }>('/api/shifts/publish/check', { method: 'POST', body: { facilityId: g.facilityId, from: g.from, to: g.to, shiftIds: g.shiftIds } });
          all.gaps.push(...r.gaps.map((x) => ({ ...x, facilityId: g.facilityId })));
          all.ineligible.push(...r.ineligible);
          if (r.federalNotice) all.federalNotice = { count: (all.federalNotice?.count ?? 0) + r.federalNotice.count, hours: r.federalNotice.hours };
        }
        if (live) setCheck(all);
      } catch (e) {
        if (live) setError(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'));
      }
    })();
    return () => {
      live = false;
    };
    // Re-check each time it opens for a new set of shifts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groups]);

  const warned = !!check && (check.gaps.length > 0 || check.ineligible.length > 0 || !!check.federalNotice);

  async function publish() {
    setBusy(true);
    try {
      let published = 0;
      let posted = 0;
      for (const g of groups) {
        const r = await api<{ published: number; postedToBoard: number }>('/api/shifts/publish', { method: 'POST', body: { facilityId: g.facilityId, from: g.from, to: g.to, shiftIds: g.shiftIds, acknowledgeWarnings: warned && confirmed } });
        published += r.published ?? 0;
        posted += r.postedToBoard ?? 0;
      }
      onPublished({ published, posted });
    } catch (e) {
      setError(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  const gaps = check?.gaps ?? [];
  const shown = gaps.slice(0, 8);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('publishCheck.title')}
      description={t('publishCheck.ready', { count })}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button icon={<Send className="h-4 w-4" aria-hidden="true" />} loading={busy} disabled={!check || (warned && !confirmed)} onClick={() => void publish()}>
            {warned ? t('publishCheck.publishAnyway') : t('publishCheck.publish')}
          </Button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="rounded-xl bg-warn-bg px-3 py-2 text-small text-warn">{error}</p>
      ) : !check ? (
        <div className="grid gap-2" role="status" aria-live="polite">
          <p className="text-small text-muted">{t('publishCheck.checking')}</p>
          <Skeleton className="h-16" />
        </div>
      ) : !warned ? (
        <p className="text-small" role="status">{t('publishCheck.allClear')}</p>
      ) : (
        <div className="grid gap-4" role="status" aria-live="polite">
          {gaps.length ? (
            <section className="grid gap-1.5">
              <h3 className="flex items-center gap-2 text-small font-bold text-warn">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('publishCheck.gapsTitle')}
              </h3>
              <ul className="grid gap-1 text-small">
                {shown.map((g) => {
                  const tz = tzOf((g as Gap & { facilityId: string }).facilityId);
                  return (
                    <li key={`${g.ruleId}-${g.from}`} className="rounded-lg bg-warn-bg/60 px-2.5 py-1.5">
                      {t('publishCheck.gap', { rule: g.rule, date: formatDate(`${g.date}T12:00:00`, lng), time: formatTimeRange(g.localFrom ?? localOf(g.from, tz), g.localTo ?? localOf(g.to, tz), lng), have: g.have, need: g.need })}
                    </li>
                  );
                })}
              </ul>
              {gaps.length > shown.length ? <p className="text-caption text-muted">{t('publishCheck.more', { count: gaps.length - shown.length })}</p> : null}
            </section>
          ) : null}
          {check.ineligible.length ? (
            <section className="grid gap-1.5">
              <h3 className="flex items-center gap-2 text-small font-bold text-warn">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('publishCheck.ineligibleTitle')}
              </h3>
              <ul className="grid gap-1 text-small">
                {check.ineligible.slice(0, 8).map((x) => (
                  <li key={x.shiftId} className="rounded-lg bg-warn-bg/60 px-2.5 py-1.5">
                    <span className="font-semibold">{x.name}</span> · {x.codes.map((c) => t(`planner.reasonsPlain.${c}`, { defaultValue: t(`planner.reasons.${c}`, { defaultValue: c }) })).join(' · ')}
                  </li>
                ))}
              </ul>
              {check.ineligible.length > 8 ? <p className="text-caption text-muted">{t('publishCheck.more', { count: check.ineligible.length - 8 })}</p> : null}
            </section>
          ) : null}
          {check.federalNotice ? <p className="rounded-lg bg-warn-bg/60 px-2.5 py-1.5 text-small">{t('publishCheck.federal', { count: check.federalNotice.count, hours: check.federalNotice.hours })}</p> : null}
          <label className="flex min-h-11 items-start gap-3 text-small">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{t('publishCheck.confirm')}</span>
          </label>
        </div>
      )}
    </Dialog>
  );
}
