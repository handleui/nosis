import { createAuthClient } from "better-auth/react";
import { API_URL as WORKER_API_URL } from "@nosis/lib/api-config";

export const authClient = createAuthClient({
  baseURL: WORKER_API_URL,
  fetchOptions: {
    credentials: "include",
  },
});
