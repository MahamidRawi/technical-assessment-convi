import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASELINE_PATH = resolve(process.cwd(), 'evals', 'baseline.json');
const MAX_DROP = 0.1;

interface Baseline {
  passed: number;
  total: number;
  passRate: number;
  recordedAt: string;
}

function runEvalSuite(): { passed: number; total: number; output: string } {
  let output = '';
  try {
    output = execSync('npm run -s eval:golden', {
      env: { ...process.env, RUN_LLM_EVALS: 'true' },
      stdio: 'pipe',
    }).toString();
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    output = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`;
  }
  const passed = (output.match(/^ok /gm) ?? []).length;
  const failed = (output.match(/^not ok /gm) ?? []).length;
  return { passed, total: passed + failed, output };
}

function loadBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
  return parsed;
}

function saveBaseline(b: Baseline): void {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(b, null, 2)}\n`);
}

function main(): void {
  const acceptFlag = process.argv.includes('--accept');
  console.log('Running golden eval suite...\n');
  const { passed, total, output } = runEvalSuite();
  console.log(output);

  if (total === 0) {
    console.error('FAIL: No evals ran. Eval harness may be broken.');
    process.exit(1);
  }

  const passRate = passed / total;
  const current: Baseline = {
    passed,
    total,
    passRate,
    recordedAt: new Date().toISOString(),
  };

  const baseline = loadBaseline();

  if (acceptFlag || !baseline) {
    saveBaseline(current);
    if (!baseline) {
      console.log(
        `\nNo baseline existed. Recorded current run as baseline: ${passed}/${total} (${(passRate * 100).toFixed(1)}%).`
      );
    } else {
      console.log(
        `\n--accept: replaced baseline. Was ${baseline.passed}/${baseline.total} (${(baseline.passRate * 100).toFixed(1)}%), now ${passed}/${total} (${(passRate * 100).toFixed(1)}%).`
      );
    }
    process.exit(0);
  }

  const drop = baseline.passRate - passRate;
  console.log(
    `\nBaseline: ${baseline.passed}/${baseline.total} (${(baseline.passRate * 100).toFixed(1)}%) recorded ${baseline.recordedAt}`
  );
  console.log(`Current:  ${passed}/${total} (${(passRate * 100).toFixed(1)}%)`);
  console.log(`Delta:    ${drop > 0 ? '-' : '+'}${(Math.abs(drop) * 100).toFixed(1)} percentage points`);

  if (drop > MAX_DROP) {
    console.error(
      `\nFAIL: pass-rate dropped ${(drop * 100).toFixed(1)}pp (threshold ${MAX_DROP * 100}pp). To accept this as the new baseline, run: npm run eval:check -- --accept`
    );
    process.exit(1);
  }

  console.log('\nPASS: pass-rate within threshold.');
  process.exit(0);
}

main();
