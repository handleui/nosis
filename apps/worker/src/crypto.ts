import { HTTPException } from "hono/http-exception";

const ALGORITHM = "AES-GCM";
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
/** Minimum raw ciphertext length: IV + at least 1 plaintext byte + GCM auth tag. */
const MIN_ENCRYPTED_BYTES = IV_BYTES + 1 + GCM_TAG_BYTES;
const KEY_USAGE: string[] = ["encrypt", "decrypt"];
const MIN_SECRET_LENGTH = 32;

async function deriveKey(secret: string, userId: string): Promise<CryptoKey> {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("nosis-user-api-keys-v1"),
      info: encoder.encode(`aes-gcm-encryption:${userId}`),
    },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    false,
    KEY_USAGE
  );
}

export async function encryptApiKey(
  secret: string,
  userId: string,
  plaintext: string
): Promise<string> {
  const key = await deriveKey(secret, userId);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Build binary string in chunks to avoid call-stack limits (spread) and
  // O(n^2) string concatenation (single-char loop). 8 KiB chunks keep each
  // String.fromCharCode call well within safe argument-count limits while
  // producing far fewer intermediate strings than the byte-at-a-time approach.
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < combined.length; i += CHUNK) {
    parts.push(String.fromCharCode(...combined.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(""));
}

export async function decryptApiKey(
  secret: string,
  userId: string,
  encrypted: string
): Promise<string> {
  // Derive key outside try/catch so config errors (e.g. short secret) propagate
  // as 500s rather than being swallowed into a misleading 422.
  const key = await deriveKey(secret, userId);

  try {
    const raw = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    if (raw.byteLength < MIN_ENCRYPTED_BYTES) {
      throw new Error("Ciphertext too short");
    }
    const iv = raw.slice(0, IV_BYTES);
    const ciphertext = raw.slice(IV_BYTES);
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new HTTPException(422, {
      message: "Stored API key is unreadable. Please re-enter your key.",
    });
  }
}
