export interface IMessageSDKErrorOptions {
  readonly provider?: string;
  readonly connectionId?: string;
  readonly code?: string;
  readonly statusCode?: number;
  readonly retryable?: boolean;
  readonly retryAfter?: number;
  readonly traceId?: string;
  readonly raw?: unknown;
}

export class IMessageSDKError extends Error {
  readonly provider: string | undefined;
  readonly connectionId: string | undefined;
  readonly code: string | undefined;
  readonly statusCode: number | undefined;
  readonly retryable: boolean;
  readonly retryAfter: number | undefined;
  readonly traceId: string | undefined;
  readonly raw: unknown;

  constructor(message: string, options: IMessageSDKErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.provider = options.provider;
    this.connectionId = options.connectionId;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;
    this.traceId = options.traceId;
    this.raw = options.raw;
  }
}

export class ValidationError extends IMessageSDKError {}

export class UnsupportedCapabilityError extends IMessageSDKError {
  readonly capability: string;

  constructor(
    capability: string,
    options: Pick<IMessageSDKErrorOptions, "provider" | "connectionId"> = {},
  ) {
    super(`The selected provider does not support ${capability}.`, {
      ...options,
      code: "unsupported_capability",
    });
    this.capability = capability;
  }
}

export class WebhookVerificationError extends IMessageSDKError {
  constructor(
    options: Pick<IMessageSDKErrorOptions, "provider" | "connectionId"> = {},
  ) {
    super("Webhook signature verification failed.", {
      ...options,
      code: "webhook_verification_failed",
    });
  }
}

export class ClientClosedError extends IMessageSDKError {
  constructor(
    options: Pick<IMessageSDKErrorOptions, "provider" | "connectionId"> = {},
  ) {
    super("This iMessage client has already been closed.", {
      ...options,
      code: "client_closed",
    });
  }
}

