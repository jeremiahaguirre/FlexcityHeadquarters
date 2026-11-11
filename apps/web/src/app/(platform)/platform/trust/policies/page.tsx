'use client';

import { BookCheck, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/platform/trust/charts';
import { useParam, usePeople, useTrustAccess } from '@/components/platform/trust/hooks';
import { DataTable, Drawer, Facts, TrustTabs, errorText, useDate } from '@/components/platform/trust/ui';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { papi, usePlatformQuery } from '@/lib/platform';
import { fr, pick } from '@/lib/trust';

interface Version { id: string; version: number; status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'RETIRED'; body: string; bodyFr: string; changeNote: string | null; createdAt: string; createdBy: string | null; approvedAt: string | null; approvedBy: string | null; publishedAt: string | null; acks: number }
interface Policy { id: string; key: string; title: string; titleFr: string; ownerId: string | null; owner: string | null; reviewEveryMonths: number; nextReviewAt: string | null; status: Version['status']; publishedVersion: number | null; acknowledged: number; mine: boolean | null; pending: string[]; versions: Version[] }
const TONE: Record<Version['status'], Tone> = { DRAFT: 'neutral', APPROVED: 'brand', PUBLISHED: 'ok', RETIRED: 'neutral' };

/** Trust: policies from draft to approval and publication, and which console admins have accepted each one. */
export default function PoliciesPage() {
  const { t, i18n } = useTranslation();
  const date = useDate();
  const data = usePlatformQuery<{ admins: number; policies: Policy[] }>('/trust/policies');
  const id = useParam('id');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setOpenId(id), [id]);
  const open = data.data?.policies.find((p) => p.id === openId) ?? null;
  const all = data.data?.policies ?? [];
  const published = all.filter((p) => p.status === 'PUBLISHED');
  const mineToDo = published.filter((p) => p.mine === false);
  return (
    <div>
      <PageHeader eyebrow={t('trust.nav')} title={t('trust.section.policies')} description={t('trust.policies.description')} />
      <TrustTabs />
      {!data.data ? <Skeleton className="h-96" /> : (
        <div className="grid gap-4">
          <Card>
            <CardBody className="grid gap-4 md:grid-cols-2">
              <Progress done={published.reduce((s, p) => s + p.acknowledged, 0)} total={published.length * data.data.admins} label={t('trust.policies.ackOverall')} />
              <p className="text-small">{mineToDo.length ? t('trust.policies.yourTurn', { count: mineToDo.length }) : <span className="inline-flex items-center gap-1.5 text-ok"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('trust.policies.allRead')}</span>}</p>
            </CardBody>
          </Card>
          <DataTable<Policy>
            label={t('trust.section.policies')}
            rows={all}
            rowKey={(p) => p.id}
            onOpen={(p) => setOpenId(p.id)}
            emptyIcon={BookCheck}
            emptyTitle={t('trust.table.none')}
            filters={[{ key: 'status', label: t('trust.table.status'), options: (['DRAFT', 'APPROVED', 'PUBLISHED'] as const).map((s) => ({ value: s, label: t(`trust.policyStatus.${s}`) })), value: (p) => p.status }]}
            columns={[
              { key: 'title', label: t('trust.table.title'), value: (p) => pick(p, 'title', i18n.language) },
              { key: 'status', label: t('trust.table.status'), value: (p) => p.status, render: (p) => <StatusPill tone={TONE[p.status]}>{t(`trust.policyStatus.${p.status}`)}{p.publishedVersion ? ` · v${p.publishedVersion}` : ''}</StatusPill> },
              { key: 'acks', label: t('trust.policies.acks'), value: (p) => (p.status === 'PUBLISHED' ? p.acknowledged : -1), render: (p) => (p.status === 'PUBLISHED' ? `${p.acknowledged} / ${data.data!.admins}` : '—') },
              { key: 'mine', label: t('trust.policies.you'), value: (p) => (p.mine === null ? '' : p.mine ? 'y' : 'n'), render: (p) => (p.mine === null ? '—' : p.mine ? <StatusPill tone="ok">{t('trust.policies.accepted')}</StatusPill> : <StatusPill tone="warn">{t('trust.policies.toRead')}</StatusPill>) },
              { key: 'owner', label: t('trust.table.owner'), value: (p) => p.owner ?? '', render: (p) => p.owner ?? <span className="text-muted">{t('trust.unassigned')}</span>, wide: true },
              { key: 'review', label: t('trust.policies.nextReview'), value: (p) => p.nextReviewAt ?? '', render: (p) => date(p.nextReviewAt) },
            ]}
          />
        </div>
      )}
      <PolicyDrawer policy={open} onClose={() => setOpenId(null)} onChanged={() => void data.reload()} />
    </div>
  );
}

