// Lazy loader for tiled NASA FIRMS thermal detections (see shared/firms-codec.js).
import { loadDataFile } from './data.js';
import { tileKeysForBbox } from '../shared/firms-codec.js';

const MAX_CACHED_TILES = 80;

export class FiresStore {
  constructor(meta, version) {
    this.meta = meta;
    this.version = version;
    this.tiles = new Map(); // key → rows (insertion order = LRU)
    this.inflight = new Map();
    this._index = null;
    this._summary = null;
  }

  async index() {
    if (!this._index) this._index = loadDataFile('fires/index.json', this.version);
    try {
      return await this._index;
    } catch (e) {
      this._index = null;
      throw e;
    }
  }

  async summary() {
    if (!this._summary) this._summary = loadDataFile('fires/summary.json', this.version);
    try {
      return await this._summary;
    } catch (e) {
      this._summary = null;
      throw e;
    }
  }

  async tile(key) {
    if (this.tiles.has(key)) {
      const rows = this.tiles.get(key);
      this.tiles.delete(key);
      this.tiles.set(key, rows);
      return rows;
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = loadDataFile(`fires/tiles/${key}.json`, this.version)
      .then((t) => {
        this.tiles.set(key, t.rows || []);
        while (this.tiles.size > MAX_CACHED_TILES) this.tiles.delete(this.tiles.keys().next().value);
        return t.rows || [];
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Tile keys that intersect `bbox` and actually exist in the published index. */
  async keysFor(bbox, maxTiles = 40) {
    const idx = await this.index();
    return tileKeysForBbox(bbox)
      .filter((k) => idx.tiles?.[k])
      .slice(0, maxTiles);
  }

  /** All detection rows in tiles intersecting `bbox`. */
  async rowsFor(bbox, maxTiles = 40) {
    const keys = await this.keysFor(bbox, maxTiles);
    const parts = await Promise.all(keys.map((k) => this.tile(k)));
    return parts.flat();
  }
}
