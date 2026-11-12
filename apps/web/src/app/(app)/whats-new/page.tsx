'use client';

import { Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { NoteBody } from '@/components/updates/NoteBody';
import { ComingChanges } from '@/components/updates/ComingChanges';
import { useSession } from '@/lib/session';
import { noteDate, pick, useWhatsNew } from '@/lib/whatsNew';

/** Every What's new note meant for this person (the last year), newest first. Opening the list counts as reading them. */
export default function WhatsNewPage() {
  const { t, i18n } = useTranslation();
  const { data, loading, markRead } = useWhatsNew();
  const { can } = useSession();
  const marked = useRef(false);
  const unread = (data?.notes ?? []).filter((n) => !n.readAt).map((n) => n.id);
  useEffect(() => {
    if (marked.current || !unread.length) return;
    marked.current = true;
    // Shown here: no sheet for them later. The "New" marks stay until the next visit.
    const id = setTimeout(() => void markRead(unread), 1500);
    return () => clearTimeout(id);
  }, [unread.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('whatsNew.title')} description={t('whatsNew.description')} />
      {can('tenant.configure') ? <ComingChanges /> : null}
      {loading && !data ? (
        <ListSkeleton rows={3} />
      ) : !data?.notes.length ? (
        <EmptyState icon={Sparkles} title={t('whatsNew.emptyTitle')}>{t('whatsNew.empty')}</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {data.notes.map((n) => (
            <li key={n.id}>
              <Card>
                <CardBody className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-caption text-muted">{noteDate(n.publishAt, i18n.language)}</p>
                    {!n.readAt ? <StatusPill tone="new">{t('whatsNew.new')}</StatusPill> : null}
                  </div>
                  <h2 className="text-subheading">{pick(i18n.language, n.title)}</h2>
                  <NoteBody text={pick(i18n.language, n.body)} />
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
