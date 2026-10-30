// The picture search model (Google's SigLIP 2, base size, ONNX export) and the worker thread that
// runs it. Downloaded once into the app cache, never into a library.
import { availableParallelism } from 'node:os';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import type { WorkerReply, WorkerRequest } from './worker';

export const MODEL_NAME = 'siglip2-base-patch16-224';
export const DIM = 768;
export const SIDE = 224;

const BASE = 'https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/main/';
/** What to fetch, with sizes from the repository (a size mismatch means a broken download). */
const FILES: { name: string; path: string; size: number }[] = [
  { name: 'tokenizer_config.json', path: 'tokenizer_config.json', size: 47_240 },
  { name: 'tokenizer.json', path: 'tokenizer.json', size: 34_363_039 },
  { name: 'text_model_quantized.onnx', path: 'onnx/text_model_quantized.onnx', size: 283_438_275 },
  { name: 'vision_model.onnx', path: 'onnx/vision_model.onnx', size: 371_807_752 },
];
export const MODEL_BYTES = FILES.reduce((n, f) => n + f.size, 0);

/** The worker goes away after this long without work (it holds about 1 GB). */
const IDLE_MS = 5 * 60_000;

export function modelDir(cacheDir: string): string {
  return join(cacheDir, 'models', MODEL_NAME);
}

async function sizeOf(path: string): Promise<number> {
  return stat(path).then(
    (s) => s.size,
    () => -1,
  );
}

export async function modelReady(dir: string): Promise<boolean> {
  for (const f of FILES) if ((await sizeOf(join(dir, f.name))) !== f.size) return false;
  return true;
}

/** Fetch what is missing. `progress` gets bytes done of MODEL_BYTES. */
export async function downloadModel(
  dir: string,
  progress: (done: number) => void,
  signal: AbortSignal,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  let done = 0;
  for (const f of FILES) {
    const dest = join(dir, f.name);
    if ((await sizeOf(dest)) === f.size) {
      done += f.size;
      progress(done);
      continue;
    }
    const part = `${dest}.part`;
    const res = await fetch(BASE + f.path, { signal });
    if (!res.ok || !res.body)
      throw new Error(`Couldn't download the picture search model (HTTP ${res.status}).`);
    const before = done;
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on('data', (chunk: Buffer) => {
      done += chunk.length;
      progress(done);
    });
    try {
      await pipeline(body, createWriteStream(part), { signal });
    } catch (e) {
      await rm(part, { force: true });
      throw e;
    }
    if ((await sizeOf(part)) !== f.size) {
      await rm(part, { force: true });
      throw new Error("The picture search model didn't download completely. It will try again.");
    }
    await rename(part, dest);
    done = before + f.size;
  }
}

/**
 * The worker's file: next to this one in the source tree (tests, dev server), `looksWorker.js`
 * next to the bundle in the built app (electron.vite.config.ts builds it).
 */
function workerUrl(): URL {
  const here = import.meta.url;
  return new URL(/\.ts$/.test(here) ? './worker.ts' : './looksWorker.js', here);
}

type Pending = { resolve: (v: Float32Array) => void; reject: (e: Error) => void };

/** One worker thread for the whole app; requests run one at a time, in order. */
export class LooksModel {
  private worker: Worker | null = null;
  private next = 1;
  private readonly pending = new Map<number, Pending>();
  private idle: NodeJS.Timeout | null = null;

  constructor(private readonly dir: string) {}

  /** Unit vectors, DIM floats per picture. `pixels`: count pictures of SIDE x SIDE RGB bytes. */
  images(pixels: Uint8Array, count: number): Promise<Float32Array> {
    return this.ask({ kind: 'images', pixels, count }, [pixels.buffer as ArrayBuffer]);
  }

  text(text: string): Promise<Float32Array> {
    return this.ask({ kind: 'text', text });
  }

  async close(): Promise<void> {
    if (this.idle) clearTimeout(this.idle);
    const w = this.worker;
    this.worker = null;
    await w?.terminate();
  }

  private ask(
    req: Omit<Extract<WorkerRequest, { kind: 'images' }>, 'id'> | { kind: 'text'; text: string },
    transfer: ArrayBuffer[] = [],
  ): Promise<Float32Array> {
    const w = this.start();
    const id = this.next++;
    if (this.idle) clearTimeout(this.idle);
    return new Promise<Float32Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(workerUrl(), {
      workerData: { dir: this.dir, threads: Math.max(1, Math.floor(availableParallelism() / 2)) },
    });
    w.unref();
    w.on('message', (msg: WorkerReply) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if ('error' in msg) p.reject(new Error(msg.error));
      else p.resolve(msg.vectors);
      if (!this.pending.size) this.idle = setTimeout(() => void this.close(), IDLE_MS).unref();
    });
    const fail = (e: Error) => {
      if (this.worker === w) this.worker = null;
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
    };
    w.on('error', fail);
    w.on('exit', () => fail(new Error('The picture search model stopped.')));
    this.worker = w;
    return w;
  }
}
