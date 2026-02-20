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
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh session daily
    },
    ...(kv && {
      secondaryStorage: {
        get: (key: string) => kv.get(key),
        set: (key: string, value: string, ttl?: number) =>
          kv.put(key, value, ttl ? { expirationTtl: ttl } : undefined),
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
      : ["tauri://localhost", "http://localhost:1420", "http://localhost:3000"],
    advanced: {
      useSecureCookies: isProduction,
    },
    plugins: [bearer()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
