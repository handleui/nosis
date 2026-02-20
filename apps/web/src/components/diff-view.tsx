"use client";

import { PatchDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";

const MOCK_PATCH = `diff --git a/apps/api/src/lib/scrub-secrets.ts b/apps/api/src/lib/scrub-secrets.ts
index 4a3e2f1..b7c9d4a 100644
--- a/apps/api/src/lib/scrub-secrets.ts
+++ b/apps/api/src/lib/scrub-secrets.ts
@@ -1,7 +1,9 @@
-import { createHash } from "node:crypto";
+import { createHash, randomUUID } from "node:crypto";
+import type { SecretPattern } from "@detent/parser";

 const SECRET_PATTERNS = [
 \t/ghp_[a-zA-Z0-9]{36}/g,
 \t/npm_[a-zA-Z0-9]{36}/g,
+\t/sk-[a-zA-Z0-9]{48}/g,
 ];
@@ -12,6 +14,8 @@ export function scrubSecrets(input: string): string {
   for (const pattern of SECRET_PATTERNS) {
     result = result.replace(pattern, (match) => {
       const hash = createHash("sha256").update(match).digest("hex").slice(0, 8);
-      return \`[REDACTED:\${hash}]\`;
+      const id = randomUUID().slice(0, 8);
+      return \`[REDACTED:\${hash}:\${id}]\`;
     });
   }
+  return result;
 }`;

export default function DiffView() {
  return (
    <WorkerPoolContextProvider
      highlighterOptions={{}}
      poolOptions={{
        workerFactory: () =>
          new Worker(new URL("../workers/diffs.worker.ts", import.meta.url), {
            type: "module",
          }),
      }}
    >
      <PatchDiff patch={MOCK_PATCH} />
    </WorkerPoolContextProvider>
  );
}
