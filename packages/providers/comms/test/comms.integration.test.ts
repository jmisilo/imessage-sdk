import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { createIMessageClient } from 'imessage-sdk';

import { comms } from '../src/index.js';

const enabled = process.env['COMMS_LIVE_TEST'] === '1';

describe.skipIf(!enabled)('Comms live API', () => {
  it('exercises documented Comms text and read operations', async () => {
    const recipientNumber = required('COMMS_TEST_RECIPIENT');
    const provider = comms();
    const client = createIMessageClient({
      connectionId: 'comms-live',
      provider,
    });
    const conversation = await client.conversations.open({
      participants: [{ kind: 'phone', value: recipientNumber }],
    });
    const startedAt = new Date();
    const run = String(Date.now());

    const sent = await client.messages.send({
      to: { kind: 'phone', value: recipientNumber },
      text: `Hello from imessage-sdk ${run}`,
      idempotencyKey: `imessage-sdk-comms-${run}`,
    });
    const messages = await provider.messages.list({
      since: startedAt,
      direction: 'outbound',
      limit: 20,
    });
    const conversations = await provider.conversations.list({ limit: 20 });
    const contacts = await provider.contacts.list({ limit: 20 });
    const events = await provider.deliveryEvents.list({ limit: 20 });
    const webhooks = await provider.webhookEndpoints.list();

    expect(conversation.providerConversationId).toBe(recipientNumber);
    expect(sent.providerMessageId).toBeTruthy();
    expect(messages.some((message) => message.id === sent.providerMessageId)).toBe(true);
    expect(conversations).toBeInstanceOf(Array);
    expect(contacts).toBeInstanceOf(Array);
    expect(events).toBeInstanceOf(Array);
    expect(webhooks).toBeInstanceOf(Array);
  }, 60_000);
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required when COMMS_LIVE_TEST=1.`);
  }
  return value;
}
