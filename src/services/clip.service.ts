import fs from 'fs/promises';



export const CLIP_MODEL_ID = 'Xenova/clip-vit-base-patch32';
export const EMBEDDING_DIM = 512;

type Transformers = typeof import('@huggingface/transformers');
const importEsm = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<Transformers>;

type Loaded<T> = { run: T };
let visionPromise: Promise<Loaded<(blob: Blob) => Promise<Float32Array>>> | null = null;
let textPromise: Promise<Loaded<(text: string) => Promise<Float32Array>>> | null = null;

function normalize(data: ArrayLike<number>): Float32Array {
  const out = new Float32Array(data.length);
  let norm = 0;
  for (let i = 0; i < data.length; i++) norm += data[i] * data[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < data.length; i++) out[i] = data[i] / norm;
  return out;
}

async function loadTransformers() {
  const t = await importEsm('@huggingface/transformers');
  if (process.env.CLIP_CACHE_DIR) t.env.cacheDir = process.env.CLIP_CACHE_DIR;
  return t;
}

function loadVision() {
  // Cache the promise (not the result) so concurrent callers share one load; reset on failure so it can be retried.
  visionPromise ??= (async () => {
    const t = await loadTransformers();
    const processor: any = await t.AutoProcessor.from_pretrained(CLIP_MODEL_ID);
    const model: any = await t.CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL_ID, { dtype: 'q8' });
    return {
      run: async (blob: Blob) => {
        const image = await t.RawImage.fromBlob(blob);
        const inputs = await processor(image);
        const { image_embeds } = await model(inputs);
        return normalize(image_embeds.data);
      },
    };
  })().catch((err) => {
    visionPromise = null;
    throw err;
  });
  return visionPromise;
}

function loadText() {
  textPromise ??= (async () => {
    const t = await loadTransformers();
    const tokenizer: any = await t.AutoTokenizer.from_pretrained(CLIP_MODEL_ID);
    const model: any = await t.CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL_ID, { dtype: 'q8' });
    return {
      run: async (text: string) => {
        const inputs = tokenizer([text], { padding: true, truncation: true });
        const { text_embeds } = await model(inputs);
        return normalize(text_embeds.data);
      },
    };
  })().catch((err) => {
    textPromise = null;
    throw err;
  });
  return textPromise;
}

/** Embeds an image file from disk. Throws if the file cannot be decoded as an image. */
export async function embedImage(filePath: string): Promise<Float32Array> {
  const { run } = await loadVision();
  const bytes = await fs.readFile(filePath);
  return run(new Blob([new Uint8Array(bytes)]));
}

/** Embeds a search query. Short queries get CLIP's usual prompt template, which improves matching. */
export async function embedText(query: string): Promise<Float32Array> {
  const { run } = await loadText();
  const words = query.trim().split(/\s+/).length;
  return run(words <= 3 ? `a photo of ${query.trim()}` : query.trim());
}

/** Loads both models in the background so the first upload / first search is not slow. */
export async function warmUpClip(): Promise<void> {
  await Promise.all([loadVision(), loadText()]);
}

/** Formats a vector as a pgvector literal, e.g. "[0.1,0.2,...]" — cast it with ::vector in SQL. */
export function toVectorLiteral(vec: ArrayLike<number>): string {
  return `[${Array.from(vec).join(',')}]`;
}
