/**
 * SQL injection rules for this codebase (checked by test/unit/sqlSafety.test.ts):
 *
 * 1. Values never go into SQL text. Use Prisma's query API, or `$queryRaw` / `$executeRaw` as
 *    tagged templates (`tx.$queryRaw\`… ${value}\``), which send every `${}` as a bound parameter;
 *    with `pg`, pass values as `$1, $2` and an array.
 * 2. Only identifiers (table, column, schema, channel names) may be spliced into SQL, and only
 *    through `ident()`, which allows plain names and quotes them. They come from the database's own
 *    catalogue or from constants in the code, never from a request.
 */

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** A quoted SQL identifier, or an error for anything that isn't a plain name. */
export function ident(name: string): string {
  if (!NAME.test(name)) throw new Error(`Refusing an unsafe SQL identifier: ${JSON.stringify(name).slice(0, 80)}`);
  return `"${name}"`;
}

/** schema.table, both checked. */
export const qualified = (schema: string, table: string) => `${ident(schema)}.${ident(table)}`;
