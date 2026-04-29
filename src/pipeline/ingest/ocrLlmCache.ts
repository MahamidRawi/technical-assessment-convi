import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createLogger } from '@/utils/logger';

const logger = createLogger('OcrLlmCache');

const DEFAULT_CACHE_PATH = '.cache/ocr-llm-facts.json';

/**
 * Cached fact shape. We deliberately do NOT cache `factId`, `caseId`,
 * `documentId`, or `chunkId` — those are remapped to the current ingest run
 * when the cache hit is replayed. Everything else (kind/value/dates/quote/etc.)
 * is a property of the chunk text itself, so the cache key is `chunkHash`.
 */
export const CachedFactSchema = z.object({
  kind: z.string(),
  subtype: z.string().nullable(),
  label: z.string(),
  value: z.string().nullable(),
  numericValue: z.number().nullable(),
  unit: z.string().nullable(),
  fromDate: z.string().nullable(),
  toDate: z.string().nullable(),
  observedDate: z.string().nullable(),
  confidence: z.number(),
  quote: z.string(),
  metadata: z.string().nullable(),
});
export type CachedFact = z.infer<typeof CachedFactSchema>;

const CacheFileSchema = z.record(z.string(), z.array(CachedFactSchema));
type CacheFile = z.infer<typeof CacheFileSchema>;

let cache: CacheFile | null = null;
let cachePath: string = DEFAULT_CACHE_PATH;
let writeChain: Promise<void> = Promise.resolve();

export function configureOcrLlmCachePath(p: string): void {
  cachePath = p;
  cache = null;
  writeChain = Promise.resolve();
}

function buildKey(extractorVersion: string, chunkHash: string): string {
  return `${extractorVersion}:${chunkHash}`;
}

async function loadCache(): Promise<CacheFile> {
  if (cache !== null) return cache;
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    if (!raw.trim()) {
      cache = {};
      return cache;
    }
    const parsed = CacheFileSchema.safeParse(JSON.parse(raw));
    cache = parsed.success ? parsed.data : {};
    if (!parsed.success) {
      logger.warn(`Cache at ${cachePath} is malformed; starting fresh.`);
    }
    return cache;
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      cache = {};
      return cache;
    }
    logger.warn('Cache read failed, starting fresh:', error instanceof Error ? error.message : error);
    cache = {};
    return cache;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT');
}

async function persistCache(): Promise<void> {
  if (cache === null) return;
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (error: unknown) {
    logger.warn('Cache write failed:', error instanceof Error ? error.message : error);
  }
}

export async function readCachedFacts(
  extractorVersion: string,
  chunkHash: string
): Promise<CachedFact[] | null> {
  const file = await loadCache();
  const hit = file[buildKey(extractorVersion, chunkHash)];
  return hit ? hit.map((f) => CachedFactSchema.parse(f)) : null;
}

export async function writeCachedFacts(
  extractorVersion: string,
  chunkHash: string,
  facts: CachedFact[]
): Promise<void> {
  const file = await loadCache();
  file[buildKey(extractorVersion, chunkHash)] = facts;
  // Serialise writes so two concurrent fact extractions don't clobber one another.
  writeChain = writeChain.then(persistCache, persistCache);
  await writeChain;
}

export async function flushOcrLlmCache(): Promise<void> {
  await writeChain;
}
