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

  private async withLocal<T>(localId: string, userId: string, fn: (c: pg.PoolClient, local: { tenant_id: string; kek_id: string }) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const local = await c.query<{ tenant_id: string; kek_id: string }>('SELECT tenant_id, kek_id FROM union_hub.local WHERE id = $1', [localId]);
      const row = local.rows[0];
      if (!row) throw forbidden('Unknown union local');
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

  async postMessage(localId: string, userId: string, threadId: string, body: string): Promise<string> {
    const keys = this.keys;
    return this.withLocal(localId, userId, async function postMessage(c, local) {
      const id = crypto.randomUUID();
      const s = await seal(keys, local.kek_id, body, `union:${localId}:${id}`);
      await c.query(
        `INSERT INTO union_hub.message (id, local_id, thread_id, author_user_id, ciphertext, iv, auth_tag, wrapped_data_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, localId, threadId, userId, s.ciphertext, s.iv, s.authTag, s.wrappedDataKey],
      );
      return id;
    });
  }

  async readThread(localId: string, userId: string, threadId: string) {
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
    });
  }

  /** Official seniority roster (view-only for stewards, per the CBA). */
  async seniorityRoster(localId: string, userId: string) {
    return this.withLocal(localId, userId, async function seniorityRoster(c) {
      const r = await c.query(
        `SELECT id, first_name, last_name, employment_status, seniority_date, seniority_hours
           FROM union_hub.staff_directory WHERE union_member
          ORDER BY seniority_date NULLS LAST, seniority_hours DESC`,
      );
      return r.rows;
    });
  }
}
