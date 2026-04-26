import { z } from 'zod';
import { CaseNotFoundError, StageNotFoundError } from './_shared/notFound';

export interface ToolErrorResult {
  status: 'error';
  toolName: string;
  error: {
    code: 'invalid_input' | 'case_not_found' | 'stage_not_found' | 'tool_failed';
    message: string;
  };
}

export function toToolErrorResult(toolName: string, err: unknown): ToolErrorResult {
  if (err instanceof z.ZodError) {
    return {
      status: 'error',
      toolName,
      error: { code: 'invalid_input', message: err.message },
    };
  }
  if (err instanceof CaseNotFoundError) {
    return {
      status: 'error',
      toolName,
      error: { code: 'case_not_found', message: err.message },
    };
  }
  if (err instanceof StageNotFoundError) {
    return {
      status: 'error',
      toolName,
      error: { code: 'stage_not_found', message: err.message },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    status: 'error',
    toolName,
    error: { code: 'tool_failed', message },
  };
}
