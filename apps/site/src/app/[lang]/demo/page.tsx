import { pageMeta } from '@/lib/seo';
import { ArrowUpRight } from 'lucide-react';
import { LeadForm } from '@/components/LeadForm';
import { reveal } from '@/lib/reveal';
import { Section, SectionHead } from '@/components/Section';
import { Icon } from '@/components/Icon';
import { PageHero } from '@/components/PageHero';
import { PhoneClip } from '@/components/PhoneClip';
import { DeviceDuo, Laptop, Phone } from '@/components/Device';
import { captions } from '@/content/screens';
import { type Lang, copy } from '@/content/copy';
import { demoLink } from '@/lib/site';

/** Try the demo (EN/FR): one link per role into the static demo app, signed in as that role. */
export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const all = copy(params.lang);
  const c = all.demo;
  return pageMeta(params.lang, 'demo/', c.title, c.lead);
}

const ROLE_ICON: Record<string, string> = { STAFF: 'waves', EMPLOYEE: 'droplet', AQUATIC_SUPERVISOR: 'calendar', HR_ADMIN: 'users', FRONT_DESK: 'idcard', UNION_STEWARD: 'roles' };

export default async function Demo(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const all = copy(params.lang);
  const c = all.demo;
  const sc = captions(params.lang);
  const roleTitle = (id: string) => c.roles.find((r) => r.id === id)?.title ?? id;
  return (
    <>
      <PageHero eyebrow={all.nav.demo} title={c.title} lead={c.lead} overlap aside={<DeviceDuo laptop="laptop-hr" lang={params.lang} priority className="hidden lg:block" phoneNode={<PhoneClip clip="clock" lang={params.lang} label={all.home.see.clips[2]!.title} />} />} />
      <section className="relative">
        <div className="mx-auto -mt-28 grid max-w-7xl gap-4 px-4 pb-16 sm:grid-cols-2 md:-mt-36 md:px-6 lg:grid-cols-3">
          {c.roles.map((r, i) => (
            <a key={r.id} href={demoLink(r.id, params.lang)} {...reveal(i)} className="lift group flex flex-col rounded-2xl border border-line bg-panel p-6 shadow-lift">
              <span className="lift-icon mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand-text"><Icon name={ROLE_ICON[r.id] ?? 'users'} /></span>
              <h2 className="text-heading">{r.title}</h2>
              <p className="mt-2 flex-1 text-small text-muted">{r.body}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-small font-semibold text-brand-text">
                {c.open}
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </a>
          ))}
        </div>
      </section>
      {/* What two of the roles open on: real screens from the demo */}
      <Section className="overflow-hidden">
        <SectionHead title={sc.demoTitle} />
        <div className="grid items-end gap-12 md:grid-cols-[1.9fr_1fr] md:gap-10">
          <figure {...reveal()}>
            <Laptop name="laptop-casefile" lang={params.lang} />
            <figcaption className="mt-5 text-small leading-6 text-muted">
              <a href={demoLink('HR_ADMIN', params.lang)} className="font-semibold text-brand-text hover:underline">{roleTitle('HR_ADMIN')}</a> · {sc.demoHr}
            </figcaption>
          </figure>
          <figure {...reveal(1)} className="mx-auto w-full max-w-[15rem]">
            <Phone name="phone-board" lang={params.lang} />
            <figcaption className="mt-5 text-small leading-6 text-muted">
              <a href={demoLink('STAFF', params.lang)} className="font-semibold text-brand-text hover:underline">{roleTitle('STAFF')}</a> · {sc.demoStaff}
            </figcaption>
          </figure>
        </div>
      </Section>
      <Section tone="panel">
        <div {...reveal()} className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <SectionHead title={c.guidedTitle} lead={c.guidedBody} />
          <LeadForm lang={params.lang} kind="DEMO" />
        </div>
      </Section>
    </>
  );
}
