import type { AnyIMessageProvider } from 'imessage-sdk';
import { DEFAULT_CONNECTION_ID } from 'imessage-sdk';

import type { IMessageAdapterOptions } from './types.js';
import { IMessageAdapter } from './adapter.js';

export function createIMessageAdapter<
  const TProvider extends AnyIMessageProvider,
  const TConnectionId extends string = typeof DEFAULT_CONNECTION_ID,
>(
  options: IMessageAdapterOptions<TProvider, TConnectionId>,
): IMessageAdapter<TProvider, TConnectionId> {
  return new IMessageAdapter(options);
}
