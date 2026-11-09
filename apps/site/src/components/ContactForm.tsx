'use client';

import { useEffect, useState } from 'react';
import type { Lang } from '@/content/copy';
import { LeadForm } from './LeadForm';

/** Picks the topic from the link (?kind=DEMO from "Book a walkthrough"). */
export function ContactForm({ lang }: { lang: Lang }) {
  const [kind, setKind] = useState<'SALES' | 'DEMO' | 'SUPPORT'>('SALES');
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('kind');
    if (k === 'DEMO' || k === 'SUPPORT' || k === 'SALES') setKind(k);
  }, []);
  return <LeadForm key={kind} lang={lang} kind={kind} />;
}
