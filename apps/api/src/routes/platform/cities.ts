/**
 * Dev console: set up and run organizations ("cities"). Every query on an
 * organization's data still goes through withTenant, so row-level security
 * scopes it to that one organization.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { appUrl, issueAuthToken } from '../../auth/authTokens.js';
import { platformOf } from '../../auth/platform.js';
import { type Tx, tenantIds, withTenant } from '../../lib/db.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { FEATURE_KEYS, FEATURES, forgetFeatures, resolveFeatures } from '../../services/platform/features.js';
import { logoUrlFor, parseLogo } from '../../services/platform/logo.js';
import { previewImport } from '../../services/platform/staffImport.js';
import { forgetTenantLookup, h } from '../context.js';
import { facilityBody } from '../settings.js';
import { positionBody } from '../staff.js';

export const citiesRouter = Router();
const uuid = z.string().uuid();
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'dev', 'platform', 'mail', 'status', 'help', 'support', 'demo', 'static']);
const subdomain = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/, 'Use 3–32 lowercase letters, digits or hyphens, starting with a letter.')
  .refine((s) => !RESERVED.has(s), 'That address is reserved.');

/** Logged twice: in the platform audit and in the organization's own audit trail. */
async function record(tx: Tx, adminId: string, tenantId: string, action: string, detail?: unknown) {
  const json = detail === undefined ? undefined : (JSON.parse(JSON.stringify(detail)) as Prisma.InputJsonValue);
  await tx.platformAudit.create({ data: { adminId, tenantId, action, detail: json } });
  await tx.auditLog.create({ data: { tenantId, actorId: null, action: `platform.${action}`, entity: 'Tenant', entityId: tenantId, after: json } });
}

async function cityOr404<T>(id: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(id, async (tx) => {
    if (!(await tx.tenant.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Organization');
    return fn(tx);
  });
}

citiesRouter.get(
  '/tenants',
  h(async (_req, res) => {
    const ids = await tenantIds();
    const cities = await Promise.all(
      ids.map((id) =>
        withTenant(id, async (tx) => {
          const [t, staff, facilities] = await Promise.all([
            tx.tenant.findUniqueOrThrow({ where: { id } }),
            tx.user.count({ where: { status: 'ACTIVE', anonymizedAt: null } }),
            tx.facility.count(),
          ]);
          const features = resolveFeatures(t.features);
          return {
            id,
            name: t.name,
            subdomain: t.subdomain,
            logoUrl: t.logoUrl,
            createdAt: t.createdAt,
            staff,
            facilities,
            featuresOn: FEATURE_KEYS.filter((k) => features[k]).length,
            featuresTotal: FEATURE_KEYS.length,
          };
        }),
      ),
    );
    res.json(cities.sort((a, b) => a.name.localeCompare(b.name)));
  }),
);

const newCity = z.object({
  name: z.string().trim().min(2).max(120),
  subdomain,
  defaultLocale: z.enum(['en-CA', 'fr-CA']).default('en-CA'),
  facility: facilityBody,
  admin: z.object({ firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60), email: z.string().email().max(160) }).nullable().optional(),
});

/** New organization with its first facility and, optionally, its first HR administrator (invited by email). */
citiesRouter.post(
  '/tenants',
  h(async (req, res) => {
    const p = platformOf(req);
    const body = newCity.parse(req.body);
    const id = randomUUID();
    try {
      await withTenant(id, async (tx) => {
        await tx.tenant.create({ data: { id, name: body.name, subdomain: body.subdomain, defaultLocale: body.defaultLocale } });
        await tx.facility.create({ data: { ...body.facility, tenantId: id } });
        if (body.admin) {
          const u = await tx.user.create({
            data: { tenantId: id, firstName: body.admin.firstName, lastName: body.admin.lastName, email: body.admin.email.toLowerCase(), roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', locale: body.defaultLocale },
          });
          const token = await issueAuthToken(tx, id, u.id, 'INVITE');
          await tx.emailOutbox.create({
            data: { tenantId: id, toEmail: u.email, template: 'invite', locale: u.locale, params: { organization: body.name, url: appUrl(body.subdomain, `/reset?token=${token}&invite=1`) } },
          });
        }
        await record(tx, p.adminId, id, 'tenant.create', { name: body.name, subdomain: body.subdomain, admin: body.admin?.email ?? null });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('SUBDOMAIN_TAKEN', 'Another organization already uses that address.');
      throw e;
    }
    res.status(201).json({ id });
  }),
);

citiesRouter.get(
  '/tenants/:id',
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const out = await cityOr404(id, async (tx) => {
      const [t, facilities, positions, certifications, staff, admins] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id } }),
        tx.facility.findMany({ orderBy: { name: 'asc' } }),
        tx.position.findMany({ include: { requirements: true, _count: { select: { qualifiedUsers: true } } }, orderBy: { name: 'asc' } }),
        tx.certification.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, nameFr: true } }),
        tx.user.count({ where: { status: 'ACTIVE', anonymizedAt: null } }),
        tx.user.findMany({ where: { roles: { has: 'HR_ADMIN' }, anonymizedAt: null }, select: { id: true, firstName: true, lastName: true, email: true, passwordHash: true } }),
      ]);
      return {
        organization: {
          id,
          name: t.name,
          subdomain: t.subdomain,
          defaultLocale: t.defaultLocale,
          themeColors: t.themeColors,
          logoUrl: t.logoUrl,
          payWeekStartDay: t.payWeekStartDay,
          vacationPayMode: t.vacationPayMode,
          payrollRetentionYears: t.payrollRetentionYears,
          createdAt: t.createdAt,
          signInUrl: appUrl(t.subdomain, '/login'),
        },
        features: resolveFeatures(t.features),
        featureDefaults: Object.fromEntries(FEATURE_KEYS.map((k) => [k, FEATURES[k].default])),
        facilities: facilities.map((f) => ({ ...f, latitude: f.latitude?.toNumber() ?? null, longitude: f.longitude?.toNumber() ?? null })),
        positions: positions.map((p) => ({ id: p.id, name: p.name, nameFr: p.nameFr, minimumAge: p.minimumAge, requiredCertificationIds: p.requirements.map((r) => r.certificationId), staff: p._count.qualifiedUsers })),
        certifications,
        staff,
        admins: admins.map((a) => ({ id: a.id, name: `${a.firstName} ${a.lastName}`, email: a.email, invited: !a.passwordHash })),
      };
    });
    res.json(out);
  }),
);

