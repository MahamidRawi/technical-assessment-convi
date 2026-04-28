import { z } from 'zod';

export type AggregateDimension =
  | 'legalStage'
  | 'caseType'
  | 'phase'
  | 'status'
  | 'insurer'
  | 'injury'
  | 'bodyPart'
  | 'missingCritical'
  | 'documentCategory'
  | 'contactType'
  | 'expertSide';

export const dimensionSchema = z.enum([
  'legalStage',
  'caseType',
  'phase',
  'status',
  'insurer',
  'injury',
  'bodyPart',
  'missingCritical',
  'documentCategory',
  'contactType',
  'expertSide',
]);

interface DimensionQueries {
  /** Returns label + count rows for the dimension. */
  buckets: string;
  /** Total count for the membership denominator. */
  total: string;
  /** Distinct bucket count for the truncation indicator. */
  distinct: string;
  /** Whether each Case is counted at most once across buckets. */
  partitioning: boolean;
}

export const DIMENSION_QUERIES: Record<AggregateDimension, DimensionQueries> = {
  legalStage: {
    buckets: `MATCH (c:Case) WHERE c.legalStage IS NOT NULL RETURN c.legalStage AS label, count(c) AS count`,
    total: `MATCH (c:Case) WHERE c.legalStage IS NOT NULL RETURN count(c) AS total`,
    distinct: `MATCH (c:Case) WHERE c.legalStage IS NOT NULL RETURN count(DISTINCT c.legalStage) AS totalDistinctBuckets`,
    partitioning: true,
  },
  caseType: {
    buckets: `MATCH (c:Case) WHERE c.caseType IS NOT NULL RETURN c.caseType AS label, count(c) AS count`,
    total: `MATCH (c:Case) WHERE c.caseType IS NOT NULL RETURN count(c) AS total`,
    distinct: `MATCH (c:Case) WHERE c.caseType IS NOT NULL RETURN count(DISTINCT c.caseType) AS totalDistinctBuckets`,
    partitioning: true,
  },
  phase: {
    buckets: `MATCH (c:Case) WHERE c.phase IS NOT NULL RETURN c.phase AS label, count(c) AS count`,
    total: `MATCH (c:Case) WHERE c.phase IS NOT NULL RETURN count(c) AS total`,
    distinct: `MATCH (c:Case) WHERE c.phase IS NOT NULL RETURN count(DISTINCT c.phase) AS totalDistinctBuckets`,
    partitioning: true,
  },
  status: {
    buckets: `MATCH (c:Case) WHERE c.status IS NOT NULL RETURN c.status AS label, count(c) AS count`,
    total: `MATCH (c:Case) WHERE c.status IS NOT NULL RETURN count(c) AS total`,
    distinct: `MATCH (c:Case) WHERE c.status IS NOT NULL RETURN count(DISTINCT c.status) AS totalDistinctBuckets`,
    partitioning: true,
  },
  insurer: {
    buckets: `MATCH (c:Case)-[:AGAINST_INSURER]->(i:InsuranceCompany) RETURN i.name AS label, i.normalized AS key, count(DISTINCT c) AS count`,
    total: `MATCH (:Case)-[:AGAINST_INSURER]->(:InsuranceCompany) RETURN count(*) AS total`,
    distinct: `MATCH (:Case)-[:AGAINST_INSURER]->(i:InsuranceCompany) RETURN count(DISTINCT i.name) AS totalDistinctBuckets`,
    partitioning: false,
  },
  injury: {
    buckets: `MATCH (c:Case)-[:HAS_INJURY]->(i:Injury) RETURN i.name AS label, i.normalized AS key, count(DISTINCT c) AS count`,
    total: `MATCH (c:Case)-[:HAS_INJURY]->(:Injury) RETURN count(*) AS total`,
    distinct: `MATCH (:Case)-[:HAS_INJURY]->(i:Injury) RETURN count(DISTINCT i.name) AS totalDistinctBuckets`,
    partitioning: false,
  },
  bodyPart: {
    buckets: `MATCH (c:Case)-[:AFFECTS_BODY_PART]->(b:BodyPart) RETURN b.name AS label, b.normalized AS key, count(DISTINCT c) AS count`,
    total: `MATCH (c:Case)-[:AFFECTS_BODY_PART]->(:BodyPart) RETURN count(*) AS total`,
    distinct: `MATCH (:Case)-[:AFFECTS_BODY_PART]->(b:BodyPart) RETURN count(DISTINCT b.name) AS totalDistinctBuckets`,
    partitioning: false,
  },
  missingCritical: {
    buckets: `MATCH (c:Case) WHERE c.missingCritical IS NOT NULL UNWIND c.missingCritical AS label RETURN label, count(DISTINCT c) AS count`,
    total: `MATCH (c:Case) WHERE c.missingCritical IS NOT NULL UNWIND c.missingCritical AS label RETURN count(label) AS total`,
    distinct: `MATCH (c:Case) WHERE c.missingCritical IS NOT NULL UNWIND c.missingCritical AS label RETURN count(DISTINCT label) AS totalDistinctBuckets`,
    partitioning: false,
  },
  documentCategory: {
    buckets: `MATCH (c:Case)-[:HAS_DOCUMENT]->(:Document)-[:OF_CATEGORY]->(dc:DocumentCategory) RETURN dc.name AS label, count(DISTINCT c) AS count`,
    total: `MATCH (c:Case)-[:HAS_DOCUMENT]->(:Document)-[:OF_CATEGORY]->(dc:DocumentCategory) WITH DISTINCT c, dc RETURN count(*) AS total`,
    distinct: `MATCH (:Case)-[:HAS_DOCUMENT]->(:Document)-[:OF_CATEGORY]->(dc:DocumentCategory) RETURN count(DISTINCT dc.name) AS totalDistinctBuckets`,
    partitioning: false,
  },
  // Counts how many cases involve each contact role. Answers
  // "how many lawyers / doctors / witnesses do we work with across the portfolio".
  contactType: {
    buckets: `MATCH (c:Case)-[:HAS_CONTACT]->(con:Contact) WHERE con.contactType IS NOT NULL RETURN con.contactType AS label, count(DISTINCT con) AS count`,
    total: `MATCH (:Case)-[:HAS_CONTACT]->(con:Contact) WHERE con.contactType IS NOT NULL RETURN count(DISTINCT con) AS total`,
    distinct: `MATCH (:Case)-[:HAS_CONTACT]->(con:Contact) WHERE con.contactType IS NOT NULL RETURN count(DISTINCT con.contactType) AS totalDistinctBuckets`,
    partitioning: false,
  },
  // Two buckets only ('ours' / 'court'); useful for "how does our expert use compare to court-appointed".
  expertSide: {
    buckets: `
      MATCH (c:Case)-[r:OUR_EXPERT|COURT_EXPERT]->(:Expert)
      WITH CASE type(r) WHEN 'OUR_EXPERT' THEN 'ours' ELSE 'court' END AS label, c
      RETURN label, count(DISTINCT c) AS count
    `,
    total: `MATCH (:Case)-[r:OUR_EXPERT|COURT_EXPERT]->(:Expert) RETURN count(r) AS total`,
    distinct: `
      MATCH (:Case)-[r:OUR_EXPERT|COURT_EXPERT]->(:Expert)
      RETURN count(DISTINCT CASE type(r) WHEN 'OUR_EXPERT' THEN 'ours' ELSE 'court' END) AS totalDistinctBuckets
    `,
    partitioning: false,
  },
};
