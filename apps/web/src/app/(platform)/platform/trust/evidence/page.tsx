'use client';

import { Download, FileCheck2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trustDownload, useParam, usePeople, useTrustAccess } from '@/components/platform/trust/hooks';
import { DataTable, Drawer, Facts, TrustTabs, errorText, useDate } from '@/components/platform/trust/ui';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { FileInput } from '@/components/ui/FileInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { papi, usePlatformQuery } from '@/lib/platform';
import { daysLeft, pick } from '@/lib/trust';
import type { ControlRow } from '../controls/page';

interface Item { id: string; controlKey: string; kind: 'FILE' | 'LINK' | 'NOTE' | 'SNAPSHOT' | 'CI'; title: string; url: string | null; note: string | null; result: string | null; fileName: string | null; size: number | null; sha256: string | null; validUntil: string | null; addedBy: string | null; createdAt: string }
interface Request { id: string; controlKey: string; title: string; detail: string | null; ownerId: string | null; owner: string | null; dueAt: string; status: 'OPEN' | 'DONE' | 'CANCELLED' }

export default function EvidencePage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const date = useDate();
  const { canManage } = useTrustAccess();
  const data = usePlatformQuery<{ items: Item[]; requests: Request[] }>('/trust/evidence');
  const controls = usePlatformQuery<ControlRow[]>('/trust/controls').data ?? [];
  const control = useParam('control');
  const [open, setOpen] = useState<Item | null>(null);
  const [adding, setAdding] = useState<{ controlKey: string; requestId?: string } | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (control) setAdding({ controlKey: control });
  }, [control]);
  const title = (k: string) => {
    const c = controls.find((x) => x.key === k);
    return c ? `${k} · ${pick(c, 'title', i18n.language)}` : k;
  };
  const open_ = (data.data?.requests ?? []).filter((r) => r.status === 'OPEN');
  return (
    <div>
      <PageHeader eyebrow={t('trust.nav')} title={t('trust.section.evidence')} description={t('trust.evidence.description')}
        actions={canManage ? <><Button size="sm" variant="secondary" onClick={() => setAsking(true)}>{t('trust.evidence.request')}</Button><Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding({ controlKey: '' })}>{t('trust.evidence.add')}</Button></> : undefined} />
      <TrustTabs />
      {!data.data ? <Skeleton className="h-96" /> : (
        <div className="grid gap-5">
          <Card>
            <CardHeader title={t('trust.evidence.requests')} description={open_.length ? undefined : t('trust.evidence.noRequests')} />
            <CardBody className="pt-3">
              <ul className="divide-y divide-line">
                {open_.map((r) => {
                  const left = daysLeft(r.dueAt);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-small">
                      <span className="min-w-0 flex-1"><span className="font-semibold">{r.title}</span><span className="block text-muted">{title(r.controlKey)} · {r.owner ?? t('trust.unassigned')}</span></span>
                      <span className={cn('tabular-nums', left < 0 ? 'font-semibold text-danger' : left <= 7 ? 'font-semibold text-warn' : 'text-muted')}>{left < 0 ? t('trust.timeline.overdue', { count: -left }) : `${date(r.dueAt)}`}</span>
                      {canManage ? <Button size="sm" variant="secondary" onClick={() => setAdding({ controlKey: r.controlKey, requestId: r.id })}>{t('trust.evidence.fulfil')}</Button> : null}
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
          <DataTable<Item>
            label={t('trust.section.evidence')}
            rows={data.data.items}
            rowKey={(e) => e.id}
            onOpen={setOpen}
            emptyIcon={FileCheck2}
            emptyTitle={t('trust.evidence.none')}
            initialSort={{ key: 'added', dir: 'desc' }}
            filters={[
              { key: 'kind', label: t('trust.evidence.kind'), options: (['FILE', 'LINK', 'NOTE', 'CI', 'SNAPSHOT'] as const).map((k) => ({ value: k, label: t(`trust.evidence.kinds.${k}`) })), value: (e) => e.kind },
              { key: 'control', label: t('trust.table.control'), options: [...new Set(data.data.items.map((e) => e.controlKey))].sort().map((k) => ({ value: k, label: k })), value: (e) => e.controlKey },
            ]}
            columns={[
              { key: 'title', label: t('trust.table.title'), value: (e) => e.title },
              { key: 'control', label: t('trust.table.control'), value: (e) => e.controlKey },
              { key: 'kind', label: t('trust.evidence.kind'), value: (e) => t(`trust.evidence.kinds.${e.kind}`), render: (e) => <StatusPill tone={e.kind === 'CI' ? (e.result === 'PASS' ? 'ok' : 'danger') : 'neutral'}>{t(`trust.evidence.kinds.${e.kind}`)}{e.kind === 'CI' ? ` · ${e.result}` : ''}</StatusPill> },
              { key: 'added', label: t('trust.evidence.added'), value: (e) => e.createdAt, render: (e) => date(e.createdAt) },
              { key: 'by', label: t('trust.evidence.by'), value: (e) => e.addedBy ?? '', wide: true },
            ]}
          />
        </div>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''} subtitle={open ? title(open.controlKey) : null}
        footer={open?.kind === 'FILE' ? <Button icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void trustDownload(`/trust/evidence/${open.id}/file`, open.fileName ?? 'evidence').catch((e) => toast(errorText(e, t), 'warn'))}>{t('trust.evidence.download')}</Button> : undefined}>
        {open ? (
          <>
            <Facts items={[
              [t('trust.evidence.kind'), t(`trust.evidence.kinds.${open.kind}`)],
              [t('trust.evidence.added'), `${date(open.createdAt)} · ${open.addedBy ?? '—'}`],
              [t('trust.evidence.validUntil'), date(open.validUntil)],
              ...(open.fileName ? [[t('trust.evidence.file'), `${open.fileName} (${Math.ceil((open.size ?? 0) / 1024)} KB)`] as [string, string]] : []),
              ...(open.sha256 ? [['SHA-256', <code key="h" className="break-all text-caption">{open.sha256}</code>] as [string, JSX.Element]] : []),
            ]} />
            {open.url ? <p className="text-small"><a href={open.url} target="_blank" rel="noreferrer noopener" className="font-semibold text-brand-text underline">{open.url}</a></p> : null}
            {open.note ? <p className="whitespace-pre-wrap text-small">{open.note}</p> : null}
            {open.kind === 'FILE' ? <p className="text-caption text-muted">{t('trust.evidence.sealed')}</p> : null}
            {canManage ? <div><Button variant="ghost" size="sm" onClick={() => void papi(`/trust/evidence/${open.id}`, { method: 'DELETE' }).then(() => (setOpen(null), data.reload()))}>{t('trust.evidence.remove')}</Button></div> : null}
          </>
        ) : null}
      </Drawer>
      <AddEvidence target={adding} controls={controls} onClose={() => setAdding(null)} onDone={() => void data.reload()} />
      <AskEvidence open={asking} controls={controls} onClose={() => setAsking(false)} onDone={() => void data.reload()} />
    </div>
  );
}

const readFile = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(f);
});

