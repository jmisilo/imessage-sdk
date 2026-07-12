import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ClientClosedError,
  createFallbackConversationId,
  createIMessageClient,
  defineProvider,
  isFallbackConversationId,
  UnsupportedCapabilityError,
} from "../src/index.js";
import type {
  IMessageAddress,
  ProviderMessage,
  ProviderSentMessage,
} from "../src/index.js";
import {
  BLOOIO_CAPABILITIES,
  blooio,
} from "../src/providers/blooio.js";

const sender = {
  kind: "phone",
  value: "+15550000000",
} as const satisfies IMessageAddress;

const recipient = {
  kind: "phone",
  value: "+15551111111",
} as const satisfies IMessageAddress;

function createProviderMessage(
  overrides: Partial<ProviderMessage> = {},
): ProviderSentMessage {
  return {
    providerMessageId: "message-1",
    conversationId: "conversation-1",
    direction: "outbound",
    sender,
    recipients: [recipient],
    text: "Hello",
    attachments: [],
    service: "imessage",
    status: "sent",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    raw: { source: "test" },
    ...overrides,
  } as ProviderSentMessage;
}

function createTestProvider() {
  const close = vi.fn(async () => undefined);

  const provider = defineProvider({
    name: "blooio",
    capabilities: BLOOIO_CAPABILITIES,
    messages: {
      async send(input) {
        return createProviderMessage({ text: input.text ?? "" });
      },
      async get() {
        return createProviderMessage();
      },
    },
    conversations: {
      async open(input) {
        return {
          providerConversationId: "conversation-1",
          participants: input.participants,
          raw: { source: "test" },
        };
      },
      async get() {
        return {
          providerConversationId: "conversation-1",
          participants: [recipient],
          raw: { source: "test" },
        };
      },
      async markRead() {},
    },
    reactions: {
      async add() {},
      async remove() {},
    },
    typing: {
      async start() {},
      async stop() {},
    },
    webhooks: {
      async verify(request) {
        return request.headers.get("x-test-signature") === "valid";
      },
      async parse() {
        return [
          {
            id: "event-1",
            type: "message.received",
            timestamp: new Date("2026-01-01T00:00:01.000Z"),
            message: createProviderMessage({ direction: "inbound" }),
            raw: { source: "test" },
          },
        ];
      },
    },
    close,
  });

  return { close, provider };
}

