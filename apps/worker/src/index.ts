import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

type Bindings = {
  ENVIRONMENT?: string;
};

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

export default app;
