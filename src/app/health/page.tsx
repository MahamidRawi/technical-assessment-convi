'use client';
import { useEffect, useState } from 'react';

interface HealthPayload {
  generatedAt: string;
  graph: {
    lastSuccessfulIngestAt: string | null;
    minutesSinceLastIngest: number | null;
    totalCases: number;
  };
  staleness: {
    casesWithMongoNewerThanGraph: number;
    samples: Array<{
      caseId: string;
      graphIngestedAt: string | null;
      mongoUpdatedAt: string | null;
      staleMs: number | null;
    }>;
  };
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function HealthPage(): React.JSX.Element {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as HealthPayload;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (error)
    return (
      <main style={{ padding: 24, fontFamily: 'monospace' }}>
        <h1>Ingest health</h1>
        <p style={{ color: 'crimson' }}>Error: {error}</p>
      </main>
    );
  if (!data)
    return (
      <main style={{ padding: 24, fontFamily: 'monospace' }}>
        <h1>Ingest health</h1>
        <p>Loading…</p>
      </main>
    );

  const lagMinutes = data.graph.minutesSinceLastIngest;
  const lagColor =
    lagMinutes === null
      ? '#888'
      : lagMinutes > 60 * 24
        ? 'crimson'
        : lagMinutes > 60
          ? '#c97a00'
          : '#1a7f37';

  return (
    <main style={{ padding: 24, fontFamily: 'monospace', maxWidth: 980, lineHeight: 1.5 }}>
      <h1 style={{ marginBottom: 4 }}>Ingest health</h1>
      <p style={{ color: '#666', marginTop: 0, fontSize: 12 }}>
        Auto-refreshes every 30s · Last fetched {new Date(data.generatedAt).toLocaleTimeString()}
      </p>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 14, marginBottom: 8 }}>Pipeline</h2>
        <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ color: '#666' }}>Last successful ingest</td>
              <td>
                {data.graph.lastSuccessfulIngestAt
                  ? new Date(data.graph.lastSuccessfulIngestAt).toLocaleString()
                  : '—'}
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ color: '#666' }}>Lag</td>
              <td style={{ color: lagColor, fontWeight: 600 }}>
                {lagMinutes === null
                  ? 'never'
                  : lagMinutes < 60
                    ? `${lagMinutes}m ago`
                    : lagMinutes < 60 * 24
                      ? `${Math.round(lagMinutes / 60)}h ago`
                      : `${Math.round(lagMinutes / 60 / 24)}d ago`}
              </td>
            </tr>
            <tr>
              <td style={{ color: '#666' }}>Total cases in graph</td>
              <td>{data.graph.totalCases}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 14, marginBottom: 8 }}>Mongo-vs-graph staleness</h2>
        <p style={{ color: '#666', marginTop: 0, fontSize: 12 }}>
          {data.staleness.casesWithMongoNewerThanGraph} case
          {data.staleness.casesWithMongoNewerThanGraph === 1 ? '' : 's'} have a Mongo updatedAt
          newer than their last graph ingest.
        </p>
        {data.staleness.samples.length > 0 ? (
          <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
                <th>caseId</th>
                <th>Graph ingested</th>
                <th>Mongo updated</th>
                <th>Stale by</th>
              </tr>
            </thead>
            <tbody>
              {data.staleness.samples.map((row) => (
                <tr key={row.caseId} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{row.caseId}</td>
                  <td>{row.graphIngestedAt ? new Date(row.graphIngestedAt).toLocaleString() : '—'}</td>
                  <td>{row.mongoUpdatedAt ? new Date(row.mongoUpdatedAt).toLocaleString() : '—'}</td>
                  <td>{formatMs(row.staleMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: '#1a7f37', fontSize: 12 }}>No stale cases — graph is current.</p>
        )}
      </section>
    </main>
  );
}
