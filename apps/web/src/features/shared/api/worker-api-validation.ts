const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;
const WHITESPACE_RE = /\s/;

export function assertUuid(value: string, field = "ID"): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid ${field}`);
  }
}

export function assertPathSegment(value: string, field: string): void {
  if (!value || value.length > 200) {
    throw new Error(`Invalid ${field}`);
  }
  if (!PATH_SEGMENT_RE.test(value)) {
    throw new Error(`Invalid ${field}`);
  }
}

export function assertBranchName(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255 || WHITESPACE_RE.test(trimmed)) {
    throw new Error(`Invalid ${field}`);
  }
  return trimmed;
}

export function safePagination(
  limit: number,
  offset: number,
  maxLimit = 200
): { limit: number; offset: number } {
  return {
    limit: Math.max(1, Math.min(Math.floor(limit), maxLimit)),
    offset: Math.max(0, Math.floor(offset)),
  };
}
