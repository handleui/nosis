import { HTTPException } from "hono/http-exception";

const MAX_API_KEY_LENGTH = 500;
const MIN_API_KEY_LENGTH = 8;
const VALID_PROVIDERS: ReadonlySet<string> = new Set([
  "exa",
  "firecrawl",
  "letta",
]);

const MAX_TITLE_LENGTH = 500;
const MAX_CONTENT_LENGTH = 100_000;
const MAX_MODEL_LENGTH = 100;
const MAX_AGENT_ID_LENGTH = 200;
const MAX_TOKEN_COUNT = 10_000_000; // 10 M — well above any model's context window
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGENT_ID_REGEX = /^[a-zA-Z0-9._:-]+$/;

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

export function validateJsonBody(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    badRequest("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export async function parseJsonBody(c: {
  req: { json(): Promise<unknown> };
}): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    badRequest("Invalid JSON in request body");
  }
  return validateJsonBody(raw);
}

export function validateUuid(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !UUID_REGEX.test(value)) {
    badRequest(`Invalid ${field}: must be a valid UUID`);
  }
  return value;
}

export function validateTitle(value: unknown): string {
  if (typeof value !== "string") {
    badRequest("Title must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    badRequest("Title must not be empty");
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    badRequest(
      `Title exceeds maximum length of ${MAX_TITLE_LENGTH} characters`
    );
  }
  return trimmed;
}

export function validateRole(value: unknown): "user" | "assistant" | "system" {
  if (value !== "user" && value !== "assistant" && value !== "system") {
    badRequest("Invalid role: must be 'user', 'assistant', or 'system'");
  }
  return value;
}

export function validateContent(value: unknown): string {
  if (typeof value !== "string") {
    badRequest("Content must be a string");
  }
  if (value.trim().length === 0) {
    badRequest("Content must not be empty");
  }
  if (value.length > MAX_CONTENT_LENGTH) {
    badRequest(
      `Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`
    );
  }
  return value;
}

export function validateModel(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    badRequest("Model must be a string");
  }
  if (value.length > MAX_MODEL_LENGTH) {
    badRequest(
      `Model name exceeds maximum length of ${MAX_MODEL_LENGTH} characters`
    );
  }
  return value;
}

export function validateTokenCount(
  value: unknown,
  field: string
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    badRequest(`${field} must be an integer`);
  }
  if (value < 0) {
    badRequest(`${field} must be non-negative`);
  }
  if (value > MAX_TOKEN_COUNT) {
    badRequest(`${field} exceeds maximum of ${MAX_TOKEN_COUNT}`);
  }
  return value;
}

export function validateAgentId(value: unknown): string {
  if (typeof value !== "string") {
    badRequest("Agent ID must be a string");
  }
  if (value.length === 0 || value.length > MAX_AGENT_ID_LENGTH) {
    badRequest(`Agent ID must be 1-${MAX_AGENT_ID_LENGTH} characters`);
  }
  if (!AGENT_ID_REGEX.test(value)) {
    badRequest("Agent ID contains invalid characters");
  }
  return value;
}

export function validatePagination(
  limit: unknown,
  offset: unknown
): { limit: number; offset: number } {
  const parsedLimit = parsePageParam(limit, "limit", DEFAULT_PAGE_SIZE);
  const parsedOffset = parsePageParam(offset, "offset", 0);

  return {
    limit: Math.max(1, Math.min(parsedLimit, MAX_PAGE_SIZE)),
    offset: Math.max(0, parsedOffset),
  };
}

function parsePageParam(
  value: unknown,
  field: string,
  defaultValue: number
): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isInteger(n)) {
    badRequest(`${field} must be an integer`);
  }
  return n;
}

export type ApiProvider = "exa" | "firecrawl" | "letta";

export function validateProvider(value: unknown): ApiProvider {
  if (typeof value !== "string" || !VALID_PROVIDERS.has(value)) {
    badRequest(
      `Invalid provider: must be one of ${[...VALID_PROVIDERS].join(", ")}`
    );
  }
  return value as ApiProvider;
}

// ── MCP Server Validation ──

const MCP_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_MCP_NAME_LENGTH = 100;
const MAX_MCP_URL_LENGTH = 2000;
const VALID_MCP_AUTH_TYPES: ReadonlySet<string> = new Set(["none", "api_key"]);

// ── SSRF: Private / Reserved Network Detection ──

const BLOCKED_MCP_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "metadata.google.internal",
]);

function isPrivateMcpIPv4(hostname: string): boolean {
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

function isPrivateMcpIPv6(hostname: string): boolean {
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
  if (lower.startsWith("::ffff:") && isPrivateMcpIPv4(lower.slice(7))) {
    return true; // mapped IPv4
  }
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") {
    return true; // unspecified
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return true; // unique local address (ULA)
  }
  if (lower.startsWith("ff")) {
    return true; // multicast
  }

  return false;
}

function isBlockedMcpHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    BLOCKED_MCP_HOSTNAMES.has(lower) ||
    isPrivateMcpIPv4(lower) ||
    isPrivateMcpIPv6(lower)
  );
}

export type McpAuthType = "none" | "api_key";

export function validateMcpName(value: unknown): string {
  if (typeof value !== "string") {
    badRequest("MCP server name must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_MCP_NAME_LENGTH) {
    badRequest(`MCP server name must be 1-${MAX_MCP_NAME_LENGTH} characters`);
  }
  if (!MCP_NAME_REGEX.test(trimmed)) {
    badRequest(
      "MCP server name must contain only alphanumeric characters, hyphens, and underscores"
    );
  }
  return trimmed;
}

export function validateMcpUrl(value: unknown): string {
  if (typeof value !== "string") {
    badRequest("MCP server URL must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_MCP_URL_LENGTH) {
    badRequest(`MCP server URL must be 1-${MAX_MCP_URL_LENGTH} characters`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    badRequest("MCP server URL is not a valid URL");
  }

  // Reject embedded credentials
  if (parsed.username || parsed.password) {
    badRequest("MCP server URL must not contain credentials");
  }

  // Require HTTPS — no HTTP exceptions. MCP servers run on the public
  // internet; this is a Cloudflare Worker, not a desktop app, so "localhost"
  // loopback exceptions are SSRF vectors (localhost resolves to the Worker's
  // own network context / cloud metadata endpoints).
  if (parsed.protocol !== "https:") {
    badRequest("MCP server URL must use HTTPS");
  }

  // Block private / reserved hostnames and IPs (defense-in-depth against
  // DNS-rebinding or crafted URLs that resolve to internal services)
  if (isBlockedMcpHost(parsed.hostname)) {
    badRequest("MCP server URL must not target private or reserved addresses");
  }

  return trimmed;
}

export function validateMcpAuthType(value: unknown): McpAuthType {
  if (typeof value !== "string" || !VALID_MCP_AUTH_TYPES.has(value)) {
    badRequest("auth_type must be 'none' or 'api_key'");
  }
  return value as McpAuthType;
}

// ── API Key Validation ──

export function validateApiKeyInput(value: unknown): string {
  if (typeof value !== "string") {
    badRequest("apiKey must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length < MIN_API_KEY_LENGTH) {
    badRequest(`apiKey must be at least ${MIN_API_KEY_LENGTH} characters`);
  }
  if (trimmed.length > MAX_API_KEY_LENGTH) {
    badRequest(
      `apiKey exceeds maximum length of ${MAX_API_KEY_LENGTH} characters`
    );
  }
  return trimmed;
}
