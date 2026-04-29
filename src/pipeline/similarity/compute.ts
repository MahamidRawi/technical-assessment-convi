import { cosineSimilarity } from 'ai';
import { SIMILARITY_MIN_SCORE, SIMILARITY_TOP_K_PER_CASE } from '@/constants/readiness';
import type { CaseSignals, SimilarityMethod, SimilarityWriteRow } from './types';

const SEMANTIC_REASON_THRESHOLD = 0.7;
const SEMANTIC_BLEND_WEIGHT = 0.45;
const SIGNAL_BLEND_WEIGHT = 0.55;
const TOP_REASON_COUNT = 3;

function signalWeight(caseCount: number, docFreq: number): number {
  return Math.log((1 + caseCount) / (1 + docFreq)) + 1;
}

function buildDocFrequency(cases: CaseSignals[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const row of cases) {
    for (const key of row.signals.keys()) {
      docFreq.set(key, (docFreq.get(key) ?? 0) + 1);
    }
  }
  return docFreq;
}

interface PairScore {
  signalScore: number;
  overlap: Array<{ key: string; label: string; weight: number }>;
}

function scorePair(
  left: CaseSignals,
  right: CaseSignals,
  caseCount: number,
  docFreq: Map<string, number>
): PairScore {
  const overlap: PairScore['overlap'] = [];
  let intersection = 0;
  let union = 0;
  const allKeys = new Set([...left.signals.keys(), ...right.signals.keys()]);
  for (const key of allKeys) {
    const weight = signalWeight(caseCount, docFreq.get(key) ?? 0);
    const leftHas = left.signals.has(key);
    const rightHas = right.signals.has(key);
    if (leftHas && rightHas) {
      intersection += weight;
      overlap.push({ key, label: left.signals.get(key) ?? key, weight });
    }
    union += weight;
  }
  return {
    signalScore: union === 0 ? 0 : intersection / union,
    overlap,
  };
}

function semanticScoreFor(
  left: CaseSignals,
  right: CaseSignals,
  method: SimilarityMethod
): number | null {
  if (method !== 'signal+semantic') return null;
  if (!left.embedding || !right.embedding) return null;
  return cosineSimilarity(left.embedding, right.embedding);
}

function combinedFor(signalScore: number, semanticScore: number | null): number {
  return semanticScore === null
    ? signalScore
    : SIGNAL_BLEND_WEIGHT * signalScore + SEMANTIC_BLEND_WEIGHT * semanticScore;
}

export function computePairs(
  cases: CaseSignals[],
  similarityMethod: SimilarityMethod
): SimilarityWriteRow[] {
  const docFreq = buildDocFrequency(cases);
  const candidatePairs: SimilarityWriteRow[] = [];
  for (let i = 0; i < cases.length; i++) {
    const left = cases[i];
    if (!left) continue;
    for (let j = i + 1; j < cases.length; j++) {
      const right = cases[j];
      if (!right) continue;
      const { signalScore, overlap } = scorePair(left, right, cases.length, docFreq);
      const semanticScore = semanticScoreFor(left, right, similarityMethod);
      const combinedScore = combinedFor(signalScore, semanticScore);
      if (combinedScore < SIMILARITY_MIN_SCORE) continue;

      const topReasons = overlap.sort((a, b) => b.weight - a.weight).slice(0, TOP_REASON_COUNT);
      const reasons = topReasons.map((r) => r.label);
      if (semanticScore !== null && semanticScore >= SEMANTIC_REASON_THRESHOLD) {
        reasons.push('Semantic summary match');
      }
      candidatePairs.push({
        leftId: left.caseId,
        rightId: right.caseId,
        score: combinedScore,
        signalScore,
        semanticScore,
        combinedScore,
        similarityMethod,
        reasons,
        overlapSignalKeys: topReasons.map((r) => r.key),
      });
    }
  }
  return pruneToTopKPerCase(candidatePairs, SIMILARITY_TOP_K_PER_CASE);
}

// Small portfolios + a permissive threshold produce a saturated graph (every
// pair admitted), which means SIMILAR_TO carries no retrieval signal. We keep
// each Case's K strongest neighbors and drop the rest. A pair survives if it
// ranks in *either* endpoint's top-K, so a hub case can't crowd out a weaker
// case's best match.
function pruneToTopKPerCase(rows: SimilarityWriteRow[], k: number): SimilarityWriteRow[] {
  if (k <= 0 || rows.length === 0) return rows;
  const byCase = new Map<string, SimilarityWriteRow[]>();
  for (const row of rows) {
    const left = byCase.get(row.leftId) ?? [];
    left.push(row);
    byCase.set(row.leftId, left);
    const right = byCase.get(row.rightId) ?? [];
    right.push(row);
    byCase.set(row.rightId, right);
  }
  const survivors = new Set<SimilarityWriteRow>();
  for (const list of byCase.values()) {
    list.sort((a, b) => b.combinedScore - a.combinedScore);
    for (let i = 0; i < Math.min(k, list.length); i++) {
      survivors.add(list[i]!);
    }
  }
  return Array.from(survivors);
}
