import { runCypher, connectNeo4j } from '@/db/neo4j';
import { z } from 'zod';

export async function runReadQuery<TSchema extends z.ZodTypeAny>(
  cypher: string,
  params: Record<string, unknown> | undefined,
  rowSchema: TSchema
): Promise<z.output<TSchema>[]>;

export async function runReadQuery(
  cypher: string,
  params?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export async function runReadQuery<TSchema extends z.ZodTypeAny>(
  cypher: string,
  params?: Record<string, unknown>,
  rowSchema?: TSchema
): Promise<Array<Record<string, unknown> | z.output<TSchema>>> {
  await connectNeo4j();
  const records = await runCypher(cypher, params);
  const rows = records.map((r) => r.toObject());
  if (!rowSchema) return rows;
  return rows.map((row, index) => {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      throw new Error(`Neo4j row ${index} did not match expected shape: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}
