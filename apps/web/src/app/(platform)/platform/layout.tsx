import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PRIVATE_ROBOTS } from '@/lib/crawlers';

export const metadata: Metadata = { title: 'Dev console', robots: PRIVATE_ROBOTS };

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
