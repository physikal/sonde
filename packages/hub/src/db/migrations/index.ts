import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

import { up as up001, version as v001 } from './001-initial-schema.js';
import { up as up002, version as v002 } from './002-hub-settings.js';

export const migrations: Migration[] = [
  { version: v001, up: up001 },
  { version: v002, up: up002 },
].sort((a, b) => a.version - b.version);
