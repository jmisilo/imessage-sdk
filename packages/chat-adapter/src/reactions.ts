import type { EmojiValue } from 'chat';

import { ValidationError } from '@chat-adapter/shared';
import { getEmoji } from 'chat';

import type { IMessageReaction } from 'imessage-sdk';

const REACTION_ALIASES: Readonly<Record<string, IMessageReaction>> = {
  love: 'love',
  heart: 'love',
  '❤': 'love',
  '❤️': 'love',
  like: 'like',
  thumbs_up: 'like',
  thumbsup: 'like',
  '+1': 'like',
  '👍': 'like',
  dislike: 'dislike',
  thumbs_down: 'dislike',
  thumbsdown: 'dislike',
  '-1': 'dislike',
  '👎': 'dislike',
  laugh: 'laugh',
  joy: 'laugh',
  haha: 'laugh',
  '😂': 'laugh',
  emphasize: 'emphasize',
  bangbang: 'emphasize',
  exclamation: 'emphasize',
  '!!': 'emphasize',
  '‼️': 'emphasize',
  question: 'question',
  '?': 'question',
  '❓': 'question',
};

const CHAT_REACTION_NAMES: Readonly<Record<IMessageReaction, string>> = {
  love: 'heart',
  like: 'thumbs_up',
  dislike: 'thumbs_down',
  laugh: 'joy',
  emphasize: 'bangbang',
  question: 'question',
};

export function toIMessageReaction(emoji: EmojiValue | string): IMessageReaction {
  const value = (typeof emoji === 'string' ? emoji : emoji.name).trim().toLowerCase();
  const reaction = REACTION_ALIASES[value];
  if (!reaction) {
    throw new ValidationError('imessage', `Unsupported iMessage reaction: ${value}`);
  }
  return reaction;
}

export function toChatEmoji(reaction: IMessageReaction): EmojiValue {
  return getEmoji(CHAT_REACTION_NAMES[reaction]);
}
