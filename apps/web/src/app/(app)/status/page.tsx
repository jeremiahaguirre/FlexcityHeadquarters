'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';

interface Pool {
  id: string;
  name: string;
  kind: string;
  status: 'OPEN' | 'CLOSURE_RECOMMENDED' | 'CLOSED';
  facility: { id: string; name: string };
}

const POLL_MS = 15_000;

/** Front-desk view. Status is conveyed by text and icon shape, never colour alone. */
export default function StatusPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const p = await api<Pool[]>('/api/ops/status');
        if (alive) {
          setPools(p);
          setUpdated(new Date());
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.push('/login');
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [router]);

  const style = {
    OPEN: { box: 'border-ok', text: 'text-ok', icon: '●' },
    CLOSURE_RECOMMENDED: { box: 'border-warn', text: 'text-warn', icon: '▲' },
    CLOSED: { box: 'border-danger', text: 'text-danger', icon: '■' },
  } as const;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('status.title')}</h1>
        {updated ? (
          <p className="text-sm text-muted">
            {t('status.updated', { time: new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(updated) })}
          </p>
        ) : null}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2" aria-live="polite">
        {pools?.map((p) => (
          <li key={p.id} className={`rounded-lg border-2 p-4 ${style[p.status].box}`}>
            <p className="font-medium">{p.name}</p>
            <p className="text-sm text-muted">{p.facility.name}</p>
            <p className={`mt-2 font-semibold ${style[p.status].text}`}>
              <span aria-hidden="true">{style[p.status].icon} </span>
              {t(`status.${p.status}`)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
