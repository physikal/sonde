import type { Pack } from '../types.js';
import { postgresManifest } from './manifest.js';
import { connectionsActive } from './probes/connections-active.js';
import { databasesList } from './probes/databases-list.js';
import { querySlow } from './probes/query-slow.js';

export const postgresPack: Pack = {
  manifest: postgresManifest,
  handlers: {
    'postgres.databases.list': databasesList,
    'postgres.connections.active': connectionsActive,
    'postgres.query.slow': querySlow,
  },
};
