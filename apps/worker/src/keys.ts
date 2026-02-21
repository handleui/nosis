import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { decryptApiKey } from "./crypto";
import type { AppDatabase } from "./db";
import { userApiKeys } from "./schema";
import type { ApiProvider } from "./validate";

const PROVIDER_LABELS: Record<ApiProvider, string> = {
  daytona: "Daytona",
  exa: "Exa",
  firecrawl: "Firecrawl",
  letta: "Letta",
};

export async function resolveUserApiKey(
  db: AppDatabase,
  secret: string,
  userId: string,
  provider: ApiProvider
): Promise<string> {
  const row = await db
    .select({ encrypted_key: userApiKeys.encrypted_key })
    .from(userApiKeys)
    .where(
      and(eq(userApiKeys.user_id, userId), eq(userApiKeys.provider, provider))
    )
    .get();

  if (!row) {
    const label = PROVIDER_LABELS[provider];
    throw new HTTPException(422, {
      message: `${label} API key not configured. Add your key in Settings.`,
    });
  }

  return decryptApiKey(secret, userId, row.encrypted_key);
}
