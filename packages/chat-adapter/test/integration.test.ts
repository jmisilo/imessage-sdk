import { createMemoryState } from '@chat-adapter/state-memory';
import { Chat } from 'chat';
import { describe, expect, it } from 'vitest';

import { createIMessageAdapter } from '../src/index.js';
import { createFakeProvider, messageReceivedEvent } from './fake-provider.js';

describe('Chat SDK integration', () => {
  it('routes a normalized webhook through Chat to an onDirectMessage handler', async () => {
    const fake = createFakeProvider();
    fake.setEvents([messageReceivedEvent()]);
    const imessage = createIMessageAdapter({ provider: fake.provider });
    const chat = new Chat({
      userName: 'test-bot',
      adapters: { imessage },
      state: createMemoryState(),
    });
    let receivedText: string | undefined;
    chat.onDirectMessage((_thread, message) => {
      receivedText = message.text;
    });
    await chat.initialize();
    const tasks: Promise<unknown>[] = [];

    const response = await chat.webhooks.imessage(
      new Request('https://example.com/webhooks/imessage', {
        method: 'POST',
        headers: { 'x-test-signature': 'valid' },
        body: '{}',
      }),
      { waitUntil: (task) => tasks.push(task) },
    );
    await Promise.all(tasks);

    expect(response.status).toBe(200);
    expect(receivedText).toBe('Hello');
    await chat.shutdown();
  });
});
