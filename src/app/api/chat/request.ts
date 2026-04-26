import type { UIMessage } from 'ai';
import { z } from 'zod';

const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().trim().min(1).max(10000),
});

const currentUserMessageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.literal('user'),
  parts: z.array(textPartSchema).min(1).max(8),
});

const currentChatRequestSchema = z
  .object({
    message: currentUserMessageSchema,
  })
  .strict();

export type CurrentChatRequest = z.infer<typeof currentChatRequestSchema>;

export function parseCurrentChatRequest(value: unknown): UIMessage[] {
  const parsed = currentChatRequestSchema.parse(value);
  return [
    {
      id: parsed.message.id,
      role: parsed.message.role,
      parts: parsed.message.parts,
    },
  ];
}