const cityPatch = z
  .object({
    name: z.string().trim().min(2).max(120),
    defaultLocale: z.enum(['en-CA', 'fr-CA']),
    themeColors: z.object({ primary: hex, primaryHover: hex, primaryContrast: hex, accent: hex }).partial(),
    payWeekStartDay: z.number().int().min(0).max(6),
    vacationPayMode: z.enum(['PAY_EACH_PERIOD', 'ACCRUE']),
    payrollRetentionYears: z.number().int().min(6).max(15),
    features: z.record(z.enum(FEATURE_KEYS as [string, ...string[]]), z.boolean()),
  })
  .partial();

citiesRouter.patch(
  '/tenants/:id',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const { features, themeColors, ...rest } = cityPatch.parse(req.body);
    await cityOr404(id, async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id } });
      await tx.tenant.update({
        where: { id },
        data: {
          ...rest,
          ...(themeColors ? { themeColors: { ...(before.themeColors as object), ...themeColors } } : {}),
          ...(features ? { features: { ...resolveFeatures(before.features), ...features } } : {}),
        },
      });
      await record(tx, p.adminId, id, features ? 'tenant.features' : 'tenant.update', { ...rest, themeColors, features });
    });
    forgetFeatures(id);
    forgetTenantLookup();
    res.json({ ok: true });
  }),
);

citiesRouter.post(
  '/tenants/:id/facilities',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = facilityBody.parse(req.body);
    const f = await cityOr404(id, async (tx) => {
      const created = await tx.facility.create({ data: { ...body, tenantId: id } });
      await record(tx, p.adminId, id, 'facility.create', body);
      return created;
    });
    res.status(201).json({ id: f.id });
  }),
);

citiesRouter.patch(
  '/tenants/:id/facilities/:facilityId',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const facilityId = uuid.parse(req.params.facilityId);
    const body = facilityBody.partial().parse(req.body);
    await cityOr404(id, async (tx) => {
      if (!(await tx.facility.findUnique({ where: { id: facilityId } }))) throw notFound('Facility');
      await tx.facility.update({ where: { id: facilityId }, data: body });
      await record(tx, p.adminId, id, 'facility.update', { facilityId, ...body });
    });
    res.json({ ok: true });
  }),
);

async function savePosition(tx: Tx, tenantId: string, positionId: string | null, body: z.infer<typeof positionBody>) {
  const visible = await tx.certification.count({ where: { id: { in: body.requiredCertificationIds } } });
  if (visible !== new Set(body.requiredCertificationIds).size) throw badRequest('Unknown certification.');
  const data = { name: body.name, nameFr: body.nameFr ?? null, minimumAge: body.minimumAge ?? null };
  const pos = positionId ? await tx.position.update({ where: { id: positionId }, data }) : await tx.position.create({ data: { ...data, tenantId } });
  await tx.positionCertRequirement.deleteMany({ where: { positionId: pos.id } });
  if (body.requiredCertificationIds.length) {
    await tx.positionCertRequirement.createMany({ data: body.requiredCertificationIds.map((certificationId) => ({ tenantId, positionId: pos.id, certificationId })) });
  }
  return pos;
}

citiesRouter.post(
  '/tenants/:id/positions',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = positionBody.parse(req.body);
    const pos = await cityOr404(id, async (tx) => {
      if (await tx.position.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } })) throw conflict('POSITION_EXISTS', 'This organization already has a position with that name.');
      const created = await savePosition(tx, id, null, body);
      await record(tx, p.adminId, id, 'position.create', body);
      return created;
    });
    res.status(201).json({ id: pos.id });
  }),
);

