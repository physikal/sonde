import type { Pack } from '../types.js';
import { systemManifest } from './manifest.js';
import { cpuUsage } from './probes/cpu-usage.js';
import { diskUsage } from './probes/disk-usage.js';
import { memoryUsage } from './probes/memory-usage.js';
import { ping } from './probes/ping.js';

export const systemPack: Pack = {
  manifest: systemManifest,
  handlers: {
    'system.disk.usage': diskUsage,
    'system.memory.usage': memoryUsage,
    'system.cpu.usage': cpuUsage,
    'system.network.ping': ping,
  },
};
