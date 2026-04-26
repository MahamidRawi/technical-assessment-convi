import type { Record as Neo4jRecord } from 'neo4j-driver';
import type { z } from 'zod';

export function parseNeo4jRecords<TSchema extends z.ZodTypeAny>(
  records: Neo4jRecord[],
  schema: TSchema,
  label: string
): z.output<TSchema>[] {
  return records.map((record, index) => {
    const parsed = schema.safeParse(record.toObject());
    if (!parsed.success) {
      throw new Error(`${label} row ${index} did not match expected shape: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}
