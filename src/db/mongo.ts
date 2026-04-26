import { MongoClient, type Db, type Filter, type Document } from 'mongodb';
import type { ZodType } from 'zod';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Mongo');

let client: MongoClient | null = null;

export interface MongoCursorLike {
  limit(limit: number): MongoCursorLike;
  toArray(): Promise<unknown[]>;
}

export interface MongoCollectionLike {
  find(filter: Filter<Document>): MongoCursorLike;
}

export interface ReadableMongoDb {
  collection(name: string): MongoCollectionLike;
}

export interface MongoRejectedRow {
  id: string;
  errors: string[];
}

export class MongoValidationError extends Error {
  constructor(
    public collectionName: string,
    public rejectedRows: MongoRejectedRow[]
  ) {
    super(
      `Mongo collection "${collectionName}" failed schema validation for ${rejectedRows.length} row(s): ${rejectedRows
        .map((row) => `${row.id}: ${row.errors.join('; ')}`)
        .join(' | ')}`
    );
    this.name = 'MongoValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rowId(row: unknown, index: number): string {
  if (isRecord(row) && '_id' in row) {
    const id = row._id;
    if (isRecord(id) && typeof id.$oid === 'string') return id.$oid;
    if (typeof id === 'string' || typeof id === 'number') return String(id);
    if (id !== null && id !== undefined) return String(id);
  }
  return `row:${index}`;
}

export async function connectMongo(): Promise<MongoClient> {
  if (client) return client;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is not set');

  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  logger.log('Connected:', uri.split('@').pop());
  return client;
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    logger.log('Disconnected');
  }
}

export function getDb(dbName: string): Db {
  if (!client) throw new Error('Mongo not connected. Call connectMongo() first.');
  return client.db(dbName);
}

export async function readCollection<T>(
  db: ReadableMongoDb,
  name: string,
  schema: ZodType<T>,
  filter: Filter<Document> = {},
  opts: { limit?: number; allowInvalid?: boolean } = {}
): Promise<T[]> {
  const cursor = db.collection(name).find(filter);
  if (opts.limit && opts.limit > 0) cursor.limit(opts.limit);
  const raw = await cursor.toArray();
  const out: T[] = [];
  const rejected: MongoRejectedRow[] = [];
  for (const [index, row] of raw.entries()) {
    const parsed = schema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else {
      rejected.push({
        id: rowId(row, index),
        errors: parsed.error.issues.map((issue) => {
          const path = issue.path.join('.');
          return path ? `${path}: ${issue.message}` : issue.message;
        }),
      });
    }
  }
  if (rejected.length > 0 && !opts.allowInvalid) {
    throw new MongoValidationError(name, rejected);
  }
  if (rejected.length > 0) {
    logger.warn(`${name}: ${rejected.length}/${raw.length} rows failed schema validation (skipped)`);
  }
  return out;
}
