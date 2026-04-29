import type { EvidenceFactNode } from '@/types/graph.types';

/**
 * Build the dedupe key for a fact. Mirrors the regex-side `addUnique` key in
 * `ocrFacts.ts` so a regex draft and an LLM draft that describe the same fact
 * collide here.
 */
function dedupeKey(fact: EvidenceFactNode): string {
  const parts = [
    fact.kind,
    fact.subtype ?? '',
    fact.value ?? '',
    fact.numericValue == null ? '' : String(fact.numericValue),
    fact.fromDate ?? '',
    fact.toDate ?? '',
    (fact.quote ?? '').slice(0, 120),
  ];
  return parts.join('|');
}

/**
 * Merge regex and LLM facts. Regex wins on collision so the deterministic
 * baseline is the canonical record; LLM-only facts are appended.
 */
export function mergeEvidenceFacts(
  regexFacts: EvidenceFactNode[],
  llmFacts: EvidenceFactNode[]
): EvidenceFactNode[] {
  const seen = new Set<string>();
  const out: EvidenceFactNode[] = [];

  for (const fact of regexFacts) {
    const key = dedupeKey(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }

  for (const fact of llmFacts) {
    const key = dedupeKey(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }

  return out;
}
