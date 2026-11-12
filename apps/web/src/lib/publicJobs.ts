import { headers } from 'next/headers';
import type { Job } from './jobs';
import { API_URL, subdomainFromHost, tenantApiHeaders } from './tenant';

export interface PublicJob extends Job {
  postedOn: string;
  province: string | null;
}

async function sub() {
  return subdomainFromHost((await headers()).get('host'));
}

/** This organization's own address, e.g. https://kelowna.flexcity.ca (for canonical links and the sitemap). */
export async function siteOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return null;
  const proto = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** Server-side: open postings, so the page arrives with them (search engines read it as sent). */
export async function publicJobs(): Promise<PublicJob[] | null> {
  const s = await sub();
  if (!s) return null;
  try {
    const res = await fetch(`${API_URL}/api/public/jobs`, { headers: tenantApiHeaders(s), next: { revalidate: 300 } });
    return res.ok ? ((await res.json()) as PublicJob[]) : null;
  } catch {
    return null;
  }
}

export async function publicJob(id: string): Promise<PublicJob | null> {
  const s = await sub();
  if (!s || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const res = await fetch(`${API_URL}/api/public/jobs/${id}`, { headers: tenantApiHeaders(s), next: { revalidate: 300 } });
    return res.ok ? ((await res.json()) as PublicJob) : null;
  } catch {
    return null;
  }
}

const EMPLOYMENT_TYPE: Record<string, string> = { FULL_TIME: 'FULL_TIME', PART_TIME: 'PART_TIME', CASUAL: 'PER_DIEM', ON_CALL: 'PER_DIEM', VOLUNTEER: 'VOLUNTEER' };

/** schema.org JobPosting, as Google for Jobs reads it. */
export function jobPostingLd(j: PublicJob, org: { name: string; logoUrl: string | null }, origin: string) {
  const min = j.payMin ? Number(j.payMin) : null;
  const max = j.payMax ? Number(j.payMax) : null;
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: j.title,
    description: j.description.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\n/g, '<br>'),
    identifier: { '@type': 'PropertyValue', name: org.name, value: j.id },
    datePosted: j.postedOn,
    validThrough: `${j.closesOn}T23:59:59`,
    employmentType: EMPLOYMENT_TYPE[j.employmentStatus] ?? 'OTHER',
    hiringOrganization: { '@type': 'Organization', name: org.name, sameAs: origin, ...(org.logoUrl ? { logo: org.logoUrl.startsWith('http') ? org.logoUrl : `${origin}${org.logoUrl}` } : {}) },
    jobLocation: { '@type': 'Place', ...(j.facility ? { name: j.facility } : {}), address: { '@type': 'PostalAddress', ...(j.province ? { addressRegion: j.province } : {}), addressCountry: 'CA' } },
    ...(min
      ? { baseSalary: { '@type': 'MonetaryAmount', currency: 'CAD', value: { '@type': 'QuantitativeValue', unitText: 'HOUR', ...(max && max !== min ? { minValue: min, maxValue: max } : { value: min }) } } }
      : {}),
    directApply: false,
    url: `${origin}/jobs/${j.id}`,
  };
}
