import type Database from 'better-sqlite3';

export const version = 7;

export function up(db: Database.Database): void {
  // SQLite doesn't support ALTER COLUMN, so recreate the table to make key_pem nullable
  db.exec(`
    CREATE TABLE hub_ca_new (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cert_pem TEXT NOT NULL,
      key_pem TEXT,
      key_pem_enc TEXT,
      created_at TEXT NOT NULL
    )
  `);
  db.exec('INSERT INTO hub_ca_new SELECT id, cert_pem, key_pem, NULL, created_at FROM hub_ca');
  db.exec('DROP TABLE hub_ca');
  db.exec('ALTER TABLE hub_ca_new RENAME TO hub_ca');
}
