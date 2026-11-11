import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coversHour, holidayEffect, occursOn } from '../../src/services/ops/specialEvents.js';
import {
  bucketOf,
  conditionFromIcon,
  conditionFromText,
  defaultEffect,
  ecccSource,
  learnEffects,
  MIN_LEARN_DAYS,
  nearestClimateStation,
  parseCityPage,
  parseClimateDaily,
  parseSites,
  profileOf,
  weatherEffect,
} from '../../src/services/ops/weather.js';
import { addDays } from '../../src/lib/time.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/eccc/${name}`, import.meta.url), 'utf8')) as unknown;

describe('ECCC city page parsing (recorded fixtures)', () => {
  it('turns day and night periods into dated days with high, low, chance of rain and both languages', () => {
    const { info, days } = parseCityPage(fixture('citypage-bc-48.json'), 'bc-48');
    expect(info).toMatchObject({ site: 'bc-48', nameEn: 'Kelowna', latitude: 49.888, longitude: -119.496 });
    expect(days.map((d) => d.date)).toEqual(['2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19']);
    expect(days[0]).toMatchObject({ high: 31, low: 16, condition: 'sunny', iconCode: 0, pop: null, summaryEn: 'Sunny', summaryFr: 'Ensoleillé' });
    // Showers by day, thunderstorms likely that night: the day counts as a thunder day.
    expect(days[1]).toMatchObject({ high: 24, low: 14, pop: 60, condition: 'thunder' });
    expect(days[2]).toMatchObject({ high: 27, condition: 'thunder', pop: 70 });
    expect(days[3]).toMatchObject({ high: 18, low: 9, condition: 'rain', pop: 80 });
    expect(days[4]).toMatchObject({ high: 22, condition: 'partly', summaryFr: 'Alternance de soleil et de nuages' });
  });

  it('copes with a forecast issued in the evening, plain values and a single temperature', () => {
    const { info, days } = parseCityPage(fixture('citypage-on-143-night.json'), 'on-143');
    expect(info?.nameEn).toBe('Toronto');
    expect(days).toEqual([
      expect.objectContaining({ date: '2026-01-09', high: null, low: -8, condition: 'snow', pop: 40 }),
      expect.objectContaining({ date: '2026-01-10', high: -3, condition: 'cloudy', iconCode: null }),
    ]);
  });

  it('returns nothing for an answer that isn’t a forecast', () => {
    expect(parseCityPage({ type: 'Feature', properties: {} }, 'bc-1').days).toEqual([]);
    expect(parseCityPage(null, 'bc-1').days).toEqual([]);
    expect(parseCityPage('<html>', 'bc-1').days).toEqual([]);
  });

  it('reads sites, climate stations and daily climate data', () => {
    expect(parseSites(fixture('sites-okanagan.json')).map((s) => s.site)).toEqual(['bc-48', 'bc-27', 'bc-84']);
    // The closed station is skipped even though it's nearer.
    expect(nearestClimateStation(fixture('stations-kelowna.json'), 49.888, -119.496, '2026-07-15')).toBe('1123939');
    expect(nearestClimateStation(fixture('stations-kelowna.json'), 43.7, -79.4, '2026-07-15')).toBeNull();
    const obs = parseClimateDaily(fixture('climate-daily-1123939.json'));
    expect(obs).toEqual([
      expect.objectContaining({ date: '2026-01-05', high: -4, snowCm: 7.5, condition: 'snow' }),
      expect.objectContaining({ date: '2026-07-12', high: 33.1, precipMm: 0, condition: 'sunny' }),
      expect.objectContaining({ date: '2026-07-13', precipMm: 8.4, condition: 'rain' }),
    ]);
  });

  it('maps icon codes and words to conditions', () => {
    expect(conditionFromIcon(0)).toBe('sunny');
    expect(conditionFromIcon(39)).toBe('thunder');
    expect(conditionFromIcon(16)).toBe('snow');
    expect(conditionFromIcon(99)).toBeNull();
    expect(conditionFromText('Averses ou orages')).toBe('thunder');
    expect(conditionFromText('Chance of showers')).toBe('showers');
    expect(conditionFromText('A mix of sun and cloud')).toBe('partly');
    expect(conditionFromText('Ensoleillé')).toBe('sunny');
  });
});

