export { IMessageAdapter } from './adapter.js';
export { createIMessageAdapter } from './factory.js';
export { IMessageFormatConverter } from './format.js';
export {
  decodeIMessageThreadId,
  encodeIMessageThreadId,
  IMESSAGE_THREAD_ID_PREFIX,
} from './thread-id.js';
export type {
  IMessageAdapterClient,
  IMessageAdapterMessage,
  IMessageAdapterOptions,
  IMessageThreadId,
} from './types.js';
