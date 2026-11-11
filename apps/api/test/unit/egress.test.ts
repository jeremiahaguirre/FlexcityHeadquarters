import { describe, expect, it } from 'vitest';
import { blockedAddress } from '../../src/lib/egress.js';

describe('outbound address guard', () => {
  it('refuses internal, metadata and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:a00:1', '::ffff:a9fe:a9fe', '::ffff:7f00:1']) {
      expect(blockedAddress(ip), ip).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '52.60.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:808:808']) expect(blockedAddress(ip), ip).toBe(false);
  });
  it('URL hosts: an IPv4-mapped address in brackets is normalized to hex and still refused', async () => {
    const { assertPublicUrl } = await import('../../src/lib/egress.js');
    for (const url of ['https://[::ffff:10.0.0.1]/x', 'https://[::ffff:169.254.169.254]/x', 'https://169.254.169.254/x', 'https://[::1]/x']) {
      await expect(assertPublicUrl(url, 'It', { allowLocal: false }), url).rejects.toMatchObject({ code: 'HOST_NOT_PUBLIC' });
    }
    await expect(assertPublicUrl('http://localhost:9/x', 'It', { allowLocal: false })).rejects.toMatchObject({ code: 'BAD_URL' });
    await expect(assertPublicUrl('https://u:p@8.8.8.8/x', 'It', { allowLocal: false })).rejects.toMatchObject({ code: 'BAD_URL' });
    await expect(assertPublicUrl('https://8.8.8.8/x', 'It', { allowLocal: false })).resolves.toBe('8.8.8.8');
  });
  it('treats anything that is not an IP as blocked', () => {
    expect(blockedAddress('not-an-ip')).toBe(true);
  });
});
