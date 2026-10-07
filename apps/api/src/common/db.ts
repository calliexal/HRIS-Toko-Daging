/**
 * Akses database minimal yang dipakai semua repository.
 * Konvensi SQL repository (agar driver produksi `pg` dan executor uji memberi bentuk data sama):
 *  - parameter posisional $1..$n dengan cast eksplisit ($1::date, $2::bigint);
 *  - SELECT tidak pernah mengembalikan TIMESTAMPTZ mentah: format jadi teks (to_char … AT TIME ZONE) atau epoch ms;
 *  - INSERT/UPDATE/DELETE yang perlu hasil memakai RETURNING; tanpa hasil → execute().
 *  - parameter JSONB selalu JSON.stringify(...) (driver pg mengubah array JS menjadi array Postgres, bukan JSON).
 */
export type Db = {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
  /** Menjalankan fn dalam satu transaksi; error apa pun = ROLLBACK. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
};

export const one = async <T>(rows: Promise<T[]>): Promise<T | undefined> => (await rows)[0];

/** Kode SQLSTATE dari error database (dipetakan ke error domain oleh lapisan service). */
export class DbError extends Error {
  constructor(
    message: string,
    readonly sqlState: string,
  ) {
    super(message);
    this.name = 'DbError';
  }
}
