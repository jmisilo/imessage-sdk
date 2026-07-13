import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { createIMessageClient } from 'imessage-sdk';

import { blooio } from '../src/index.js';

const enabled = process.env['BLOOIO_LIVE_TEST'] === '1';

describe.skipIf(!enabled)('Blooio live API', () => {
  it('exercises every Blooio v0.1 outbound operation', async () => {
    const apiKey = required('BLOOIO_API_KEY');
    const recipientValue = required('BLOOIO_TEST_RECIPIENT');
    const imageUrl = required('BLOOIO_TEST_IMAGE_URL');
    const videoUrl = required('BLOOIO_TEST_VIDEO_URL');
    const fileUrl = required('BLOOIO_TEST_FILE_URL');
    const requestedSender = process.env['BLOOIO_FROM_NUMBER'];

    const recipient = { kind: addressKind(recipientValue), value: recipientValue } as const;
    const discoveryProvider = blooio({ apiKey });
    const numbers = await discoveryProvider.numbers.list();
    const activeNumbers = numbers.filter((number) => number.active);
    if (activeNumbers.length === 0) {
      throw new Error(
        'This Blooio API key has no active linked number. Link a number to the API key in Dashboard → Numbers, then rerun the test.',
      );
    }
    const senderValue = requestedSender ?? activeNumbers[0]?.phoneNumber;
    if (
      senderValue === undefined ||
      !activeNumbers.some((number) => number.phoneNumber === senderValue)
    ) {
      throw new Error(
        `BLOOIO_FROM_NUMBER=${requestedSender ?? '<unset>'} is not active for this API key. Active numbers: ${activeNumbers.map((number) => number.phoneNumber).join(', ')}`,
      );
    }
    const provider = blooio({
      apiKey,
      sender: { kind: 'phone', value: senderValue },
    });
    const client = createIMessageClient({
      connectionId: 'blooio-live',
      provider,
    });
    const run = `${Date.now()}`;

    const conversation = await client.conversations.open({
      participants: [recipient],
    });
    const textInput = {
      conversationId: conversation.id,
      text: `imessage-sdk live test ${run}`,
      idempotencyKey: `imessage-sdk-${run}-text`,
    } as const;
    const text = await client.messages.send(textInput);
    const deduplicatedText = await client.messages.send(textInput);
    expect(deduplicatedText.providerMessageId).toBe(text.providerMessageId);
    await waitUntilSent(provider, {
      conversationId: conversation.id,
      messageId: text.providerMessageId,
    });
    const attachment = await client.messages.send({
      conversationId: conversation.id,
      text: 'Public URL attachment test',
      attachments: [
        { kind: 'image', source: { type: 'url', url: imageUrl } },
        { kind: 'video', source: { type: 'url', url: videoUrl } },
        { kind: 'file', source: { type: 'url', url: fileUrl } },
      ],
      idempotencyKey: `imessage-sdk-${run}-attachments`,
    });
    const reply = await client.messages.send({
      conversationId: conversation.id,
      text: 'Thread reply test',
      replyTo: { messageId: text.providerMessageId },
      idempotencyKey: `imessage-sdk-${run}-reply`,
    });
    const locator = {
      conversationId: conversation.id,
      messageId: text.providerMessageId,
    };

    const found = await client.messages.get(locator);
    const status = await client.providers.blooio.messages.getStatus(locator);
    const foundConversation = await client.conversations.get(conversation.id);
    await client.typing.start(conversation.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
    await client.typing.stop(conversation.id);
    await client.reactions.add({ ...locator, reaction: 'like' });
    await client.reactions.remove({ ...locator, reaction: 'like' });
    await client.conversations.markRead(conversation.id);

    expect(text.providerMessageId).toBeTruthy();
    expect(attachment.attachments).toHaveLength(3);
    expect(reply.replyTo?.messageId).toBe(text.providerMessageId);
    expect(found?.providerMessageId).toBe(text.providerMessageId);
    expect(status?.messageId).toBe(text.providerMessageId);
    expect(foundConversation?.providerConversationId).toBeTruthy();
  }, 120_000);
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required when BLOOIO_LIVE_TEST=1.`);
  }
  return value;
}

function addressKind(value: string): 'phone' | 'email' {
  return value.includes('@') ? 'email' : 'phone';
}

async function waitUntilSent(
  provider: ReturnType<typeof blooio>,
  locator: { readonly conversationId: string; readonly messageId: string },
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await provider.messages.getStatus(locator);
    if (status?.status === 'sent' || status?.status === 'delivered' || status?.status === 'read') {
      return;
    }
    if (status?.status === 'failed') {
      throw new Error(`Blooio test message failed: ${status.error ?? 'unknown'}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('Blooio test message was not sent within 60 seconds.');
}
