import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { DEMO } from '@/lib/demo';

export const metadata: Metadata = { title: 'Dev console', robots: { index: false, follow: false } };

export default function PlatformLayout({ children }: { children: ReactNode }) {
  // The public demo has no Dev console.
  if (DEMO) redirect('/login');
  return <PlatformShell>{children}</PlatformShell>;
}
