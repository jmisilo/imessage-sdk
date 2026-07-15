/** Runtime feature declaration for one configured provider connection. */
export interface IMessageCapabilities {
  /** Optional for backward compatibility with providers defined before attachment downloads. */
  readonly attachments?: {
    readonly download: boolean;
  };
  readonly messages: {
    readonly text: boolean;
    readonly attachments: boolean;
    readonly replies: boolean;
    readonly get: boolean;
    readonly edit: boolean;
    readonly delete: boolean;
  };
  readonly conversations: {
    readonly direct: boolean;
    readonly groups: boolean;
    readonly get: boolean;
    readonly markRead: boolean;
  };
  readonly interactions: {
    readonly reactions: boolean;
    readonly typingStart: boolean;
    readonly typingStop: boolean;
    readonly readReceipts: boolean;
  };
  readonly events: {
    readonly webhooks: boolean;
    readonly stream: boolean;
  };
}
