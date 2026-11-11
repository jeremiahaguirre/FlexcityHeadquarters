import { type Lang, copy } from '@/content/copy';
import { COMPANY } from '@/lib/site';

/**
 * Who we are, from config (lib/site.ts COMPANY): bracketed placeholders until the owner sets
 * them, never invented. Phone and business number appear only when set.
 */
export function BusinessDetails({ lang, className }: { lang: Lang; className?: string }) {
  const f = copy(lang).footer;
  const rows: Array<[string, string]> = [
    [f.legalName, COMPANY.legalName],
    [f.operatingName, COMPANY.operatingName],
    [f.address, COMPANY.mailingAddress],
    [f.emailLabel, COMPANY.email],
    ...(COMPANY.phone ? ([[f.phoneLabel, COMPANY.phone]] as Array<[string, string]>) : []),
    ...(COMPANY.businessNumber ? ([[f.bnLabel, COMPANY.businessNumber]] as Array<[string, string]>) : []),
    [f.privacyOfficer, `${COMPANY.privacyOfficer.name} · ${COMPANY.privacyOfficer.email}`],
  ];
  return (
    <section aria-labelledby={`business-${lang}`} className={className}>
      <h2 id={`business-${lang}`} className="text-label uppercase text-muted">{f.business}</h2>
      <dl className="mt-2 grid gap-1.5 text-caption">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-x-3 sm:grid-cols-[11rem_1fr]">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
