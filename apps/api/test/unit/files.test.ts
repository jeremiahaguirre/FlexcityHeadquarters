import { describe, expect, it } from 'vitest';
import { FILE_CSP, sniff, storedName } from '../../src/lib/files.js';

describe('uploaded files', () => {
  it('accepts only PDF, PNG, JPEG and WebP, by their bytes', () => {
    expect(sniff(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
    for (const bad of ['<html><script>alert(1)</script>', '<svg onload=alert(1)>', 'MZ\x90\x00', 'GIF89a', '#!/bin/sh', 'PK\x03\x04', '']) expect(sniff(Buffer.from(bad, 'latin1'))).toBeNull();
  });

  it('renames every file to a plain name with the extension of its real type', () => {
    expect(storedName('note.pdf', 'application/pdf')).toBe('note.pdf');
    expect(storedName('invoice.html', 'application/pdf')).toBe('invoice.pdf');
    expect(storedName('photo.pdf.exe', 'image/png')).toBe('photo.pdf.png');
    expect(storedName('scan.JPEG', 'image/jpeg')).toBe('scan.jpg');
    expect(storedName('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf');
    expect(storedName('Reçu été "final"<script>.webp', 'image/webp')).toBe('Recu ete _final_script.webp');
    expect(storedName('C:\\Users\\me\\scan.png', 'image/png')).toBe('scan.png');
    expect(storedName('.htaccess', 'application/pdf')).toBe('file.pdf');
    expect(storedName('', 'image/png')).toBe('file.png');
    expect(storedName('a'.repeat(300) + '.pdf', 'application/pdf')).toHaveLength(124);
  });

  it('file answers allow nothing to run', () => {
    expect(FILE_CSP).toContain("default-src 'none'");
    expect(FILE_CSP).toContain('sandbox');
    expect(FILE_CSP).toContain("frame-ancestors 'none'");
  });
});
