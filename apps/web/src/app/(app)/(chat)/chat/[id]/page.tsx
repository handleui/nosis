import type { Metadata } from "next";
import ConversationPageClient from "./conversation-page-client";

export const metadata: Metadata = {
  title: "Conversation",
  description: "Continue an existing conversation thread.",
};

export default function ConversationPage() {
  return <ConversationPageClient />;
}
