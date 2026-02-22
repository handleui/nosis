import type { Metadata } from "next";
import NewProjectPageClient from "./new-project-page-client";

export const metadata: Metadata = {
  title: "New Project",
  description: "Create a project and workspace for code chats.",
};

export default function CodeNewProjectPage() {
  return <NewProjectPageClient />;
}
