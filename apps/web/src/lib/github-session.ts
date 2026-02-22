"use client";

import { authClient } from "@nosis/lib/auth-client";

export const REQUIRED_GITHUB_SCOPES = [
  "read:user",
  "user:email",
  "repo",
  "read:org",
] as const;

export async function closeCurrentSession(): Promise<void> {
  await authClient.signOut();
}

export async function beginGithubSignIn(callbackURL: string): Promise<void> {
  await authClient.signIn.social({
    provider: "github",
    callbackURL,
    errorCallbackURL: callbackURL,
    scopes: [...REQUIRED_GITHUB_SCOPES],
  });
}

export async function reconnectGithubSignIn(
  callbackURL: string
): Promise<void> {
  const socialLinkClient = authClient as typeof authClient & {
    linkSocial?: (input: {
      provider: "github";
      callbackURL: string;
      errorCallbackURL?: string;
      scopes?: string[];
    }) => Promise<unknown>;
    linkSocialAccount?: (input: {
      provider: "github";
      callbackURL: string;
      errorCallbackURL?: string;
      scopes?: string[];
    }) => Promise<unknown>;
  };

  let linkSocial:
    | ((input: {
        provider: "github";
        callbackURL: string;
        errorCallbackURL?: string;
        scopes?: string[];
      }) => Promise<unknown>)
    | null = null;

  if (typeof socialLinkClient.linkSocial === "function") {
    linkSocial = socialLinkClient.linkSocial;
  } else if (typeof socialLinkClient.linkSocialAccount === "function") {
    linkSocial = socialLinkClient.linkSocialAccount;
  }

  if (linkSocial) {
    const result = await linkSocial({
      provider: "github",
      callbackURL,
      errorCallbackURL: callbackURL,
      scopes: [...REQUIRED_GITHUB_SCOPES],
    });

    const hasError =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      Boolean((result as { error?: unknown }).error);
    if (!hasError) {
      return;
    }
  }

  try {
    await closeCurrentSession();
  } catch {
    // No active session is fine; continue with OAuth.
  }
  await beginGithubSignIn(callbackURL);
}
