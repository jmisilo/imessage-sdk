import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import type { IMessageAddress, MessageLocator } from 'imessage-sdk';
import { blooio } from '@imessage-sdk/blooio';
import { createIMessageClient } from 'imessage-sdk';

if (process.env['BLOOIO_RUN_LIVE'] !== '1') {
  throw new Error(
    'Set BLOOIO_RUN_LIVE=1 in examples/basic-blooio/.env to acknowledge that this example sends real messages.',
  );
}

const client = createIMessageClient({
  provider: blooio(),
});

console.log('Capabilities:', client.capabilities);
console.log('Sender:', process.env['BLOOIO_FROM_NUMBER']!);

const conversation = await client.conversations.open({
  participants: [address(process.env['BLOOIO_TEST_RECIPIENT']!)],
});
const runId = Date.now().toString();
const textInput = {
  conversationId: conversation.id,
  text: `imessage-sdk basic Blooio example ${runId}`,
  idempotencyKey: `basic-blooio-${runId}-text`,
} as const;

const text = await client.messages.send(textInput);
const duplicate = await client.messages.send(textInput);
console.log('Idempotent send:', duplicate.providerMessageId);

const locator: MessageLocator = {
  conversationId: conversation.id,
  messageId: text.providerMessageId,
};
await waitUntilSent(locator);

const attachmentMessage = await client.messages.send({
  conversationId: conversation.id,
  text: 'Attachments from public URLs',
  attachments: [
    { kind: 'image', source: { type: 'url', url: process.env['BLOOIO_TEST_IMAGE_URL']! } },
    { kind: 'video', source: { type: 'url', url: process.env['BLOOIO_TEST_VIDEO_URL']! } },
    { kind: 'file', source: { type: 'url', url: process.env['BLOOIO_TEST_FILE_URL']! } },
  ],
  idempotencyKey: `basic-blooio-${runId}-attachments`,
});

const reply = await client.messages.send({
  conversationId: conversation.id,
  text: 'Replying to the first message',
  replyTo: { messageId: text.providerMessageId },
  idempotencyKey: `basic-blooio-${runId}-reply`,
});

const foundMessage = await client.messages.get(locator);
const messageStatus = await client.providers.blooio.messages.getStatus(locator);
const foundConversation = await client.conversations.get(conversation.id);

await client.typing.start(conversation.id);
await delay(2_000);
await client.typing.stop(conversation.id);

await client.reactions.add({ ...locator, reaction: 'like' });
await client.reactions.remove({ ...locator, reaction: 'like' });
await client.conversations.markRead(conversation.id);

console.log('Conversation:', foundConversation ?? conversation);
console.log('Text message:', foundMessage ?? text);
console.log('Attachment message:', attachmentMessage);
console.log('Reply message:', reply);
console.log('Status:', messageStatus ?? 'unknown');
console.log('Blooio example completed successfully.');

function address(value: string): IMessageAddress {
  return {
    kind: value.includes('@') ? 'email' : 'phone',
    value,
  };
}

async function waitUntilSent(locator: MessageLocator): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await client.providers.blooio.messages.getStatus(locator);
    if (status?.status === 'sent' || status?.status === 'delivered' || status?.status === 'read') {
      return;
    }
    if (status?.status === 'failed') {
      throw new Error(`Blooio message failed: ${status.error ?? 'unknown provider error'}`);
    }
    await delay(2_000);
  }
  throw new Error('Blooio did not report the message as sent within 60 seconds.');
}
