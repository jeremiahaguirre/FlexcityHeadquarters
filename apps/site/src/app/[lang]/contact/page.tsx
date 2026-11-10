import { pageMeta } from '@/lib/seo';
import { ContactForm } from '@/components/ContactForm';
import { LogoMark } from '@/components/Logo';
import { Kicker } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';

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
      {/* A dark band with the FH mark, large and faded, easing in behind the page title. */}
      <section className="night grain relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-16 md:-right-10 md:-top-24">
          <div className="opacity-[0.13]">
            <div className="mark-in">
              <LogoMark size={560} className="mark-breathe h-[22rem] w-[22rem] md:h-[36rem] md:w-[36rem]" />
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="drift pointer-events-none absolute -left-32 bottom-[-12rem] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(closest-side,rgb(var(--chartreuse)/0.18),transparent)] blur-2xl" />
        <div className="relative mx-auto max-w-7xl px-4 pb-36 pt-14 md:px-6 md:pb-44 md:pt-20">
          <div className="rise max-w-2xl">
            <Kicker dark>{c.eyebrow}</Kicker>
            <h1 className="text-hero2 [text-wrap:balance]">{c.title}</h1>
            <p className="mt-5 text-[1.125rem] leading-8 text-white/85">{c.lead}</p>
          </div>
        </div>
      </section>

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
          </aside>
        </div>
      </section>
    </>
  );
}
