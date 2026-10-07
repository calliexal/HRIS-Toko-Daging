import type { Db } from './db';

/**
 * Catat aksi sensitif (ubah gaji, kunci payroll, keputusan persetujuan, ubah role) ke audit_log.
 * Rantai hash dihitung trigger database. `diff` berisi ringkasan tanpa PII mentah (UU PDP).
 */
export const writeAudit = (db: Db, entry: { actorId: string; action: string; entity: string; entityId: string; diff?: Record<string, unknown> }) =>
  db.execute('INSERT INTO audit_log (actor_id, action, entity, entity_id, diff) VALUES ($1, $2, $3, $4, $5::jsonb)', [
    entry.actorId,
    entry.action,
    entry.entity,
    entry.entityId,
    JSON.stringify(entry.diff ?? {}),
  ]);
