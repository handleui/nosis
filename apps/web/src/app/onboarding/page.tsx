"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@nosis/ui/button";
import AuthGuard from "@nosis/components/auth-guard";
import { API_URL } from "@nosis/lib/auth-client";

const PROVIDERS = [
  {
    key: "letta",
    label: "Letta",
    description: "AI agent provider (required for chat)",
  },
  { key: "exa", label: "Exa", description: "Web search" },
  {
    key: "firecrawl",
    label: "Firecrawl",
    description: "URL content extraction",
  },
];

function OnboardingForm() {
  const router = useRouter();
  const [configured, setConfigured] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();

    const fetchKeys = async () => {
      try {
        const res = await fetch(`${API_URL}/api/keys`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) {
          return;
        }
        const rows: { provider: string }[] = await res.json();
        setConfigured(new Set(rows.map((r) => r.provider)));
      } catch {
        // Silently ignore abort and network errors
      }
    };

    fetchKeys();

    return () => controller.abort();
  }, []);

  const saveKey = async (provider: string) => {
    const value = values[provider]?.trim();
    if (!value) {
      return;
    }

    setSaving((s) => ({ ...s, [provider]: true }));
    setErrors((e) => ({ ...e, [provider]: "" }));

    try {
      const res = await fetch(`${API_URL}/api/keys/${provider}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apiKey: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to save");
      }
      setConfigured((s) => new Set(s).add(provider));
      setValues((v) => ({ ...v, [provider]: "" }));
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [provider]: err instanceof Error ? err.message : "Failed to save",
      }));
    } finally {
      setSaving((s) => ({ ...s, [provider]: false }));
    }
  };

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-2">
        <h1 className="font-semibold text-2xl">Set up your API keys</h1>
        <p className="text-muted text-sm">
          Provide your own keys for the services Nosis uses.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-4">
        {PROVIDERS.map(({ key, label, description }) => (
          <div className="flex flex-col gap-1.5" key={key}>
            <div className="flex items-center gap-2">
              <label className="font-medium text-sm" htmlFor={key}>
                {label}
              </label>
              {configured.has(key) && (
                <span className="text-green-600 text-xs dark:text-green-400">
                  configured
                </span>
              )}
            </div>
            <p className="text-muted text-xs">{description}</p>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-subtle bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-foreground"
                id={key}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [key]: e.target.value }))
                }
                placeholder={
                  configured.has(key) ? "••••••••" : `Enter ${label} API key`
                }
                type="password"
                value={values[key] ?? ""}
              />
              <Button
                disabled={!values[key]?.trim() || saving[key]}
                onClick={() => saveKey(key)}
                size="sm"
                variant="outline"
              >
                {saving[key] ? "..." : "Save"}
              </Button>
            </div>
            {errors[key] && (
              <p className="text-red-500 text-xs">{errors[key]}</p>
            )}
          </div>
        ))}
      </div>

      <Button onClick={() => router.push("/")}>Continue</Button>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <AuthGuard>
      <OnboardingForm />
    </AuthGuard>
  );
}
