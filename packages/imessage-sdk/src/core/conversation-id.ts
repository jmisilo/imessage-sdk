const FALLBACK_CONVERSATION_ID_PREFIX = "imsg-sdk-v1-";

interface FallbackConversationIdPayload {
  readonly message: string;
  readonly timestamp: string;
}

/**
 * Creates a diagnostic fallback when a provider message omits its native
 * conversation ID. Fallback IDs are stable for the same message and timestamp,
 * but are not provider-routable conversation handles.
 */
export function createFallbackConversationId(
  message: string,
  timestamp: Date,
): string {
  if (message.length === 0) {
    throw new TypeError("Fallback conversation message must not be empty.");
  }
  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError("Fallback conversation timestamp must be valid.");
  }

  const payload: FallbackConversationIdPayload = {
    message,
    timestamp: timestamp.toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${FALLBACK_CONVERSATION_ID_PREFIX}${encoded}`;
}

export function isFallbackConversationId(value: string): boolean {
  return value.startsWith(FALLBACK_CONVERSATION_ID_PREFIX);
}
