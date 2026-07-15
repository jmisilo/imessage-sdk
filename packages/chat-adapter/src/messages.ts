import type { Attachment, Author } from 'chat';

import { z } from 'zod';

import type { IMessageAddress, IMessageAttachment } from 'imessage-sdk';

const AttachmentFetchMetadataSchema = z.object({
  provider: z.string().min(1),
  connectionId: z.string().min(1),
  attachmentId: z.string().min(1),
});

export interface AttachmentDownloadOptions {
  readonly provider: string;
  readonly connectionId: string;
  download(attachmentId: string): Promise<Uint8Array>;
}

export function authorFromAddress(address: IMessageAddress, isMe: boolean): Author {
  return {
    userId: address.value,
    userName: address.value,
    fullName: address.value,
    isBot: isMe,
    isMe,
  };
}

export function addressFromUserId(userId: string): IMessageAddress {
  const value = userId.trim();
  if (!value) throw new TypeError('iMessage user ID must not be empty');

  if (value.startsWith('phone:')) return prefixedAddress('phone', value.slice(6));
  if (value.startsWith('email:')) return prefixedAddress('email', value.slice(6));
  return { kind: value.includes('@') ? 'email' : 'phone', value };
}

function prefixedAddress(kind: IMessageAddress['kind'], value: string): IMessageAddress {
  if (!value) throw new TypeError(`iMessage ${kind} address must not be empty`);
  return { kind, value };
}

export function attachmentToChat(
  attachment: IMessageAttachment,
  downloadOptions?: AttachmentDownloadOptions,
): Attachment {
  const downloadable =
    attachment.url === undefined && attachment.id !== undefined && downloadOptions !== undefined
      ? downloadableFields(attachment.id, downloadOptions)
      : {};
  return {
    type: attachment.kind,
    ...(attachment.url === undefined ? {} : { url: attachment.url }),
    ...(attachment.filename === undefined ? {} : { name: attachment.filename }),
    ...(attachment.contentType === undefined ? {} : { mimeType: attachment.contentType }),
    ...(attachment.size === undefined ? {} : { size: attachment.size }),
    ...downloadable,
  };
}

export function rehydrateIMessageAttachment(
  attachment: Attachment,
  downloadOptions?: AttachmentDownloadOptions,
): Attachment {
  if (downloadOptions === undefined) return attachment;
  const parsed = AttachmentFetchMetadataSchema.safeParse(attachment.fetchMetadata);
  if (!parsed.success) return attachment;
  if (
    parsed.data.provider !== downloadOptions.provider ||
    parsed.data.connectionId !== downloadOptions.connectionId
  ) {
    return attachment;
  }
  return {
    ...attachment,
    ...downloadableFields(parsed.data.attachmentId, downloadOptions),
  };
}

function downloadableFields(
  attachmentId: string,
  options: AttachmentDownloadOptions,
): Pick<Attachment, 'fetchData' | 'fetchMetadata'> {
  return {
    fetchData: async () => Buffer.from(await options.download(attachmentId)),
    fetchMetadata: {
      provider: options.provider,
      connectionId: options.connectionId,
      attachmentId,
    },
  };
}
