import type { StageBenchmark, StageBenchmarkPosition } from './types';

type Quartiles = { p25: number; p50: number; p75: number };

export interface PeerSample {
  caseId: string;
  completionRate: number | null;
  monthsToStage: number | null;
  categories: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loValue = sorted[lo];
  const hiValue = sorted[hi];
  if (loValue === undefined || hiValue === undefined) {
    throw new Error('Percentile index out of range');
  }
  if (lo === hi) return loValue;
  const frac = idx - lo;
  return loValue * (1 - frac) + hiValue * frac;
}

function quartilesOf(values: number[]): Quartiles | null {
  if (values.length === 0) return null;
  return { p25: percentile(values, 0.25), p50: percentile(values, 0.5), p75: percentile(values, 0.75) };
}

function classifyPosition(
  value: number | null,
  q: Quartiles | null
): StageBenchmarkPosition['completionRate'] {
  if (value === null || !q) return 'no_data';
  if (value < q.p25) return 'below_p25';
  if (value < q.p50) return 'p25_p50';
  if (value < q.p75) return 'p50_p75';
  return 'above_p75';
}

export function shapePeerStats(
  samples: PeerSample[],
  thisCase: StageBenchmark['thisCase']
): { peers: StageBenchmark['peers']; position: StageBenchmarkPosition } {
  const completions = samples
    .map((s) => s.completionRate)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const months = samples
    .map((s) => s.monthsToStage)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const coverages = samples
    .map((s) => s.categories.length)
    .sort((a, b) => a - b);

  const categoryCounts = new Map<string, number>();
  for (const s of samples) {
    for (const cat of new Set(s.categories)) categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }
  const mostCommonCategories = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({ category, freq: count / samples.length }))
    .sort((a, b) => b.freq - a.freq)
    .slice(0, 5);

  const completionQ = quartilesOf(completions);
  const monthsQ = quartilesOf(months);
  const coverageQ = quartilesOf(coverages);

  const position: StageBenchmarkPosition = {
    completionRate: classifyPosition(thisCase.completionRate, completionQ),
    timeline:
      thisCase.monthsSinceEvent === null ? 'no_event_date' : classifyPosition(thisCase.monthsSinceEvent, monthsQ),
    coverage: classifyPosition(thisCase.documentCoverage, coverageQ),
  };

  return {
    peers: {
      completionRate: completionQ,
      monthsFromEventToStage: monthsQ,
      documentCoverage: coverageQ,
      mostCommonCategories,
      sampleCaseIds: samples.map((s) => s.caseId).slice(0, 10),
    },
    position,
  };
}
