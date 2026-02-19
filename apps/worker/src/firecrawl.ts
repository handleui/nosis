import { HTTPException } from "hono/http-exception";
import type { ScrapeRequest, ScrapeResponse } from "./types";

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MiB
const MAX_UPSTREAM_ERROR_LENGTH = 200;

// ── Private / Reserved Network Detection (defense-in-depth against SSRF via Firecrawl) ──

const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "metadata.google.internal",
]);

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    return false;
  }

  const [a, b] = octets;

  if (a === 127) {
    return true; // 127.0.0.0/8 loopback
  }
  if (a === 10) {
    return true; // 10.0.0.0/8 private
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true; // 172.16.0.0/12 private
  }
  if (a === 192 && b === 168) {
    return true; // 192.168.0.0/16 private
  }
  if (a === 169 && b === 254) {
    return true; // 169.254.0.0/16 link-local / cloud metadata
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true; // 100.64.0.0/10 CGNAT
  }
  if (a === 0) {
    return true; // 0.0.0.0/8
  }

  return false;
}

function isPrivateIPv6(hostname: string): boolean {
  const raw =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  const lower = raw.toLowerCase();

  if (lower === "::1") {
    return true; // loopback
  }
  if (lower.startsWith("fe80:") || lower.startsWith("fe80%")) {
    return true; // link-local
  }
  if (lower.startsWith("::ffff:") && isPrivateIPv4(lower.slice(7))) {
    return true; // mapped IPv4
  }

  return false;
}

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    BLOCKED_HOSTNAMES.has(lower) || isPrivateIPv4(lower) || isPrivateIPv6(lower)
  );
}

// ── Input Validation ──

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

function validateUrl(value: unknown): string {
  if (typeof value !== "string") {
    badRequest("url must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    badRequest("url must not be empty");
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    badRequest(`url exceeds maximum length of ${MAX_URL_LENGTH} characters`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    badRequest("url is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    badRequest("url must use http or https protocol");
  }

  if (parsed.username || parsed.password) {
    badRequest("url must not contain credentials");
  }

  if (isBlockedHost(parsed.hostname)) {
    badRequest("url must not target private or reserved addresses");
  }

  return trimmed;
}

export function validateScrapeRequest(body: unknown): ScrapeRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  return { url: validateUrl(raw.url) };
}

// ── Output Validation ──

function badUpstream(): never {
  throw new HTTPException(502, {
    message: "Unexpected response from Firecrawl",
  });
}

/** Sanitize an upstream error string: truncate and strip control characters. */
function sanitizeUpstreamError(raw: string): string {
  const truncated =
    raw.length > MAX_UPSTREAM_ERROR_LENGTH
      ? `${raw.slice(0, MAX_UPSTREAM_ERROR_LENGTH)}...`
      : raw;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — strip C0 controls and DEL
  return truncated.replace(/[\u0000-\u001f\u007f]/g, "");
}

function validateScrapeResponse(data: unknown): ScrapeResponse {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    badUpstream();
  }

  const raw = data as Record<string, unknown>;

  if (raw.success === false) {
    const msg =
      typeof raw.error === "string"
        ? sanitizeUpstreamError(raw.error)
        : "Unknown Firecrawl error";
    throw new HTTPException(502, { message: `Firecrawl error: ${msg}` });
  }

  if (raw.success !== true || raw.data === null || raw.data === undefined) {
    badUpstream();
  }

  const d = raw.data as Record<string, unknown>;

  if (typeof d.markdown !== "string") {
    badUpstream();
  }

  const meta =
    d.metadata !== null && typeof d.metadata === "object"
      ? (d.metadata as Record<string, unknown>)
      : {};

  return {
    markdown: d.markdown,
    title: typeof meta.title === "string" ? meta.title : null,
    sourceURL: typeof meta.sourceURL === "string" ? meta.sourceURL : "",
  };
}

// ── Fetch Logic ──

const FIRECRAWL_FETCH_TIMEOUT_MS = 25_000; // 25 s — allows JS rendering, under Workers' 30 s limit

async function fetchFromFirecrawl(
  apiKey: string,
  request: ScrapeRequest
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    FIRECRAWL_FETCH_TIMEOUT_MS
  );

  try {
    return await fetch(FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: request.url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new HTTPException(504, {
        message: "Firecrawl request timed out",
      });
    }
    throw new HTTPException(502, {
      message: "Firecrawl scrape request failed",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function handleFirecrawlErrorStatus(status: number): never {
  if (status === 401 || status === 403) {
    throw new HTTPException(401, { message: "Invalid Firecrawl API key" });
  }
  if (status === 402) {
    throw new HTTPException(402, {
      message: "Firecrawl usage limit reached",
    });
  }
  if (status === 429) {
    throw new HTTPException(429, {
      message: "Firecrawl rate limit exceeded",
    });
  }
  if (status === 408 || status === 504) {
    throw new HTTPException(504, {
      message: "Firecrawl timed out scraping the page",
    });
  }
  throw new HTTPException(502, {
    message: "Firecrawl scrape request failed",
  });
}

function throwResponseTooLarge(): never {
  throw new HTTPException(502, {
    message: "Firecrawl response exceeded size limit",
  });
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("Content-Length");
  if (
    contentLength &&
    Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES
  ) {
    throwResponseTooLarge();
  }

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throwResponseTooLarge();
  }

  try {
    return JSON.parse(text);
  } catch {
    badUpstream();
  }
}

export async function scrapeUrl(
  apiKey: string,
  request: ScrapeRequest
): Promise<ScrapeResponse> {
  const response = await fetchFromFirecrawl(apiKey, request);

  if (!response.ok) {
    handleFirecrawlErrorStatus(response.status);
  }

  const parsed = await readResponseBody(response);
  return validateScrapeResponse(parsed);
}
