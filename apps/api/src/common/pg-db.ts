import pg from 'pg';
import { DbError, type Db } from './db';

// Bentuk data disamakan dengan konvensi Db: BIGINT & NUMERIC → number, DATE → 'YYYY-MM-DD'.
// Rupiah aman di Number (< 2^53).
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => Number(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

type Queryable = pg.Pool | pg.PoolClient;

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    const err = e as { message?: string; code?: string };
    throw new DbError(err.message ?? 'Database error', err.code ?? 'XX000');
  }
};

const fromQueryable = (q: Queryable, pool: pg.Pool): Db => ({
  query: <T>(sql: string, params: readonly unknown[] = []) => wrap(async () => (await q.query(sql, params as unknown[])).rows as T[]),
  execute: (sql, params = []) => wrap(async () => void (await q.query(sql, params as unknown[]))),
  transaction: async (fn) => {
    if (q !== pool) return fn(fromQueryable(q, pool)); // transaksi bersarang memakai transaksi luar
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(fromQueryable(client, pool));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
});

export const createPgDb = (connectionString: string): { db: Db; close: () => Promise<void> } => {
  const pool = new pg.Pool({ connectionString, max: 10, statement_timeout: 15_000 });
  return { db: fromQueryable(pool, pool), close: () => pool.end() };
};
