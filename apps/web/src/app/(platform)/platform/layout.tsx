import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PlatformShell } from '@/components/platform/PlatformShell';

export const metadata: Metadata = { title: 'Dev console', robots: { index: false, follow: false } };

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
