import type { Pack } from '../types.js';
import { redisManifest } from './manifest.js';
import { info } from './probes/info.js';
import { keysCount } from './probes/keys-count.js';
import { memoryUsage } from './probes/memory-usage.js';

export const redisPack: Pack = {
  manifest: redisManifest,
  handlers: {
    'redis.info': info,
    'redis.keys.count': keysCount,
    'redis.memory.usage': memoryUsage,
  },
};
