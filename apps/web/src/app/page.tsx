'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Client-side redirect so the page also works in the static demo export. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/board');
  }, [router]);
  return null;
}
