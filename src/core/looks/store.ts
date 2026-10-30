// Picture search vectors for one library, in our own cache (never in the library). Kept apart
// from the index: the index is rebuilt freely, and these take the better part of an hour to make.
// Each vector is stored as DIM signed bytes plus a scale (a quarter of the size of floats, and the
// ranking doesn't notice).
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DIM, MODEL_NAME } from './model';

export class LooksStore {
  private readonly db: Database.Database;
  /** Everything in memory once a search needs it, kept up to date by put(). */
  private mem: {
    row: Map<string, number>;
    /** Pictures that couldn't be read. */
    skipped: Set<string>;
    q: Int8Array;
    scale: Float32Array;
    size: number;
  } | null = null;

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS vecs (
        id    TEXT PRIMARY KEY,
        stamp TEXT NOT NULL,  -- the file it was read from: size and mtime
        scale REAL,           -- NULL with v: the picture couldn't be read
        v     BLOB
      ) WITHOUT ROWID;`);
    const model = this.db.prepare("SELECT value FROM meta WHERE key = 'model'").pluck().get();
    if (model !== MODEL_NAME) {
      this.db.exec('DELETE FROM vecs');
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('model', ?)")
        .run(MODEL_NAME);
    }
  }

  /** id -> stamp of every picture done (read or not readable). */
  stamps(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, stamp FROM vecs').raw().all() as [string, string][];
    return new Map(rows);
  }

  /** Store results; `vectors` holds DIM floats per id, null for a picture that couldn't be read. */
  put(entries: { id: string; stamp: string; vector: Float32Array | null }[]): void {
    const ins = this.db.prepare(
      'INSERT OR REPLACE INTO vecs (id, stamp, scale, v) VALUES (?, ?, ?, ?)',
    );
    this.db.transaction(() => {
      for (const e of entries) {
        if (!e.vector) {
          ins.run(e.id, e.stamp, null, null);
          this.mem?.skipped.add(e.id);
          continue;
        }
        const { q, scale } = quantize(e.vector);
        ins.run(e.id, e.stamp, scale, Buffer.from(q.buffer, q.byteOffset, q.byteLength));
        this.remember(e.id, q, scale);
      }
    })();
  }

  /** Forget items that are no longer in the library. */
  keepOnly(live: Set<string>): void {
    const gone = [...this.stamps().keys()].filter((id) => !live.has(id));
    if (!gone.length) return;
    const del = this.db.prepare('DELETE FROM vecs WHERE id = ?');
    this.db.transaction(() => gone.forEach((id) => del.run(id)))();
    this.mem = null; // rebuilt on the next search
  }

  /**
   * Cosine similarity to `query` (a unit vector) for each id: -Infinity for a picture that
   * couldn't be read, NaN for one not read yet.
   */
  scores(query: Float32Array, ids: string[]): Float64Array {
    const m = this.load();
    const out = new Float64Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const r = m.row.get(ids[i]);
      if (r === undefined) {
        out[i] = m.skipped.has(ids[i]) ? -Infinity : NaN;
        continue;
      }
      let d = 0;
      const base = r * DIM;
      for (let k = 0; k < DIM; k++) d += m.q[base + k] * query[k];
      out[i] = d * m.scale[r];
    }
    return out;
  }

  close(): void {
    this.db.close();
  }

  private load(): NonNullable<LooksStore['mem']> {
    if (this.mem) return this.mem;
    const rows = this.db.prepare('SELECT id, scale, v FROM vecs').raw().all() as [
      string,
      number | null,
      Buffer | null,
    ][];
    const m = (this.mem = {
      row: new Map<string, number>(),
      skipped: new Set<string>(),
      q: new Int8Array(Math.max(1024, rows.length) * DIM),
      scale: new Float32Array(Math.max(1024, rows.length)),
      size: 0,
    });
    for (const [id, scale, v] of rows)
      if (v && scale !== null) this.remember(id, new Int8Array(v.buffer, v.byteOffset, DIM), scale);
      else m.skipped.add(id);
    return m;
  }

  private remember(id: string, q: Int8Array, scale: number): void {
    const m = this.mem;
    if (!m) return;
    let r = m.row.get(id);
    if (r === undefined) {
      r = m.size++;
      m.row.set(id, r);
      if (m.size > m.scale.length) {
        const q2 = new Int8Array(m.q.length * 2);
        q2.set(m.q);
        const s2 = new Float32Array(m.scale.length * 2);
        s2.set(m.scale);
        m.q = q2;
        m.scale = s2;
      }
    }
    m.q.set(q, r * DIM);
    m.scale[r] = scale;
    m.skipped.delete(id);
  }
}

/** Signed bytes with the largest component at +-127, and the factor that undoes it. */
export function quantize(v: Float32Array): { q: Int8Array; scale: number } {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = max / 127 || 1;
  const q = new Int8Array(v.length);
  for (let k = 0; k < v.length; k++) q[k] = Math.round(v[k] / scale);
  return { q, scale };
}
