import { HTTPException } from "hono/http-exception";
import type {
  SearchCategory,
  SearchRequest,
  SearchResponse,
  SearchResult,
  SearchType,
} from "./types";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const MAX_QUERY_LENGTH = 2000;
const MAX_NUM_RESULTS = 100;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MiB

const VALID_SEARCH_TYPES: ReadonlySet<string> = new Set<SearchType>([
  "neural",
  "fast",
  "auto",
  "deep",
]);

const VALID_CATEGORIES: ReadonlySet<string> = new Set<SearchCategory>([
  "company",
  "research paper",
  "news",
  "pdf",
  "github",
  "tweet",
  "personal site",
  "financial report",
  "people",
]);

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

function validateQuery(value: unknown): string {
  if (typeof value !== "string") {
    badRequest("query must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    badRequest("Search query must not be empty");
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    badRequest(
      `Search query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`
    );
  }
  return trimmed;
}

function validateNumResults(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    badRequest("numResults must be an integer");
  }
  if (value < 1 || value > MAX_NUM_RESULTS) {
    badRequest(`numResults must be between 1 and ${MAX_NUM_RESULTS}`);
  }
  return value;
}

function validateEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: ReadonlySet<string>
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.has(value)) {
    badRequest(`${fieldName} must be one of: ${[...allowed].join(", ")}`);
  }
  return value as T;
}

function validateContents(value: unknown): { text?: boolean } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    badRequest("contents must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.text !== undefined && typeof raw.text !== "boolean") {
    badRequest("contents.text must be a boolean");
  }
  return raw.text !== undefined ? { text: raw.text as boolean } : {};
}

export function validateSearchRequest(body: unknown): SearchRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  const clean: SearchRequest = {
    query: validateQuery(raw.query),
  };

  const numResults = validateNumResults(raw.numResults);
  if (numResults !== undefined) {
    clean.numResults = numResults;
  }

  const type = validateEnum<SearchType>(raw.type, "type", VALID_SEARCH_TYPES);
  if (type !== undefined) {
    clean.type = type;
  }

  const category = validateEnum<SearchCategory>(
    raw.category,
    "category",
    VALID_CATEGORIES
  );
  if (category !== undefined) {
    clean.category = category;
  }

  const contents = validateContents(raw.contents);
  if (contents !== undefined) {
    clean.contents = contents;
  }

  return clean;
}

function badUpstream(): never {
  throw new HTTPException(502, { message: "Unexpected response from Exa" });
}

function validateSearchResult(item: unknown): SearchResult {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    badUpstream();
  }

  const r = item as Record<string, unknown>;

  if (typeof r.id !== "string" || typeof r.url !== "string") {
    badUpstream();
  }

  return {
    id: r.id,
    url: r.url,
    title: typeof r.title === "string" ? r.title : null,
    publishedDate: typeof r.publishedDate === "string" ? r.publishedDate : null,
    author: typeof r.author === "string" ? r.author : null,
    text: typeof r.text === "string" ? r.text : null,
    highlights: Array.isArray(r.highlights)
      ? r.highlights.filter((h): h is string => typeof h === "string")
      : null,
    score: typeof r.score === "number" ? r.score : null,
  };
}

function validateSearchResponse(data: unknown): SearchResponse {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    badUpstream();
  }

  const raw = data as Record<string, unknown>;

  if (!Array.isArray(raw.results)) {
    badUpstream();
  }

  return {
    results: raw.results.map(validateSearchResult),
    requestId: typeof raw.requestId === "string" ? raw.requestId : null,
  };
}

const EXA_FETCH_TIMEOUT_MS = 15_000;

async function fetchFromExa(
  apiKey: string,
  request: SearchRequest
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXA_FETCH_TIMEOUT_MS);

  try {
    return await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new HTTPException(504, { message: "Exa request timed out" });
    }
    throw new HTTPException(502, { message: "Exa search request failed" });
  } finally {
    clearTimeout(timeout);
  }
}

function handleExaErrorStatus(status: number): never {
  if (status === 401) {
    throw new HTTPException(401, { message: "Invalid Exa API key" });
  }
  if (status === 429) {
    throw new HTTPException(429, { message: "Exa rate limit exceeded" });
  }
  throw new HTTPException(502, { message: "Exa search request failed" });
}

function throwResponseTooLarge(): never {
  throw new HTTPException(502, {
    message: "Exa response exceeded size limit",
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

export async function searchExa(
  apiKey: string,
  request: SearchRequest
): Promise<SearchResponse> {
  const response = await fetchFromExa(apiKey, request);

  if (!response.ok) {
    handleExaErrorStatus(response.status);
  }

  const parsed = await readResponseBody(response);
  return validateSearchResponse(parsed);
}
