import type { Metadata } from "next";
import CodeSessionPageClient from "./code-session-page-client";

export const metadata: Metadata = {
  title: "Code Session",
  description: "Inspect and continue a code conversation thread.",
};

export default function CodeSessionPage() {
  return <CodeSessionPageClient />;
}
