import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ALLOWED_OVERRIDE_KEYS } from '../services/compliance/provincialRules.js';
import { h } from './context.js';
import { resolveFeatures, tenantSettings } from '../services/platform/features.js';
import { RETENTION_DEFAULTS, RETENTION_LIMITS, readRetention } from '../services/privacy/retention.js';

export const settingsRouter = Router();
settingsRouter.use('/settings', requirePermission('tenant.configure'));

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const province = z.enum(['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU']);
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz.startsWith('America/');
  } catch {
    return false;
  }
}, 'Use a Canadian time zone such as America/Toronto.');
const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

settingsRouter.get(
  '/settings',
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const [tenant, facilities, payCodes, overrides, calendar] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }),
        tx.facility.findMany({ orderBy: { name: 'asc' } }),
        tx.payCodeMapping.findMany({ orderBy: [{ key: 'asc' }] }),
        tx.ruleOverride.findMany({ orderBy: [{ ruleKey: 'asc' }, { effectiveFrom: 'desc' }] }),
        tx.schoolCalendarPeriod.findMany({ orderBy: { startsOn: 'asc' } }),
      ]);
      return {
        organization: {
          name: tenant.name,
          subdomain: tenant.subdomain,
          logoUrl: tenant.logoUrl,
          themeColors: tenant.themeColors,
          defaultLocale: tenant.defaultLocale,
          timeFormat: tenant.timeFormat,
          payWeekStartDay: tenant.payWeekStartDay,
          vacationPayMode: tenant.vacationPayMode,
          payrollRetentionYears: tenant.payrollRetentionYears,
          features: (await tenantSettings(a.tenantId)).features,
        },
        facilities: facilities.map((f) => ({ ...f, latitude: f.latitude?.toNumber() ?? null, longitude: f.longitude?.toNumber() ?? null })),
        payCodes,
        ruleOverrides: overrides.map((o) => ({ ...o, effectiveFrom: iso(o.effectiveFrom), effectiveTo: iso(o.effectiveTo) })),
        schoolCalendar: calendar.map((c) => ({ id: c.id, kind: c.kind, name: c.name, startsOn: iso(c.startsOn), endsOn: iso(c.endsOn) })),
        allowedRuleKeys: [...ALLOWED_OVERRIDE_KEYS],
      };
    });
    res.json(out);
  }),
);

settingsRouter.patch(
  '/settings',
  h(async (req, res) => {
    const a = authOf(req);
    const body = z
      .object({
        name: z.string().min(2).max(120),
        logoUrl: z.string().url().startsWith('https://').nullable(),
        themeColors: z.object({ primary: hex, primaryHover: hex, primaryContrast: hex, accent: hex }).partial(),
        defaultLocale: z.enum(['en-CA', 'fr-CA']),
        timeFormat: z.enum(['auto', '12h', '24h']),
        payWeekStartDay: z.number().int().min(0).max(6),
        vacationPayMode: z.enum(['PAY_EACH_PERIOD', 'ACCRUE']),
        payrollRetentionYears: z.number().int().min(6).max(15),
      })
      .partial()
      .parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
      await tx.tenant.update({ where: { id: a.tenantId }, data: body as Prisma.TenantUpdateInput });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'settings.update', entity: 'Tenant', entityId: a.tenantId, before, after: body });
    });
    res.json({ ok: true });
  }),
);

export const facilityBody = z.object({
  name: z.string().min(2).max(120),
  province,
  timezone,
  latitude: z.number().min(41).max(84).nullable(),
  longitude: z.number().min(-142).max(-52).nullable(),
  geoRadiusM: z.number().int().min(25).max(2000),
  costCenter: z.string().max(40).nullable(),
  rotationMinutes: z.number().int().min(10).max(120).optional(),
  maxOnChairMinutes: z.number().int().min(30).max(480).optional(),
});

settingsRouter.post(
  '/settings/facilities',
  h(async (req, res) => {
    const a = authOf(req);
    const body = facilityBody.parse(req.body);
    const f = await withTenant(a.tenantId, (tx) => tx.facility.create({ data: { ...body, tenantId: a.tenantId } }));
    res.status(201).json({ id: f.id });
  }),
);

settingsRouter.patch(
  '/settings/facilities/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = facilityBody.partial().parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.facility.findUnique({ where: { id } });
      if (!before) throw notFound('Facility');
      await tx.facility.update({ where: { id }, data: body });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'facility.update', entity: 'Facility', entityId: id, before, after: body });
    });
    res.json({ ok: true });
  }),
);

