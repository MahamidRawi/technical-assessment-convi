import { runReadQuery } from './runReadQuery';
import { neo4jNumber } from './neo4jMap';
import { z } from 'zod';

const existsRowSchema = z.object({ ok: neo4jNumber });
const caseIdRowSchema = z.object({ caseId: z.string() });

export class CaseNotFoundError extends Error {
  public readonly caseId: string;
  constructor(caseId: string) {
    super(`Case not found: ${caseId}`);
    this.name = 'CaseNotFoundError';
    this.caseId = caseId;
  }
}

export class StageNotFoundError extends Error {
  public readonly stage: string;
  constructor(stage: string) {
    super(`Stage not found: ${stage}`);
    this.name = 'StageNotFoundError';
    this.stage = stage;
  }
}

export async function resolveCaseId(caseReference: string): Promise<string> {
  const rows = await runReadQuery(
    `MATCH (c:Case)
     WHERE c.caseId = $caseReference OR c.sourceId = $caseReference
     RETURN c.caseId AS caseId
     LIMIT 1`,
    { caseReference },
    caseIdRowSchema
  );
  const row = rows[0];
  if (!row) throw new CaseNotFoundError(caseReference);
  return row.caseId;
}

export async function assertCaseExists(caseId: string): Promise<string> {
  return resolveCaseId(caseId);
}

export async function assertStageExists(stage: string): Promise<void> {
  const rows = await runReadQuery(
    'MATCH (s:Stage {name: $stage}) RETURN 1 AS ok LIMIT 1',
    { stage },
    existsRowSchema
  );
  if (rows.length === 0) throw new StageNotFoundError(stage);
}
