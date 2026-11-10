/** Live sites only (".live.tsx" isn't built into the static demo, which has no server and no postings). */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JobDetail } from '@/components/jobs/JobDetail';
import { jobPostingLd, publicJob, siteOrigin } from '@/lib/publicJobs';
import { currentTenant } from '@/lib/tenant';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [job, tenant, origin] = await Promise.all([publicJob(id), currentTenant(), siteOrigin()]);
  if (!job) return { title: 'Job closed', robots: { index: false } };
  const where = [job.facility, tenant?.name].filter(Boolean).join(', ');
  const description = job.description.replace(/\s+/g, ' ').slice(0, 155);
  return {
    title: `${job.title}${where ? ` · ${where}` : ''}`,
    description,
    ...(origin ? { alternates: { canonical: `${origin}/jobs/${job.id}` } } : {}),
    openGraph: { title: job.title, description, type: 'website', ...(origin ? { url: `${origin}/jobs/${job.id}` } : {}), ...(tenant?.name ? { siteName: tenant.name } : {}) },
  };
}

export default async function JobPage({ params }: Props) {
  const { id } = await params;
  const [job, tenant, origin] = await Promise.all([publicJob(id), currentTenant(), siteOrigin()]);
  if (!job) notFound();
  // JSON-LD isn't run as a script, so the strict script policy doesn't apply; "<" is escaped so text can't close the tag.
  const ld = tenant && origin ? JSON.stringify(jobPostingLd(job, tenant, origin)).replace(/</g, '\\u003c') : null;
  return (
    <>
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} /> : null}
      <JobDetail job={job} />
    </>
  );
}