function PolicyDrawer({ policy: p, onClose, onChanged }: { policy: Policy | null; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const date = useDate();
  const people = usePeople();
  const { canManage } = useTrustAccess();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ body: '', bodyFr: '', changeNote: '' });
  const [busy, setBusy] = useState(false);
  const latest = p?.versions[0];
  const shown = p?.versions.find((v) => v.status === 'PUBLISHED') ?? latest;
  useEffect(() => {
    setEditing(false);
    if (latest) setDraft({ body: latest.body, bodyFr: latest.bodyFr, changeNote: '' });
  }, [p?.id, latest?.id]);
  const act = async (path: string, body?: object) => {
    setBusy(true);
    try {
      await papi(path, { method: path.endsWith('/') ? 'PATCH' : 'POST', body });
      toast(t('trust.saved'), 'ok');
      onChanged();
      setEditing(false);
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: object) => void papi(`/trust/policies/${p!.id}`, { method: 'PATCH', body }).then(() => (toast(t('trust.saved'), 'ok'), onChanged())).catch((e) => toast(errorText(e, t), 'warn'));
  return (
    <Drawer open={!!p} onClose={onClose} title={p ? pick(p, 'title', i18n.language) : ''} subtitle={p ? <StatusPill tone={TONE[p.status]}>{t(`trust.policyStatus.${p.status}`)}</StatusPill> : null}
      footer={p ? (
        <>
          {p.mine === false ? <Button loading={busy} onClick={() => void act(`/trust/policies/${p.id}/ack`)}>{t('trust.policies.accept')}</Button> : null}
          {canManage && latest?.status === 'DRAFT' && !editing ? <Button variant="secondary" onClick={() => setEditing(true)}>{t('trust.policies.edit')}</Button> : null}
          {canManage && latest?.status === 'PUBLISHED' && !editing ? <Button variant="secondary" onClick={() => setEditing(true)}>{t('trust.policies.newVersion')}</Button> : null}
          {canManage && latest?.status === 'DRAFT' && !editing ? <Button loading={busy} onClick={() => void act(`/trust/policies/${p.id}/versions/${latest.id}/approve`)}>{t('trust.policies.approve')}</Button> : null}
          {canManage && latest?.status === 'APPROVED' ? <Button loading={busy} onClick={() => void act(`/trust/policies/${p.id}/versions/${latest.id}/publish`)}>{t('trust.policies.publish')}</Button> : null}
          {editing ? <><Button variant="secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</Button><Button loading={busy} onClick={() => void act(`/trust/policies/${p.id}/versions`, draft)}>{t('trust.policies.saveDraft')}</Button></> : null}
        </>
      ) : undefined}>
      {p && shown ? (
        <>
          <Facts items={[
            [t('trust.policies.version'), `v${shown.version}${shown.changeNote ? ` · ${shown.changeNote}` : ''}`],
            [t('trust.policies.approved'), shown.approvedAt ? `${date(shown.approvedAt)} · ${shown.approvedBy ?? ''}` : '—'],
            [t('trust.policies.published'), date(shown.publishedAt)],
            [t('trust.policies.nextReview'), date(p.nextReviewAt)],
          ]} />
          {p.status === 'PUBLISHED' && p.pending.length ? <p className="text-small text-warn">{t('trust.policies.pending', { names: p.pending.join(', ') })}</p> : null}
          {editing ? (
            <div className="grid gap-3">
              <Field label={t('trust.policies.textEn')}>{(f) => <Textarea {...f} rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />}</Field>
              <Field label={t('trust.policies.textFr')}>{(f) => <Textarea {...f} rows={12} lang="fr-CA" value={draft.bodyFr} onChange={(e) => setDraft({ ...draft, bodyFr: e.target.value })} />}</Field>
              <Field label={t('trust.policies.changeNote')}>{(f) => <Input {...f} maxLength={300} value={draft.changeNote} onChange={(e) => setDraft({ ...draft, changeNote: e.target.value })} />}</Field>
            </div>
          ) : (
            <article className="whitespace-pre-wrap rounded-xl bg-surface/60 p-4 text-small leading-relaxed" lang={fr(i18n.language) ? 'fr-CA' : 'en-CA'}>{fr(i18n.language) ? shown.bodyFr : shown.body}</article>
          )}
          {canManage ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('trust.table.owner')}>{(f) => <Select {...f} value={p.ownerId ?? ''} onChange={(e) => patch({ ownerId: e.target.value || null })}><option value="">{t('trust.unassigned')}</option>{people.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
              <Field label={t('trust.policies.reviewEvery')}>{(f) => <Select {...f} value={String(p.reviewEveryMonths)} onChange={(e) => patch({ reviewEveryMonths: Number(e.target.value) })}>{[6, 12, 24].map((m) => <option key={m} value={m}>{t('trust.months', { count: m })}</option>)}</Select>}</Field>
            </div>
          ) : null}
          <div>
            <h3 className="text-small font-semibold">{t('trust.policies.history')}</h3>
            <ol className="mt-2 grid gap-1 text-small">{p.versions.map((v) => <li key={v.id} className="flex flex-wrap gap-2"><span className="font-semibold">v{v.version}</span><StatusPill tone={TONE[v.status]}>{t(`trust.policyStatus.${v.status}`)}</StatusPill><span className="text-muted">{date(v.createdAt)}{v.acks ? ` · ${t('trust.policies.ackCount', { count: v.acks })}` : ''}</span></li>)}</ol>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}