settingsRouter.put(
  '/settings/pay-codes',
  h(async (req, res) => {
    const a = authOf(req);
    const rows = z
      .array(
        z.object({
          key: z.enum(['REGULAR', 'OVERTIME_1_5', 'OVERTIME_2_0', 'STAT_WORKED', 'STAT_HOLIDAY_PAY', 'SHIFT_PREMIUM', 'VACATION_PAY']),
          positionId: uuid.nullable(),
          code: z.string().trim().min(1).max(40),
        }),
      )
      .max(200)
      .parse(req.body);
    const seen = new Set(rows.map((r) => `${r.key}|${r.positionId}`));
    if (seen.size !== rows.length) throw badRequest('Each pay type can be mapped once per position.');
    await withTenant(a.tenantId, async (tx) => {
      await tx.payCodeMapping.deleteMany({});
      if (rows.length) await tx.payCodeMapping.createMany({ data: rows.map((r) => ({ ...r, tenantId: a.tenantId })) });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'paycodes.replace', entity: 'Tenant', entityId: a.tenantId, after: rows });
    });
    res.json({ ok: true, count: rows.length });
  }),
);

/** Collective-agreement overrides. Values are type-checked per key. */
settingsRouter.post(
  '/settings/rule-overrides',
  h(async (req, res) => {
    const a = authOf(req);
    const body = z
      .object({ province: province.nullable(), ruleKey: z.string(), value: z.unknown(), effectiveFrom: isoDate, effectiveTo: isoDate.nullable(), source: z.string().min(3).max(200) })
      .parse(req.body);
    if (!ALLOWED_OVERRIDE_KEYS.has(body.ruleKey)) throw badRequest(`Rules that can be overridden: ${[...ALLOWED_OVERRIDE_KEYS].join(', ')}.`);
    if (body.effectiveTo && body.effectiveTo < body.effectiveFrom) throw badRequest('The end date must be after the start date.');
    const v = body.value;
    const okValue =
      body.ruleKey === 'overtime.method'
        ? v === 'stacked' || v === 'greater_of'
        : body.ruleKey === 'vacation.tiers'
          ? Array.isArray(v) && v.every((t) => typeof t?.minYears === 'number' && typeof t?.percent === 'number' && t.percent > 0 && t.percent <= 20)
          : v === null || (typeof v === 'number' && v > 0 && v <= 80);
    if (!okValue) throw badRequest('That value is not valid for this rule.');
    const o = await withTenant(a.tenantId, async (tx) => {
      const created = await tx.ruleOverride.create({
        data: { tenantId: a.tenantId, province: body.province, ruleKey: body.ruleKey, value: body.value as Prisma.InputJsonValue, effectiveFrom: day(body.effectiveFrom)!, effectiveTo: day(body.effectiveTo), source: body.source },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'rule.override', entity: 'RuleOverride', entityId: created.id, after: body });
      return created;
    });
    res.status(201).json({ id: o.id });
  }),
);

settingsRouter.delete(
  '/settings/rule-overrides/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      await tx.ruleOverride.delete({ where: { id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'rule.override.delete', entity: 'RuleOverride', entityId: id });
    });
    res.status(204).end();
  }),
);

settingsRouter.put(
  '/settings/school-calendar',
  h(async (req, res) => {
    const a = authOf(req);
    const periods = z
      .array(z.object({ kind: z.enum(['TERM', 'BREAK']), name: z.string().min(2).max(80), startsOn: isoDate, endsOn: isoDate }))
      .max(60)
      .parse(req.body);
    for (const p of periods) if (p.endsOn < p.startsOn) throw badRequest(`"${p.name}" ends before it starts.`);
    await withTenant(a.tenantId, async (tx) => {
      await tx.schoolCalendarPeriod.deleteMany({});
      if (periods.length) {
        await tx.schoolCalendarPeriod.createMany({ data: periods.map((p) => ({ tenantId: a.tenantId, kind: p.kind, name: p.name, startsOn: day(p.startsOn)!, endsOn: day(p.endsOn)! })) });
      }
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'schoolcalendar.replace', entity: 'Tenant', entityId: a.tenantId, after: periods });
    });
    res.json({ ok: true, count: periods.length });
  }),
);

/** How long routine records are kept (notifications, the email log). */
settingsRouter.get(
  '/settings/retention',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const t = await withTenant(a.tenantId, (tx) => tx.tenant.findFirstOrThrow({ select: { retentionSettings: true } }));
    res.json({ ...readRetention(t.retentionSettings), defaults: RETENTION_DEFAULTS, limits: RETENTION_LIMITS });
  }),
);

settingsRouter.put(
  '/settings/retention',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z
      .object({
        notificationsDays: z.number().int().min(RETENTION_LIMITS.notificationsDays[0]).max(RETENTION_LIMITS.notificationsDays[1]),
        emailLogDays: z.number().int().min(RETENTION_LIMITS.emailLogDays[0]).max(RETENTION_LIMITS.emailLogDays[1]),
      })
      .parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.tenant.findFirstOrThrow({ select: { retentionSettings: true } });
      await tx.tenant.update({ where: { id: a.tenantId }, data: { retentionSettings: b } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'settings.retention', entity: 'Tenant', entityId: a.tenantId, before: readRetention(before.retentionSettings), after: b });
    });
    res.json(b);
  }),
);
