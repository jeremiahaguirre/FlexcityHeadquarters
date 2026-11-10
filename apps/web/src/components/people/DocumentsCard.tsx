'use client';

import { Download, FileText, Lock, Paperclip, Trash2, Upload } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useQuery } from '@/lib/useQuery';

const KINDS = ['MEDICAL_NOTE', 'CERTIFICATE', 'IDENTIFICATION', 'CONTRACT', 'POLICY', 'OTHER'] as const;
interface Doc { id: string; kind: (typeof KINDS)[number]; visibility: 'HR' | 'DEPARTMENT'; title: string; fileName: string; contentType: string; size: number; createdAt: string; uploadedBy: string | null }
const MAX = 10 * 1024 * 1024;
const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Files on someone's record. `userId` absent: the signed-in person's own.
 * `mode`: hr (everything, can remove), lead (department files only, no medical).
 */
export function DocumentsCard({ userId, mode = 'self' }: { userId?: string; mode?: 'self' | 'hr' | 'lead' }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const base = userId ? `/api/users/${userId}/documents` : '/api/me/documents';
  const list = useQuery<Doc[]>(base);
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Doc['kind']>(mode === 'self' ? 'MEDICAL_NOTE' : 'CERTIFICATE');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Doc | null>(null);

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get('file') as File | null;
    if (!file || !file.size) return setError(t('documents.pickFile'));
    if (file.size > MAX) return setError(t('documents.tooBig'));
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    setError(null);
    const out = await run('up', () => api(base, { method: 'POST', body: { kind, title: String(f.get('title')).trim(), fileName: file.name, data, shareWithDepartment: f.get('share') === 'on' } }), t('documents.uploaded'));
    if (out !== undefined) {
      setAdding(false);
      await list.reload();
    }
  }
  async function download(d: Doc) {
    await run(`dl${d.id}`, async () => {
      const r = await apiDownload(`/api/documents/${d.id}/file`);
      if (!r.ok) throw new Error('download');
      saveBlob(r.blob, d.fileName);
      return true;
    });
  }
  const kinds = mode === 'lead' ? KINDS.filter((k) => k !== 'MEDICAL_NOTE') : KINDS;
  return (
    <Card>
      <CardHeader
        title={mode === 'self' ? t('documents.mine') : t('documents.title')}
        description={mode === 'self' ? t('documents.mineHelp') : mode === 'lead' ? t('documents.leadHelp') : t('documents.hrHelp')}
        action={<Button size="sm" variant="secondary" icon={<Upload className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('documents.add')}</Button>}
      />
      <CardBody className="pt-2">
        {!list.data ? (
          <Skeleton className="h-16" />
        ) : !list.data.length ? (
          <p className="text-small text-muted">{t('documents.none')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface text-muted"><FileText className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-strong">{d.title}</span>
                  <span className="block truncate text-caption text-muted">{t(`documents.kinds.${d.kind}`)} · {size(d.size)} · {formatDate(d.createdAt.slice(0, 10), lng, 'dated')}{d.uploadedBy ? ` · ${d.uploadedBy}` : ''}</span>
                </span>
                {d.visibility === 'HR' ? <StatusPill tone="neutral" icon={<Lock className="h-3 w-3 shrink-0" aria-hidden="true" />}>{t('documents.hrOnly')}</StatusPill> : <StatusPill tone="brand">{t('documents.department')}</StatusPill>}
                <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" aria-hidden="true" />} loading={busy === `dl${d.id}`} onClick={() => void download(d)}>{t('documents.download')}</Button>
                {mode === 'hr' ? <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setRemoving(d)} aria-label={t('documents.remove')} /> : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('documents.add')} description={t('documents.addHelp')} closeLabel={t('common.close')}>
        <form className="grid gap-4" onSubmit={(e) => void upload(e)}>
          <Field label={t('documents.kind')}>{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as Doc['kind'])}>{kinds.map((k) => <option key={k} value={k}>{t(`documents.kinds.${k}`)}</option>)}</Select>}</Field>
          <Field label={t('documents.docTitle')}>{(p) => <Input {...p} name="title" required minLength={2} maxLength={120} placeholder={t(`documents.placeholder.${kind}`)} />}</Field>
          <Field label={t('documents.file')} hint={t('documents.fileHint')} error={error ?? undefined}>{(p) => <Input {...p} name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required className="py-2" />}</Field>
          {kind === 'MEDICAL_NOTE' ? (
            <p className="flex items-start gap-2 text-small text-muted"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('documents.medicalPrivate')}</p>
          ) : mode !== 'lead' ? (
            <label className="flex items-start gap-2 text-small"><input type="checkbox" name="share" className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" /><span>{t('documents.share')}</span></label>
          ) : (
            <p className="text-small text-muted">{t('documents.leadShared')}</p>
          )}
          <p className="flex items-start gap-2 text-caption text-muted"><Paperclip className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('documents.security')}</p>
          <div><Button type="submit" loading={busy === 'up'} icon={<Upload className="h-4 w-4" aria-hidden="true" />}>{t('documents.upload')}</Button></div>
        </form>
      </Dialog>
      <Dialog open={!!removing} onClose={() => setRemoving(null)} title={t('documents.removeTitle', { title: removing?.title ?? '' })} description={t('documents.removeHelp')} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get('reason'));
            void run('rm', () => api(`/api/documents/${removing!.id}`, { method: 'DELETE', body: { reason } }), t('documents.removed')).then(async (r) => { if (r !== undefined) { setRemoving(null); await list.reload(); } });
          }}
        >
          <Field label={t('documents.reason')}>{(p) => <Input {...p} name="reason" required minLength={3} maxLength={200} />}</Field>
          <div><Button type="submit" variant="danger" loading={busy === 'rm'}>{t('documents.remove')}</Button></div>
        </form>
      </Dialog>
    </Card>
  );
}
