/**
 * Union Hub service. Talks to Postgres ONLY through the `flexcity_union` role
 * (UNION_DATABASE_URL), which is the only role granted the union_hub schema.
 * The main API's role (flexcity_app) cannot read these tables at all — a bug or
 * a supervisor account in the main app cannot reach them.
 *
 * Message bodies are sealed with the LOCAL's KEK, not the employer tenant's.
 *
 * Not a guarantee of legal privilege; see db/union_hub.sql.
 */
import pg from 'pg';
import { forbidden } from '../../lib/errors.js';
import { type KeyProvider, open, seal } from '../crypto/envelope.js';

export class UnionHub {
  constructor(
    private readonly pool: pg.Pool,
    private readonly keys: KeyProvider,
  ) {}

  static fromUrl(url: string, keys: KeyProvider): UnionHub {
    return new UnionHub(new pg.Pool({ connectionString: url, max: 5 }), keys);
  }

  /** Locals this person belongs to, within their own organization. */
  async listLocals(tenantId: string, userId: string) {
    const r = await this.pool.query<{ id: string; name: string; is_steward: boolean }>(
      `SELECT l.id, l.name, m.is_steward FROM union_hub.member_access m JOIN union_hub.local l ON l.id = m.local_id
        WHERE m.user_id = $1 AND l.tenant_id = $2 ORDER BY l.name`,
      [userId, tenantId],
    );
    return r.rows.map((x) => ({ id: x.id, name: x.name, isSteward: x.is_steward }));
  }

  async listThreads(tenantId: string, localId: string, userId: string) {
    return this.withLocal(localId, userId, async function listThreads(c) {
      const r = await c.query(
        `SELECT t.id, t.title, t.created_at, count(m.id)::int AS messages, max(m.created_at) AS last_message_at
           FROM union_hub.thread t LEFT JOIN union_hub.message m ON m.thread_id = t.id
          WHERE t.local_id = $1 GROUP BY t.id ORDER BY coalesce(max(m.created_at), t.created_at) DESC`,
        [localId],
      );
      return r.rows.map((x) => ({ id: x.id, title: x.title, createdAt: x.created_at, messages: x.messages, lastMessageAt: x.last_message_at }));
    }, tenantId);
  }

  async createThread(tenantId: string, localId: string, userId: string, title: string, body: string): Promise<string> {
    const id = await this.withLocal(localId, userId, async function createThread(c) {
      const r = await c.query<{ id: string }>('INSERT INTO union_hub.thread (local_id, title, created_by) VALUES ($1, $2, $3) RETURNING id', [localId, title, userId]);
      return r.rows[0]!.id;
    }, tenantId);
    await this.postMessage(localId, userId, id, body, tenantId);
    return id;
  }

  /** Stewards add members of their own organization. */
  async addMember(tenantId: string, localId: string, stewardId: string, userId: string, isSteward: boolean) {
    return this.withLocal(localId, stewardId, async function addMember(c) {
      const me = await c.query('SELECT is_steward FROM union_hub.member_access WHERE local_id = $1 AND user_id = $2', [localId, stewardId]);
      if (!me.rows[0]?.is_steward) throw forbidden('Only stewards can add members.');
      const person = await c.query('SELECT 1 FROM union_hub.staff_directory WHERE id = $1', [userId]);
      if (person.rowCount === 0) throw forbidden('That person is not on this organization’s staff.');
      await c.query(
        `INSERT INTO union_hub.member_access (local_id, user_id, is_steward) VALUES ($1, $2, $3)
         ON CONFLICT (local_id, user_id) DO UPDATE SET is_steward = EXCLUDED.is_steward`,
        [localId, userId, isSteward],
      );
    }, tenantId);
  }

  private async withLocal<T>(
    localId: string,
    userId: string,
    fn: (c: pg.PoolClient, local: { tenant_id: string; kek_id: string }) => Promise<T>,
    callerTenantId?: string,
  ): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const local = await c.query<{ tenant_id: string; kek_id: string }>('SELECT tenant_id, kek_id FROM union_hub.local WHERE id = $1', [localId]);
      const row = local.rows[0];
      if (!row) throw forbidden('Unknown union local');
      // A local belongs to one employer tenant; never serve it to another organization's users.
      if (callerTenantId && row.tenant_id !== callerTenantId) throw forbidden('Unknown union local');
      const member = await c.query('SELECT 1 FROM union_hub.member_access WHERE local_id = $1 AND user_id = $2', [localId, userId]);
      if (member.rowCount === 0) throw forbidden('Not a member of this local');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [row.tenant_id]);
      const result = await fn(c, row);
      await c.query('INSERT INTO union_hub.access_log (local_id, user_id, action) VALUES ($1, $2, $3)', [localId, userId, fn.name || 'access']);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  async postMessage(localId: string, userId: string, threadId: string, body: string, tenantId?: string): Promise<string> {
    const keys = this.keys;
    return this.withLocal(localId, userId, async function postMessage(c, local) {
      const t = await c.query('SELECT 1 FROM union_hub.thread WHERE id = $1 AND local_id = $2', [threadId, localId]);
      if (t.rowCount === 0) throw forbidden('Unknown thread');
      const id = crypto.randomUUID();
      const s = await seal(keys, local.kek_id, body, `union:${localId}:${id}`);
      await c.query(
        `INSERT INTO union_hub.message (id, local_id, thread_id, author_user_id, ciphertext, iv, auth_tag, wrapped_data_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, localId, threadId, userId, s.ciphertext, s.iv, s.authTag, s.wrappedDataKey],
      );
      return id;
    }, tenantId);
  }

  async readThread(localId: string, userId: string, threadId: string, tenantId?: string) {
    const keys = this.keys;
    return this.withLocal(localId, userId, async function readThread(c, local) {
      const rows = await c.query<{
        id: string;
        author_user_id: string;
        created_at: Date;
        ciphertext: Buffer;
        iv: Buffer;
        auth_tag: Buffer;
        wrapped_data_key: Buffer;
      }>('SELECT * FROM union_hub.message WHERE local_id = $1 AND thread_id = $2 ORDER BY created_at', [localId, threadId]);
      return Promise.all(
        rows.rows.map(async (r) => ({
          id: r.id,
          authorUserId: r.author_user_id,
          createdAt: r.created_at,
          body: await open(
            keys,
            { ciphertext: r.ciphertext, iv: r.iv, authTag: r.auth_tag, wrappedDataKey: r.wrapped_data_key, kekId: local.kek_id },
            `union:${localId}:${r.id}`,
          ),
        })),
      );
    }, tenantId);
  }

  /** Official seniority roster (view-only for stewards, per the CBA). */
  async seniorityRoster(localId: string, userId: string, tenantId?: string) {
    return this.withLocal(localId, userId, async function seniorityRoster(c) {
      const r = await c.query(
        `SELECT id, first_name, last_name, employment_status, seniority_date, seniority_hours
           FROM union_hub.staff_directory WHERE union_member
          ORDER BY seniority_date NULLS LAST, seniority_hours DESC`,
      );
      return r.rows;
    }, tenantId);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
