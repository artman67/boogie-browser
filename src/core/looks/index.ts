// Search by what is in the picture: "horse in a field" finds paintings of horses in fields whatever
// they are named or tagged. Each picture is read once into a vector (a few hundred numbers saying what it
// shows); a search turns its words into a vector the same way and ranks pictures by closeness.
// Only the window's library is read in the background; searching works on any library.
import { join } from 'node:path';
import type { EagleLibrary, LibraryIndex, MediaService } from '../contracts';
import type { JobManager } from '../service/jobs';
import { DIM, LooksModel, MODEL_BYTES, SIDE, downloadModel, modelDir, modelReady } from './model';
import { LooksStore } from './store';

/** What a background pass needs from an open library. */
export interface LooksSource {
  libraryId: string;
  index: LibraryIndex;
  lib: EagleLibrary;
  /** Aborted when the library closes (unlike a cancel from the status strip). */
  closed: AbortSignal;
}

/** Pictures per model run. */
const BATCH = 8;
/**
 * Pictures count as looking like the words when they score this many standard deviations above
 * the average picture. Looser and "a dog" lists dogs, then things that are not dogs; tighter and
 * "young woman" in a portrait collection stops long before the young women do. Best first, so
 * the doubtful ones are at the end.
 */
const CUT_SD = 1.5;
/** The longest list a search returns. */
const MAX_RESULTS = 3000;
const TEXT_CACHE = 100;

const MB = (bytes: number) => Math.round(bytes / 1e6);
/** Job labels (the status strip adds the numbers; while downloading they are megabytes). */
export const DOWNLOADING = 'Downloading picture search';
const READING = 'Reading pictures for search';

export class Looks {
  private readonly dir: string;
  private readonly model: LooksModel;
  private readonly stores = new Map<string, LooksStore>();
  private readonly textCache = new Map<string, Float32Array>();
  private ready = false;
  /** The pass running now (one at a time, for the whole app). */
  private running: { libraryId: string; done: Promise<void> } | null = null;
  /** The index's items version each library's last pass started from. */
  private readonly seen = new Map<string, number>();
  /** Libraries not to read again until the next start: the user stopped the pass, or it failed. */
  private readonly stopped = new Set<string>();

  constructor(
    private readonly cacheDir: string,
    private readonly jobs: JobManager,
    private readonly media: () => MediaService,
  ) {
    this.dir = modelDir(cacheDir);
    this.model = new LooksModel(this.dir);
  }

  /** Read the library's new and changed pictures, unless that is running or nothing changed. */
  keepUp(s: LooksSource): void {
    if (this.running || this.stopped.has(s.libraryId) || s.closed.aborted) return;
    const version = s.index.versions?.().items ?? -1;
    if (version !== -1 && this.seen.get(s.libraryId) === version) return;
    this.seen.set(s.libraryId, version);
    const done = this.run(s);
    this.running = { libraryId: s.libraryId, done };
    void done.finally(() => {
      if (this.running?.done === done) this.running = null;
    });
  }

  /**
   * The pictures in `pool` that look like `text`, best first, leaving out `exclude` (what the
   * words already found). `pending`: pictures in the pool not read yet.
   */
  async rank(
    libraryId: string,
    text: string,
    pool: string[],
    exclude: ReadonlySet<string>,
  ): Promise<{ ids: string[]; pending: number }> {
    if (!pool.length) return { ids: [], pending: 0 };
    if (!(await this.modelIsReady())) return { ids: [], pending: pool.length };
    const query = await this.textVector(text);
    return lookalikes(pool, this.store(libraryId).scores(query, pool), exclude);
  }

  async close(): Promise<void> {
    await this.running?.done;
    await this.model.close();
    for (const s of this.stores.values()) s.close();
    this.stores.clear();
  }

  // ───────────────────────── internals ─────────────────────────

  private store(libraryId: string): LooksStore {
    let s = this.stores.get(libraryId);
    if (!s) {
      s = new LooksStore(join(this.cacheDir, 'looks', `${libraryId}.sqlite`));
      this.stores.set(libraryId, s);
    }
    return s;
  }

  private async modelIsReady(): Promise<boolean> {
    this.ready ||= await modelReady(this.dir);
    return this.ready;
  }

  private async textVector(text: string): Promise<Float32Array> {
    const key = text.trim().toLowerCase();
    let v = this.textCache.get(key);
    if (!v) {
      v = await this.model.text(key);
      if (this.textCache.size >= TEXT_CACHE)
        this.textCache.delete(this.textCache.keys().next().value!);
      this.textCache.set(key, v);
    }
    return v;
  }