describe("generic client", () => {
  it("creates a diagnostic fallback when a provider message omits conversationId", async () => {
    const { provider: baseProvider } = createTestProvider();
    const provider = defineProvider({
      ...baseProvider,
      name: "fallback-provider" as const,
      messages: {
        ...baseProvider.messages,
        async send() {
          const withoutConversation = { ...createProviderMessage() };
          delete withoutConversation.conversationId;
          return withoutConversation;
        },
      },
    });
    const client = createIMessageClient({ provider });

    const message = await client.messages.send({ to: recipient, text: "Hello" });

    expect(message.conversationId).toBe(
      createFallbackConversationId(
        message.providerMessageId,
        message.createdAt,
      ),
    );
    expect(isFallbackConversationId(message.conversationId)).toBe(true);
    await expect(
      client.messages.send({
        conversationId: message.conversationId,
        text: "Cannot route this",
      }),
    ).rejects.toMatchObject({
      name: "ValidationError",
      code: "non_routable_conversation_id",
    });
  });

  it("infers the concrete provider returned by the Blooio factory", async () => {
    const provider = blooio({ apiKey: "" });
    const client = createIMessageClient({ provider });

    expectTypeOf(provider.name).toEqualTypeOf<"blooio">();
    expectTypeOf(client.provider).toEqualTypeOf<"blooio">();
    expectTypeOf(client.connectionId).toEqualTypeOf<"default">();
    expectTypeOf<keyof typeof client.providers>().toEqualTypeOf<"blooio">();
    expect(client.connectionId).toBe("default");
    expect(client.providers.blooio).toBe(provider);

    await expect(
      client.messages.send({ to: recipient, text: "Missing credentials" }),
    ).rejects.toMatchObject({
      provider: "blooio",
      code: "missing_api_key",
    });
  });

  it("preserves the selected provider and connection literals", async () => {
    const { provider } = createTestProvider();
    const client = createIMessageClient({
      connectionId: "main-line",
      provider,
    });

    expectTypeOf(client.provider).toEqualTypeOf<"blooio">();
    expectTypeOf(client.connectionId).toEqualTypeOf<"main-line">();
    expectTypeOf<keyof typeof client.providers>().toEqualTypeOf<"blooio">();
    expectTypeOf(client.capabilities.messages.edit).toEqualTypeOf<false>();
    expectTypeOf(client.providers.blooio.name).toEqualTypeOf<"blooio">();

    const message = await client.messages.send({
      to: recipient,
      text: "Typed end to end",
    });

    expectTypeOf(message.provider).toEqualTypeOf<"blooio">();
    expectTypeOf(message.connectionId).toEqualTypeOf<"main-line">();
    expect(message).toMatchObject({
      id: "message-1",
      provider: "blooio",
      connectionId: "main-line",
      text: "Typed end to end",
    });
    expect(client.providers.blooio).toBe(provider);
    expect(client.providers.blooio.messages).toBe(provider.messages);
    expect(client.providers.blooio.capabilities).toBe(BLOOIO_CAPABILITIES);
  });

  it("accepts URL, image, video, and file attachments plus thread replies", async () => {
    const { provider } = createTestProvider();
    const client = createIMessageClient({ provider });

    await client.messages.send({
      conversationId: "conversation-1",
      text: "Attachments and a reply",
      replyTo: { messageId: "message-0", partIndex: 0 },
      attachments: [
        {
          kind: "image",
          source: { type: "url", url: "https://example.test/photo.jpg" },
          contentType: "image/jpeg",
        },
        {
          kind: "video",
          source: { type: "blob", data: new Blob(["video"]) },
          filename: "clip.mp4",
          contentType: "video/mp4",
        },
        {
          kind: "file",
          source: { type: "bytes", data: new Uint8Array([1, 2, 3]) },
          filename: "document.pdf",
          contentType: "application/pdf",
        },
      ],
    });
  });

  it("preserves a user-defined provider and its required methods", async () => {
    const { provider: baseProvider } = createTestProvider();
    const provider = defineProvider({
      ...baseProvider,
      name: "custom" as const,
      capabilities: {
        ...BLOOIO_CAPABILITIES,
        messages: {
          ...BLOOIO_CAPABILITIES.messages,
          get: true,
          edit: true,
        },
      } as const,
      messages: {
        ...baseProvider.messages,
        async get(message: { readonly conversationId: string; readonly messageId: string }) {
          void message;

          return createProviderMessage();
        },
        async edit(
          message: { readonly conversationId: string; readonly messageId: string },
          input: { readonly text: string },
        ) {
          void message;
          return createProviderMessage({ text: input.text });
        },
      },
    });
    const client = createIMessageClient({ provider });

    const locator = {
      conversationId: "conversation-1",
      messageId: "message-1",
    };
    const found = await client.providers.custom.messages.get(locator);
    const edited = await client.providers.custom.messages.edit(locator, {
      text: "Edited",
    });

    expectTypeOf(client.provider).toEqualTypeOf<"custom">();
    expectTypeOf<keyof typeof client.providers>().toEqualTypeOf<"custom">();
    expect(found?.providerMessageId).toBe("message-1");
    expect(edited.text).toBe("Edited");
  });

  it("preserves provider-specific methods directly on the provider", async () => {
    const { provider: baseProvider } = createTestProvider();
    const provider = defineProvider({
      ...baseProvider,
      async getLineStatus() {
        return "connected" as const;
      },
    });
    const client = createIMessageClient({
      connectionId: "extended-line",
      provider,
    });

    const status = await client.providers.blooio.getLineStatus();

    expectTypeOf(status).toEqualTypeOf<"connected">();
    expect(status).toBe("connected");
  });

  it("throws a typed error for an unsupported normalized operation", async () => {
    const { provider } = createTestProvider();
    const client = createIMessageClient({
      connectionId: "main-line",
      provider,
    });

    await expect(
      client.messages.edit(
        { conversationId: "conversation-1", messageId: "message-1" },
        { text: "Edited" },
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "UnsupportedCapabilityError",
        capability: "messages.edit",
        provider: "blooio",
        connectionId: "main-line",
      }),
    );
    await expect(
      client.messages.edit(
        { conversationId: "conversation-1", messageId: "message-1" },
        { text: "Edited" },
      ),
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  it("verifies and decorates webhook events", async () => {
    const { provider } = createTestProvider();
    const client = createIMessageClient({
      connectionId: "webhook-line",
      provider,
    });
    const request = new Request("https://example.test/webhooks/blooio", {
      method: "POST",
      headers: { "x-test-signature": "valid" },
      body: "{}",
    });

    const [event] = await client.webhooks.handle(request);

    expect(event).toMatchObject({
      id: "event-1",
      type: "message.received",
      provider: "blooio",
      connectionId: "webhook-line",
      message: {
        provider: "blooio",
        connectionId: "webhook-line",
      },
    });
  });

  it("closes idempotently and rejects later operations", async () => {
    const { close, provider } = createTestProvider();
    const client = createIMessageClient({
      connectionId: "main-line",
      provider,
    });

    await Promise.all([client.close(), client.close()]);

    expect(close).toHaveBeenCalledTimes(1);
    await expect(
      client.messages.send({ to: recipient, text: "Too late" }),
    ).rejects.toBeInstanceOf(ClientClosedError);
  });
});
