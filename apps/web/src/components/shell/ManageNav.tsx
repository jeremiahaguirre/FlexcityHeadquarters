'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { MANAGE_SECTIONS, type ManageSection, NAV, type NavItem } from '@/lib/nav';

const STORE = 'fh-nav-open';
/** Short menus stay flat; long ones (HR's) become a few sections you open as needed. */
export const SECTION_THRESHOLD = 9;

function readOpen(): ManageSection[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '[]') as ManageSection[];
  } catch {
    return [];
  }
}

type Locked = { href: string; key: string; addOn: string };

/**
 * The "Manage" part of the sidebar as collapsible sections. The section with
 * the current page is always open; others remember whether you opened them.
 */
export function ManageNav({ items, locked, activeHref, link, lockedLink }: { items: NavItem[]; locked: Locked[]; activeHref: string | null; link: (n: NavItem) => ReactNode; lockedLink: (l: Locked) => ReactNode }) {
  const { t } = useTranslation();
  const sectionOf = (href: string) => NAV.find((n) => n.href === href)?.section ?? 'organization';
  const current = activeHref ? sectionOf(activeHref) : null;
  const [open, setOpen] = useState<ManageSection[]>([]);
  useEffect(() => setOpen(readOpen()), []);
  const toggle = (s: ManageSection) =>
    setOpen((o) => {
      const next = o.includes(s) ? o.filter((x) => x !== s) : [...o, s];
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        /* private mode: still works for this visit */
      }
      return next;
    });

  return (
    <div className="grid gap-1">
      {MANAGE_SECTIONS.map((s) => {
        const list = items.filter((n) => (n.section ?? 'organization') === s);
        const lockedHere = locked.filter((l) => sectionOf(l.href) === s);
        if (!list.length && !lockedHere.length) return null;
        const isOpen = s === current || open.includes(s);
        const id = `nav-section-${s}`;
        return (
          <div key={s}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={id}
              onClick={() => toggle(s)}
              className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-small font-semibold transition-colors hover:bg-surface', s === current ? 'text-ink' : 'text-muted')}
            >
              <span className="flex-1">{t(`navSections.${s}`)}</span>
              {!isOpen ? <span className="rounded-full bg-surface px-1.5 text-caption tabular-nums text-muted">{list.length}</span> : null}
              <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform duration-200', isOpen ? 'rotate-180' : '')} aria-hidden="true" />
            </button>
            {isOpen ? (
              <div id={id} className="ml-3 grid gap-0.5 border-l border-line pb-1 pl-2">
                {list.map((n) => link(n))}
                {lockedHere.map((l) => lockedLink(l))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
