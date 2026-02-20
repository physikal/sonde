import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

import { up as up001, version as v001 } from './001-initial-schema.js';
import { up as up002, version as v002 } from './002-hub-settings.js';
import { up as up003, version as v003 } from './003-integrations.js';
import { up as up004, version as v004 } from './004-sessions-and-roles.js';
import { up as up005, version as v005 } from './005-sso-config.js';
import { up as up006, version as v006 } from './006-rbac-and-groups.js';
import { up as up007, version as v007 } from './007-ca-key-encryption.js';
import { up as up008, version as v008 } from './008-api-key-type.js';
import { up as up009, version as v009 } from './009-integration-events.js';
import { up as up010, version as v010 } from './010-tags.js';
import { up as up011, version as v011 } from './011-admin-credentials.js';
import { up as up012, version as v012 } from './012-api-key-owner.js';

export const migrations: Migration[] = [
  { version: v001, up: up001 },
  { version: v002, up: up002 },
  { version: v003, up: up003 },
  { version: v004, up: up004 },
  { version: v005, up: up005 },
  { version: v006, up: up006 },
  { version: v007, up: up007 },
  { version: v008, up: up008 },
  { version: v009, up: up009 },
  { version: v010, up: up010 },
  { version: v011, up: up011 },
  { version: v012, up: up012 },
].sort((a, b) => a.version - b.version);
