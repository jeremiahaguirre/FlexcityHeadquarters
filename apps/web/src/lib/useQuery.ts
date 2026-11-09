'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from './api';

/** Load JSON from the API. Pass null to skip. `reload` refetches without flashing a loader. */
export function useQuery<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(async () => {
    if (!current.current) return;
    const p = current.current;
    try {
      const d = await api<T>(p);
      if (current.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (current.current === p) setError(e as Error);
    } finally {
      if (current.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    void load();
  }, [path, load]);

  return { data, error, loading, reload: load };
}

/**
 * Run a change against the API with consistent feedback: a success toast, or the
 * server's own explanation (translated where we know the code) as a warning.
 */
export function useAction() {
  const toast = useToast();
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <R,>(key: string, fn: () => Promise<R>, success?: string): Promise<R | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        if (success) toast(success, 'ok');
        return r;
      } catch (e) {
        if (e instanceof ApiError) toast(t(`errors.${e.code}`, { defaultValue: e.message }), 'warn');
        else toast(t('common.error'), 'warn');
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [t, toast],
  );
  return { run, busy };
}

/** Today in a facility's time zone as YYYY-MM-DD (falls back to the device). */
export function todayIso(timezone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
