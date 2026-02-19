import type Database from 'better-sqlite3';

export const version = 10;

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tags (
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (agent_id, tag)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_tags_tag ON agent_tags(tag)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_tags (
      integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (integration_id, tag)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_integration_tags_tag ON integration_tags(tag)
  `);
}
