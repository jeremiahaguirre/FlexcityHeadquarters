/**
 * Winter operations settings, chosen by each city's managers: whether call-outs
 * and patrol records are used, the winter season, how long people have to
 * answer a call-out, and the rest they need between shifts.
 */
import type { Prisma } from '../../generated/prisma/client.js';
import { z } from 'zod';
import type { Tx } from '../../lib/db.js';

const mmdd = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
export const winterSettingsBody = z.object({
  season: z.object({ start: mmdd, end: mmdd }),
  callOuts: z.object({ responseMinutes: z.number().int().min(5).max(240), minRestHours: z.number().int().min(0).max(24) }),
  patrols: z.object({ graceMinutes: z.number().int().min(0).max(720) }),
});
export type WinterSettings = z.infer<typeof winterSettingsBody>;

export const DEFAULT_WINTER: WinterSettings = {
  season: { start: '11-01', end: '04-15' },
  callOuts: { responseMinutes: 15, minRestHours: 8 },
  patrols: { graceMinutes: 60 },
};

export function parseWinter(stored: unknown): WinterSettings {
  // Each section is optional and so is each value in it; anything missing uses the default.
  const r = z
    .object({
      season: winterSettingsBody.shape.season.partial(),
      callOuts: winterSettingsBody.shape.callOuts.partial(),
      patrols: winterSettingsBody.shape.patrols.partial(),
    })
    .partial()
    .safeParse(stored ?? {});
  const v = r.success ? r.data : {};
  return {
    season: { ...DEFAULT_WINTER.season, ...v.season },
    callOuts: { ...DEFAULT_WINTER.callOuts, ...v.callOuts },
    patrols: { ...DEFAULT_WINTER.patrols, ...v.patrols },
  } as WinterSettings;
}

export async function winterSettings(tx: Tx): Promise<WinterSettings> {
  const t = await tx.tenant.findFirstOrThrow({ select: { winterSettings: true } });
  return parseWinter(t.winterSettings);
}

export const asJson = (s: WinterSettings) => s as unknown as Prisma.InputJsonValue;

/** Is this moment inside the season (which usually wraps the new year)? Uses the given time zone's date. */
export function inSeason(now: Date, season: WinterSettings['season'], timezone = 'America/Toronto'): boolean {
  const md = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: '2-digit', day: '2-digit' }).format(now).replace('/', '-');
  return season.start <= season.end ? md >= season.start && md <= season.end : md >= season.start || md <= season.end;
}
