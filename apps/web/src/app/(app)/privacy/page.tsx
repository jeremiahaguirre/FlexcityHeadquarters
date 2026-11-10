'use client';

import { Eye, Lock, type LucideIcon, MapPin, ScrollText, Timer, UserCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';

const SECTIONS: Array<{ key: string; icon: LucideIcon }> = [
  { key: 'collect', icon: ScrollText },
  { key: 'see', icon: Eye },
  { key: 'monitoring', icon: MapPin },
  { key: 'keep', icon: Timer },
  { key: 'rights', icon: UserCheck },
  { key: 'security', icon: Lock },
];

/** What the app keeps about the person reading it, who sees it, and their rights: the notice every employee can open. */
export default function PrivacyNoticePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('privacyNotice.title')} description={t('privacyNotice.intro')} />
      <div className="grid max-w-3xl gap-4">
        {SECTIONS.map(({ key, icon: Icon }) => (
          <Card key={key}>
            <CardBody className="flex gap-4">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-text" aria-hidden />
              <div className="grid gap-2">
                <h2 className="text-body-strong">{t(`privacyNotice.${key}.title`)}</h2>
                <ul className="grid list-disc gap-1 pl-5 text-small text-muted">
                  {(t(`privacyNotice.${key}.items`, { returnObjects: true }) as string[]).map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            </CardBody>
          </Card>
        ))}
        <p className="text-caption text-muted">{t('privacyNotice.footer')}</p>
      </div>
    </>
  );
}
