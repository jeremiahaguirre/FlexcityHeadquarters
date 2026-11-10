/**
 * A printable certificate for one signed agreement: who signed, when, from which device, what
 * they chose, both fingerprints checked again against what's stored, the signature itself, and
 * the full text they agreed to.
 */
import PDFDocument from 'pdfkit';
import type { ConsentRecord } from '@prisma/client';
import { agreementFor, canonicalText, sha256 } from './consent.js';

export function consentCertificate(r: ConsentRecord, who: { name: string; email: string | null; organization: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 60, bottom: 60, left: 60, right: 60 }, info: { Title: `Signed agreement: ${r.signedName}`, Creator: 'FlexcityHeadquarters' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const ink = '#0B1F22';
  const muted = '#4A5C5E';
  const accent = '#0D5F59';
  const width = doc.page.width - 120;
  const text = agreementFor(r.locale);
  const textOk = sha256(canonicalText(r.version, text)) === r.textSha256;
  const sigOk = sha256(Buffer.from(r.signature)) === r.signatureSha256;
  const choices = r.choices as Record<string, string>;

  doc.rect(0, 0, doc.page.width, 6).fill(accent);
  doc.rect(doc.page.width * 0.7, 0, doc.page.width * 0.3, 6).fill('#C5F23A');
  doc.font('Helvetica-Bold').fontSize(15).fillColor(ink).text('Flexcity', 60, 30, { continued: true }).font('Helvetica').fillColor(accent).text('Headquarters');
  doc.moveDown(1.6).font('Helvetica-Bold').fontSize(22).fillColor(ink).text('Certificate of signed agreement');
  doc.moveDown(0.3).font('Helvetica').fontSize(11).fillColor(muted).text(text.title);
  doc.moveDown(1.2);
  const row = (k: string, v: string) => doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text(`${k}: `, { continued: true }).font('Helvetica').fillColor(ink).text(v, { width });
  row('Organization', who.organization);
  row('Person', `${who.name}${who.email ? ` <${who.email}>` : ''}`);
  row('Name typed when signing', r.signedName);
  row('Signed at', `${r.signedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`);
  row('Agreement version / language', `${r.version} / ${r.locale}`);
  row('Notifications', choices.notifications ?? '—');
  row('Location', choices.location ?? '—');
  row('Device address', r.ipAddress ?? '—');
  row('Browser', r.userAgent ?? '—');
  row('Record', r.id);
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text('Integrity');
  doc.font('Courier').fontSize(8.5).fillColor(muted).text(`Text SHA-256:      ${r.textSha256}  ${textOk ? 'matches' : 'DOES NOT MATCH'} the text of this version`, { width });
  doc.text(`Signature SHA-256: ${r.signatureSha256}  ${sigOk ? 'matches' : 'DOES NOT MATCH'} the stored image`, { width });
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).fillColor(ink).text('Signature');
  doc.moveDown(0.3);
  const y = doc.y;
  doc.roundedRect(60, y, 260, 110, 8).strokeColor('#C9D6D4').lineWidth(1).stroke();
  try {
    doc.image(Buffer.from(r.signature), 70, y + 8, { fit: [240, 94], align: 'center', valign: 'center' });
  } catch {
    doc.font('Helvetica').fontSize(9).fillColor(muted).text('(signature image unreadable)', 70, y + 50);
  }
  doc.y = y + 124;
  doc.x = 60;
  doc.font('Helvetica').fontSize(8.5).fillColor(muted).text('This record cannot be changed or deleted by the application. The agreement text below is exactly what was shown; its fingerprint is checked above.', { width });

  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(15).fillColor(ink).text(text.title, { width });
  doc.moveDown(0.5).font('Helvetica').fontSize(10).fillColor(ink).text(text.intro, { width });
  for (const s of text.sections) {
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).fillColor(ink).text(s.heading, { width });
    for (const b of s.body) doc.moveDown(0.3).font('Helvetica').fontSize(9.5).fillColor(muted).text(b, { width });
  }
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).fillColor(ink).text(text.confirm, { width });
  doc.end();
  return done;
}
