import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { Migration } from './migrations/index.js';
import { runMigrations } from './migrator.js';

describe('runMigrations', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it('should apply all migrations on a fresh database', () => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const applied = runMigrations(db);

    expect(applied).toBe(10);

    const row = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as {
      version: number;
    };
    expect(row.version).toBe(10);

    // Verify tables from migration 001 exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('agents');
    expect(tableNames).toContain('audit_log');
    expect(tableNames).toContain('api_keys');
    expect(tableNames).toContain('setup');

    // Verify table from migration 002 exists
    expect(tableNames).toContain('hub_settings');

    // Verify table from migration 003 exists
    expect(tableNames).toContain('integrations');

    // Verify table from migration 004 exists
    expect(tableNames).toContain('sessions');

    // Verify tables from migration 005 exist
    expect(tableNames).toContain('sso_config');
    expect(tableNames).toContain('authorized_users');

    // Verify tables from migration 006 exist
    expect(tableNames).toContain('roles');
    expect(tableNames).toContain('authorized_groups');
    expect(tableNames).toContain('access_groups');
    expect(tableNames).toContain('access_group_agents');
    expect(tableNames).toContain('access_group_integrations');
    expect(tableNames).toContain('access_group_users');

    // Verify table from migration 009 exists
    expect(tableNames).toContain('integration_events');

    // Verify tables from migration 010 exist
    expect(tableNames).toContain('agent_tags');
    expect(tableNames).toContain('integration_tags');
  });

  it('should be idempotent — running again applies 0 migrations', () => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const first = runMigrations(db);
    expect(first).toBe(10);

    const second = runMigrations(db);
    expect(second).toBe(0);

    const row = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as {
      version: number;
    };
    expect(row.version).toBe(10);
  });

  it('should apply only new migrations when a new one is added', async () => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run initial migrations
    runMigrations(db);

    // Simulate adding a new migration by manually importing and modifying the module
    const { migrations } = await import('./migrations/index.js');

    const fakeMigration: Migration = {
      version: 11,
      up: (database) => {
        database.exec(
          'CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, data TEXT NOT NULL)',
        );
      },
    };

    migrations.push(fakeMigration);

    try {
      const applied = runMigrations(db);
      expect(applied).toBe(1);

      const row = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as {
        version: number;
      };
      expect(row.version).toBe(11);

      // Verify test_table was created
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'test_table'")
        .all();
      expect(tables).toHaveLength(1);
    } finally {
      // Clean up: remove fake migration so other tests aren't affected
      migrations.pop();
    }
  });
});
