import { connectMongo, getDb } from '@/db/mongo';
import { connectNeo4j, createSession } from '@/db/neo4j';

interface StalenessRow {
  caseId: string;
  graphIngestedAt: string | null;
  mongoUpdatedAt: string | null;
  staleMs: number | null;
}

interface HealthPayload {
  generatedAt: string;
  graph: {
    lastSuccessfulIngestAt: string | null;
    minutesSinceLastIngest: number | null;
    totalCases: number;
  };
  staleness: {
    casesWithMongoNewerThanGraph: number;
    samples: StalenessRow[];
  };
}

const SAMPLE_LIMIT = 10;

export async function GET(): Promise<Response> {
  try {
    await connectNeo4j();
    const session = createSession();
    let payload: HealthPayload;
    try {
      const ingestRun = await session.run(
        `MATCH (m:IngestRun {key: 'singleton'}) RETURN toString(m.lastSuccessfulAt) AS lastAt`
      );
      const lastSuccessfulIngestAt =
        (ingestRun.records[0]?.get('lastAt') as string | null | undefined) ?? null;
      const totalCasesResult = await session.run(`MATCH (c:Case) RETURN count(c) AS n`);
      const totalCases = totalCasesResult.records[0]?.get('n')?.toNumber?.() ?? 0;

      const minutesSinceLastIngest = lastSuccessfulIngestAt
        ? Math.floor((Date.now() - new Date(lastSuccessfulIngestAt).getTime()) / 60_000)
        : null;

      const graphCases = await session.run(
        `MATCH (c:Case) RETURN c.caseId AS caseId, toString(c.ingestedAt) AS ingestedAt, c.updatedAt AS updatedAt`
      );

      await connectMongo();
      const db = getDb('convi-assessment');
      const stale: StalenessRow[] = [];
      for (const rec of graphCases.records) {
        const caseId = rec.get('caseId') as string;
        const graphIngestedAt = (rec.get('ingestedAt') as string | null) ?? null;
        const mongoCase = (await db
          .collection('cases')
          .findOne({ caseId }, { projection: { updatedAt: 1, _id: 0 } })) as
          | { updatedAt?: Date | string }
          | null;
        const mongoUpdatedAt = mongoCase?.updatedAt
          ? new Date(mongoCase.updatedAt).toISOString()
          : null;
        const staleMs =
          graphIngestedAt && mongoUpdatedAt
            ? new Date(mongoUpdatedAt).getTime() - new Date(graphIngestedAt).getTime()
            : null;
        if (staleMs !== null && staleMs > 0) {
          stale.push({ caseId, graphIngestedAt, mongoUpdatedAt, staleMs });
        }
      }
      stale.sort((a, b) => (b.staleMs ?? 0) - (a.staleMs ?? 0));

      payload = {
        generatedAt: new Date().toISOString(),
        graph: {
          lastSuccessfulIngestAt,
          minutesSinceLastIngest,
          totalCases,
        },
        staleness: {
          casesWithMongoNewerThanGraph: stale.length,
          samples: stale.slice(0, SAMPLE_LIMIT),
        },
      };
    } finally {
      await session.close();
    }
    return Response.json(payload);
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
