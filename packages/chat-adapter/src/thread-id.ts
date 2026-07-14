import { ValidationError } from '@chat-adapter/shared';
import { z } from 'zod';

import type { IMessageThreadId } from './types.js';

export const IMESSAGE_THREAD_ID_PREFIX = 'imessage:v1:';

const ThreadIdSchema = z.object({
  version: z.literal(1),
  provider: z.string().min(1),
  connectionId: z.string().min(1),
  conversationId: z.string().min(1),
});

export function encodeIMessageThreadId<TProvider extends string, TConnectionId extends string>(
  thread: IMessageThreadId<TProvider, TConnectionId>,
): string {
  const parsed = ThreadIdSchema.safeParse(thread);
  if (!parsed.success) {
    throw new ValidationError('imessage', 'Thread ID fields must not be empty');
  }

  const payload = Buffer.from(JSON.stringify(parsed.data)).toString('base64url');
  return `${IMESSAGE_THREAD_ID_PREFIX}${payload}`;
}

export function decodeIMessageThreadId(threadId: string): IMessageThreadId<string, string> {
  if (!threadId.startsWith(IMESSAGE_THREAD_ID_PREFIX)) {
    throw new ValidationError('imessage', 'Invalid iMessage thread ID prefix');
  }

  try {
    const encoded = threadId.slice(IMESSAGE_THREAD_ID_PREFIX.length);
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const parsed = ThreadIdSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error('Invalid payload');
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('imessage', 'Invalid iMessage thread ID payload');
  }
}
