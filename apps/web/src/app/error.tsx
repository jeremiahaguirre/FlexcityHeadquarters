'use client';

import { useEffect } from 'react';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { reportError } from '@/lib/errorReporting';

/**
 * The error boundary for every page: a page that throws while rendering shows the usual notice
 * with "Try again" instead of a blank screen, and the error is reported (scrubbed, no form contents).
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError('boundary', error, { digest: error.digest });
  }, [error]);
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <ErrorNotice onRetry={reset} />
    </main>
  );
}
