"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { authClient } from "@nosis/lib/auth-client";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();

  const isUnauthenticated = !(isPending || session);

  useEffect(() => {
    if (isUnauthenticated) {
      router.replace("/sign-in");
    }
  }, [isUnauthenticated, router]);

  if (isPending || !session) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <p className="text-muted text-sm">Loading...</p>
      </div>
    );
  }

  return children;
}
