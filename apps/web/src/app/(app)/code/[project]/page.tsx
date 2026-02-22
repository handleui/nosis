import type { Metadata } from "next";
import CodeProjectPageClient from "./project-page-client";

export const metadata: Metadata = {
  title: "Project Threads",
  description: "Browse code threads for a project.",
};

export default function CodeProjectPage() {
  return <CodeProjectPageClient />;
}
