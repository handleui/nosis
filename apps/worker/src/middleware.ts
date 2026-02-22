import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createAuth } from "./auth";
import type { Auth } from "./auth";
import type { Bindings } from "./types";

export interface AuthUser {
  id: string;
  [key: string]: unknown;
}

export interface AuthVariables {
  user: AuthUser | null;
  session: Record<string, unknown> | null;
  auth: Auth;
}

// Defense-in-depth: reject user IDs with control characters (CRLF, null, etc.)
// to prevent header injection when the ID flows into HTTP headers like
// Arcade-User-ID. Only printable ASCII is allowed.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — detect injection via C0 controls / DEL
const HEADER_UNSAFE_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_USER_ID_LENGTH = 200;
const REQUIRED_GITHUB_SCOPES = [
  "read:user",
  "user:email",
  "repo",
  "read:org",
] as const;
const SCOPE_SPLIT_PATTERN = /[,\s]+/u;

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((scope): scope is string => typeof scope === "string");
  }

  if (typeof value === "string") {
    return value
      .split(SCOPE_SPLIT_PATTERN)
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }

  return [];
}

function isHeaderSafeUserId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= MAX_USER_ID_LENGTH &&
    !HEADER_UNSAFE_PATTERN.test(id)
  );
}

export const sessionMiddleware = createMiddleware<{
  Bindings: Bindings;
  Variables: AuthVariables;
}>(async (c, next) => {
  const auth = createAuth(c.env);
  c.set("auth", auth);
  const result = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  const rawUser = result?.user;
  if (
    rawUser &&
    typeof rawUser === "object" &&
    typeof rawUser.id === "string" &&
    isHeaderSafeUserId(rawUser.id)
  ) {
    c.set("user", rawUser as AuthUser);
  } else {
    c.set("user", null);
  }
  c.set("session", result?.session ?? null);
  await next();
});

export const requireAuth = createMiddleware<{
  Bindings: Bindings;
  Variables: AuthVariables;
}>(async (c, next) => {
  if (!c.get("user")) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  await next();
});

/** Extract the authenticated user ID. Must be called after requireAuth. */
export function getUserId(c: { get(key: "user"): AuthUser | null }): string {
  const user = c.get("user");
  if (!user) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  return user.id;
}

/** Retrieve the user's GitHub OAuth access token from Better Auth.
 *  Reuses the auth instance stored on context by sessionMiddleware to avoid
 *  constructing a second betterAuth instance per request. */
export async function getGithubToken(c: {
  get(key: "auth"): Auth;
  req: { raw: Request };
}): Promise<string> {
  const auth = c.get("auth");
  const result = (await auth.api.getAccessToken({
    body: { providerId: "github" },
    headers: c.req.raw.headers,
  })) as
    | {
        accessToken?: unknown;
        scopes?: unknown;
        scope?: unknown;
      }
    | undefined;
  if (!result?.accessToken) {
    throw new HTTPException(401, {
      message: "GitHub account not connected",
    });
  }

  const grantedScopes = new Set([
    ...parseScopes(result.scopes),
    ...parseScopes(result.scope),
  ]);
  if (grantedScopes.size > 0) {
    const missingScopes = REQUIRED_GITHUB_SCOPES.filter(
      (scope) => !grantedScopes.has(scope)
    );
    if (missingScopes.length > 0) {
      throw new HTTPException(403, {
        message: `GitHub token lacks required permissions: ${missingScopes.join(", ")}`,
      });
    }
  }

  if (
    typeof result.accessToken !== "string" ||
    result.accessToken.length === 0
  ) {
    throw new HTTPException(401, {
      message: "GitHub account not connected",
    });
  }

  return result.accessToken;
}
