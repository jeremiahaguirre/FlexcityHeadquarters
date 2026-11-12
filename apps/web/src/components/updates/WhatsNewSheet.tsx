'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { blockers } from '@/lib/appUpdate';
import { noteDate, pick, useWhatsNew } from '@/lib/whatsNew';
import { NoteBody } from './NoteBody';

/**
 * New What's new notes, once per person: a calm sheet after an update or at the next sign-in.
 * It waits while anything else is in progress (another dialog, a punch on its way, unsaved typing),
 * and closing it marks the notes it showed as read.
 */
export function WhatsNewSheet() {
  const { t, i18n } = useTranslation();
  const { data, markRead } = useWhatsNew();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string[]>([]);
  const unseen = data?.unseen ?? [];

  useEffect(() => {
    if (open || !unseen.length) return;
    // Not on top of something else: look again every few seconds until the screen is quiet.
    const tryOpen = () => {
      const b = blockers();
      if (b.dialog || b.busy.length || b.dirty) return false;
      setShown(unseen.slice(0, 5));
      setOpen(true);
      return true;
    };
    if (tryOpen()) return;
    const id = setInterval(() => tryOpen() && clearInterval(id), 4000);
    return () => clearInterval(id);
  }, [unseen.join(','), open]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setOpen(false);
    void markRead(shown);
  };
  const notes = (data?.notes ?? []).filter((n) => shown.includes(n.id));
  const more = unseen.length - shown.length;
  return (
    <Dialog
      open={open && notes.length > 0}
      onClose={close}
      closeLabel={t('common.close')}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand-text" aria-hidden="true" />
          {t('whatsNew.sheetTitle')}
        </span>
      }
      footer={
        <>
          <Link href="/whats-new" onClick={close} className="inline-flex min-h-[44px] items-center px-3 text-small font-semibold text-brand-text hover:underline">
            {more > 0 ? t('whatsNew.seeAllMore', { count: more }) : t('whatsNew.seeAll')}
          </Link>
          <Button onClick={close}>{t('whatsNew.gotIt')}</Button>
        </>
      }
    >
      <div className="grid gap-5">
        {notes.map((n) => (
          <article key={n.id} className="grid gap-1.5">
            <p className="text-caption text-muted">{noteDate(n.publishAt, i18n.language)}</p>
            <h3 className="text-subheading">{pick(i18n.language, n.title)}</h3>
            <NoteBody text={pick(i18n.language, n.body)} className="grid gap-2 text-small text-ink" />
          </article>
        ))}
      </div>
    </Dialog>
  );
}
