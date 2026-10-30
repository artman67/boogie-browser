// The picture search model, run in a worker thread: onnxruntime's run() holds the thread it is
// called on for the whole batch (seconds), so on the main thread it would freeze the app.
// Self-contained on purpose (only packages and node:), so plain Node can run this file as it is.
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { setPriority } from 'node:os';
import { join } from 'node:path';
import ort from 'onnxruntime-node';
import { Tokenizer } from '@huggingface/tokenizers';

export type WorkerRequest =
  | { id: number; kind: 'images'; pixels: Uint8Array; count: number }
  | { id: number; kind: 'text'; text: string };
export type WorkerReply = { id: number; vectors: Float32Array } | { id: number; error: string };

const { dir, threads } = workerData as { dir: string; threads: number };
const SIDE = 224;
const DIM = 768;
/** SigLIP 2 reads text lowercased and padded to 64 tokens (its tokenizer_config). */
const TEXT_LEN = 64;

let vision: Promise<ort.InferenceSession> | null = null;
let text: Promise<{ session: ort.InferenceSession; tokenizer: Tokenizer }> | null = null;

const opts = { intraOpNumThreads: threads, interOpNumThreads: 1 };

// Background work: give way to everything else. On Linux this lowers only this thread, and the
// model's own threads, started from here, inherit it.
try {
  setPriority(10);
} catch {
  /* not allowed: run at normal priority */
}

async function readJson(name: string): Promise<object> {
  return JSON.parse(await readFile(join(dir, name), 'utf8')) as object;
}

/** Unit-length rows, so a dot product is the cosine. */
function normalized(data: Float32Array, rows: number): Float32Array {
  const out = new Float32Array(rows * DIM);
  for (let r = 0; r < rows; r++) {
    let n = 0;
    for (let k = 0; k < DIM; k++) n += data[r * DIM + k] ** 2;
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < DIM; k++) out[r * DIM + k] = data[r * DIM + k] / n;
  }
  return out;
}

async function images(pixels: Uint8Array, count: number): Promise<Float32Array> {
  vision ??= ort.InferenceSession.create(join(dir, 'vision_model.onnx'), opts);
  const session = await vision;
  // RGB bytes, pixel after pixel -> planar floats in [-1, 1] (mean 0.5, std 0.5).
  const plane = SIDE * SIDE;
  const input = new Float32Array(count * 3 * plane);
  for (let i = 0; i < count; i++)
    for (let p = 0; p < plane; p++)
      for (let c = 0; c < 3; c++)
        input[(i * 3 + c) * plane + p] = pixels[(i * plane + p) * 3 + c] / 127.5 - 1;
  const out = await session.run({
    pixel_values: new ort.Tensor('float32', input, [count, 3, SIDE, SIDE]),
  });
  return normalized(out.pooler_output.data as Float32Array, count);
}

async function embedText(query: string): Promise<Float32Array> {
  text ??= (async () => ({
    session: await ort.InferenceSession.create(join(dir, 'text_model_quantized.onnx'), opts),
    tokenizer: new Tokenizer(
      await readJson('tokenizer.json'),
      await readJson('tokenizer_config.json'),
    ),
  }))();
  const { session, tokenizer } = await text;
  const ids = tokenizer.encode(query.toLowerCase()).ids.slice(0, TEXT_LEN);
  while (ids.length < TEXT_LEN) ids.push(0); // <pad>
  const out = await session.run({
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, TEXT_LEN]),
  });
  return normalized(out.pooler_output.data as Float32Array, 1);
}

parentPort!.on('message', (msg: WorkerRequest) => {
  const work = msg.kind === 'images' ? images(msg.pixels, msg.count) : embedText(msg.text);
  work.then(
    (vectors) =>
      parentPort!.postMessage({ id: msg.id, vectors } satisfies WorkerReply, [
        vectors.buffer as ArrayBuffer,
      ]),
    (e: unknown) =>
      parentPort!.postMessage({
        id: msg.id,
        error: e instanceof Error ? e.message : String(e),
      } satisfies WorkerReply),
  );
});
