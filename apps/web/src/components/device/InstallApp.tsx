'use client';

import { Download, Share, SquarePlus, MoreVertical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { type InstallWay, installWay, promptInstall } from '@/lib/device';

/**
 * "Get the app on your phone", with no app store: the web app installs to the home screen and
 * opens full-screen like any other app. Android browsers show their own install prompt; on an
 * iPhone or iPad it's Share, then Add to Home Screen. Hidden when the app is already installed.
 */
export function InstallApp({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [way, setWay] = useState<InstallWay>('none');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = () => setWay(installWay());
    update();
    window.addEventListener('fh-install-ready', update);
    return () => window.removeEventListener('fh-install-ready', update);
  }, []);
  if (way === 'none' || way === 'installed') return null;

  const steps =
    way === 'ios'
      ? [
          { icon: <Share className="h-5 w-5" aria-hidden="true" />, text: t('install.ios1') },
          { icon: <SquarePlus className="h-5 w-5" aria-hidden="true" />, text: t('install.ios2') },
          { icon: <Download className="h-5 w-5" aria-hidden="true" />, text: t('install.ios3') },
        ]
      : [
          { icon: <MoreVertical className="h-5 w-5" aria-hidden="true" />, text: t('install.android1') },
          { icon: <Download className="h-5 w-5" aria-hidden="true" />, text: t('install.android2') },
        ];

  return (
    <div className={className}>
      <Button
        variant="secondary"
        block
        icon={<Download className="h-5 w-5" aria-hidden="true" />}
        onClick={() => {
          if (way === 'prompt') void promptInstall().then(() => setWay(installWay()));
          else setOpen(true);
        }}
      >
        {t('install.button')}
      </Button>
      <p className="mt-2 text-center text-caption text-muted">{t('install.why')}</p>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('install.title')} description={t('install.help')} closeLabel={t('common.close')}>
        <ol className="grid gap-3">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-body">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/10 text-brand-text">{s.icon}</span>
              <span><span className="font-semibold">{i + 1}.</span> {s.text}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-caption text-muted">{way === 'ios' ? t('install.iosNote') : t('install.androidNote')}</p>
      </Dialog>
    </div>
  );
}
