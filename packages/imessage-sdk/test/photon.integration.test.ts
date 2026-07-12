import process from "node:process";

import { describe, expect, it } from "vitest";

import { createIMessageClient } from "../src/index.js";
import { photon } from "../src/providers/photon.js";

const enabled = process.env["PHOTON_LIVE_TEST"] === "1";
const streamEnabled = process.env["PHOTON_LIVE_STREAM_TEST"] === "1";

describe.skipIf(!enabled)("Photon Cloud live API", () => {
  it("exercises every Photon Cloud v0.1 outbound operation", async () => {
    required("PHOTON_PROJECT_ID");
    required("PHOTON_PROJECT_SECRET");
    const recipientValue = required("PHOTON_TEST_RECIPIENT");
    const imageUrl = required("PHOTON_TEST_IMAGE_URL");
    const videoUrl = required("PHOTON_TEST_VIDEO_URL");
    const fileUrl = required("PHOTON_TEST_FILE_URL");
    const provider = photon();
    const client = createIMessageClient({
      connectionId: "photon-cloud-live",
      provider,
    });
    const run = String(Date.now());

    try {
      const line = await provider.connection.getLine();
      expect(line.phone).toBeTruthy();

      const conversation = await client.conversations.open({
        participants: [toAddress(recipientValue)],
      });
      const textInput = {
        conversationId: conversation.id,
        text: `imessage-sdk Photon live test ${run}`,
        idempotencyKey: `imessage-sdk-photon-${run}-text`,
      } as const;
      const text = await client.messages.send(textInput);
      await expect(client.messages.send(textInput)).rejects.toMatchObject({
        name: "ConflictError",
        code: "duplicate_message",
        retryable: false,
      });

      const locator = {
        conversationId: conversation.id,
        messageId: text.providerMessageId,
      };
      let found = await client.messages.get(locator);
      for (
        let attempt = 0;
        attempt < 15 &&
        found !== null &&
        found.status !== "delivered" &&
        found.status !== "read";
        attempt += 1
      ) {
        await delay(1_000);
        found = await client.messages.get(locator);
      }
      const foundConversation = await client.conversations.get(conversation.id);

      await client.reactions.add({ ...locator, reaction: "like" });
      await client.reactions.remove({ ...locator, reaction: "like" });
      await client.typing.start(conversation.id);
      await delay(2_000);
      await client.typing.stop(conversation.id);
      await client.conversations.markRead(conversation.id);

      const attachment = await client.messages.send({
        conversationId: conversation.id,
        attachments: [
          { kind: "image", source: { type: "url", url: imageUrl } },
          { kind: "video", source: { type: "url", url: videoUrl } },
          { kind: "file", source: { type: "url", url: fileUrl } },
        ],
        replyTo: { messageId: text.providerMessageId },
        idempotencyKey: `imessage-sdk-photon-${run}-attachments`,
      });

      expect(text.providerMessageId).toBeTruthy();
      expect(attachment.attachments).toHaveLength(3);
      expect(attachment.replyTo?.messageId).toBe(text.providerMessageId);
      expect(found?.providerMessageId).toBe(text.providerMessageId);
      expect(foundConversation?.providerConversationId).toBe(conversation.id);
    } finally {
      await client.close();
    }
  }, 180_000);
});

describe.skipIf(!streamEnabled)("Photon Cloud live stream", () => {
  it("receives one real Photon event", async () => {
    required("PHOTON_PROJECT_ID");
    required("PHOTON_PROJECT_SECRET");
    const provider = photon();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const events = provider.events.subscribe({ signal: controller.signal });
      const iterator = events[Symbol.asyncIterator]();
      const result = await iterator.next();
      if (result.done === true) {
        throw new Error(
          "No Photon event arrived within 60 seconds. Send an iMessage to the configured line while this test is running.",
        );
      }
      expect(result.value.providerEventId).toBeTruthy();
    } finally {
      clearTimeout(timeout);
      controller.abort();
      await provider.close?.();
    }
  }, 90_000);
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for Photon live tests.`);
  }
  return value;
}

function toAddress(value: string) {
  return {
    kind: value.includes("@") ? ("email" as const) : ("phone" as const),
    value,
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