function AddEvidence({ target, controls, onClose, onDone }: { target: { controlKey: string; requestId?: string } | null; controls: ControlRow[]; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [f, setF] = useState({ controlKey: '', kind: 'FILE', title: '', url: '', note: '', result: 'PASS', validUntil: '' });
  const [file, setFile] = useState<File | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (target) setF({ controlKey: target.controlKey, kind: 'FILE', title: '', url: '', note: '', result: 'PASS', validUntil: '' });
    setFile(undefined);
  }, [target]);
  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { controlKey: f.controlKey, kind: f.kind, title: f.title, note: f.note || null, validUntil: f.validUntil || null, requestId: target?.requestId };
      if (f.kind === 'LINK' || f.kind === 'CI') body.url = f.url || null;
      if (f.kind === 'CI') body.result = f.result;
      if (f.kind === 'FILE') {
        if (!file) throw new Error('file');
        body.fileName = file.name;
        body.data = await readFile(file);
      }
      await papi('/trust/evidence', { method: 'POST', body });
      toast(t('trust.saved'), 'ok');
      onDone();
      onClose();
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!target} onClose={onClose} title={t('trust.evidence.add')} description={t('trust.evidence.addHelp')} closeLabel={t('common.close')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={!f.controlKey || f.title.trim().length < 1 || (f.kind === 'FILE' && !file)} onClick={() => void save()}>{t('common.save')}</Button></>}>
      <div className="grid gap-3">
        <Field label={t('trust.table.control')}>{(p) => <Select {...p} value={f.controlKey} onChange={(e) => setF({ ...f, controlKey: e.target.value })}><option value="">—</option>{controls.map((c) => <option key={c.key} value={c.key}>{c.key} · {pick(c, 'title', i18n.language)}</option>)}</Select>}</Field>
        {f.controlKey ? <p className="text-caption text-muted">{pick(controls.find((c) => c.key === f.controlKey) ?? {}, 'evidenceHint', i18n.language)}</p> : null}
        <Field label={t('trust.evidence.kind')}>{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{(['FILE', 'LINK', 'NOTE', 'CI'] as const).map((k) => <option key={k} value={k}>{t(`trust.evidence.kinds.${k}`)}</option>)}</Select>}</Field>
        <Field label={t('trust.table.title')}>{(p) => <Input {...p} maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        {f.kind === 'FILE' ? <Field label={t('trust.evidence.file')} hint={t('trust.evidence.fileHint')}>{(p) => <FileInput id={p.id} accept="application/pdf,image/png,image/jpeg,image/webp" onFile={setFile} fileName={file?.name} />}</Field> : null}
        {f.kind === 'LINK' || f.kind === 'CI' ? <Field label={t('trust.evidence.link')}>{(p) => <Input {...p} type="url" placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />}</Field> : null}
        {f.kind === 'CI' ? <Field label={t('trust.evidence.ciResult')}>{(p) => <Select {...p} value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="PASS">{t('trust.testStatus.PASS')}</option><option value="FAIL">{t('trust.testStatus.FAIL')}</option></Select>}</Field> : null}
        <Field label={t('trust.notes')}>{(p) => <Textarea {...p} rows={3} maxLength={4000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
        <Field label={t('trust.evidence.validUntil')} hint={t('trust.evidence.validHint')}>{(p) => <Input {...p} type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function AskEvidence({ open, controls, onClose, onDone }: { open: boolean; controls: ControlRow[]; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const people = usePeople();
  const [f, setF] = useState({ controlKey: '', title: '', ownerId: '', dueAt: '' });
  async function save() {
    try {
      await papi('/trust/evidence-requests', { method: 'POST', body: { controlKey: f.controlKey, title: f.title, ownerId: f.ownerId || null, dueAt: f.dueAt } });
      toast(t('trust.saved'), 'ok');
      setF({ controlKey: '', title: '', ownerId: '', dueAt: '' });
      onDone();
      onClose();
    } catch (e) {
      toast(errorText(e, t), 'warn');
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title={t('trust.evidence.request')} closeLabel={t('common.close')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={!f.controlKey || !f.title || !f.dueAt} onClick={() => void save()}>{t('common.save')}</Button></>}>
      <div className="grid gap-3">
        <Field label={t('trust.table.control')}>{(p) => <Select {...p} value={f.controlKey} onChange={(e) => setF({ ...f, controlKey: e.target.value })}><option value="">—</option>{controls.map((c) => <option key={c.key} value={c.key}>{c.key} · {pick(c, 'title', i18n.language)}</option>)}</Select>}</Field>
        <Field label={t('trust.evidence.what')}>{(p) => <Input {...p} maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label={t('trust.table.owner')}>{(p) => <Select {...p} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">{t('trust.unassigned')}</option>{people.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
        <Field label={t('trust.table.due')}>{(p) => <Input {...p} type="date" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
