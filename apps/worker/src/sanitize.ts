const API_KEY_PATTERN = /\b(sk-ant-|sk-)[A-Za-z0-9_-]{10,}\b/g;
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{40,}\b/g;
const MAX_SANITIZED_LENGTH = 500;

/**
 * Redact potential secrets from a string.
 * Accepts an optional list of known secret values for exact-match replacement
 * (guards against keys that don't match the generic patterns).
 */
export function redactSecrets(
  input: string,
  knownSecrets?: readonly string[]
): string {
  let result = input;

  if (knownSecrets) {
    for (const secret of knownSecrets) {
      if (secret && result.includes(secret)) {
        result = result.replaceAll(secret, "[REDACTED]");
      }
    }
  }

  return result
    .replace(API_KEY_PATTERN, "[REDACTED]")
    .replace(LONG_TOKEN_PATTERN, "[REDACTED]");
}

/** Produce a safe, truncated string from an unknown error value for logging. */
export function sanitizeError(
  err: unknown,
  knownSecrets?: readonly string[]
): string {
  let message = "Unknown error";
  if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === "string") {
    message = err;
  }

  const redacted = redactSecrets(message, knownSecrets);
  return redacted.length > MAX_SANITIZED_LENGTH
    ? `${redacted.slice(0, MAX_SANITIZED_LENGTH)}...`
    : redacted;
}
