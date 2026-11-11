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
import { platformOf, requirePlatformStepUp } from '../../auth/platform.js';
import { type Tx, tenantIds, withTenant } from '../../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { FILE_CSP } from '../../lib/files.js';
import { FEATURE_KEYS, FEATURE_REQUIRES, FEATURES, forgetFeatures, resolveFeatures } from '../../services/platform/features.js';
import { logoUrlFor, parseLogo } from '../../services/platform/logo.js';
import { previewImport } from '../../services/platform/staffImport.js';
import { setManagers } from '../../services/people/reporting.js';
import { createPool, poolDetailsBody, poolDetailsView, updatePool } from '../../services/ops/pools.js';
import { CUSTOM_ROLE_PERMISSIONS, customRoleBody, deleteCustomRole, listCustomRoles, saveCustomRole, setUserCustomRoles } from '../../services/people/customRoles.js';
import { forgetTenantLookup, h } from '../context.js';
import type { AccessRole } from '@prisma/client';
import { MENU } from '../../auth/menu.js';
import { PERMISSIONS, type Permission, ROLE_PERMISSIONS } from '../../auth/permissions.js';
import { parseOverrides, rolePermissions, setMenu, setPermission, type RoleOverrides } from '../../services/platform/roleOverrides.js';
import { facilityBody } from '../settings.js';
import { positionBody, savePosition as savePositionChange } from '../../services/people/positionAdmin.js';
import { departmentBody, deleteDepartment, listDepartments, saveDepartment } from '../../services/people/departmentAdmin.js';

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
  /** Private-sector companies start without seniority; cities with it (either can change it later). */
  sector: z.enum(['public', 'private']).default('public'),
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
        // New organizations start with a passkey required for HR, who can see everyone's records.
        await tx.tenant.create({ data: { id, name: body.name, subdomain: body.subdomain, defaultLocale: body.defaultLocale, mfaRoles: ['HR_ADMIN'], ...(body.sector === 'private' ? { features: { seniority: false } } : {}) } });
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
      const [t, facilities, positions, certifications, staff, admins, customRoles, pools, departments] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id } }),
        tx.facility.findMany({ orderBy: { name: 'asc' } }),
        tx.position.findMany({ include: { requirements: true, _count: { select: { qualifiedUsers: true } } }, orderBy: { name: 'asc' } }),
        tx.certification.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, nameFr: true } }),
        tx.user.count({ where: { status: 'ACTIVE', anonymizedAt: null } }),
        tx.user.findMany({ where: { roles: { has: 'HR_ADMIN' }, anonymizedAt: null }, select: { id: true, firstName: true, lastName: true, email: true, passwordHash: true } }),
        listCustomRoles(tx),
        tx.poolBody.findMany({ orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { name: 'asc' }] }),
        listDepartments(tx),
      ]);
      return {
        organization: {
          id,
          name: t.name,
          subdomain: t.subdomain,
          defaultLocale: t.defaultLocale,
          timeFormat: t.timeFormat,
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
        featureRequires: FEATURE_REQUIRES,
        facilities: facilities.map((f) => ({ ...f, latitude: f.latitude?.toNumber() ?? null, longitude: f.longitude?.toNumber() ?? null })),
        positions: positions.map((p) => ({ id: p.id, name: p.name, nameFr: p.nameFr, minimumAge: p.minimumAge, hoursOfService: p.hoursOfService, departmentId: p.departmentId, requiredCertificationIds: p.requirements.map((r) => r.certificationId), staff: p._count.qualifiedUsers })),
        departments: departments.departments.map(({ positions: _p, ...d }) => d),
        departmentSetup: { ...departments, limited: false },
        certifications,
        staff,
        admins: admins.map((a) => ({ id: a.id, name: `${a.firstName} ${a.lastName}`, email: a.email, invited: !a.passwordHash })),
        customRoles,
        roleCatalog: CUSTOM_ROLE_PERMISSIONS,
        pools: pools.map((p) => ({ id: p.id, facilityId: p.facilityId, name: p.name, kind: p.kind, bathersPerLifeguard: p.bathersPerLifeguard, limitsSet: p.freeChlorineMinPpm !== null || p.phMin !== null, ...poolDetailsView(p) })),
      };
    });
    res.json(out);
  }),
);

