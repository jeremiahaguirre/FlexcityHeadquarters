import type { Metadata } from 'next';
import { JobsList } from '@/components/jobs/JobsList';
import { DEMO } from '@/lib/demo';
import { publicJobs, siteOrigin } from '@/lib/publicJobs';
import { currentTenant } from '@/lib/tenant';

/** Public careers page for the organization the address belongs to. Rendered on the server so search engines see the jobs. */
export async function generateMetadata(): Promise<Metadata> {
  if (DEMO) return { title: 'Jobs' };
  const [tenant, origin] = await Promise.all([currentTenant(), siteOrigin()]);
  const name = tenant?.name ?? 'Jobs';
  return {
    title: `Jobs at ${name}`,
    description: `Open positions at ${name}: lifeguards, instructors, recreation and facility staff. Apply online.`,
    ...(origin ? { alternates: { canonical: `${origin}/jobs` } } : {}),
    openGraph: { title: `Jobs at ${name}`, type: 'website', ...(origin ? { url: `${origin}/jobs` } : {}) },
  };
}

export default async function PublicJobsPage() {
  return <JobsList initial={DEMO ? null : await publicJobs()} />;
}
