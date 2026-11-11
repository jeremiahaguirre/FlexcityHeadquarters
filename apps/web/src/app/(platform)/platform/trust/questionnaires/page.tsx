'use client';

import { Copy, MessageSquareText, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTrustAccess } from '@/components/platform/trust/hooks';
import { DataTable, Drawer, TrustTabs, errorText, useDate } from '@/components/platform/trust/ui';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { papi, usePlatformQuery } from '@/lib/platform';
import { daysLeft, pick } from '@/lib/trust';

interface Answer { id: string; category: string; question: string; questionFr: string; answer: string; answerFr: string; controlKeys: string[]; lastReviewedAt: string; reviewedBy: string | null }
/** Approved answers are re-read at least yearly. */
const stale = (a: Answer) => daysLeft(a.lastReviewedAt) < -365;
const blank = { category: '', question: '', questionFr: '', answer: '', answerFr: '', controlKeys: '' };

export default function QuestionnairesPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const date = useDate();
  const { canManage } = useTrustAccess();
  const data = usePlatformQuery<Answer[]>('/trust/answers');
  const [open, setOpen] = useState<Answer | 'new' | null>(null);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const a = open && open !== 'new' ? open : null;
  useEffect(() => {
    if (open === 'new') setF(blank);
    else if (open) setF({ ...open, controlKeys: open.controlKeys.join(', ') });
  }, [open]);
  async function save(reviewedOnly = false) {
    setBusy(true);
    try {
      const body = reviewedOnly ? { reviewed: true } : { ...f, controlKeys: f.controlKeys.split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase()) };
      await papi(a ? `/trust/answers/${a.id}` : '/trust/answers', { method: a ? 'PATCH' : 'POST', body });
      toast(t('trust.saved'), 'ok');
      await data.reload();
      setOpen(null);
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setBusy(false);
    }
  }
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => toast(t('trust.answers.copied'), 'ok'));
  return (
    <div>
      <PageHeader eyebrow={t('trust.nav')} title={t('trust.section.questionnaires')} description={t('trust.answers.description')}
        actions={canManage ? <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpen('new')}>{t('trust.answers.add')}</Button> : undefined} />
      <TrustTabs />
      {!data.data ? <Skeleton className="h-96" /> : (
        <DataTable<Answer>
          label={t('trust.section.questionnaires')}
          rows={data.data}
          rowKey={(x) => x.id}
          onOpen={setOpen}
          emptyIcon={MessageSquareText}
          emptyTitle={t('trust.table.none')}
          filters={[
            { key: 'cat', label: t('trust.table.category'), options: [...new Set(data.data.map((x) => x.category))].sort().map((c) => ({ value: c, label: c })), value: (x) => x.category },
            { key: 'fresh', label: t('trust.answers.review'), options: [{ value: 'stale', label: t('trust.answers.stale') }, { value: 'ok', label: t('trust.answers.current') }], value: (x) => (stale(x) ? 'stale' : 'ok') },
          ]}
          columns={[
            { key: 'q', label: t('trust.answers.question'), value: (x) => pick(x, 'question', i18n.language) },
            { key: 'a', label: t('trust.answers.answer'), value: (x) => pick(x, 'answer', i18n.language), render: (x) => <span className="line-clamp-2 text-muted">{pick(x, 'answer', i18n.language)}</span>, wide: true },
            { key: 'cat', label: t('trust.table.category'), value: (x) => x.category },
            { key: 'reviewed', label: t('trust.answers.lastReviewed'), value: (x) => x.lastReviewedAt, render: (x) => (stale(x) ? <StatusPill tone="warn">{date(x.lastReviewedAt)}</StatusPill> : date(x.lastReviewedAt)) },
          ]}
        />
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={a ? pick(a, 'question', i18n.language) : t('trust.answers.add')} subtitle={a ? t('trust.answers.reviewedBy', { date: date(a.lastReviewedAt), name: a.reviewedBy ?? '—' }) : null}
        footer={canManage ? <>{a ? <Button variant="ghost" onClick={() => void save(true)}>{t('trust.answers.stillRight')}</Button> : null}<Button variant="secondary" onClick={() => setOpen(null)}>{t('common.cancel')}</Button><Button loading={busy} disabled={!f.category || !f.question || !f.questionFr || !f.answer || !f.answerFr} onClick={() => void save()}>{t('common.save')}</Button></> : undefined}>
        {a ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="secondary" size="sm" icon={<Copy className="h-4 w-4" aria-hidden="true" />} onClick={() => copy(a.answer)}>{t('trust.answers.copyEn')}</Button>
            <Button variant="secondary" size="sm" icon={<Copy className="h-4 w-4" aria-hidden="true" />} onClick={() => copy(a.answerFr)}>{t('trust.answers.copyFr')}</Button>
          </div>
        ) : null}
        <fieldset disabled={!canManage} className="grid gap-3">
          <Field label={t('trust.table.category')}>{(p) => <Input {...p} maxLength={80} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />}</Field>
          <Field label={t('trust.answers.questionEn')}>{(p) => <Textarea {...p} rows={2} maxLength={500} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} />}</Field>
          <Field label={t('trust.answers.answerEn')}>{(p) => <Textarea {...p} rows={4} maxLength={4000} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} />}</Field>
          <Field label={t('trust.answers.questionFr')}>{(p) => <Textarea {...p} lang="fr-CA" rows={2} maxLength={500} value={f.questionFr} onChange={(e) => setF({ ...f, questionFr: e.target.value })} />}</Field>
          <Field label={t('trust.answers.answerFr')}>{(p) => <Textarea {...p} lang="fr-CA" rows={4} maxLength={4000} value={f.answerFr} onChange={(e) => setF({ ...f, answerFr: e.target.value })} />}</Field>
          <Field label={t('trust.risks.controls')} hint={t('trust.risks.controlsHint')}>{(p) => <Input {...p} value={f.controlKeys} onChange={(e) => setF({ ...f, controlKeys: e.target.value })} />}</Field>
        </fieldset>
      </Drawer>
    </div>
  );
}
