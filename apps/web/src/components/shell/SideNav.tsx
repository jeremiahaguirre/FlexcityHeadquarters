'use client';

import { ChevronDown } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { NavItem } from '@/lib/nav';
import { ManageNav, SECTION_THRESHOLD } from './ManageNav';

const GROUPS: Array<NavItem['group']> = ['mine', 'deck', 'manage', 'union'];
/** Past this many screens, each group folds away until you need it. */
const LONG_MENU = 14;
const STORE = 'fh-nav-groups';
type Locked = { href: string; key: string; group: NavItem['group']; addOn: string };

export function SideNav({ items, locked, activeHref, link, lockedLink }: { items: NavItem[]; locked: Locked[]; activeHref: string | null; link: (n: NavItem) => ReactNode; lockedLink: (l: Locked) => ReactNode }) {
  const { t } = useTranslation();
  const long = items.length + locked.length >= LONG_MENU;
  const activeGroup = items.find((n) => n.href === activeHref)?.group ?? null;
  const [open, setOpen] = useState<Array<NavItem['group']>>([]);
  useEffect(() => {
    try {
      setOpen(JSON.parse(localStorage.getItem(STORE) ?? '[]'));
    } catch {
      /* first visit or private mode */
    }
  }, []);
  const toggle = (g: NavItem['group']) =>
    setOpen((o) => {
      const next = o.includes(g) ? o.filter((x) => x !== g) : [...o, g];
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        /* fine */
      }
      return next;
    });

  return (
    <div className={long ? 'grid gap-2' : 'space-y-6'}>
      {GROUPS.map((g) => {
        const list = items.filter((n) => n.group === g);
        const lockedHere = locked.filter((l) => l.group === g);
        if (!list.length) return null;
        const sectioned = g === 'manage' && list.length + lockedHere.length >= SECTION_THRESHOLD;
        const body = sectioned ? (
          <ManageNav items={list} locked={lockedHere} activeHref={activeHref} link={link} lockedLink={(l) => lockedLink(l as Locked)} />
        ) : (
          <div className="grid gap-0.5">
            {list.map((n) => link(n))}
            {lockedHere.map((l) => lockedLink(l))}
          </div>
        );
        if (!long) {
          return (
            <div key={g}>
              <p className="mb-1.5 px-3 text-label uppercase text-muted">{t(`navGroups.${g}`)}</p>
              {body}
            </div>
          );
        }
        const isOpen = g === activeGroup || open.includes(g);
        return (
          <div key={g}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(g)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-label uppercase text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <span className="flex-1">{t(`navGroups.${g}`)}</span>
              {!isOpen ? <span className="rounded-full bg-surface px-1.5 normal-case tracking-normal tabular-nums">{list.length}</span> : null}
              <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', isOpen ? 'rotate-180' : '')} aria-hidden="true" />
            </button>
            {isOpen ? <div className="mt-1">{body}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
