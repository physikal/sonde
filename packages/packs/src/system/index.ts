import type { Pack } from '../types.js';
import { systemManifest } from './manifest.js';
import { cpuUsage } from './probes/cpu-usage.js';
import { diskUsage } from './probes/disk-usage.js';
import { logsDmesg } from './probes/logs-dmesg.js';
import { logsJournal } from './probes/logs-journal.js';
import { logsTail } from './probes/logs-tail.js';
import { memoryUsage } from './probes/memory-usage.js';
import { ping } from './probes/ping.js';
import { traceroute } from './probes/traceroute.js';

export const systemPack: Pack = {
  manifest: systemManifest,
  handlers: {
    'system.disk.usage': diskUsage,
    'system.memory.usage': memoryUsage,
    'system.cpu.usage': cpuUsage,
    'system.network.ping': ping,
    'system.logs.journal': logsJournal,
    'system.logs.dmesg': logsDmesg,
    'system.logs.tail': logsTail,
    'system.network.traceroute': traceroute,
  },
};
