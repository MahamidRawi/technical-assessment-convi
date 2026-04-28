import type { Db } from 'mongodb';
import type { Session } from 'neo4j-driver';
import {
  FinancialProjectionSchema,
  extractISODate,
  extractSourceId,
  type FinancialProjection,
} from '@/types/mongo.types';
import type { CaseValuationNode, DamageComponentNode } from '@/types/graph.types';
import { readCollection } from '@/db/mongo';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Ingest');

const DAMAGE_COMPONENTS = [
  ['painAndSuffering', 'pain_and_suffering'],
  ['pastLosses', 'past_losses'],
  ['futureLosses', 'future_losses'],
  ['pensionLoss', 'pension_loss'],
  ['helpAndExpenses', 'help_and_expenses'],
  ['niDeduction', 'nii_deduction'],
  ['totalEstimate', 'total_estimate'],
] as const;

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

export function buildValuationRows(
  projection: FinancialProjection
): { valuation: CaseValuationNode; components: DamageComponentNode[] } | null {
  const p = projection.projection;
  if (!p) return null;
  const idPart = projection._id ? extractSourceId(projection._id) : `${projection.status ?? 'current'}:${projection.version ?? 'v1'}`;
  const valuationId = `${projection.caseId}:valuation:${idPart}`;
  const compensation = p.financials?.estimatedCompensation;
  const fee = p.financials?.estimatedFeeBeforeVAT;
  const damageBreakdown = p.caseData?.damageBreakdown;
  const totalEstimate =
    numberOrNull(damageBreakdown?.totalEstimate) ??
    numberOrNull(compensation?.max) ??
    numberOrNull(compensation?.min);
  const basis = stringOrNull(compensation?.basis) ?? stringOrNull(p.classification?.reasoning);

  const valuation: CaseValuationNode = {
    valuationId,
    caseId: projection.caseId,
    compensationMin: numberOrNull(compensation?.min),
    compensationMax: numberOrNull(compensation?.max),
    feeMin: numberOrNull(fee?.min),
    feeMax: numberOrNull(fee?.max),
    totalEstimate,
    basis,
    status: projection.status ?? null,
    analysisDate: extractISODate(p.analysisDate),
  };

  const components: DamageComponentNode[] = [];
  for (const [sourceKey, kind] of DAMAGE_COMPONENTS) {
    const amount = numberOrNull(damageBreakdown?.[sourceKey]);
    if (amount === null) continue;
    components.push({
      componentId: `${valuationId}:component:${kind}`,
      valuationId,
      caseId: projection.caseId,
      kind,
      amount,
    });
  }

  return { valuation, components };
}

export async function writeCaseValuations(
  session: Session,
  db: Db,
  fetchLimit: number,
  caseIds: Set<string>
): Promise<void> {
  logger.log('\nWriting CaseValuation nodes + damage components');
  const projections = await readCollection(
    db,
    'case_financial_projections',
    FinancialProjectionSchema,
    {},
    { limit: fetchLimit }
  );
  const valuationRows: CaseValuationNode[] = [];
  const componentRows: DamageComponentNode[] = [];
  for (const projection of projections) {
    if (!caseIds.has(projection.caseId)) continue;
    const rows = buildValuationRows(projection);
    if (!rows) continue;
    valuationRows.push(rows.valuation);
    componentRows.push(...rows.components);
  }

  await session.run(
    `UNWIND $caseIds AS caseId
     MATCH (:Case {caseId: caseId})-[:HAS_VALUATION]->(valuation:CaseValuation)-[:HAS_COMPONENT]->(component:DamageComponent)
     DETACH DELETE component`,
    { caseIds: Array.from(caseIds) }
  );
  await session.run(
    `UNWIND $caseIds AS caseId
     MATCH (:Case {caseId: caseId})-[:HAS_VALUATION]->(valuation:CaseValuation)
     DETACH DELETE valuation`,
    { caseIds: Array.from(caseIds) }
  );
  await session.run(
    `UNWIND $rows AS row
     MERGE (valuation:CaseValuation {valuationId: row.valuationId})
     SET valuation.caseId = row.caseId,
         valuation.compensationMin = row.compensationMin,
         valuation.compensationMax = row.compensationMax,
         valuation.feeMin = row.feeMin,
         valuation.feeMax = row.feeMax,
         valuation.totalEstimate = row.totalEstimate,
         valuation.basis = row.basis,
         valuation.status = row.status,
         valuation.analysisDate = row.analysisDate
     WITH row, valuation
     MATCH (c:Case {caseId: row.caseId})
     MERGE (c)-[:HAS_VALUATION]->(valuation)`,
    { rows: valuationRows }
  );
  await session.run(
    `UNWIND $rows AS row
     MERGE (component:DamageComponent {componentId: row.componentId})
     SET component.valuationId = row.valuationId,
         component.caseId = row.caseId,
         component.kind = row.kind,
         component.amount = row.amount
     WITH row, component
     MATCH (valuation:CaseValuation {valuationId: row.valuationId})
     MERGE (valuation)-[:HAS_COMPONENT]->(component)`,
    { rows: componentRows }
  );
  logger.log(`Wrote ${valuationRows.length} CaseValuations and ${componentRows.length} DamageComponents`);
}
