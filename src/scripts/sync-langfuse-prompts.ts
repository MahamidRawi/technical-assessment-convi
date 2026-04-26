import 'dotenv/config';
import { execSync } from 'node:child_process';
import { LangfuseClient } from '@langfuse/client';
import {
  LANGFUSE_PROMPT_CASE_REASONER_SYSTEM,
  langfuseToolDescriptionPromptName,
} from '../prompts/promptNames';
import {
  DEFAULT_CASE_REASONER_SYSTEM_PROMPT,
  DEFAULT_TOOL_DESCRIPTIONS,
} from '../prompts/defaultPrompts';

/**
 * Pushes the local prompt definitions (`src/prompts/defaultPrompts.ts`) to
 * Langfuse, creating a new version per prompt under the configured label.
 *
 * Each prompt name matches what `resolveFromLangfuse.ts` reads at request
 * time, so once this script runs successfully the production agent loads the
 * uploaded version from Langfuse instead of the local fallback.
 *
 * Idempotent. Each call creates a new version of the same prompt name; the
 * label moves to the latest version on the Langfuse side.
 */

interface CliFlags {
  dryRun: boolean;
  label: string;
  commitMessage: string;
}

function parseFlags(argv: string[]): CliFlags {
  const args = argv.slice(2);
  const labelArg = args.find((a) => a.startsWith('--label='));
  const messageArg = args.find((a) => a.startsWith('--message='));
  return {
    dryRun: args.includes('--dry-run'),
    label:
      labelArg?.split('=')[1] ??
      process.env.LANGFUSE_PROMPT_LABEL?.trim() ??
      'production',
    commitMessage: messageArg?.split('=')[1] ?? buildDefaultCommitMessage(),
  };
}

function buildDefaultCommitMessage(): string {
  const timestamp = new Date().toISOString();
  let sha = '';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // outside a git repo or git unavailable; the timestamp alone is fine.
  }
  return sha ? `local sync ${timestamp} (${sha})` : `local sync ${timestamp}`;
}

interface PromptUpload {
  name: string;
  prompt: string;
}

function buildUploadList(): PromptUpload[] {
  const uploads: PromptUpload[] = [
    { name: LANGFUSE_PROMPT_CASE_REASONER_SYSTEM, prompt: DEFAULT_CASE_REASONER_SYSTEM_PROMPT },
  ];
  for (const [toolName, description] of Object.entries(DEFAULT_TOOL_DESCRIPTIONS)) {
    uploads.push({
      name: langfuseToolDescriptionPromptName(toolName),
      prompt: description,
    });
  }
  return uploads;
}

function assertCredentials(): void {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) {
    console.error(
      'Missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY. Add them to .env or export before running.'
    );
    process.exit(1);
  }
}

async function pushOne(
  client: LangfuseClient,
  upload: PromptUpload,
  label: string,
  commitMessage: string
): Promise<{ name: string; ok: boolean; error?: string }> {
  try {
    await client.prompt.create({
      name: upload.name,
      prompt: upload.prompt,
      type: 'text',
      labels: [label],
      tags: ['case-reasoner'],
      commitMessage,
    });
    return { name: upload.name, ok: true };
  } catch (err) {
    return {
      name: upload.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  assertCredentials();

  const uploads = buildUploadList();
  console.log(
    `Sync target: Langfuse (${process.env.LANGFUSE_BASE_URL ?? 'cloud default'}); label=${flags.label}; ${uploads.length} prompts; commit: "${flags.commitMessage}"`
  );

  if (flags.dryRun) {
    console.log('\n--dry-run: would push the following prompts:');
    for (const u of uploads) {
      const preview = u.prompt.slice(0, 80).replace(/\s+/g, ' ');
      console.log(`  ${u.name.padEnd(48)} ${u.prompt.length} chars  "${preview}…"`);
    }
    return;
  }

  const client = new LangfuseClient();
  const results = await Promise.all(
    uploads.map((u) => pushOne(client, u, flags.label, flags.commitMessage))
  );

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  for (const r of ok) console.log(`  ok      ${r.name}`);
  for (const r of failed) console.error(`  FAILED  ${r.name}: ${r.error}`);

  console.log(`\n${ok.length}/${results.length} prompts pushed successfully`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
