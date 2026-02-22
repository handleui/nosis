"use client";

import { useRef } from "react";
import { Github } from "iconoir-react";
import { useRouter } from "next/navigation";
import { Button } from "@nosis/ui/button";
import { authClient } from "@nosis/lib/auth-client";
import { beginGithubSignIn } from "@nosis/lib/github-session";

export default function SignInPageClient() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  const didRedirectRef = useRef(false);

  const isAuthenticated = !isPending && !!session;
  if (isAuthenticated && !didRedirectRef.current) {
    didRedirectRef.current = true;
    router.replace("/");
  }

  if (isPending || isAuthenticated) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <p className="text-muted text-sm">Loading...</p>
      </div>
    );
  }

  const handleSignIn = async () => {
    await beginGithubSignIn(`${window.location.origin}/`);
  };

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-2">
        <h1 className="font-semibold text-2xl">Nosis</h1>
        <p className="text-muted text-sm">Sign in to get started</p>
      </div>
      <Button className="gap-2" onClick={handleSignIn}>
        <Github className="size-4" />
        Sign in with GitHub
      </Button>
    </div>
  );
}
