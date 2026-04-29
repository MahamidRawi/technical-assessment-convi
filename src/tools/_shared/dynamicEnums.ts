import { z } from 'zod';
import { runReadQuery } from './runReadQuery';
import { createLogger } from '@/utils/logger';

const logger = createLogger('DynamicEnums');

/**
 * Closed-vocabulary fields whose valid values are owned by the graph, not the code.
 *
 * Adding a new field here means: (a) extend the loader query below to populate the cache,
 * (b) call `dynamicEnumOptional(field, ...)` from the tool's input schema. No regex, no
 * hand-maintained enum literals, no per-field translations.
 */
export type EnumField = 'caseType' | 'legalStage' | 'phase' | 'status';

const cache = new Map<EnumField, string[]>();
let loadedAt: number | null = null;

const VOCABULARY_QUERY = `
  MATCH (c:Case)
  WITH
    [v IN collect(DISTINCT c.caseType)   WHERE v IS NOT NULL] AS caseType,
    [v IN collect(DISTINCT c.legalStage) WHERE v IS NOT NULL] AS legalStage,
    [v IN collect(DISTINCT c.phase)      WHERE v IS NOT NULL] AS phase,
    [v IN collect(DISTINCT c.status)     WHERE v IS NOT NULL] AS status
  RETURN caseType, legalStage, phase, status
`;

const vocabularyRowSchema = z.object({
  caseType: z.array(z.string()),
  legalStage: z.array(z.string()),
  phase: z.array(z.string()),
  status: z.array(z.string()),
});

/**
 * Loads the enum vocabulary from the live graph into the in-process cache.
 * Idempotent and safe to call multiple times. Should be awaited once at agent
 * bootstrap (before tool schemas are constructed).
 */
export async function loadEnumVocabulary(): Promise<void> {
  try {
    const rows = await runReadQuery(VOCABULARY_QUERY, {}, vocabularyRowSchema);
    const row = rows[0];
    if (!row) {
      logger.warn('Vocabulary query returned no rows; enum cache stays empty (fail-open).');
      return;
    }
    cache.set('caseType', [...row.caseType].sort());
    cache.set('legalStage', [...row.legalStage].sort());
    cache.set('phase', [...row.phase].sort());
    cache.set('status', [...row.status].sort());
    loadedAt = Date.now();
    logger.log(
      `Loaded vocabulary: caseType=${row.caseType.length}, legalStage=${row.legalStage.length}, phase=${row.phase.length}, status=${row.status.length}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Vocabulary load failed (${message}); enum cache stays empty (fail-open).`);
  }
}

/** Returns the cached values for a field, or [] if the cache is cold. */
export function getEnumValues(field: EnumField): string[] {
  return cache.get(field) ?? [];
}

/** True if at least one field has been populated. Useful for diagnostics & tests. */
export function isEnumVocabularyLoaded(): boolean {
  return loadedAt !== null;
}

/** Test-only: clear the cache. Production code should never call this. */
export function __resetEnumVocabularyForTests(): void {
  cache.clear();
  loadedAt = null;
}

/**
 * Returns a Zod schema for an optional closed-vocabulary field.
 *
 * Design note: previously this returned `z.enum([...]).optional()`, which serialized to
 * `{ type: "string", enum: [...] }` in JSON Schema. With temperature-0 LLMs, that hard
 * enum constraint deterministically biases the model to pick the alphabetical-first
 * value at parameter-fill time, even when the description says "OMIT". (Confirmed by
 * runtime evidence: two independent calls produced byte-identical alphabetical-first
 * picks like caseType:"car_accident_minor" + legalStage:"case_building".)
 *
 * We now emit a plain `z.string().optional()` to the JSON Schema, with the live
 * vocabulary listed only in the description as a *hint* for value mapping. Validation
 * against the live vocabulary is enforced at tool-entry via `coerceVocabOrNull`. This
 * removes the schema-level pull while preserving rejection of out-of-vocabulary strings.
 */
export function dynamicEnumOptional(
  field: EnumField,
  baseDescription: string
): z.ZodOptional<z.ZodString> {
  const values = getEnumValues(field);
  const description =
    values.length > 0
      ? `${baseDescription} Recognised values (sourced from live graph; OMIT this field unless the user literally named one of these): ${values.join(', ')}.`
      : `${baseDescription} (Closed vocabulary; live values not yet loaded.)`;
  return z.string().describe(description).optional();
}

/**
 * Tool-entry validator: returns `value` if it is in the live vocabulary for `field`,
 * otherwise null. Use after `emptyToNull(...)` to drop unknown strings the LLM may emit
 * now that the JSON Schema no longer enforces enum membership.
 *
 * Fail-open when the cache is cold: an empty cache means we can't validate, so we let
 * the value through (matches pre-existing behavior in unit tests / cold paths).
 */
export function coerceVocabOrNull(field: EnumField, value: string | null): string | null {
  if (value === null) return null;
  const values = getEnumValues(field);
  if (values.length === 0) return value;
  return values.includes(value) ? value : null;
}
