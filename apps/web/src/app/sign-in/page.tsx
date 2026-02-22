import type { Metadata } from "next";
import SignInPageClient from "./sign-in-page-client";

export const metadata: Metadata = {
  title: "Sign In | Nosis",
  description: "Sign in to Nosis with GitHub.",
};

export default function SignInPage() {
  return <SignInPageClient />;
}
