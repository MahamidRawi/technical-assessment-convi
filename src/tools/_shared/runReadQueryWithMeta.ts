import type { z } from 'zod';
import { runReadQuery } from './runReadQuery';

export interface QueryMeta {
  cypher: string;
  params: Record<string, unknown>;
  rowCount: number;
}

export interface QueryResultWithMeta<T> {
  rows: T[];
  meta: QueryMeta;
}

export async function runReadQueryWithMeta<TSchema extends z.ZodTypeAny>(
  cypher: string,
  params: Record<string, unknown>,
  rowSchema: TSchema
): Promise<QueryResultWithMeta<z.output<TSchema>>> {
  const rows = await runReadQuery(cypher, params, rowSchema);
  return {
    rows,
    meta: { cypher: cypher.trim(), params, rowCount: rows.length },
  };
}
