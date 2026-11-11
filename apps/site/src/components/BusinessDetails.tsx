import { type Lang, copy } from '@/content/copy';
import { COMPANY, isPlaceholder } from '@/lib/site';

/**
 * Who we are, from config (lib/site.ts COMPANY), never invented. Details not set yet are left out
 * with one line saying they come before launch (a production build can't be made without them,
 * next.config.mjs). Phone and business number appear only when set.
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
    ...(isPlaceholder(COMPANY.privacyOfficer.name) || isPlaceholder(COMPANY.privacyOfficer.email) ? [] : ([[f.privacyOfficer, `${COMPANY.privacyOfficer.name} · ${COMPANY.privacyOfficer.email}`]] as Array<[string, string]>)),
  ];
  const shown = rows.filter(([, v]) => !isPlaceholder(v));
  const pending = [COMPANY.legalName, COMPANY.mailingAddress, COMPANY.email, COMPANY.privacyOfficer.name, COMPANY.privacyOfficer.email].some(isPlaceholder);
  return (
    <section aria-labelledby={`business-${lang}`} className={className}>
      <h2 id={`business-${lang}`} className="text-label uppercase text-muted">{f.business}</h2>
      <dl className="mt-2 grid gap-1.5 text-caption">
        {shown.map(([k, v]) => (
          <div key={k} className="grid gap-x-3 sm:grid-cols-[11rem_1fr]">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      {pending && <p className="mt-2 text-caption text-muted">{f.detailsPending}</p>}
    </section>
  );
}
