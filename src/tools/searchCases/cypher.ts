import { sortBySchema, type SearchCasesInput } from './schema';
import type { z } from 'zod';
import { buildSearchParams, type SearchCasesParams } from './params';

const SORT_FIELD_MAP: Record<z.infer<typeof sortBySchema>, string> = {
  completionRate: 'c.completionRate',
  monthsSinceEvent: 'coalesce(c.monthsSinceEvent, 9999)',
  eventDate: 'c.eventDate',
  createdAt: 'c.createdAt',
  caseName: 'c.caseName',
  missingCriticalCount: 'missingCriticalCount',
  documentCount: 'documentCount',
};

const BASE_MATCH = `
  MATCH (c:Case)
  OPTIONAL MATCH (c)-[:HAS_CLIENT]->(candidate:Contact)
  WITH c, collect(candidate) AS clients
  WITH c, head([x IN clients WHERE x.dedupKey IS NOT NULL] + clients) AS client
  WITH c, client,
       size(coalesce(c.missingCritical, [])) AS missingCriticalCount,
       COUNT { (c)-[:HAS_DOCUMENT]->(:Document) } AS documentCount,
       [(c)-[:AGAINST_INSURER]->(ins:InsuranceCompany) | ins.name] AS insurers,
       [(c)-[:HAS_INJURY]->(inj:Injury) | inj.name] AS injuries
  WHERE
    ($caseType IS NULL OR c.caseType = $caseType)
    AND ($legalStage IS NULL OR c.legalStage = $legalStage)
    AND ($phase IS NULL OR c.phase = $phase)
    AND ($status IS NULL OR c.status = $status)
    AND ($isSigned IS NULL OR c.isSigned = $isSigned)
    AND ($isOverdue IS NULL OR c.isOverdue = $isOverdue)
    AND ($mainInjury IS NULL
         OR toLower(coalesce(c.mainInjury, '')) CONTAINS $mainInjury
         OR ($injuryName IS NOT NULL AND EXISTS {
              MATCH (c)-[:HAS_INJURY]->(mainInjuryMatch:Injury)
              WHERE coalesce(mainInjuryMatch.normalized, toLower(mainInjuryMatch.name)) = $injuryName
            }))
    AND ($clientName IS NULL OR toLower(coalesce(client.name, '')) CONTAINS $clientName)
    AND ($completionRateMin IS NULL OR c.completionRate >= $completionRateMin)
    AND ($completionRateMax IS NULL OR c.completionRate <= $completionRateMax)
    AND ($monthsSinceEventMin IS NULL OR c.monthsSinceEvent >= $monthsSinceEventMin)
    AND ($monthsSinceEventMax IS NULL OR c.monthsSinceEvent <= $monthsSinceEventMax)
    AND ($monthsToSoLMax IS NULL
         OR (c.monthsSinceEvent IS NOT NULL
             AND ($solWindow - c.monthsSinceEvent) >= 0
             AND ($solWindow - c.monthsSinceEvent) <= $monthsToSoLMax))
    AND ($solExpired IS NULL
         OR (c.monthsSinceEvent IS NOT NULL AND c.monthsSinceEvent >= $solWindow))
    AND ($eventDateFrom IS NULL OR c.eventDate >= $eventDateFrom)
    AND ($eventDateTo   IS NULL OR c.eventDate <= $eventDateTo)
    AND ($createdAtFrom IS NULL OR c.createdAt >= $createdAtFrom)
    AND ($createdAtTo   IS NULL OR c.createdAt <= $createdAtTo)
    AND ($signedAtFrom  IS NULL OR c.signedAt  >= $signedAtFrom)
    AND ($signedAtTo    IS NULL OR c.signedAt  <= $signedAtTo)
    AND ($missingDocumentCategory IS NULL
         OR $missingDocumentCategory IN coalesce(c.missingCritical, []))
    AND ($injuryName IS NULL OR EXISTS {
          MATCH (c)-[:HAS_INJURY]->(i:Injury)
          WHERE coalesce(i.normalized, toLower(i.name)) = $injuryName
        })
    AND ($bodyPart IS NULL OR EXISTS {
          MATCH (c)-[:AFFECTS_BODY_PART]->(bp:BodyPart)
          WHERE coalesce(bp.normalized, toLower(bp.name)) = $bodyPart
        })
    AND ($insurer IS NULL OR EXISTS {
          MATCH (c)-[:AGAINST_INSURER]->(ins:InsuranceCompany)
          WHERE coalesce(ins.normalized, toLower(ins.name)) CONTAINS $insurer
                OR toLower(ins.name) CONTAINS $insurer
        })
    AND ($hasDocumentCategory IS NULL OR EXISTS {
          MATCH (c)-[:HAS_DOCUMENT]->(:Document)-[:OF_CATEGORY]->(dc:DocumentCategory)
          WHERE toLower(dc.name) = toLower($hasDocumentCategory)
        })
`;

const RETURN_ROWS = `
  RETURN c.caseId           AS caseId,
         c.caseName         AS caseName,
         c.caseNumber       AS caseNumber,
         c.caseType         AS caseType,
         c.legalStage       AS legalStage,
         c.status           AS status,
         c.completionRate   AS completionRate,
         c.monthsSinceEvent AS monthsSinceEvent,
         CASE
           WHEN c.monthsSinceEvent IS NULL THEN null
           ELSE $solWindow - c.monthsSinceEvent
         END AS monthsToSoL,
         c.isOverdue        AS isOverdue,
         c.eventDate        AS eventDate,
         c.createdAt        AS createdAt,
         c.signedAt         AS signedAt,
         c.mainInjury       AS mainInjury,
         client.name        AS clientName,
         missingCriticalCount,
         documentCount,
         insurers,
         injuries
`;

export function buildSearchCypher(input: SearchCasesInput): {
  cypher: string;
  countCypher: string;
  params: SearchCasesParams;
} {
  const sortField = SORT_FIELD_MAP[input.sortBy] ?? SORT_FIELD_MAP.caseName;
  const sortDir = input.sortOrder === 'desc' ? 'DESC' : 'ASC';

  const cypher = `
    ${BASE_MATCH}
    ${RETURN_ROWS}
    ORDER BY ${sortField} ${sortDir}, c.caseName ASC
    LIMIT toInteger($limit)
  `;

  const countCypher = `
    ${BASE_MATCH}
    RETURN count(c) AS total
  `;

  return { cypher, countCypher, params: buildSearchParams(input) };
}