const cityPatch = z
  .object({
    name: z.string().trim().min(2).max(120),
    defaultLocale: z.enum(['en-CA', 'fr-CA']),
    timeFormat: z.enum(['auto', '12h', '24h']),
    themeColors: z.object({ primary: hex, primaryHover: hex, primaryContrast: hex, accent: hex }).partial(),
    payWeekStartDay: z.number().int().min(0).max(6),
    vacationPayMode: z.enum(['PAY_EACH_PERIOD', 'ACCRUE']),
    payrollRetentionYears: z.number().int().min(6).max(15),
    features: z.partialRecord(z.enum(FEATURE_KEYS as [string, ...string[]]), z.boolean()),
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

/** The Dev console sends the whole position: what's left out is cleared, as before. */
const savePosition = (tx: Tx, tenantId: string, positionId: string | null, body: z.infer<typeof positionBody>) => savePositionChange(tx, tenantId, positionId, { ...body, nameFr: body.nameFr ?? null, minimumAge: body.minimumAge ?? null });

// Departments, set up from the Dev console when a city is first configured.
citiesRouter.post(
  '/tenants/:id/departments',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = departmentBody.parse(req.body);
    const d = await cityOr404(id, async (tx) => {
      const created = await saveDepartment(tx, id, null, body);
      await record(tx, p.adminId, id, 'department.create', body);
      return created;
    });
    res.status(201).json({ id: d.id });
  }),
);

citiesRouter.put(
  '/tenants/:id/departments/:departmentId',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const departmentId = uuid.parse(req.params.departmentId);
    const body = departmentBody.parse(req.body);
    await cityOr404(id, async (tx) => {
      await saveDepartment(tx, id, departmentId, body);
      await record(tx, p.adminId, id, 'department.update', { departmentId, ...body });
    });
    res.json({ ok: true });
  }),
);

citiesRouter.delete(
  '/tenants/:id/departments/:departmentId',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const departmentId = uuid.parse(req.params.departmentId);
    await cityOr404(id, async (tx) => {
      await deleteDepartment(tx, id, departmentId);
      await record(tx, p.adminId, id, 'department.delete', { departmentId });
    });
    res.status(204).end();
  }),
);

citiesRouter.post(
  '/tenants/:id/positions',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = positionBody.parse(req.body);
    const pos = await cityOr404(id, async (tx) => {
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
      await savePosition(tx, id, positionId, body);
      await record(tx, p.adminId, id, 'position.update', { positionId, ...body });
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------- The city's own roles
citiesRouter.post(
  '/tenants/:id/roles',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = customRoleBody.parse(req.body);
    const role = await cityOr404(id, async (tx) => {
      const r = await saveCustomRole(tx, id, null, body);
      await record(tx, p.adminId, id, 'role.create', body);
      return r;
    });
    res.status(201).json({ id: role.id });
  }),
);

citiesRouter.put(
  '/tenants/:id/roles/:roleId',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const roleId = uuid.parse(req.params.roleId);
    const body = customRoleBody.parse(req.body);
    await cityOr404(id, async (tx) => {
      await saveCustomRole(tx, id, roleId, body);
      await record(tx, p.adminId, id, 'role.update', { roleId, ...body });
    });
    res.json({ ok: true });
  }),
);

citiesRouter.delete(
  '/tenants/:id/roles/:roleId',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const roleId = uuid.parse(req.params.roleId);
    await cityOr404(id, async (tx) => {
      await deleteCustomRole(tx, id, roleId);
      await record(tx, p.adminId, id, 'role.delete', { roleId });
    });
    res.status(204).end();
  }),
);

// ------------------------------------------------------------------ Pools
citiesRouter.post(
  '/tenants/:id/pools',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = poolDetailsBody.parse(req.body);
    const pool = await cityOr404(id, async (tx) => {
      const created = await createPool(tx, id, body);
      await record(tx, p.adminId, id, 'pool.create', body);
      return created;
    });
    res.status(201).json({ id: pool.id });
  }),
);

