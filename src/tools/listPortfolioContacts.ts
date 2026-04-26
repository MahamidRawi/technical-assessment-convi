import { z } from 'zod';
import { runReadQueryWithMeta, type QueryMeta } from './_shared/runReadQueryWithMeta';
import {
  neo4jBoolean,
  neo4jNumber,
  neo4jString,
  neo4jStringArray,
} from './_shared/neo4jMap';
import type { ToolDefinition } from './types';

export interface PortfolioContactRow {
  /** Stable identity for the deduplicated person: normalizedName + contactType. */
  identityKey: string;
  name: string;
  contactType: string;
  hasPhone: boolean;
  hasEmail: boolean;
  caseCount: number;
  caseIds: string[];
  /**
   * Underlying Contact nodes (dedupKeys) that share this (normalizedName, contactType).
   * In source data the same person sometimes appears with raw and hashed contact details
   * — those collapse here. Length > 1 is a hint the source had partial anonymization.
   */
  underlyingDedupKeys: string[];
}

export interface PortfolioContactsResult {
  filterContactType: string | null;
  sharedAcrossCasesOnly: boolean;
  totalMatches: number;
  returnedCount: number;
  truncated: boolean;
  hits: PortfolioContactRow[];
  meta: QueryMeta;
}

const inputSchema = z.object({
  contactType: z
    .string()
    .optional()
    .describe(
      "Restrict to a single contactType (e.g. 'lawyer', 'doctor', 'witness', 'insurance_company', 'client', 'employer'). OMIT to list contacts of every type."
    ),
  sharedAcrossCasesOnly: z
    .boolean()
    .default(false)
    .describe(
      'When true, returns only contacts that appear in two or more cases (cross-case contacts).'
    ),
  limit: z.number().int().min(1).max(100).default(25),
});

type Input = z.infer<typeof inputSchema>;

const rowSchema = z.object({
  identityKey: neo4jString,
  name: neo4jString,
  contactType: neo4jString,
  hasPhone: neo4jBoolean,
  hasEmail: neo4jBoolean,
  caseCount: neo4jNumber,
  caseIds: neo4jStringArray,
  underlyingDedupKeys: neo4jStringArray,
});

const totalRowSchema = z.object({ total: neo4jNumber });

async function execute(input: Input): Promise<PortfolioContactsResult> {
  const filterContactType = input.contactType?.trim() ? input.contactType.trim() : null;
  const sharedThreshold = input.sharedAcrossCasesOnly ? 2 : 1;

  // Group by (normalizedName, contactType) so a single person represented by
  // multiple Contact nodes (e.g. raw email + hashed email after partial source
  // anonymization) collapses into one row.
  const baseMatch = `
    MATCH (con:Contact)<-[:HAS_CONTACT]-(c:Case)
    WHERE ($contactType IS NULL OR con.contactType = $contactType)
    WITH coalesce(con.normalizedName, toLower(con.name)) AS identityName,
         coalesce(con.contactType, 'unknown') AS identityContactType,
         con,
         c
    WITH identityName + '|' + identityContactType AS identityKey,
         identityName,
         identityContactType,
         collect(DISTINCT con) AS contacts,
         collect(DISTINCT c.caseId) AS caseIds
    WITH identityKey,
         identityContactType,
         contacts,
         caseIds,
         size(caseIds) AS caseCount,
         head([x IN contacts WHERE x.name IS NOT NULL]).name AS displayName,
         any(x IN contacts WHERE coalesce(x.hasPhone, false)) AS hasPhone,
         any(x IN contacts WHERE coalesce(x.hasEmail, false)) AS hasEmail,
         [x IN contacts | x.dedupKey] AS underlyingDedupKeys
    WHERE caseCount >= $sharedThreshold
  `;

  const bucketsCypher = `
    ${baseMatch}
    RETURN identityKey,
           coalesce(displayName, identityKey) AS name,
           identityContactType AS contactType,
           hasPhone,
           hasEmail,
           caseCount,
           caseIds,
           underlyingDedupKeys
    ORDER BY caseCount DESC, name ASC
    LIMIT toInteger($limit)
  `;
  const totalCypher = `${baseMatch} RETURN count(identityKey) AS total`;
  const params = {
    contactType: filterContactType,
    sharedThreshold,
    limit: input.limit,
  };

  const { rows, meta } = await runReadQueryWithMeta(bucketsCypher, params, rowSchema);
  const totalRows = await runReadQueryWithMeta(totalCypher, params, totalRowSchema);
  const totalMatches = totalRows.rows[0]?.total ?? rows.length;

  return {
    filterContactType,
    sharedAcrossCasesOnly: input.sharedAcrossCasesOnly,
    totalMatches,
    returnedCount: rows.length,
    truncated: rows.length < totalMatches,
    hits: rows,
    meta: { ...meta, rowCount: totalMatches },
  };
}

export const listPortfolioContactsTool: ToolDefinition<typeof inputSchema, PortfolioContactsResult> = {
  name: 'listPortfolioContacts',
  label: 'Listing portfolio contacts',
  inputSchema,
  execute,
  summarize: (r) => {
    if (r.hits.length === 0) {
      return r.filterContactType
        ? `No ${r.filterContactType} contacts found`
        : 'No contacts match';
    }
    const scope = r.filterContactType ? r.filterContactType : 'contacts';
    const cross = r.sharedAcrossCasesOnly ? ' shared across cases' : '';
    return r.truncated
      ? `${r.returnedCount} of ${r.totalMatches} ${scope}${cross}`
      : `${r.returnedCount} ${scope}${cross}`;
  },
  extractEvidence: (r) =>
    r.hits.map((row) => ({
      sourceType: 'Contact' as const,
      sourceId: row.identityKey,
      label: `${row.name} (${row.contactType}, ${row.caseCount} case${row.caseCount === 1 ? '' : 's'})`,
      viaTool: 'listPortfolioContacts',
    })),
  traceMeta: (r) => r.meta,
};
