// Registry of implemented source adapters, keyed by config/sources.json `key`.
// To add a source: create an adapter exporting `key`, `fetchRaw(ctx)` and
// `normalize(raw, ctx)`, register it here, and add its entry to config/sources.json.
import * as usgs from './usgs.mjs';
import * as gdacs from './gdacs.mjs';
import * as firms from './firms.mjs';
import * as nws from './nws.mjs';
import * as eonet from './eonet.mjs';

export const adapters = {
  [usgs.key]: usgs,
  [gdacs.key]: gdacs,
  [firms.key]: firms,
  [nws.key]: nws,
  [eonet.key]: eonet,
};
