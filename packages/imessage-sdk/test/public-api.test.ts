import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ClientClosedError,
  createIMessageClient,
  defineProvider,
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
    },
    conversations: {
      async open(input) {
        return {
          providerConversationId: "conversation-1",
          participants: input.participants,
          raw: { source: "test" },
        };
      },
    },
    reactions: {
      async add() {},
      async remove() {},
    },
    typing: {
      async start() {},
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
  it("infers the concrete provider returned by the Blooio factory", async () => {
    const provider = blooio();
    const client = createIMessageClient({ provider });

    expectTypeOf(provider.name).toEqualTypeOf<"blooio">();
    expectTypeOf(client.provider).toEqualTypeOf<"blooio">();
    expectTypeOf(client.connectionId).toEqualTypeOf<"default">();
    expectTypeOf<keyof typeof client.providers>().toEqualTypeOf<"blooio">();
    expect(client.connectionId).toBe("default");
    expect(client.providers.blooio).toBe(provider);

    await expect(
      client.messages.send({ to: recipient, text: "Not implemented yet" }),
    ).rejects.toMatchObject({
      provider: "blooio",
      code: "provider_not_implemented",
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
        async get(_messageId: string) {
          void _messageId;

          return createProviderMessage();
        },
        async edit(_messageId: string, input: { readonly text: string }) {
          return createProviderMessage({ text: input.text });
        },
      },
    });
    const client = createIMessageClient({ provider });

    const found = await client.providers.custom.messages.get("message-1");
    const edited = await client.providers.custom.messages.edit("message-1", {
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
      client.messages.edit("message-1", { text: "Edited" }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "UnsupportedCapabilityError",
        capability: "messages.edit",
        provider: "blooio",
        connectionId: "main-line",
      }),
    );
    await expect(
      client.messages.edit("message-1", { text: "Edited" }),
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
