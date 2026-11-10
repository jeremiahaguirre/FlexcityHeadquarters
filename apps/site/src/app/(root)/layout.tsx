import { Analytics } from '@vercel/analytics/next';
import type { ReactNode } from 'react';
import '../globals.css';

export default function RootRedirectLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-CA">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
