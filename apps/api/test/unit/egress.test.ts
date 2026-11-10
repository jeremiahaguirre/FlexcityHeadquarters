import { describe, expect, it } from 'vitest';
import { blockedAddress } from '../../src/lib/egress.js';

describe('outbound address guard', () => {
  it('refuses internal, metadata and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:169.254.169.254']) {
      expect(blockedAddress(ip), ip).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '52.60.0.1', '172.32.0.1', '2606:4700:4700::1111']) expect(blockedAddress(ip), ip).toBe(false);
  });
  it('treats anything that is not an IP as blocked', () => {
    expect(blockedAddress('not-an-ip')).toBe(true);
  });
});
