import type { Logger } from 'chat';

import type {
  AnyIMessageProvider,
  DEFAULT_CONNECTION_ID,
  IMessageClient,
  Message,
} from 'imessage-sdk';

export interface IMessageThreadId<
  TProvider extends string = string,
  TConnectionId extends string = string,
> {
  readonly version: 1;
  readonly provider: TProvider;
  readonly connectionId: TConnectionId;
  readonly conversationId: string;
}

export interface IMessageAdapterOptions<
  TProvider extends AnyIMessageProvider,
  TConnectionId extends string = typeof DEFAULT_CONNECTION_ID,
> {
  readonly provider: TProvider;
  readonly connectionId?: TConnectionId;
  /** Overrides the Chat instance's global bot username. */
  readonly userName?: string;
  readonly logger?: Logger;
}

export type IMessageAdapterMessage<
  TProvider extends AnyIMessageProvider,
  TConnectionId extends string,
> = Message<TProvider['name'], TConnectionId>;

export type IMessageAdapterClient<
  TProvider extends AnyIMessageProvider,
  TConnectionId extends string,
> = IMessageClient<TProvider, TConnectionId>;
