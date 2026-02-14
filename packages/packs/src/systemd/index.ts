import type { Pack } from '../types.js';
import { systemdManifest } from './manifest.js';
import { journalQuery } from './probes/journal-query.js';
import { serviceStatus } from './probes/service-status.js';
import { servicesList } from './probes/services-list.js';

export const systemdPack: Pack = {
  manifest: systemdManifest,
  handlers: {
    'systemd.services.list': servicesList,
    'systemd.service.status': serviceStatus,
    'systemd.journal.query': journalQuery,
  },
};
