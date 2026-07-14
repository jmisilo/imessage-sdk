import { threadIdContract } from '@chat-adapter/tests';
import { describe, expect, it } from 'vitest';

import {
  decodeIMessageThreadId,
  encodeIMessageThreadId,
  IMESSAGE_THREAD_ID_PREFIX,
} from '../src/index.js';

const thread = {
  version: 1 as const,
  provider: 'blooio',
  connectionId: 'main-line',
  conversationId: 'conversation:123',
};

threadIdContract({
  name: 'imessage',
  encode: encodeIMessageThreadId,
  decode: decodeIMessageThreadId,
  cases: [{ decoded: thread }],
});

describe('iMessage thread IDs', () => {
  it('uses the versioned prefix', () => {
    expect(encodeIMessageThreadId(thread)).toMatch(
      new RegExp(`^${IMESSAGE_THREAD_ID_PREFIX.replaceAll(':', '\\:')}`),
    );
  });

  it.each(['invalid', 'imessage:v1:', 'imessage:v1:not-json'])(
    'rejects invalid thread ID %s',
    (value) => {
      expect(() => decodeIMessageThreadId(value)).toThrow();
    },
  );
});
