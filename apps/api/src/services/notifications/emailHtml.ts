/**
 * The branded HTML version of every email (the plain-text part stays as written).
 * Table layout and inline styles, so it reads the same in Outlook, Gmail and phone mail apps;
 * no remote images, so nothing is blocked or tracks the reader. Fonts: the system stack only
 * (no @font-face, no font link): mail apps block or strip web fonts, so naming one would only
 * make the email look different from reader to reader.
 */
export const EMAIL_FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const URL_RE = /(https?:\/\/[^\s<]+)/g;

const BRAND = { ink: '#10201F', teal: '#0D5F59', tealText: '#0A5A54', page: '#EEF3F2', panel: '#FFFFFF', muted: '#4C5F5D', line: '#D6E1DF', lime: '#C5F23A' };

export function emailHtml(subject: string, text: string, locale: string): string {
  const fr = locale.startsWith('fr');
  const blocks = text.trim().split(/\n{2,}/);
  const body = blocks
    .map((block) => {
      const lines = block.split('\n');
      // A link alone on its line becomes the button.
      return lines
        .map((line) => {
          const t = line.trim();
          if (/^https?:\/\/\S+$/.test(t)) {
            return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0"><tr><td style="border-radius:12px;background:${BRAND.teal}"><a href="${esc(t)}" style="display:inline-block;padding:13px 22px;font-weight:700;font-size:15px;color:#FFFFFF;text-decoration:none;border-radius:12px">${fr ? 'Ouvrir FlexcityHeadquarters' : 'Open FlexcityHeadquarters'} &rarr;</a></td></tr></table><p style="margin:0 0 4px;font-size:12px;color:${BRAND.muted};word-break:break-all">${esc(t)}</p>`;
          }
          return `<p style="margin:0 0 6px;font-size:15px;line-height:24px;color:${BRAND.ink}">${esc(line).replace(URL_RE, (u) => `<a href="${u}" style="color:${BRAND.tealText}">${u}</a>`)}</p>`;
        })
        .join('');
    })
    .map((b) => `<div style="margin:0 0 14px">${b}</div>`)
    .join('');
  const footer = fr
    ? 'Envoyé par FlexcityHeadquarters au nom de votre organisation. Horaires, pointage, paie et RH pour les organisations canadiennes.'
    : 'Sent by FlexcityHeadquarters on behalf of your organization. Scheduling, timekeeping, payroll and HR for Canadian organizations.';
  return `<!doctype html>
<html lang="${fr ? 'fr-CA' : 'en-CA'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:${EMAIL_FONT_STACK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page}"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px;font-size:20px;letter-spacing:-0.5px"><span style="font-weight:800;color:${BRAND.ink}">Flexcity</span><span style="font-weight:500;color:${BRAND.tealText}">Headquarters</span></td></tr>
<tr><td style="background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:18px;overflow:hidden">
<div style="height:5px;background:linear-gradient(90deg,${BRAND.teal},${BRAND.lime});background-color:${BRAND.teal}"></div>
<div style="padding:28px 28px 16px"><h1 style="margin:0 0 18px;font-size:21px;line-height:28px;color:${BRAND.ink}">${esc(subject)}</h1>${body}</div>
</td></tr>
<tr><td style="padding:16px 6px;font-size:12px;line-height:18px;color:${BRAND.muted}">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}
