import type { Readable } from 'node:stream';

import { createReadStream } from 'node:fs';
import { basename } from 'node:path';

import { z } from 'zod';

import type {
  IMessageAddress,
  IMessageAttachmentInput,
  IMessageAttachmentKind,
  SendMessageInput,
} from 'imessage-sdk';

import { CliUsageError } from './errors.js';

const MAX_TEXT_INPUT_BYTES = 1024 * 1024;
export const MAX_LOCAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export const AddressSchema = z.object({
  kind: z.enum(['phone', 'email']),
  value: z.string().trim().min(1),
});

const AddressInputSchema = z.union([AddressSchema, z.string().trim().min(1)]);

const PublicHttpUrlSchema = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  },
  { message: 'Attachment URLs must use HTTP or HTTPS.' },
);

export const CliAttachmentSchema = z.object({
  kind: z.enum(['image', 'video', 'file']),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('url'), url: PublicHttpUrlSchema }),
    z.object({ type: z.literal('path'), path: z.string().min(1) }),
  ]),
  filename: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
});

export const SendCliInputSchema = z
  .object({
    to: z.union([AddressInputSchema, z.array(AddressInputSchema).min(1)]).optional(),
    conversationId: z.string().trim().min(1).optional(),
    text: z.string().optional(),
    attachments: z.array(CliAttachmentSchema).optional(),
    replyTo: z
      .object({
        messageId: z.string().trim().min(1),
        partIndex: z.number().int().nonnegative().optional(),
      })
      .optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((value, context) => {
    if ((value.to === undefined) === (value.conversationId === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Provide exactly one destination: to or conversationId.',
        path: ['to'],
      });
    }
    if ((value.text?.trim().length ?? 0) === 0 && (value.attachments?.length ?? 0) === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Provide non-empty text and/or at least one attachment.',
        path: ['text'],
      });
    }
  });

export type SendCliInput = z.infer<typeof SendCliInputSchema>;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  gif: 'image/gif',
  heic: 'image/heic',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain',
  webp: 'image/webp',
};

export function parseAddress(value: string): IMessageAddress {
  const trimmed = value.trim();
  const address = trimmed.startsWith('phone:')
    ? { kind: 'phone' as const, value: trimmed.slice(6) }
    : trimmed.startsWith('email:')
      ? { kind: 'email' as const, value: trimmed.slice(6) }
      : { kind: trimmed.includes('@') ? ('email' as const) : ('phone' as const), value: trimmed };
  if (address.value.trim().length === 0) {
    throw new CliUsageError('Message addresses must not be empty.');
  }
  return { ...address, value: address.value.trim() };
}

function contentTypeFor(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase();
  return extension === undefined ? undefined : CONTENT_TYPES[extension];
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function attachmentFromArgument(
  kind: IMessageAttachmentKind,
  value: string,
): z.input<typeof CliAttachmentSchema> {
  return isUrl(value)
    ? { kind, source: { type: 'url', url: value } }
    : { kind, source: { type: 'path', path: value } };
}

async function materializeAttachment(
  attachment: z.infer<typeof CliAttachmentSchema>,
  maxBytes: number,
): Promise<IMessageAttachmentInput> {
  if (attachment.source.type === 'url') {
    return {
      kind: attachment.kind,
      source: { type: 'url', url: attachment.source.url },
      ...(attachment.filename === undefined ? {} : { filename: attachment.filename }),
      ...(attachment.contentType === undefined ? {} : { contentType: attachment.contentType }),
    };
  }

  let data: Uint8Array;
  try {
    data = await readBytes(createReadStream(attachment.source.path), maxBytes);
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read attachment ${attachment.source.path}.`, {
      cause: error,
    });
  }
  const contentType = attachment.contentType ?? contentTypeFor(attachment.source.path);
  return {
    kind: attachment.kind,
    source: { type: 'bytes', data },
    filename: attachment.filename ?? basename(attachment.source.path),
    ...(contentType === undefined ? {} : { contentType }),
  };
}

function normalizeAddress(value: z.infer<typeof AddressInputSchema>): IMessageAddress {
  return typeof value === 'string' ? parseAddress(value) : value;
}

export async function materializeSendInput(input: SendCliInput): Promise<SendMessageInput> {
  const attachments: IMessageAttachmentInput[] = [];
  let remainingAttachmentBytes = MAX_LOCAL_ATTACHMENT_BYTES;
  for (const attachment of input.attachments ?? []) {
    const materialized = await materializeAttachment(attachment, remainingAttachmentBytes);
    attachments.push(materialized);
    if (materialized.source.type === 'bytes') {
      remainingAttachmentBytes -= materialized.source.data.byteLength;
    }
  }
  const to =
    input.to === undefined
      ? undefined
      : Array.isArray(input.to)
        ? input.to.map(normalizeAddress)
        : normalizeAddress(input.to);

  const content = {
    ...(input.text === undefined ? {} : { text: input.text }),
    ...(attachments.length === 0 ? {} : { attachments }),
  };
  const extras = {
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };

  return (
    input.conversationId === undefined
      ? {
          to: to as IMessageAddress | readonly [IMessageAddress, ...IMessageAddress[]],
          ...content,
          ...extras,
        }
      : { conversationId: input.conversationId, ...content, ...extras }
  ) as SendMessageInput;
}

async function readBytes(stream: Readable, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > limit) throw new CliUsageError(`Input exceeds the ${limit}-byte limit.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

export async function readTextInput(path: string, stdin: Readable): Promise<string> {
  try {
    const bytes = await readBytes(
      path === '-' ? stdin : createReadStream(path),
      MAX_TEXT_INPUT_BYTES,
    );
    return Buffer.from(bytes).toString('utf8');
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read input from ${path}.`, { cause: error });
  }
}

export async function readSendInput(path: string, stdin: Readable): Promise<SendCliInput> {
  const source = await readTextInput(path, stdin);
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new CliUsageError('Send input is not valid JSON.', { cause: error });
  }

  const result = SendCliInputSchema.safeParse(raw);
  if (!result.success) {
    throw new CliUsageError('Send input does not match the command schema.', result.error.issues);
  }
  return result.data;
}

export function parseMetadata(values: readonly string[]): Readonly<Record<string, string>> {
  const metadata: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf('=');
    if (separator < 1)
      throw new CliUsageError(`Invalid metadata entry: ${value}. Expected key=value.`);
    metadata[value.slice(0, separator)] = value.slice(separator + 1);
  }
  return metadata;
}
