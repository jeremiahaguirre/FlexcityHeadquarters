'use client';

import { ChevronRight, Network, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DepartmentTabs } from '@/components/DepartmentTabs';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { departmentParam, useDepartmentTab } from '@/lib/departments';
import { type Named, type OrgNode, type OrgPerson, buildTree, filterTree, fold, withTeams } from '@/lib/orgChart';
import { useQuery } from '@/lib/useQuery';

/** Who reports to whom: an indented outline that reads the same on a phone and a desk. */
export default function OrgChartPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [department, setDepartment] = useDepartmentTab();
  const data = useQuery<{ people: OrgPerson[] }>(`/api/org-chart${departmentParam(department, true)}`);
  const [q, setQ] = useState('');
  // Opened by hand; the first two levels start open.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const label = (x: Named) => (lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const text = (p: OrgPerson) => [p.name, ...p.positions.map(label), ...p.departments.map(label)].join(' ');

  const tree = useMemo(() => buildTree(data.data?.people ?? []), [data.data]);
  const shown = useMemo(() => filterTree(tree.roots, q, text), [tree, q, lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const unplaced = q.trim() ? tree.unplaced.filter((p) => fold(text(p)).includes(fold(q.trim()))) : tree.unplaced;
  const searching = !!q.trim();
  const isOpen = (n: OrgNode, depth: number) => (searching ? shown.open.has(n.person.id) || toggled.get(n.person.id) === true : (toggled.get(n.person.id) ?? depth < 2));
  const setAll = (open: boolean) => setToggled(new Map(withTeams(tree.roots).map((id) => [id, open])));

  return (
    <>
      <PageHeader
        title={t('orgChart.title')}
        description={t('orgChart.description')}
        actions={
          tree.roots.length ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setAll(true)}>
                {t('orgChart.expandAll')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAll(false)}>
                {t('orgChart.collapseAll')}
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="mb-3">
        <DepartmentTabs value={department} onChange={setDepartment} />
      </div>
      <div className="relative mb-4 w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input type="search" aria-label={t('orgChart.search')} placeholder={t('orgChart.search')} value={q} onChange={(e) => setQ(e.target.value)} className="pl-11" autoComplete="off" />
      </div>
      {searching ? (
        <p className="sr-only" role="status">
          {t('orgChart.found', { count: shown.matches + unplaced.length })}
        </p>
      ) : null}

      {data.error ? (
        <ErrorNotice onRetry={data.reload} />
      ) : data.loading ? (
        <ListSkeleton rows={5} />
      ) : !data.data?.people.length ? (
        <EmptyState icon={Network} title={t('orgChart.none')}>
          {t('orgChart.noneHelp')}
        </EmptyState>
      ) : !shown.roots.length && !unplaced.length ? (
        <EmptyState icon={Search} title={t('orgChart.noMatch')} />
      ) : (
        <div className="grid gap-6">
          {shown.roots.length ? (
            <Card className="p-2 sm:p-3">
              <ul className="grid gap-1" aria-label={t('orgChart.title')}>
                {shown.roots.map((n) => (
                  <Branch key={n.person.id} node={n} depth={0} isOpen={isOpen} onToggle={(id, open) => setToggled((m) => new Map(m).set(id, open))} label={label} />
                ))}
              </ul>
            </Card>
          ) : null}
          {unplaced.length ? (
            <section aria-labelledby="org-unplaced">
              <h2 id="org-unplaced" className="text-subheading">
                {t('orgChart.unplaced', { count: unplaced.length })}
              </h2>
              <p className="mb-3 mt-1 text-small text-muted">{t('orgChart.unplacedHelp')}</p>
              <Card className="p-2 sm:p-3">
                <ul className="grid gap-1 sm:grid-cols-2">
                  {unplaced.map((p) => (
                    <li key={p.id}>
                      <PersonCard person={p} label={label} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

function Branch({ node, depth, isOpen, onToggle, label }: { node: OrgNode; depth: number; isOpen: (n: OrgNode, depth: number) => boolean; onToggle: (id: string, open: boolean) => void; label: (x: Named) => string }) {
  const { t } = useTranslation();
  const open = isOpen(node, depth);
  const id = `org-team-${node.person.id}`;
  const hasTeam = node.children.length > 0;
  return (
    <li>
      <div className="flex items-center gap-1">
        {hasTeam ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => onToggle(node.person.id, !open)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <ChevronRight className={cn('h-5 w-5 transition-transform duration-200', open ? 'rotate-90' : '')} aria-hidden="true" />
            <span className="sr-only">{t(open ? 'orgChart.hideTeam' : 'orgChart.showTeam', { name: node.person.name })}</span>
          </button>
        ) : (
          <span className="w-11 shrink-0" aria-hidden="true" />
        )}
        <PersonCard person={node.person} label={label} team={node.size} />
      </div>
      {hasTeam && open ? (
        <ul id={id} className="ml-[1.375rem] grid gap-1 border-l border-line pl-1 sm:pl-3">
          {node.children.map((c) => (
            <Branch key={c.person.id} node={c} depth={depth + 1} isOpen={isOpen} onToggle={onToggle} label={label} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function PersonCard({ person: p, label, team }: { person: OrgPerson; label: (x: Named) => string; team?: number }) {
  const { t } = useTranslation();
  const title = p.positions.map(label).join(', ');
  return (
    <Link href={`/manage/staff/person?id=${p.id}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface">
      <Avatar name={p.name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-strong">{p.name}</span>
        <span className="block truncate text-caption text-muted">
          {title || t('staff.noPositions')}
          {p.departments.length ? ` · ${p.departments.map(label).join(', ')}` : ''}
        </span>
      </span>
      {p.directReports ? (
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-caption tabular-nums text-muted" title={team && team > p.directReports ? t('orgChart.everyoneBelow', { count: team }) : undefined}>
          {t('orgChart.reports', { count: p.directReports })}
        </span>
      ) : null}
    </Link>
  );
}
