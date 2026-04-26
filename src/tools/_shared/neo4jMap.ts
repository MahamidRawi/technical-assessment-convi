import { z } from 'zod';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readNeo4jNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isRecord(value)) {
    const toNumberFn = value.toNumber;
    if (typeof toNumberFn === 'function') {
      const n = Number(toNumberFn.call(value));
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function readNeo4jDateTime(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    const toStringFn = value.toString;
    if (typeof toStringFn !== 'function') return null;
    const result = String(toStringFn.call(value));
    return result.length > 0 ? result : null;
  }
  return null;
}

function addInvalidIssue(ctx: z.RefinementCtx, expected: string): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Expected ${expected} from Neo4j`,
  });
}

export const neo4jNumber = z.custom<unknown>((value) => readNeo4jNumber(value) !== null, {
  message: 'Expected numeric Neo4j value',
}).transform((value) => {
  const parsed = readNeo4jNumber(value);
  if (parsed === null) throw new Error('Expected numeric Neo4j value');
  return parsed;
});

export const neo4jNullableNumber = z
  .union([neo4jNumber, z.null()])
  .transform((value) => value);

export const neo4jOptionalNumber = z
  .union([neo4jNumber, z.null(), z.undefined()])
  .transform((value) => value ?? null);

export const neo4jString = z.string();

export const neo4jNullableString = z.union([z.string(), z.null()]);

export const neo4jOptionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => value ?? null);

export const neo4jDateTimeString = z.custom<unknown>(
  (value) => readNeo4jDateTime(value) !== null,
  { message: 'Expected Neo4j date/time value' }
).transform((value) => {
  const parsed = readNeo4jDateTime(value);
  if (parsed === null) throw new Error('Expected Neo4j date/time value');
  return parsed;
});

export const neo4jNullableDateTimeString = z
  .union([neo4jDateTimeString, z.null()])
  .transform((value) => value);

export const neo4jOptionalDateTimeString = z
  .union([neo4jDateTimeString, z.null(), z.undefined()])
  .transform((value) => value ?? null);

export const neo4jBoolean = z.boolean();

export const neo4jNullableBoolean = z.union([z.boolean(), z.null()]);

export const neo4jOptionalBoolean = z
  .union([z.boolean(), z.null(), z.undefined()])
  .transform((value) => value ?? null);

export const neo4jStringArray = z
  .array(z.union([z.string(), z.null()]))
  .transform((values) => values.filter((value): value is string => typeof value === 'string'));

export const neo4jNullableStringArray = z
  .union([neo4jStringArray, z.null()])
  .transform((values) => values ?? []);

export const neo4jOptionalStringArray = z
  .union([neo4jStringArray, z.null(), z.undefined()])
  .transform((values) => values ?? []);

export const neo4jUnknownArray = z.array(z.unknown());

export const neo4jNodeProps = z
  .object({ properties: z.record(z.unknown()) })
  .passthrough()
  .transform((value) => value.properties);

export const neo4jNullableNodeProps = z
  .union([neo4jNodeProps, z.null()])
  .transform((value) => value);

export function neo4jNodePropsOf<TSchema extends z.ZodTypeAny>(
  schema: TSchema
): z.ZodType<z.output<TSchema>> {
  return neo4jNodeProps.transform((props, ctx): z.output<TSchema> => {
    const parsed = schema.safeParse(props);
    if (!parsed.success) {
      addInvalidIssue(ctx, `node properties matching schema: ${parsed.error.message}`);
      return z.NEVER;
    }
    return parsed.data;
  });
}

export function neo4jNullableNodePropsOf<TSchema extends z.ZodTypeAny>(
  schema: TSchema
): z.ZodType<z.output<TSchema> | null> {
  return z.union([neo4jNodePropsOf(schema), z.null()]).transform((value) => value);
}

export function toNumber(value: unknown): number {
  const parsed = readNeo4jNumber(value);
  if (parsed === null) throw new Error('Expected numeric Neo4j value');
  return parsed;
}

export function toOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  return toNumber(value);
}

export function toStringArray(value: unknown): string[] {
  return neo4jStringArray.parse(value);
}

export function toNodeProps(node: unknown): Record<string, unknown> {
  if (isRecord(node) && isRecord(node.properties)) {
    return node.properties;
  }
  throw new Error('Expected Neo4j node with properties');
}

export function toISOString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = readNeo4jDateTime(value);
  if (parsed === null) throw new Error('Expected Neo4j date/time value');
  return parsed;
}
