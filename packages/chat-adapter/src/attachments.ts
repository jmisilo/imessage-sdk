import type { AdapterPostableMessage, Attachment, FileUpload } from 'chat';

import { extractFiles, extractPostableAttachments } from '@chat-adapter/shared';

import type {
  IMessageAttachmentInput,
  IMessageAttachmentKind,
  IMessageAttachmentSource,
} from 'imessage-sdk';

export async function attachmentsFromPostable(
  message: AdapterPostableMessage,
): Promise<readonly IMessageAttachmentInput[]> {
  const files = extractFiles(message);
  const attachments = extractPostableAttachments(message);
  return Promise.all([
    ...files.map(async (file) => attachmentFromFile(file)),
    ...attachments.map(async (attachment) => attachmentFromChatAttachment(attachment)),
  ]);
}

function attachmentFromFile(file: FileUpload): IMessageAttachmentInput {
  return compactAttachment({
    kind: kindFromContentType(file.mimeType),
    source: sourceFromData(file.data),
    filename: file.filename,
    ...(file.mimeType === undefined ? {} : { contentType: file.mimeType }),
  });
}

async function attachmentFromChatAttachment(
  attachment: Attachment,
): Promise<IMessageAttachmentInput> {
  let source: IMessageAttachmentSource;
  if (attachment.url) {
    source = { type: 'url', url: attachment.url };
  } else if (attachment.data) {
    source = sourceFromData(attachment.data);
  } else if (attachment.fetchData) {
    source = { type: 'bytes', data: await attachment.fetchData() };
  } else {
    throw new TypeError('iMessage attachments require a URL or data');
  }

  return compactAttachment({
    kind: attachment.type === 'audio' ? 'file' : attachment.type,
    source,
    ...(attachment.name === undefined ? {} : { filename: attachment.name }),
    ...(attachment.mimeType === undefined ? {} : { contentType: attachment.mimeType }),
  });
}

function compactAttachment(input: {
  kind: IMessageAttachmentKind;
  source: IMessageAttachmentSource;
  filename?: string;
  contentType?: string;
}): IMessageAttachmentInput {
  return {
    kind: input.kind,
    source: input.source,
    ...(input.filename === undefined ? {} : { filename: input.filename }),
    ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
  };
}

function sourceFromData(data: Buffer | Blob | ArrayBuffer): IMessageAttachmentSource {
  if (data instanceof Blob) return { type: 'blob', data };
  if (data instanceof Uint8Array) return { type: 'bytes', data };
  return { type: 'bytes', data: new Uint8Array(data) };
}

function kindFromContentType(contentType?: string): IMessageAttachmentKind {
  if (contentType?.startsWith('image/')) return 'image';
  if (contentType?.startsWith('video/')) return 'video';
  return 'file';
}