citiesRouter.patch(
  '/tenants/:id/pools/:poolId',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const poolId = uuid.parse(req.params.poolId);
    const body = poolDetailsBody.partial().parse(req.body);
    await cityOr404(id, async (tx) => {
      await updatePool(tx, poolId, body);
      await record(tx, p.adminId, id, 'pool.update', { poolId, ...body });
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
    res.setHeader('Content-Security-Policy', FILE_CSP);
    res.send(Buffer.from(logo.bytes));
  }),
);

// ---------------------------------------------------------------- Import
const importBody = z.object({ csv: z.string().min(1).max(1_500_000), sendInvites: z.boolean().default(false) });

async function preview(tx: Tx, csv: string) {
  const [users, positions, customRoles] = await Promise.all([
    tx.user.findMany({ select: { email: true } }),
    tx.position.findMany({ select: { id: true, name: true, nameFr: true } }),
    tx.customRole.findMany({ select: { id: true, name: true, nameFr: true } }),
  ]);
  return previewImport(csv, { existingEmails: new Set(users.map((u) => u.email.toLowerCase())), positions, customRoles, today: new Date().toISOString().slice(0, 10) });
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
  requirePlatformStepUp,
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
        // FH creates a city's first HR administrators while setting it up; after that, only the city's own HR can.
        if (ready.some((r) => r.roles.includes('HR_ADMIN')) && (await tx.user.count({ where: { status: 'ACTIVE', roles: { has: 'HR_ADMIN' } } }))) {
          throw forbidden('This organization already has an HR administrator: only its own HR can add more. Remove HR_ADMIN from the file.');
        }
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
          if (r.customRoleIds.length) await setUserCustomRoles(tx, id, u.id, r.customRoleIds);
          if (r.positionIds.length) await tx.userPosition.createMany({ data: [...new Set(r.positionIds)].map((positionId) => ({ tenantId: id, userId: u.id, positionId })) });
          if (sendInvites) {
            const token = await issueAuthToken(tx, id, u.id, 'INVITE');
            await tx.emailOutbox.create({
              data: { tenantId: id, toEmail: u.email, template: 'invite', locale: u.locale, params: { organization: tenant.name, url: appUrl(tenant.subdomain, `/reset?token=${token}&invite=1`) } },
            });
          }
        }
        // Reporting lines last, once everyone in the file exists. A manager row that failed leaves the line unset.
        const withManager = ready.filter((r) => r.managerEmail);
        if (withManager.length) {
          const byEmail = new Map((await tx.user.findMany({ where: { email: { in: [...new Set(withManager.flatMap((r) => [r.email, r.managerEmail!]))] } }, select: { id: true, email: true } })).map((u) => [u.email.toLowerCase(), u.id]));
          const byManager = new Map<string, string[]>();
          for (const r of withManager) {
            const m = byEmail.get(r.managerEmail!);
            if (m) byManager.set(m, [...(byManager.get(m) ?? []), byEmail.get(r.email)!]);
          }
          for (const [m, people] of byManager) await setManagers(tx, null, id, people, m);
        }
        await record(tx, p.adminId, id, 'staff.import', { created: ready.length, skipped: pv.rows.length - ready.length, invited: sendInvites });
        return { created: ready.length, exists: pv.summary.exists, errors: pv.summary.error, invited: sendInvites ? ready.length : 0 };
      },
      { timeoutMs: 120_000 }, // up to 2,000 people in one all-or-nothing import
    );
    res.json(out);
  }),
);

// ---------------------------------------------------------------------------
// Menus and access per role: every menu item and permission, toggled per city.
// ---------------------------------------------------------------------------
const ROLE_KEYS = Object.keys(ROLE_PERMISSIONS) as [AccessRole, ...AccessRole[]];

