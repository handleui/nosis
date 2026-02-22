import type { Metadata } from "next";
import CodeHomeClient from "./code-home-client";

export const metadata: Metadata = {
  title: "Code",
  description: "Start and manage a code conversation workspace.",
};

export default function CodeHomePage() {
  return <CodeHomeClient />;
}
