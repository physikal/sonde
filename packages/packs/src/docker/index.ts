import type { Pack } from '../types.js';
import { dockerManifest } from './manifest.js';
import { containersList } from './probes/containers-list.js';
import { daemonInfo } from './probes/daemon-info.js';
import { imagesList } from './probes/images-list.js';
import { logsTail } from './probes/logs-tail.js';

export const dockerPack: Pack = {
  manifest: dockerManifest,
  handlers: {
    'docker.containers.list': containersList,
    'docker.logs.tail': logsTail,
    'docker.images.list': imagesList,
    'docker.daemon.info': daemonInfo,
  },
};
