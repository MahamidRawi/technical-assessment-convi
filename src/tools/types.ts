import type { z } from 'zod';
import type { EvidenceItem, ReadinessDecisionArtifact } from '@/types/trace.types';
import type { QueryMeta } from './_shared/runReadQueryWithMeta';

export interface ToolDefinition<TSchema extends z.ZodTypeAny, TResult> {
  name: string;
  label: string;
  inputSchema: TSchema;
  execute: (input: z.output<TSchema>) => Promise<TResult>;
  summarize: (result: TResult) => string;
  extractEvidence: (result: TResult) => EvidenceItem[];
  traceMeta?: (result: TResult) => QueryMeta | null;
  extractArtifact?: (result: TResult) => ReadinessDecisionArtifact | null;
}
