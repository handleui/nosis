import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { searchExa, validateSearchRequest } from "./exa";
import { scrapeUrl, validateScrapeRequest } from "./firecrawl";

const MAX_REQUEST_BYTES = 64 * 1024; // 64 KiB — plenty for a search query

interface Bindings {
  ENVIRONMENT?: string;
  EXA_API_KEY: string;
  FIRECRAWL_API_KEY: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.use(secureHeaders());

app.use(
  cors({
    origin: (origin, c) => {
      const allowed = ["tauri://localhost"];
      if (c.env.ENVIRONMENT !== "production") {
        allowed.push("http://localhost:1420");
      }
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86_400,
    credentials: false,
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

app.post(
  "/api/search",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new HTTPException(400, {
        message: "Invalid JSON in request body",
      });
    }
    const request = validateSearchRequest(raw);
    const results = await searchExa(c.env.EXA_API_KEY, request);
    return c.json(results);
  }
);

app.post(
  "/api/extract",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new HTTPException(400, {
        message: "Invalid JSON in request body",
      });
    }
    const request = validateScrapeRequest(raw);
    const result = await scrapeUrl(c.env.FIRECRAWL_API_KEY, request);
    return c.json(result);
  }
);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
