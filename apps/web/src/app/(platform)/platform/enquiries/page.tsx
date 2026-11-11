'use client';

import { Inbox, Mail } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/format';
import { papi, usePlatformQuery } from '@/lib/platform';

type Status = 'NEW' | 'CONTACTED' | 'WON' | 'CLOSED';
interface Lead { id: string; kind: 'SALES' | 'DEMO' | 'SUPPORT'; name: string; email: string; organization: string | null; role: string | null; province: string | null; facilities: number | null; message: string; locale: string; marketingConsent: boolean; consent?: { state: 'EXPRESS' | 'IMPLIED' | 'WITHDRAWN' | 'NONE'; since: string | null; expires: string | null }; status: Status; notes: string | null; createdAt: string }
const TONE: Record<Status, Tone> = { NEW: 'new', CONTACTED: 'brand', WON: 'ok', CLOSED: 'neutral' };
type Filter = 'OPEN' | Status | 'ALL';

/** Enquiries from the website's contact form, to follow up. */
export default function EnquiriesPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('OPEN');
  const data = usePlatformQuery<Lead[]>('/leads');
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const rows = (data.data ?? []).filter((l) => (filter === 'ALL' ? true : filter === 'OPEN' ? l.status === 'NEW' || l.status === 'CONTACTED' : l.status === filter));
  const count = (s: Status) => (data.data ?? []).filter((l) => l.status === s).length;
  async function save(l: Lead, patch: { status?: Status; notes?: string | null }) {
    try {
      await papi(`/leads/${l.id}`, { method: 'PATCH', body: patch });
      toast(t('enquiries.saved'), 'ok');
      await data.reload();
    } catch {
      toast(t('common.error'), 'warn');
    }
  }
  return (
    <div className="grid gap-6">
      <PageHeader title={t('enquiries.title')} description={t('enquiries.description')} />
      <div className="overflow-x-auto">
        <Segmented label={t('enquiries.title')} value={filter} onChange={setFilter} options={(['OPEN', 'NEW', 'CONTACTED', 'WON', 'CLOSED', 'ALL'] as const).map((v) => ({ value: v, label: v === 'OPEN' || v === 'ALL' ? t(`enquiries.filter.${v}`) : `${t(`enquiries.status.${v}`)} (${count(v)})` }))} />
      </div>
      {!data.data ? (
        <Skeleton className="h-64" />
      ) : !rows.length ? (
        <EmptyState icon={Inbox} title={t('enquiries.none')}>{t('enquiries.noneHelp')}</EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((l) => (
            <article key={l.id}>
              <button type="button" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? null : l.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3.5 text-left hover:bg-surface/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-strong">{l.name}{l.organization ? <span className="font-normal text-muted"> · {l.organization}</span> : null}</span>
                  <span className="block truncate text-small text-muted">{t(`enquiries.kind.${l.kind}`)} · {formatDate(l.createdAt.slice(0, 10), i18n.language, 'dated')}{l.province ? ` · ${l.province}` : ''}{l.facilities ? ` · ${t('enquiries.facilities', { count: l.facilities })}` : ''}</span>
                </span>
                <StatusPill tone={TONE[l.status]}>{t(`enquiries.status.${l.status}`)}</StatusPill>
              </button>
              {open === l.id ? (
                <div className="grid gap-4 border-t border-line bg-surface/30 px-4 py-4 text-small">
                  <p className="whitespace-pre-wrap">{l.message}</p>
                  <dl className="grid gap-1 sm:grid-cols-2">
                    <div><dt className="text-caption text-muted">{t('enquiries.email')}</dt><dd className="select-all font-semibold">{l.email}</dd></div>
                    {l.role ? <div><dt className="text-caption text-muted">{t('enquiries.role')}</dt><dd>{l.role}</dd></div> : null}
                    <div><dt className="text-caption text-muted">{t('enquiries.language')}</dt><dd>{l.locale.startsWith('fr') ? 'Français' : 'English'}</dd></div>
                    <div><dt className="text-caption text-muted">{t('enquiries.marketing')}</dt><dd>{l.marketingConsent ? t('enquiries.consentYes') : t('enquiries.consentNo')}</dd></div>
                    {/* CASL status for this address today: express, implied (six months after an enquiry), or withdrawn by an unsubscribe. */}
                    {l.consent ? <div className="sm:col-span-2"><dt className="text-caption text-muted">{t('enquiries.caslNow')}</dt><dd>{t(`enquiries.casl.${l.consent.state}`, { since: l.consent.since?.slice(0, 10) ?? '', until: l.consent.expires?.slice(0, 10) ?? '' })}</dd></div> : null}
                  </dl>
                  <div className="grid gap-2">
                    <label className="text-caption font-semibold text-muted" htmlFor={`notes-${l.id}`}>{t('enquiries.notes')}</label>
                    <Textarea id={`notes-${l.id}`} rows={3} maxLength={2000} value={notes[l.id] ?? l.notes ?? ''} onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select aria-label={t('enquiries.statusLabel')} value={l.status} onChange={(e) => void save(l, { status: e.target.value as Status })} className="w-44">
                      {(['NEW', 'CONTACTED', 'WON', 'CLOSED'] as const).map((s) => <option key={s} value={s}>{t(`enquiries.status.${s}`)}</option>)}
                    </Select>
                    <Button size="sm" variant="secondary" disabled={(notes[l.id] ?? l.notes ?? '') === (l.notes ?? '')} onClick={() => void save(l, { notes: (notes[l.id] ?? '').trim() || null })}>{t('enquiries.saveNotes')}</Button>
                    <span className="flex items-center gap-1.5 text-caption text-muted"><Mail className="h-4 w-4" aria-hidden="true" />{t('enquiries.replyHint')}</span>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </Card>
      )}
    </div>
  );
}
