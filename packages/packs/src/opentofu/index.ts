import type { Pack } from '../types.js';
import { opentofuManifest } from './manifest.js';
import { output } from './probes/output.js';
import { showJson } from './probes/show-json.js';
import { stateList } from './probes/state-list.js';
import { validate } from './probes/validate.js';
import { version } from './probes/version.js';

export const opentofuPack: Pack = {
  manifest: opentofuManifest,
  handlers: {
    'opentofu.version': version,
    'opentofu.state.list': stateList,
    'opentofu.state.show': showJson,
    'opentofu.validate': validate,
    'opentofu.output': output,
  },
};
