import type { QueryMeta } from '../_shared/runReadQueryWithMeta';

export interface StageBenchmarkPosition {
  completionRate: 'below_p25' | 'p25_p50' | 'p50_p75' | 'above_p75' | 'no_data';
  timeline: 'below_p25' | 'p25_p50' | 'p50_p75' | 'above_p75' | 'no_event_date' | 'no_data';
  coverage: 'below_p25' | 'p25_p50' | 'p50_p75' | 'above_p75' | 'no_data';
}

export interface StageBenchmark {
  targetStage: string;
  peerCount: number;
  thisCase: {
    completionRate: number;
    monthsSinceEvent: number | null;
    documentCoverage: number;
    coveredCategories: string[];
    missingCritical: string[];
  };
  peers: {
    completionRate: { p25: number; p50: number; p75: number } | null;
    monthsFromEventToStage: { p25: number; p50: number; p75: number } | null;
    documentCoverage: { p25: number; p50: number; p75: number } | null;
    mostCommonCategories: Array<{ category: string; freq: number }>;
    sampleCaseIds: string[];
  };
  position: StageBenchmarkPosition;
  meta: QueryMeta;
}
