import { SiteAnalytics } from '@/components/SiteAnalytics';
import type { ReactNode } from 'react';
import '../globals.css';

/** Layout for the bare address only (/), which sends visitors to /en/ or /fr/. */
export default function RootRedirectLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-CA" data-scroll-behavior="smooth">
      <body>
        {children}
        <SiteAnalytics />
      </body>
    </html>
  );
}
