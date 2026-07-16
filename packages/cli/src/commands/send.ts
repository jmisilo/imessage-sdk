import { Option } from 'clipanion';
import { z } from 'zod';

import { isFallbackConversationId, UnsupportedCapabilityError } from 'imessage-sdk';

import type { SendCliInput } from '../input.js';
import { CliUsageError } from '../errors.js';
import {
  attachmentFromArgument,
  materializeSendInput,
  parseAddress,
  parseMetadata,
  readSendInput,
  readTextInput,
  SendCliInputSchema,
} from '../input.js';
import { ClientCommand } from './client-command.js';

const SENDBLUE_MAX_MESSAGE_LENGTH = 18_996;

export class SendCommand extends ClientCommand {
  static override paths = [['send']];

  static override usage = SendCommand.Usage({
    category: 'Messages',
    description: 'Send text and attachments through one iMessage provider connection.',
    examples: [
      ['Send a text message', "$0 send --provider blooio --to +15551234567 --text 'Hello'"],
      ['Read agent input from stdin', '$0 send --provider photon --input - --json'],
    ],
  });

  to = Option.Array('--to', { description: 'Recipient address. Repeat for multiple recipients.' });
  conversationId = Option.String('--conversation', {
    description: 'Provider-native conversation ID instead of --to.',
  });
  text = Option.String('--text', { description: 'Plain-text message body.' });
  textFile = Option.String('--text-file', {
    description: 'Read plain text from a file, or use - for stdin.',
  });
  images = Option.Array('--image', { description: 'Image URL or local path. Repeatable.' });
  videos = Option.Array('--video', { description: 'Video URL or local path. Repeatable.' });
  files = Option.Array('--file', { description: 'File URL or local path. Repeatable.' });
  replyTo = Option.String('--reply-to', { description: 'Provider-native message ID to reply to.' });
  replyPart = Option.String('--reply-part', {
    description: 'Non-negative part index for --reply-to.',
  });
  idempotencyKey = Option.String('--idempotency-key', {
    description: 'Provider idempotency key when supported.',
  });
  metadata = Option.Array('--metadata', {
    description: 'Metadata entry as key=value. Repeatable.',
  });
  inputPath = Option.String('--input', {
    description: 'Read the complete send input as JSON from a file, or use - for stdin.',
  });
  dryRun = Option.Boolean('--dry-run', false, {
    description: 'Validate and print the send intent without contacting the provider.',
  });

  async execute(): Promise<number> {
    return await this.action('send', async () => {
      const cliInput = await this.readInput();

      await this.withClient('api', async ({ client, providerName, connectionId }) => {
        this.validateCapabilities(client.capabilities, cliInput, providerName, connectionId);
        const sendInput = await materializeSendInput(cliInput);

        if (this.dryRun) {
          this.output().success(
            'send',
            { dryRun: true, input: sendInput },
            { provider: providerName, connectionId },
          );
          return;
        }

        const message = await client.messages.send(sendInput);
        this.output().success('send', message, { provider: providerName, connectionId });
      });
    });
  }

