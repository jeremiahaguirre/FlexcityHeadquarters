import { describe, expect, it } from 'vitest';
import { buildStamp, isOutdated, webClientVersion } from '../../src/lib/version.js';

describe('build versions', () => {
  it('reads the build time from a version id', () => {
    expect(buildStamp('202611121530.abc1234')).toBe('202611121530');
    expect(buildStamp('20261112')).toBe('20261112');
    expect(buildStamp('dev')).toBeNull();
    expect(buildStamp('abc1234')).toBeNull();
  });

  it('a build older than the minimum is outdated; same, newer, unknown and dev builds are not', () => {
    expect(isOutdated('202611101200.aaa', '202611121530.bbb')).toBe(true);
    expect(isOutdated('202611121530.aaa', '202611121530.bbb')).toBe(false);
    expect(isOutdated('202611130000.ccc', '202611121530')).toBe(false);
    // A date-only minimum means midnight UTC that day.
    expect(isOutdated('202611112359.x', '20261112')).toBe(true);
    expect(isOutdated('202611120000.x', '20261112')).toBe(false);
    expect(isOutdated('dev', '202611121530')).toBe(false);
    expect(isOutdated(null, '202611121530')).toBe(false);
    expect(isOutdated('202601010000.x', undefined)).toBe(false);
  });

  it('only a well-formed web client header counts', () => {
    expect(webClientVersion('web/202611121530.abc1234')).toBe('202611121530.abc1234');
    expect(webClientVersion('web/dev')).toBe('dev');
    expect(webClientVersion('curl/8.0')).toBeNull();
    expect(webClientVersion(undefined)).toBeNull();
    expect(webClientVersion('web/<script>')).toBeNull();
  });
});
