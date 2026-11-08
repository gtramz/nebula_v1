import type { DatabaseSync } from 'node:sqlite';

/** Synchronous writes only. The caller owns this transaction; do not nest it. */
export function transaction<T>(db: DatabaseSync, write: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = write(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