  private async readInput(): Promise<SendCliInput> {
    if (this.inputPath !== undefined) {
      if (this.hasInlineInput()) {
        throw new CliUsageError('--input cannot be combined with message-content options.');
      }
      return await readSendInput(this.inputPath, this.context.stdin);
    }

    if (this.text !== undefined && this.textFile !== undefined) {
      throw new CliUsageError('Use either --text or --text-file, not both.');
    }
    if (this.textFile === '-' && this.inputPath === '-') {
      throw new CliUsageError('stdin cannot be used for both --input and --text-file.');
    }

    const text =
      this.textFile === undefined
        ? this.text
        : await readTextInput(this.textFile, this.context.stdin);
    const attachments = [
      ...(this.images ?? []).map((value) => attachmentFromArgument('image', value)),
      ...(this.videos ?? []).map((value) => attachmentFromArgument('video', value)),
      ...(this.files ?? []).map((value) => attachmentFromArgument('file', value)),
    ];
    let partIndex: number | undefined;
    if (this.replyPart !== undefined) {
      if (this.replyTo === undefined) throw new CliUsageError('--reply-part requires --reply-to.');
      partIndex = Number(this.replyPart);
      if (!Number.isInteger(partIndex) || partIndex < 0) {
        throw new CliUsageError('--reply-part must be a non-negative integer.');
      }
    }
    const metadata = parseMetadata(this.metadata ?? []);
    const raw = {
      ...((this.to?.length ?? 0) === 0 ? {} : { to: this.to }),
      ...(this.conversationId === undefined ? {} : { conversationId: this.conversationId }),
      ...(text === undefined ? {} : { text }),
      ...(attachments.length === 0 ? {} : { attachments }),
      ...(this.replyTo === undefined
        ? {}
        : {
            replyTo: {
              messageId: this.replyTo,
              ...(partIndex === undefined ? {} : { partIndex }),
            },
          }),
      ...(this.idempotencyKey === undefined ? {} : { idempotencyKey: this.idempotencyKey }),
      ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
    };
    const parsed = SendCliInputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CliUsageError('Invalid send input.', parsed.error.issues);
    }
    return parsed.data;
  }

  private hasInlineInput(): boolean {
    return (
      this.to !== undefined ||
      this.conversationId !== undefined ||
      this.text !== undefined ||
      this.textFile !== undefined ||
      this.images !== undefined ||
      this.videos !== undefined ||
      this.files !== undefined ||
      this.replyTo !== undefined ||
      this.replyPart !== undefined ||
      this.idempotencyKey !== undefined ||
      this.metadata !== undefined
    );
  }

  private validateCapabilities(
    capabilities: {
      readonly messages: {
        readonly text: boolean;
        readonly attachments: boolean;
        readonly replies: boolean;
      };
      readonly conversations: { readonly direct: boolean; readonly groups: boolean };
    },
    input: SendCliInput,
    provider: string,
    connectionId: string,
  ): void {
    const unsupported = (capability: string): never => {
      throw new UnsupportedCapabilityError(capability, { provider, connectionId });
    };
    if (input.text !== undefined && !capabilities.messages.text) unsupported('messages.text');
    if ((input.attachments?.length ?? 0) > 0 && !capabilities.messages.attachments) {
      unsupported('messages.attachments');
    }
    if (input.replyTo !== undefined && !capabilities.messages.replies)
      unsupported('messages.replies');
    if (input.conversationId !== undefined && isFallbackConversationId(input.conversationId)) {
      throw new CliUsageError(
        'SDK fallback conversation IDs are diagnostic and cannot be used for provider operations.',
      );
    }
    const recipients = (
      input.to === undefined ? [] : Array.isArray(input.to) ? input.to : [input.to]
    ).map((recipient) => (typeof recipient === 'string' ? parseAddress(recipient) : recipient));
    if (recipients.length > 1 && !capabilities.conversations.groups) {
      unsupported('conversations.groups');
    }
    if (recipients.length === 1 && !capabilities.conversations.direct) {
      unsupported('conversations.direct');
    }
    if (
      provider === 'blooio' &&
      input.attachments?.some((attachment) => attachment.source.type === 'path') === true
    ) {
      throw new CliUsageError(
        'Blooio requires attachment URLs; local paths cannot be sent without an external upload step.',
      );
    }
    if (provider === 'sendblue') {
      if ((input.attachments?.length ?? 0) > 1) {
        throw new CliUsageError('Sendblue supports one attachment per direct message.');
      }
      if (input.idempotencyKey !== undefined) {
        throw new CliUsageError('Sendblue does not document idempotency keys.');
      }
      if (input.text !== undefined && input.text.length > SENDBLUE_MAX_MESSAGE_LENGTH) {
        throw new CliUsageError(
          `Sendblue message text must not exceed ${SENDBLUE_MAX_MESSAGE_LENGTH} characters.`,
        );
      }
      const recipient =
        input.conversationId === undefined
          ? recipients.length === 1
            ? recipients[0]
            : undefined
          : { kind: 'phone' as const, value: input.conversationId };
      if (
        recipient === undefined ||
        recipient.kind !== 'phone' ||
        !/^\+[1-9]\d{6,14}$/u.test(recipient.value)
      ) {
        throw new CliUsageError('Sendblue requires exactly one E.164 phone recipient.');
      }
    }
  }
}

export const SendCommandInputJsonSchema = {
  ...z.toJSONSchema(SendCliInputSchema),
  allOf: [
    {
      oneOf: [
        { required: ['to'], not: { required: ['conversationId'] } },
        { required: ['conversationId'], not: { required: ['to'] } },
      ],
    },
    {
      anyOf: [
        {
          required: ['text'],
          properties: { text: { type: 'string', pattern: '\\S' } },
        },
        {
          required: ['attachments'],
          properties: { attachments: { type: 'array', minItems: 1 } },
        },
      ],
    },
  ],
} as const;
