import { z } from 'zod';
import { runReadQuery } from './_shared/runReadQuery';
import { neo4jNumber, neo4jString } from './_shared/neo4jMap';
import type { ToolDefinition } from './types';
import {
  DIMENSION_QUERIES,
  dimensionSchema,
  type AggregateDimension,
} from './portfolioAggregates/queries';

export type { AggregateDimension } from './portfolioAggregates/queries';

export interface AggregateBucket {
  label: string;
  count: number;
}

export interface PortfolioAggregateResult {
  dimension: AggregateDimension;
  total: number;
  totalCases: number;
  totalBucketMemberships: number;
  denominator: 'cases' | 'bucketMemberships';
  partitioning: boolean;
  distinctBuckets: number;
  returnedBucketCount: number;
  totalDistinctBuckets: number;
  truncated: boolean;
  buckets: AggregateBucket[];
}

const inputSchema = z.object({
  dimension: dimensionSchema.describe(
    'Field to group by. Pick the one the user is asking about:\n' +
      "• legalStage — 'which stages are cases in', 'portfolio breakdown'\n" +
      "• caseType — 'what kinds of cases do we have'\n" +
      '• phase — lead/active/closing/closed/rejected counts\n' +
      '• status — open/pending_lawyer_review/intake_complete counts\n' +
      "• insurer — 'which insurance companies do we fight most'\n" +
      "• injury — 'most common injuries'\n" +
      '• bodyPart — most common affected body parts\n' +
      "• missingCritical — 'most common missing documents'\n" +
      "• documentCategory — 'most common document categories'\n" +
      "• contactType — 'how many lawyers / doctors / witnesses' (counts contacts per role)\n" +
      "• expertSide — 'ours vs court-appointed expert use across portfolio'"
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(25)
    .describe('Max buckets to return, sorted by count DESC. Default 25.'),
});

type Input = z.infer<typeof inputSchema>;

const bucketRowSchema = z.object({ label: neo4jString, count: neo4jNumber });
const totalRowSchema = z.object({ total: neo4jNumber });
const distinctRowSchema = z.object({ totalDistinctBuckets: neo4jNumber });

export function aggregateDenominatorFor(
  dimension: AggregateDimension
): PortfolioAggregateResult['denominator'] {
  return DIMENSION_QUERIES[dimension].partitioning ? 'cases' : 'bucketMemberships';
}

async function execute({ dimension, limit }: Input): Promise<PortfolioAggregateResult> {
  const queries = DIMENSION_QUERIES[dimension];
  const bucketRows = await runReadQuery(
    `${queries.buckets} ORDER BY count DESC, label ASC LIMIT toInteger($limit)`,
    { limit },
    bucketRowSchema
  );
  const [casesRow] = await runReadQuery(
    'MATCH (c:Case) RETURN count(c) AS total',
    {},
    totalRowSchema
  );
  const [membershipRow] = await runReadQuery(queries.total, {}, totalRowSchema);
  const [distinctRow] = await runReadQuery(queries.distinct, {}, distinctRowSchema);

  const buckets: AggregateBucket[] = bucketRows.map((r) => ({ label: r.label, count: r.count }));
  const totalCases = casesRow?.total ?? 0;
  const totalBucketMemberships = membershipRow?.total ?? 0;
  const totalDistinctBuckets = distinctRow?.totalDistinctBuckets ?? buckets.length;
  const returnedBucketCount = buckets.length;
  const denominator = aggregateDenominatorFor(dimension);

  return {
    dimension,
    total: totalBucketMemberships,
    totalCases,
    totalBucketMemberships,
    denominator,
    partitioning: queries.partitioning,
    distinctBuckets: totalDistinctBuckets,
    returnedBucketCount,
    totalDistinctBuckets,
    truncated: returnedBucketCount < totalDistinctBuckets,
    buckets,
  };
}

function summarize(r: PortfolioAggregateResult): string {
  const top = r.buckets[0];
  if (!top) return `No data for ${r.dimension}`;
  return `${r.dimension}: ${r.returnedBucketCount}/${r.totalDistinctBuckets} buckets, top=${top.label} (${top.count})`;
}

export const portfolioAggregatesTool: ToolDefinition<typeof inputSchema, PortfolioAggregateResult> = {
  name: 'portfolioAggregates',
  label: 'Aggregating portfolio',
  inputSchema,
  execute,
  summarize,
  extractEvidence: () => [],
};
