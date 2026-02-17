import type { Pack } from '../types.js';
import { mysqlManifest } from './manifest.js';
import { databasesList } from './probes/databases-list.js';
import { processlist } from './probes/processlist.js';
import { status } from './probes/status.js';

export const mysqlPack: Pack = {
  manifest: mysqlManifest,
  handlers: {
    'mysql.databases.list': databasesList,
    'mysql.processlist': processlist,
    'mysql.status': status,
  },
};
