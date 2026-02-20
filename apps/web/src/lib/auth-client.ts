import { createAuthClient } from "better-auth/react";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://nosis-api.localhost:1355";

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    credentials: "include",
  },
});
