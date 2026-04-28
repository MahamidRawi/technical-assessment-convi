// Schema introspection for the MCP safety layer.
//
// Runs once per process (cached) against the live graph and produces a
// snapshot of what actually exists: node labels, relationship types, and
// property names per label. The pre-flight validator uses this snapshot
// to detect fabricated property/label/relationship names without a
// hand-coded rule per fabrication.

import type { Session } from 'neo4j-driver';
import { connectNeo4j, createSession } from '@/db/neo4j';

export interface IntrospectedSchema {
  labels: Set<string>;
  relationships: Set<string>;
  propertiesByLabel: Map<string, Set<string>>;
  // Union of all property names across all labels — used to detect a
  // property that does not exist on ANY node (e.g. slaOverdue, injuryType).
  allProperties: Set<string>;
  capturedAt: number;
}

let cached: IntrospectedSchema | null = null;
let pending: Promise<IntrospectedSchema> | null = null;

const PROPERTY_SAMPLE_LIMIT = 200;

async function fetchLabels(session: Session): Promise<Set<string>> {
  const result = await session.run('CALL db.labels() YIELD label RETURN label');
  return new Set(result.records.map((r) => r.get('label') as string));
}

async function fetchRelationshipTypes(session: Session): Promise<Set<string>> {
  const result = await session.run(
    'CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType'
  );
  return new Set(result.records.map((r) => r.get('relationshipType') as string));
}

// For each label, sample N nodes and union their property keys. APOC's
// apoc.meta.schema would be cleaner but we already require APOC; using a
// sample-based approach makes this work even on databases without APOC.
async function fetchPropertiesByLabel(
  session: Session,
  labels: Iterable<string>
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const label of labels) {
    // Backticked label to handle any future label that contains hyphens.
    const cypher = `MATCH (n:\`${label}\`) WITH n LIMIT $limit UNWIND keys(n) AS k RETURN DISTINCT k AS key`;
    const res = await session.run(cypher, { limit: PROPERTY_SAMPLE_LIMIT });
    result.set(label, new Set(res.records.map((r) => r.get('key') as string)));
  }
  return result;
}

export async function introspectSchema(): Promise<IntrospectedSchema> {
  if (cached) return cached;
  if (pending) return pending;

  pending = (async () => {
    await connectNeo4j();
    const session = createSession();
    try {
      const [labels, relationships] = await Promise.all([
        fetchLabels(session),
        fetchRelationshipTypes(session),
      ]);
      const propertiesByLabel = await fetchPropertiesByLabel(session, labels);
      const allProperties = new Set<string>();
      for (const props of propertiesByLabel.values()) {
        for (const p of props) allProperties.add(p);
      }
      const snapshot: IntrospectedSchema = {
        labels,
        relationships,
        propertiesByLabel,
        allProperties,
        capturedAt: Date.now(),
      };
      cached = snapshot;
      return snapshot;
    } finally {
      await session.close();
      pending = null;
    }
  })();

  return pending;
}

// Synchronous accessor — returns the cached snapshot if available, else null.
// The validator uses this and falls back to "no schema check" rather than
// blocking the read-cypher call on cold-start introspection.
export function getCachedSchema(): IntrospectedSchema | null {
  return cached;
}

// Test/dev helper to seed a synthetic schema.
export function setCachedSchema(schema: IntrospectedSchema | null): void {
  cached = schema;
}

// Levenshtein distance for "Did you mean?" suggestions. Capped at maxDist+1
// so the cost is small for short property names.
export function levenshtein(a: string, b: string, maxDist = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

export function suggestClosest(
  unknown: string,
  candidates: Iterable<string>,
  maxDist = 3,
  topN = 3
): string[] {
  const lower = unknown.toLowerCase();
  const scored: Array<{ name: string; dist: number }> = [];
  for (const cand of candidates) {
    const dist = levenshtein(lower, cand.toLowerCase(), maxDist);
    if (dist <= maxDist) scored.push({ name: cand, dist });
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, topN).map((s) => s.name);
}
