import 'dotenv/config';
import { generateText } from 'ai';
import { getLanguageModel, resolveLlm } from '../llm/provider';

async function main(): Promise<void> {
  const resolved = resolveLlm(process.env);
  console.log(`Provider: ${resolved.provider}`);
  console.log(`Model:    ${resolved.modelId}`);
  console.log('Pinging model with a one-token prompt...');
  const start = Date.now();
  const result = await generateText({
    model: getLanguageModel(),
    prompt: 'Reply with the single word: pong',
    maxOutputTokens: 16,
  });
  const ms = Date.now() - start;
  console.log(`Reply: ${result.text.trim()}`);
  console.log(`Latency: ${ms}ms`);
  console.log('PASS');
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