describe('weather adjustment', () => {
  it('outdoor pools: up on hot sunny days, down with rain, thunder or cold', () => {
    const july = '2026-07-15';
    expect(defaultEffect('outdoor', 'hot', { high: 31, condition: 'sunny' }, july)).toBe(18);
    expect(defaultEffect('outdoor', 'hot', { high: 40, condition: 'sunny' }, july)).toBe(40);
    expect(defaultEffect('outdoor', 'hot', { high: 31, condition: 'cloudy' }, july)).toBe(12);
    expect(defaultEffect('outdoor', 'rain', { high: 18, condition: 'rain' }, july)).toBe(-35);
    expect(defaultEffect('outdoor', 'thunder', { high: 27, condition: 'thunder' }, july)).toBe(-60);
    expect(defaultEffect('outdoor', 'cold', { high: 9, condition: 'cloudy' }, july)).toBe(-30);
    expect(defaultEffect('outdoor', 'mild', { high: 18, condition: 'partly' }, july)).toBe(0);
  });

  it('indoor pools: mildly up on rainy summer days only; arenas barely move', () => {
    expect(defaultEffect('indoor', 'rain', { high: 18, condition: 'rain' }, '2026-07-15')).toBe(10);
    expect(defaultEffect('indoor', 'rain', { high: 8, condition: 'rain' }, '2026-11-15')).toBe(0);
    expect(defaultEffect('arena', 'rain', { high: 18, condition: 'rain' }, '2026-07-15')).toBe(0);
    expect(defaultEffect('arena', 'snow', { high: -5, condition: 'snow' }, '2026-01-15')).toBe(-5);
    expect(defaultEffect('mixed', 'rain', { high: 18, condition: 'rain' }, '2026-07-15')).toBe(-12);
  });

  it('chooses the profile from the facility settings', () => {
    expect(profileOf('OUTDOOR', 'POOL')).toBe('outdoor');
    expect(profileOf('INDOOR', 'POOL')).toBe('indoor');
    expect(profileOf('INDOOR', 'ARENA')).toBe('arena');
    expect(profileOf('INDOOR', 'PARK')).toBe('indoor');
    expect(profileOf('MIXED', 'POOL')).toBe('mixed');
  });

  it('buckets days', () => {
    expect(bucketOf({ high: 31, condition: 'sunny' })).toBe('hot');
    expect(bucketOf({ high: 24, condition: 'showers', pop: 30 })).toBe('warm');
    expect(bucketOf({ high: 24, condition: 'showers', pop: 70 })).toBe('rain');
    expect(bucketOf({ high: 27, condition: 'thunder', pop: 70 })).toBe('thunder');
    expect(bucketOf({ high: 25, condition: 'sunny', precipMm: 9 })).toBe('rain');
    expect(bucketOf({ high: 5, condition: 'cloudy' })).toBe('cold');
    expect(bucketOf({ high: -2, condition: 'partly', snowCm: 3 })).toBe('snow');
    expect(bucketOf({ high: null, condition: 'partly' })).toBe('mild');
  });

  it('learns from the facility’s own history once there are enough days, else uses the rule of thumb', () => {
    // Twelve Saturdays in summer: about 200 people on ordinary days, 300 on hot ones.
    const days = Array.from({ length: 16 }, (_, i) => {
      const date = addDays('2026-06-06', 7 * i);
      const hot = i % 2 === 0;
      return { date, total: hot ? 300 : 200, weather: hot ? { high: 32, condition: 'sunny' as const } : { high: 19, condition: 'partly' as const } };
    });
    const learned = learnEffects(days, () => false);
    expect(learned.get('hot')?.days).toBeGreaterThanOrEqual(MIN_LEARN_DAYS);
    const hot = learned.get('hot')!.pct;
    expect(hot).toBeGreaterThan(20);
    expect(hot).toBeLessThan(50);
    expect(weatherEffect('outdoor', { high: 32, condition: 'sunny' }, '2026-07-18', learned)).toEqual({ bucket: 'hot', pct: hot, source: 'learned', days: learned.get('hot')!.days });
    // Too few rainy days to learn from: the rule of thumb.
    expect(weatherEffect('outdoor', { high: 17, condition: 'rain' }, '2026-07-18', learned)).toEqual({ bucket: 'rain', pct: -35, source: 'default' });
    expect(learnEffects(days.slice(0, 4), () => false).size).toBe(0);
  });
});

