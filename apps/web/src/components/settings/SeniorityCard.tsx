'use client';

import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

/** Whether the organization uses seniority (unionized cities usually do; many private companies don't). */
export function SeniorityCard() {
  const { t } = useTranslation();
  const { reload } = useSession();
  const q = useQuery<{ useSeniority: boolean }>('/api/settings/seniority');
  const { run, busy } = useAction();
  if (!q.data) return null;
  const on = q.data.useSeniority;
  return (
    <Card>
      <CardHeader title={t('seniority.title')} description={t('seniority.help')} />
      <CardBody className="pt-2">
        <label className="flex items-start gap-3 text-body text-ink">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]"
            checked={on}
            disabled={busy === 'save'}
            onChange={(e) => void run('save', () => api('/api/settings/seniority', { method: 'PUT', body: { useSeniority: e.target.checked } }), e.target.checked ? t('seniority.turnedOn') : t('seniority.turnedOff')).then(async () => { await q.reload(); await reload(); })}
          />
          <span>{t('seniority.use')}<span className="block text-small text-muted">{on ? t('seniority.onHelp') : t('seniority.offHelp')}</span></span>
        </label>
      </CardBody>
    </Card>
  );
}
