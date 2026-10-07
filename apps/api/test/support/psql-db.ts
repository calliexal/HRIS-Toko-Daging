import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { DbError, type Db } from '../../src/common/db';

/**
 * Executor uji: satu sesi `psql` yang tetap hidup (transaksi bekerja seperti di produksi),
 * dipakai karena driver `pg` tidak bisa dipasang di sandbox. Hasil dibungkus json_agg sehingga
 * tipe data mengikuti JSON Postgres (sama dengan konvensi di common/db.ts).
 * Parameter diinterpolasi sebagai literal SQL — hanya untuk uji, input dikendalikan test.
 */
const literal = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Parameter numerik tidak valid: ${v}`);
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Array.isArray(v)) return `ARRAY[${v.map(literal).join(',')}]::text[]`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replaceAll("'", "''")}'`;
  return `'${String(v).replaceAll("'", "''")}'`;
};

/**
 * Driver pg menolak parameter yang dikirim tapi tidak dirujuk di SQL ("could not determine data type"),
 * jadi executor uji ikut menolak agar perbedaan itu ketahuan di uji, bukan di produksi.
 */
const interpolate = (sql: string, params: readonly unknown[]) => {
  const used = new Set<number>();
  const out = sql.replace(/\$(\d+)/g, (_, n: string) => {
    const index = Number(n) - 1;
    if (index >= params.length) throw new Error(`Parameter $${n} tidak diberikan`);
    used.add(index);
    return literal(params[index]);
  });
  const unused = params.map((_, i) => i).filter((i) => !used.has(i));
  if (unused.length > 0) throw new Error(`Parameter tidak dipakai di SQL: ${unused.map((i) => `$${i + 1}`).join(', ')}\n${sql}`);
  return out;
};

const MARKER = '__DP_END__';

export class PsqlDb implements Db {
  private readonly proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  private chain: Promise<unknown> = Promise.resolve();
  private waiter: ((block: string) => void) | null = null;
  private inTransaction = false;

  constructor(database: string, env: NodeJS.ProcessEnv = process.env) {
    this.proc = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=0', '-d', database], { env });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      const idx = this.buffer.indexOf(`${MARKER}|`);
      if (idx >= 0 && this.buffer.indexOf('\n', idx) >= 0 && this.waiter) {
        const end = this.buffer.indexOf('\n', idx);
        const block = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        const w = this.waiter;
        this.waiter = null;
        w(block);
      }
    });
    this.proc.stderr.on('data', () => {
      /* pesan error dibaca dari variabel psql LAST_ERROR_MESSAGE */
    });
    this.proc.stdin.write("\\pset pager off\nSET client_min_messages = warning;\n");
  }

  private run(statement: string): Promise<string> {
    const next = this.chain.then(
      () =>
        new Promise<string>((resolve, reject) => {
          this.waiter = (block) => {
            const markerAt = block.lastIndexOf(`${MARKER}|`);
            const [, errorFlag, sqlState, ...message] = block.slice(markerAt).split('|');
            const output = block.slice(0, markerAt).trim();
            if (errorFlag === 'true') reject(new DbError(message.join('|').trim(), sqlState ?? 'XX000'));
            else resolve(output);
          };
          this.proc.stdin.write(`${statement}\n\\echo ${MARKER}|:ERROR|:SQLSTATE|:LAST_ERROR_MESSAGE\n`);
        }),
    );
    // Reset LAST_ERROR agar error lama tidak terbaca ulang oleh perintah berikutnya.
    this.chain = next.catch(() => undefined).then(() => this.resetError());
    return next;
  }

  private resetError(): Promise<void> {
    return new Promise((resolve) => {
      this.waiter = () => resolve();
      this.proc.stdin.write(`\\set LAST_ERROR_MESSAGE ''\n\\set LAST_ERROR_SQLSTATE '00000'\n\\echo ${MARKER}|false|00000|\n`);
    });
  }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const body = interpolate(sql.trim().replace(/;\s*$/, ''), params);
    const out = await this.run(`WITH dp_q AS (${body}) SELECT coalesce(json_agg(dp_q), '[]'::json)::text FROM dp_q;`);
    return JSON.parse(out.split('\n').join('')) as T[];
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    await this.run(`${interpolate(sql.trim().replace(/;\s*$/, ''), params)};`);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    await this.run('BEGIN;');
    this.inTransaction = true;
    try {
      const result = await fn(this);
      await this.run('COMMIT;');
      return result;
    } catch (e) {
      await this.run('ROLLBACK;').catch(() => undefined);
      throw e;
    } finally {
      this.inTransaction = false;
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.proc.on('close', () => resolve());
      this.proc.stdin.end('\\q\n');
    });
  }
}