function accessView(stored: unknown, features: ReturnType<typeof resolveFeatures>, mfaRoles: AccessRole[]) {
  const overrides = parseOverrides(stored);
  const featureOf = (p: string) => (FEATURE_KEYS as string[]).find((k) => (FEATURES[k as keyof typeof FEATURES].permissions as readonly string[]).includes(p)) ?? null;
  return {
    roles: ROLE_KEYS.map((role) => {
      const effective = rolePermissions(role, overrides);
      const hidden = overrides[role]?.hideMenu ?? [];
      return {
        role,
        mfa: mfaRoles.includes(role),
        customized: !!overrides[role] && (overrides[role]!.grant.length + overrides[role]!.revoke.length + overrides[role]!.hideMenu.length > 0),
        permissions: [...effective].sort(),
        defaults: [...ROLE_PERMISSIONS[role]].sort(),
        menu: MENU.map((m) => ({ href: m.href, shown: !hidden.includes(m.href) && m.permissions.some((p) => effective.has(p)) })),
      };
    }),
    menu: MENU.map((m) => ({ ...m, feature: featureOf(m.permissions[0]!), featureOn: (() => { const f = featureOf(m.permissions[0]!); return f ? features[f as keyof typeof features] : true; })() })),
    permissions: PERMISSIONS.map((p) => ({ key: p, feature: featureOf(p) })),
  };
}

async function saveOverrides(id: string, adminId: string, action: string, detail: unknown, change: (o: RoleOverrides) => RoleOverrides) {
  const out = await cityOr404(id, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id }, select: { roleOverrides: true, features: true, mfaRoles: true } });
    const next = change(parseOverrides(t.roleOverrides));
    await tx.tenant.update({ where: { id }, data: { roleOverrides: next as Prisma.InputJsonValue } });
    await record(tx, adminId, id, action, detail);
    return accessView(next, resolveFeatures(t.features), t.mfaRoles);
  });
  forgetFeatures(id);
  return out;
}

citiesRouter.get(
  '/tenants/:id/access',
  h(async (req, res) => {
    platformOf(req);
    const id = uuid.parse(req.params.id);
    res.json(await cityOr404(id, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id }, select: { roleOverrides: true, features: true, mfaRoles: true } });
      return accessView(t.roleOverrides, resolveFeatures(t.features), t.mfaRoles);
    }));
  }),
);

/** Require a second factor (a passkey, or a sign-in code unless the organization allows passkeys only) for everyone with this access level. */
citiesRouter.put(
  '/tenants/:id/access/mfa',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = z.object({ role: z.enum(ROLE_KEYS), required: z.boolean() }).parse(req.body);
    // HR administrators always need a second factor; FH can't take that away.
    if (body.role === 'HR_ADMIN' && !body.required) throw forbidden('HR administrators always need a second factor.');
    const out = await cityOr404(id, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id }, select: { roleOverrides: true, features: true, mfaRoles: true } });
      const mfaRoles = body.required ? [...new Set([...t.mfaRoles, body.role])] : t.mfaRoles.filter((r) => r !== body.role);
      await tx.tenant.update({ where: { id }, data: { mfaRoles } });
      await record(tx, p.adminId, id, 'access.mfa', body);
      return accessView(t.roleOverrides, resolveFeatures(t.features), mfaRoles);
    });
    forgetFeatures(id);
    res.json(out);
  }),
);

citiesRouter.put(
  '/tenants/:id/access/menu',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = z.object({ role: z.enum(ROLE_KEYS), href: z.enum(MENU.map((m) => m.href) as [string, ...string[]]), shown: z.boolean() }).parse(req.body);
    res.json(await saveOverrides(id, p.adminId, 'access.menu', body, (o) => setMenu(o, body.role, body.href, body.shown)));
  }),
);

citiesRouter.put(
  '/tenants/:id/access/permission',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = z.object({ role: z.enum(ROLE_KEYS), permission: z.enum(PERMISSIONS as unknown as [Permission, ...Permission[]]), on: z.boolean() }).parse(req.body);
    // FH can switch a role's access off, or back on to its defaults; widening it is the city's decision (its own roles).
    if (body.on && !ROLE_PERMISSIONS[body.role].includes(body.permission)) throw forbidden('FH can’t give an access level more than its defaults. The city’s HR can make a role for that.');
    res.json(await saveOverrides(id, p.adminId, 'access.permission', body, (o) => setPermission(o, body.role, body.permission, body.on)));
  }),
);

citiesRouter.post(
  '/tenants/:id/access/reset',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const { role } = z.object({ role: z.enum(ROLE_KEYS) }).parse(req.body);
    res.json(await saveOverrides(id, p.adminId, 'access.reset', { role }, (o) => {
      const { [role]: _, ...rest } = o;
      return rest;
    }));
  }),
);
