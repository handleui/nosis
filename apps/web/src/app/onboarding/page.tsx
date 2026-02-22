import type { Metadata } from "next";
import OnboardingPageClient from "./onboarding-page-client";

export const metadata: Metadata = {
  title: "Onboarding | Nosis",
  description: "Configure provider API keys for your Nosis workspace.",
};

export default function OnboardingPage() {
  return <OnboardingPageClient />;
}