  /** A job only when there is something to do, so edits don't flash one in the status strip. */
  private async run(s: LooksSource): Promise<void> {
    const ready = await this.modelIsReady();
    const todo = ready ? this.plan(s) : null;
    if (todo && !todo.length) return;
    const { result } = this.jobs.launch(
      'looks',
      ready ? READING : DOWNLOADING,
      (h) => this.pass(s, h, todo),
      { scope: s.libraryId },
    );
    try {
      await result;
    } catch (e) {
      // Closing the library stops a pass; it picks up where it left off next time.
      if (s.closed.aborted) this.seen.delete(s.libraryId);
      else {
        this.stopped.add(s.libraryId);
        if (!(e instanceof Error && e.name === 'AbortError'))
          console.error('[boogie] picture search reading failed', e);
      }
    }
  }

  /** The live items whose picture hasn't been read, or has changed since. Newest first. */
  private plan(s: LooksSource): { id: string; stamp: string }[] {
    const store = this.store(s.libraryId);
    store.keepOnly(new Set(s.index.db.prepare('SELECT id FROM items').pluck().all() as string[]));
    const have = store.stamps();
    const rows = s.index.db
      .prepare('SELECT id, size, mtime FROM items WHERE is_deleted = 0 ORDER BY imported_at DESC')
      .raw()
      .all() as [string, number, number][];
    return rows
      .map(([id, size, mtime]) => ({ id, stamp: `${size}:${mtime}` }))
      .filter((r) => have.get(r.id) !== r.stamp);
  }

  private async pass(
    s: LooksSource,
    h: { signal: AbortSignal; progress(done: number, total: number): void; label(t: string): void },
    planned: { id: string; stamp: string }[] | null,
  ): Promise<void> {
    if (!planned) {
      await downloadModel(this.dir, (done) => h.progress(MB(done), MB(MODEL_BYTES)), h.signal);
      this.ready = true;
      h.label(READING);
    }
    const store = this.store(s.libraryId);
    const todo = planned ?? this.plan(s);
    h.progress(0, todo.length);

    const read = (batch: typeof todo) => Promise.all(batch.map((r) => this.pixels(s, r.id)));
    let next = read(todo.slice(0, BATCH));
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const pics = await next;
      h.signal.throwIfAborted();
      // Decode the next batch while the model works on this one.
      next = read(todo.slice(i + BATCH, i + 2 * BATCH));
      const ok = pics.flatMap((p, k) => (p ? [k] : []));
      const pixels = new Uint8Array(ok.length * SIDE * SIDE * 3);
      ok.forEach((k, j) => pixels.set(pics[k]!, j * SIDE * SIDE * 3));
      const vectors = ok.length ? await this.model.images(pixels, ok.length) : null;
      const at = new Map(ok.map((k, j) => [k, j]));
      store.put(
        batch.map((r, k) => {
          const j = at.get(k);
          return {
            id: r.id,
            stamp: r.stamp,
            vector: j === undefined ? null : vectors!.subarray(j * DIM, (j + 1) * DIM),
          };
        }),
      );
      h.progress(Math.min(i + BATCH, todo.length), todo.length);
    }
  }

  /** The item's picture as SIDE x SIDE RGB (Eagle's thumbnail when it has one), or null. */
  private async pixels(s: LooksSource, id: string): Promise<Uint8Array | null> {
    try {
      const rec = s.index.getRecord(id);
      if (!rec) return null;
      const path = (await s.lib.locateThumbnail(id, rec)) ?? (await s.lib.locateOriginal(id, rec));
      return path ? await this.media().rgb(path, SIDE, SIDE) : null;
    } catch {
      return null;
    }
  }
}

/**
 * The pool's pictures that score CUT_SD standard deviations above the pool's average, best first,
 * without `exclude`. `scores` as LooksStore.scores gives them: NaN = not read yet (counted in
 * `pending`), -Infinity = couldn't be read.
 */
export function lookalikes(
  pool: string[],
  scores: Float64Array,
  exclude: ReadonlySet<string>,
): { ids: string[]; pending: number } {
  let n = 0;
  let sum = 0;
  let sq = 0;
  let pending = 0;
  for (const x of scores) {
    if (Number.isNaN(x)) pending++;
    else if (Number.isFinite(x)) {
      n++;
      sum += x;
      sq += x * x;
    }
  }
  if (n < 2) return { ids: [], pending };
  const mean = sum / n;
  const cut = mean + CUT_SD * Math.sqrt(Math.max(0, sq / n - mean * mean));
  const hits: number[] = [];
  for (let i = 0; i < pool.length; i++) if (scores[i] >= cut && !exclude.has(pool[i])) hits.push(i);
  hits.sort((a, b) => scores[b] - scores[a]);
  return { ids: hits.slice(0, MAX_RESULTS).map((i) => pool[i]), pending };
}
