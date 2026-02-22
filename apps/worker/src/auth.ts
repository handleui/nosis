import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { drizzle } from "drizzle-orm/d1";
// biome-ignore lint/performance/noNamespaceImport: Drizzle requires schema as namespace object
import * as schema from "./schema";
import type { Bindings } from "./types";

// D1 binding is per-request in Workers; createAuth must be called per-request
export function createAuth(env: Bindings) {
  const isProduction = env.ENVIRONMENT === "production";
  const kv = env.KV;
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    basePath: "/api/auth",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        scope: ["read:user", "user:email", "repo", "read:org"],
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh session daily
    },
    account: {
      // Cross-origin dev setup (nosis-web.localhost → nosis-api.localhost) prevents
      // the signed state cookie from being stored by the browser on the fetch() POST.
      // The D1 verification table still validates state; this only skips the cookie
      // CSRF double-check. In production, web + API share a parent domain so cookies work.
      skipStateCookieCheck: !isProduction,
    },
    ...(kv &&
      isProduction && {
        secondaryStorage: {
          get: (key: string) => kv.get(key),
          set: (key: string, value: string, ttl?: number) =>
            kv.put(
              key,
              value,
              ttl ? { expirationTtl: Math.max(60, ttl) } : undefined
            ),
          delete: (key: string) => kv.delete(key),
        },
        rateLimit: {
          enabled: true,
          window: 60, // KV minimum TTL is 60s
          max: 10,
        },
      }),
    trustedOrigins: isProduction
      ? ["tauri://localhost"]
      : [
          "tauri://localhost",
          "http://localhost:1420",
          "http://localhost:3000",
          "http://nosis-web.localhost:1355",
        ],
    advanced: {
      useSecureCookies: isProduction,
      // In dev, web (nosis-web.localhost) and API (nosis-api.localhost) are cross-site.
      // SameSite=None + Secure enables cross-site cookie set/send on fetch requests.
      // Chrome treats *.localhost as a secure context, so Secure cookies work over HTTP.
      // NOTE: Do NOT use `partitioned: true` here — CHIPS partitions cookies by top-level
      // site, so the session cookie set during the OAuth callback (top-level = nosis-api)
      // becomes invisible to cross-origin fetches from the web app (top-level = nosis-web).
      // In production, web + API share a parent domain → crossSubDomainCookies with
      // SameSite=Lax is preferred.
      ...(!isProduction && {
        defaultCookieAttributes: {
          sameSite: "none" as const,
          secure: true,
        },
      }),
    },
    ...(!isProduction && {
      onAPIError: {
        onError(error) {
          console.error("[Better Auth] underlying error:", error);
        },
      },
    }),
    plugins: [bearer()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
