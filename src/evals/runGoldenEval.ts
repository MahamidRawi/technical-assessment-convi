import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { UIMessage } from 'ai';
import { streamCaseReasonerResponse } from '@/agents/caseReasoner';
import type { StepTrace } from '@/types/trace.types';

const argRuleSchema = z.object({
  toolName: z.string(),
  path: z.string(),
  value: z.unknown().optional(),
});

const evalCaseSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  mustCall: z.array(z.string()).default([]),
  mustNotCall: z.array(z.string()).default([]),
  requiredArgs: z.array(argRuleSchema).default([]),
  forbiddenArgs: z.array(argRuleSchema).default([]),
  requiredAnswerSubstrings: z.array(z.string()).default([]),
  forbiddenAnswerPatterns: z.array(z.string()).default([]),
});

type GoldenEvalCase = z.infer<typeof evalCaseSchema>;

function loadCases(): GoldenEvalCase[] {
  const path = resolve(process.cwd(), 'evals', 'golden-agent.jsonl');
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return evalCaseSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid eval case on line ${index + 1}: ${error}`);
      }
    });
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function matchesExpected(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function runCase(testCase: GoldenEvalCase): Promise<string[]> {
  const traces: StepTrace[] = [];
  const message: UIMessage = {
    id: `eval-${testCase.id}`,
    role: 'user',
    parts: [{ type: 'text', text: testCase.prompt }],
  } as UIMessage;
  const result = await streamCaseReasonerResponse([message], undefined, (trace) => {
    traces.push(trace);
  });
  const answer = await result.text;
  const failures: string[] = [];
  const called = new Set(traces.map((trace) => trace.toolName));

  for (const toolName of testCase.mustCall) {
    if (!called.has(toolName)) failures.push(`expected tool call ${toolName}`);
  }
  for (const toolName of testCase.mustNotCall) {
    if (called.has(toolName)) failures.push(`forbidden tool call ${toolName}`);
  }
  for (const rule of testCase.requiredArgs) {
    const matched = traces.some(
      (trace) =>
        trace.toolName === rule.toolName &&
        matchesExpected(getPath(trace.toolInput, rule.path), rule.value)
    );
    if (!matched) failures.push(`expected ${rule.toolName}.${rule.path}=${JSON.stringify(rule.value)}`);
  }
  for (const rule of testCase.forbiddenArgs) {
    const matched = traces.some((trace) => {
      if (trace.toolName !== rule.toolName) return false;
      const actual = getPath(trace.toolInput, rule.path);
      if (actual === undefined || actual === null || actual === '') return false;
      return 'value' in rule ? matchesExpected(actual, rule.value) : true;
    });
    if (matched) failures.push(`forbidden ${rule.toolName}.${rule.path}`);
  }
  for (const required of testCase.requiredAnswerSubstrings) {
    if (!answer.includes(required)) failures.push(`answer missing substring ${required}`);
  }
  for (const pattern of testCase.forbiddenAnswerPatterns) {
    if (new RegExp(pattern).test(answer)) failures.push(`answer matched forbidden pattern ${pattern}`);
  }
  return failures;
}

async function main(): Promise<void> {
  const cases = loadCases();
  if (process.env.RUN_LLM_EVALS !== 'true') {
    console.log(`Validated ${cases.length} golden eval definitions. Set RUN_LLM_EVALS=true to run live agent evals.`);
    return;
  }

  let failed = 0;
  for (const testCase of cases) {
    const failures = await runCase(testCase);
    if (failures.length > 0) {
      failed += 1;
      console.error(`not ok ${testCase.id}: ${failures.join('; ')}`);
    } else {
      console.log(`ok ${testCase.id}`);
    }
  }
  if (failed > 0) {
    process.exitCode = 1;
    console.error(`${failed}/${cases.length} golden evals failed`);
  } else {
    console.log(`${cases.length}/${cases.length} golden evals passed`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