describe('special events', () => {
  it('happen on their dates, and every year when recurring (across New Year too)', () => {
    const once = { startsOn: '2026-07-01', endsOn: '2026-07-01', recursYearly: false };
    expect(occursOn(once, '2026-07-01')).toBe(true);
    expect(occursOn(once, '2027-07-01')).toBe(false);
    const yearly = { ...once, recursYearly: true };
    expect(occursOn(yearly, '2028-07-01')).toBe(true);
    expect(occursOn(yearly, '2025-07-01')).toBe(false);
    const nye = { startsOn: '2026-12-31', endsOn: '2027-01-01', recursYearly: true };
    expect(occursOn(nye, '2028-01-01')).toBe(true);
    expect(occursOn(nye, '2027-12-31')).toBe(true);
    expect(occursOn(nye, '2027-06-01')).toBe(false);
    expect(occursOn({ startsOn: '2024-02-29', endsOn: '2024-02-29', recursYearly: true }, '2025-02-28')).toBe(true);
  });

  it('cover hours when timed, every hour when all day', () => {
    expect(coversHour({ startMinute: null, endMinute: null }, 3)).toBe(true);
    expect(coversHour({ startMinute: 18 * 60, endMinute: 22 * 60 }, 17)).toBe(false);
    expect(coversHour({ startMinute: 18 * 60, endMinute: 22 * 60 }, 18)).toBe(true);
    expect(coversHour({ startMinute: 18 * 60, endMinute: 22 * 60 }, 22)).toBe(false);
    expect(holidayEffect('outdoor')).toBeGreaterThan(holidayEffect('arena'));
  });
});

describe('ECCC client', () => {
  it('asks for the site’s forecast and retries a failure before giving up', async () => {
    const urls: string[] = [];
    let n = 0;
    const src = ecccSource({
      base: 'https://api.weather.gc.ca',
      backoffMs: [0, 0],
      get: async (url) => {
        urls.push(url);
        n++;
        if (n === 1) throw new Error('timeout');
        return { status: 200, body: readFileSync(new URL('./fixtures/eccc/citypage-bc-48.json', import.meta.url), 'utf8') };
      },
    });
    const r = await src.cityPage('bc-48');
    expect(r.days).toHaveLength(5);
    expect(urls).toEqual(['https://api.weather.gc.ca/collections/citypageweather-realtime/items/bc-48?f=json', 'https://api.weather.gc.ca/collections/citypageweather-realtime/items/bc-48?f=json']);

    const down = ecccSource({ base: 'https://api.weather.gc.ca', backoffMs: [0, 0], get: async () => ({ status: 503, body: '' }) });
    await expect(down.cityPage('bc-48')).rejects.toThrow(/503/);
    let notFoundTries = 0;
    const missing = ecccSource({ base: 'https://api.weather.gc.ca', backoffMs: [0, 0], get: async () => (notFoundTries++, { status: 404, body: '' }) });
    await expect(missing.cityPage('xx-1')).rejects.toThrow(/Not found/);
    expect(notFoundTries).toBe(1);
  });

  it('sends only rounded coordinates when looking for the nearest site', async () => {
    const urls: string[] = [];
    const src = ecccSource({ base: 'https://api.weather.gc.ca', get: async (url) => (urls.push(url), { status: 200, body: JSON.stringify(fixture('sites-okanagan.json')) }) });
    await src.sitesNear(49.9, -119.5);
    expect(urls[0]).toMatch(/bbox=-120\.10,49\.30,-118\.90,50\.50/);
  });
});
