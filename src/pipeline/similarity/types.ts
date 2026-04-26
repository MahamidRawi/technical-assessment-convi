export interface CaseSignals {
  caseId: string;
  caseName: string;
  caseType: string;
  legalStage: string;
  completionRate: number;
  aiGeneratedSummary: string | null;
  injuries: string[];
  bodyParts: string[];
  insurers: string[];
  documentCategories: string[];
  documentTypes: string[];
  signals: Map<string, string>;
  embedding: number[] | null;
}

export interface SimilarityWriteRow {
  leftId: string;
  rightId: string;
  score: number;
  signalScore: number;
  semanticScore: number | null;
  combinedScore: number;
  similarityMethod: 'signal' | 'signal+semantic';
  reasons: string[];
  overlapSignalKeys: string[];
}

export type SimilarityMethod = 'signal' | 'signal+semantic';
