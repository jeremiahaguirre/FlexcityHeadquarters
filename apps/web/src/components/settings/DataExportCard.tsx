'use client';

import { Archive, Download, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { apiDownload, saveBlob } from '@/lib/api';
import { DEMO } from '@/lib/demo';
import { useQuery } from '@/lib/useQuery';

export interface ExportSummary { tables: Array<{ table: string; rows: number }>; files: number; closed: boolean; exportUntil: string | null; deleteAfter: string | null; lastExport: { at: string } | null }

/** Everything the organization keeps here, in one zip it can open without us. */
export function DataExportCard() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const data = useQuery<ExportSummary>('/api/data-export');
  const [busy, setBusy] = useState(false);
  if (data.error) return null;
  const d = data.data;
  const rows = d ? d.tables.reduce((n, x) => n + x.rows, 0) : 0;
  const fmt = (n: number) => n.toLocaleString(i18n.language);
  async function download() {
    if (DEMO) return toast(t('dataExport.demo'), 'warn');
    setBusy(true);
    try {
      const r = await apiDownload('/api/data-export/download');
      if (!r.ok) return toast(String(r.error.message ?? t('common.error')), 'warn');
      const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'data-export.zip';
      saveBlob(r.blob, name);
      toast(t('dataExport.saved'), 'ok');
      await data.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title={t('dataExport.title')} description={t('dataExport.help')} />
      <CardBody className="grid gap-4 pt-2">
        {!d ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <p className="flex items-center gap-2 text-small"><Archive className="h-4 w-4 text-brand-text" aria-hidden="true" />{t('dataExport.size', { kinds: fmt(d.tables.length), rows: fmt(rows), files: fmt(d.files) })}</p>
            <ul className="grid gap-1 text-caption text-muted sm:grid-cols-2">
              <li>{t('dataExport.has.csv')}</li>
              <li>{t('dataExport.has.files')}</li>
              <li>{t('dataExport.has.sealed')}</li>
              <li>{t('dataExport.has.notUnion')}</li>
            </ul>
            <p className="flex items-start gap-2 rounded-xl bg-warn-bg px-3 py-2 text-small text-warn"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('dataExport.sensitive')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button icon={<Download className="h-4 w-4" aria-hidden="true" />} loading={busy} onClick={() => void download()}>{t('dataExport.download')}</Button>
              {d.lastExport ? <span className="text-caption text-muted">{t('dataExport.last', { time: new Date(d.lastExport.at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) })}</span> : null}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