citiesRouter.put(
  '/tenants/:id/positions/:positionId',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const positionId = uuid.parse(req.params.positionId);
    const body = positionBody.parse(req.body);
    await cityOr404(id, async (tx) => {
      if (!(await tx.position.findUnique({ where: { id: positionId } }))) throw notFound('Position');
      await savePosition(tx, id, positionId, body);
      await record(tx, p.adminId, id, 'position.update', { positionId, ...body });
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ Logo
citiesRouter.put(
  '/tenants/:id/logo',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const logo = parseLogo(z.object({ dataUrl: z.string().max(800_000) }).parse(req.body).dataUrl);
    const logoUrl = logoUrlFor(id, logo.sha256);
    await cityOr404(id, async (tx) => {
      await tx.tenantLogo.upsert({ where: { tenantId: id }, create: { tenantId: id, ...logo }, update: logo });
      await tx.tenant.update({ where: { id }, data: { logoUrl } });
      await record(tx, p.adminId, id, 'logo.upload', { contentType: logo.contentType, bytes: logo.bytes.length, sha256: logo.sha256 });
    });
    forgetTenantLookup();
    res.json({ logoUrl });
  }),
);

citiesRouter.delete(
  '/tenants/:id/logo',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    await cityOr404(id, async (tx) => {
      await tx.tenantLogo.deleteMany({ where: { tenantId: id } });
      await tx.tenant.update({ where: { id }, data: { logoUrl: null } });
      await record(tx, p.adminId, id, 'logo.remove');
    });
    forgetTenantLookup();
    res.status(204).end();
  }),
);

citiesRouter.get(
  '/tenants/:id/logo',
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const logo = await withTenant(id, (tx) => tx.tenantLogo.findUnique({ where: { tenantId: id } }));
    if (!logo) throw notFound('Logo');
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.send(Buffer.from(logo.bytes));
  }),
);

// ---------------------------------------------------------------- Import
const importBody = z.object({ csv: z.string().min(1).max(1_500_000), sendInvites: z.boolean().default(false) });

async function preview(tx: Tx, csv: string) {
  const [users, positions] = await Promise.all([tx.user.findMany({ select: { email: true } }), tx.position.findMany({ select: { id: true, name: true, nameFr: true } })]);
  return previewImport(csv, { existingEmails: new Set(users.map((u) => u.email.toLowerCase())), positions, today: new Date().toISOString().slice(0, 10) });
}

citiesRouter.post(
  '/tenants/:id/import/preview',
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { csv } = importBody.parse(req.body);
    res.json(await cityOr404(id, (tx) => preview(tx, csv)));
  }),
);

/** Creates the rows that passed the check; rows with problems or already on staff are skipped. */
citiesRouter.post(
  '/tenants/:id/import',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const { csv, sendInvites } = importBody.parse(req.body);
    const out = await withTenant(
      id,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id } });
        if (!tenant) throw notFound('Organization');
        const pv = await preview(tx, csv);
        if (pv.missingColumns.length) throw badRequest(`Missing columns: ${pv.missingColumns.join(', ')}`);
        const ready = pv.rows.filter((r) => r.status === 'create');
        for (const r of ready) {
          const u = await tx.user.create({
            data: {
              tenantId: id,
              firstName: r.firstName,
              lastName: r.lastName,
              email: r.email,
              phone: r.phone,
              roles: r.roles,
              employmentStatus: r.employmentStatus!,
              locale: r.locale,
              hireDate: r.hireDate ? new Date(`${r.hireDate}T00:00:00Z`) : null,
              seniorityDate: r.hireDate ? new Date(`${r.hireDate}T00:00:00Z`) : null,
              dateOfBirth: r.dateOfBirth ? new Date(`${r.dateOfBirth}T00:00:00Z`) : null,
              employeeNumber: r.employeeNumber,
              unionMember: r.unionMember,
            },
          });
          if (r.positionIds.length) await tx.userPosition.createMany({ data: [...new Set(r.positionIds)].map((positionId) => ({ tenantId: id, userId: u.id, positionId })) });
          if (sendInvites) {
            const token = await issueAuthToken(tx, id, u.id, 'INVITE');
            await tx.emailOutbox.create({
              data: { tenantId: id, toEmail: u.email, template: 'invite', locale: u.locale, params: { organization: tenant.name, url: appUrl(tenant.subdomain, `/reset?token=${token}&invite=1`) } },
            });
          }
        }
        await record(tx, p.adminId, id, 'staff.import', { created: ready.length, skipped: pv.rows.length - ready.length, invited: sendInvites });
        return { created: ready.length, exists: pv.summary.exists, errors: pv.summary.error, invited: sendInvites ? ready.length : 0 };
      },
      { timeoutMs: 120_000 }, // up to 2,000 people in one all-or-nothing import
    );
    res.json(out);
  }),
);
