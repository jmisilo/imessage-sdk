import {
  AmbiguousDeliveryError,
  AuthenticationError,
  ConflictError,
  IMessageSDKError,
  NotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  UnsupportedCapabilityError,
  ValidationError,
  WebhookVerificationError,
} from 'imessage-sdk';

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details: unknown;

  constructor(
    message: string,
    options: {
      readonly code: string;
      readonly exitCode?: number;
      readonly details?: unknown;
      readonly cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.exitCode = options.exitCode ?? 2;
    this.details = options.details;
  }
}

export class CliUsageError extends CliError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'invalid_cli_input', details });
  }
}

export class ConfigError extends CliError {
  constructor(message: string, details?: unknown) {
    const cause =
      typeof details === 'object' && details !== null && 'cause' in details
        ? details.cause
        : undefined;
    super(message, {
      code: 'invalid_config',
      details,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export class CredentialStoreUnavailableError extends CliError {
  constructor(message: string, details?: unknown) {
    const cause =
      typeof details === 'object' && details !== null && 'cause' in details
        ? details.cause
        : undefined;
    super(message, {
      code: 'credential_store_unavailable',
      details,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export interface SerializedCliError {
  readonly type: string;
  readonly code: string;
  readonly message: string;
  readonly provider?: string;
  readonly connectionId?: string;
  readonly retryable: boolean;
  readonly retryAfter?: number;
  readonly statusCode?: number;
  readonly traceId?: string;
  readonly deliveryAmbiguous: boolean;
  readonly safeToRetry: boolean;
  readonly details?: unknown;
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof AmbiguousDeliveryError) return 6;
  if (error instanceof AuthenticationError) return 3;
  if (error instanceof RateLimitError || error instanceof ProviderUnavailableError) return 5;
  if (
    error instanceof UnsupportedCapabilityError ||
    error instanceof NotFoundError ||
    error instanceof ConflictError ||
    error instanceof WebhookVerificationError
  ) {
    return 4;
  }
  if (error instanceof ValidationError) return 2;
  return 1;
}

export function serializeCliError(error: unknown): SerializedCliError {
  const sdkError = error instanceof IMessageSDKError ? error : undefined;
  const cliError = error instanceof CliError ? error : undefined;
  const ambiguous = error instanceof AmbiguousDeliveryError;
  const message = error instanceof Error ? error.message : 'An unknown error occurred.';

  return {
    type: error instanceof Error ? error.name : 'UnknownError',
    code: cliError?.code ?? sdkError?.code ?? 'internal_error',
    message,
    ...(sdkError?.provider === undefined ? {} : { provider: sdkError.provider }),
    ...(sdkError?.connectionId === undefined ? {} : { connectionId: sdkError.connectionId }),
    retryable: sdkError?.retryable ?? false,
    ...(sdkError?.retryAfter === undefined ? {} : { retryAfter: sdkError.retryAfter }),
    ...(sdkError?.statusCode === undefined ? {} : { statusCode: sdkError.statusCode }),
    ...(sdkError?.traceId === undefined ? {} : { traceId: sdkError.traceId }),
    deliveryAmbiguous: ambiguous,
    safeToRetry: (sdkError?.retryable ?? false) && !ambiguous,
    ...(cliError?.details === undefined ? {} : { details: cliError.details }),
  };
}
