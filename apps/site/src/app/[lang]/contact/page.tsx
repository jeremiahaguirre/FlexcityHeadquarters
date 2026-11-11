import { pageMeta } from '@/lib/seo';
import { ContactForm } from '@/components/ContactForm';
import { BusinessDetails } from '@/components/BusinessDetails';
import { AliveMark } from '@/components/AliveMark';
import { LogoMark } from '@/components/Logo';
import { PageHero } from '@/components/PageHero';
import { type Lang, copy } from '@/content/copy';

/** Contact (EN/FR): the contact form plus the business's contact details. */
export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang).contact;
  return pageMeta(params.lang, 'contact/', c.title, c.lead);
}

export default async function Contact(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang).contact;
  return (
    <>
      {/* The interior header (flat, brand-tinted), with the FH mark faded behind the title, drawing itself in once and then gently alive. */}
      <PageHero
        eyebrow={c.eyebrow}
        title={c.title}
        lead={c.lead}
        overlap
        decoration={
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-12 md:-right-8 md:-top-20">
            <div className="opacity-[0.07] dark:opacity-[0.1]">
              <AliveMark size={480} className="h-[18rem] w-[18rem] md:h-[30rem] md:w-[30rem]" />
            </div>
          </div>
        }
      />

      <section className="relative">
        <div className="mx-auto -mt-28 grid max-w-7xl gap-10 px-4 pb-20 md:-mt-36 md:px-6 lg:grid-cols-[1.25fr_1fr] lg:gap-14">
          <div className="rise rise-2 rounded-3xl border border-line bg-panel p-6 shadow-lift sm:p-8">
            <ContactForm lang={params.lang} />
          </div>
          <aside className="rise rise-2 grid content-start gap-6 lg:pt-48">
            <h2 className="text-heading">{c.nextTitle}</h2>
            <ol className="relative grid gap-6 border-l-2 border-line pl-6">
              {c.next.map((n, i) => (
                <li key={n.title} className="relative">
                  <span aria-hidden="true" className="absolute -left-[2.15rem] top-0 grid h-7 w-7 place-items-center rounded-full bg-brand text-caption font-bold text-brand-contrast shadow-card">{i + 1}</span>
                  <h3 className="text-body-strong">{n.title}</h3>
                  <p className="mt-1 text-small leading-6 text-muted">{n.body}</p>
                </li>
              ))}
            </ol>
            <p className="flex items-center gap-3 rounded-2xl border border-line bg-surface/60 px-5 py-4 text-small font-semibold">
              <LogoMark size={28} />
              {c.promise}
            </p>
            <BusinessDetails lang={params.lang} className="rounded-2xl border border-line bg-panel p-5" />
          </aside>
        </div>
      </section>
    </>
  );
}
