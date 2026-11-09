'use client';

import { useTranslation } from 'react-i18next';
import { PasskeysCard } from '@/components/auth/PasskeysCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { platformAddPasskey } from '@/lib/passkeys';
import { papi } from '@/lib/platform';

export default function PlatformAccount() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('platform.account')} description={t('platform.accountHelp')} />
      <div className="max-w-2xl">
        <PasskeysCard list={() => papi('/passkeys')} add={platformAddPasskey} remove={(id) => papi(`/passkeys/${id}`, { method: 'DELETE' })} />
      </div>
    </>
  );
}
