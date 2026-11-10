import { describe, expect, it } from 'vitest';
import { allowedBack } from './demoBack';

describe('demo back-to-website link', () => {
  it('accepts the website’s own addresses', () => {
    expect(allowedBack('https://flexcityheadquarters.ca/fr/', undefined)).toBe('https://flexcityheadquarters.ca/fr/');
    expect(allowedBack('https://www.flexcityheadquarters.ca/en/', undefined)).toBe('https://www.flexcityheadquarters.ca/en/');
    expect(allowedBack('https://flexcity-headquarters.vercel.app/en/', undefined)).not.toBeNull();
    expect(allowedBack('http://localhost:3100/en/', undefined)).not.toBeNull();
  });
  it('refuses anything else', () => {
    for (const bad of [null, '', 'javascript:alert(1)', 'https://evil.example/', 'https://flexcityheadquarters.ca.evil.example/', 'http://flexcityheadquarters.ca/', 'https://user:pw@flexcityheadquarters.ca/', 'https://phish.vercel.app/', 'https://jeremiahaguirre.github.io/FlexcityHeadquarters/'])
      expect(allowedBack(bad, undefined)).toBeNull();
  });
  it('uses the configured hosts when set', () => {
    expect(allowedBack('https://example.org/en/', 'example.org')).toBe('https://example.org/en/');
    expect(allowedBack('https://flexcity-headquarters.vercel.app/en/', 'example.org')).toBeNull();
  });
});
