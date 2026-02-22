import type { Metadata } from "next";
import ChatHomeClient from "./chat/chat-home-client";

export const metadata: Metadata = {
  title: "Chat",
  description: "Start a new chat thread.",
};

export default function ChatHome() {
  return <ChatHomeClient />;
}
