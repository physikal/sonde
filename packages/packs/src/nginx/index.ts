import type { Pack } from '../types.js';
import { nginxManifest } from './manifest.js';
import { accessLogTail } from './probes/access-log-tail.js';
import { configTest } from './probes/config-test.js';
import { errorLogTail } from './probes/error-log-tail.js';

export const nginxPack: Pack = {
  manifest: nginxManifest,
  handlers: {
    'nginx.config.test': configTest,
    'nginx.access.log.tail': accessLogTail,
    'nginx.error.log.tail': errorLogTail,
  },
};
