import { API_URL } from "@nosis/lib/api-config";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function toApiErrorMessage(body: unknown): string {
  const isErrorObj =
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as Record<string, unknown>).error === "string";
  return isErrorObj ? (body as { error: string }).error : "Request failed";
}

export async function workerFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  const headers = new Headers(options?.headers);
  if (options?.body !== undefined && options.body !== null) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      credentials: "include",
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(408, "Request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body: unknown = await response
      .json()
      .catch(() => ({ error: "Request failed" }));
    throw new ApiError(response.status, toApiErrorMessage(body));
  }

  return response;
}

export async function workerJson<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await workerFetch(path, options);
  return (await response.json()) as T;
}
