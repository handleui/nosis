const API_KEY_PATTERN =
  /\b(sk-ant-|sk-|exa-|fc-|key-|letta-)[A-Za-z0-9_-]{8,}\b/g;
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

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "Unknown error";
}

/**
 * Strip a role string to safe alphanumeric/underscore/hyphen characters.
 * Throws 500 (internal) if empty after stripping — callers pass known literals.
 */
export function sanitizeRole(role: string): string {
  const safe = role
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
  if (!safe) {
    throw new Error("Invalid specialist role");
  }
  return safe;
}

/** Produce a safe, truncated string from an unknown error value for logging. */
export function sanitizeError(
  err: unknown,
  knownSecrets?: readonly string[]
): string {
  const redacted = redactSecrets(errorMessage(err), knownSecrets);
  return redacted.length > MAX_SANITIZED_LENGTH
    ? `${redacted.slice(0, MAX_SANITIZED_LENGTH)}...`
    : redacted;
}
