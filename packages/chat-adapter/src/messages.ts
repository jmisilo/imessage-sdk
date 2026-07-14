import type { Attachment, Author } from 'chat';

import type { IMessageAddress, IMessageAttachment } from 'imessage-sdk';

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

export function attachmentToChat(attachment: IMessageAttachment): Attachment {
  return {
    type: attachment.kind,
    ...(attachment.url === undefined ? {} : { url: attachment.url }),
    ...(attachment.filename === undefined ? {} : { name: attachment.filename }),
    ...(attachment.contentType === undefined ? {} : { mimeType: attachment.contentType }),
    ...(attachment.size === undefined ? {} : { size: attachment.size }),
  };
}
