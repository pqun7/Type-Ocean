"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAlert } from "@/contexts/alert-context";
import { consumeFlashCookie } from "@/lib/flash-cookies";

function formatProvider(provider: string | null): string {
  if (!provider) return "";

  switch (provider.toLowerCase()) {
    case "github":
      return "GitHub";
    case "google":
      return "Google";
    case "credentials":
      return "";
    default:
      return provider;
  }
}

export function HandleAuthSuccess() {
  const searchParams = useSearchParams();
  const auth = searchParams?.get("auth");
  const provider = searchParams?.get("provider");
  const { showAlert } = useAlert();
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    const flashSuccess = consumeFlashCookie("__flash_success");
    if (flashSuccess === "account_deleted") {
      // Show a single success message after redirecting to /auth.
      // Also suppress any leftover auth success flashes.
      consumeFlashCookie("__flash_auth");
      showAlert("Account deleted successfully.", "success", { durationMs: 3500 });
      return;
    }

    const flash = consumeFlashCookie("__flash_auth");
    if (flash) {
      const [status, rawProvider] = flash.split(":");
      if (status === "success") {
        const key = `success:${rawProvider ?? ""}`;
        if (prevKey.current === key) return;
        prevKey.current = key;

        const providerLabel = formatProvider(rawProvider || null);
        const message = providerLabel
          ? `Signed in with ${providerLabel} successfully.`
          : "Logged in successfully.";

        showAlert(message, "success", { durationMs: 2500 });

        void (async () => {
          try {
            const decision = await fetch("/api/user/verification-reminder", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ provider: rawProvider || null }),
              cache: "no-store",
            })
              .then(async (r) => ({ ok: r.ok, data: (await r.json().catch(() => null)) as unknown }))
              .catch(() => ({ ok: false, data: null as unknown }));

            const show =
              decision.ok &&
              typeof decision.data === "object" &&
              decision.data !== null &&
              "show" in decision.data &&
              Boolean((decision.data as { show?: unknown }).show);

            if (show) {
              showAlert(
                "Please verify your account from Profile to secure your account.",
                "warning",
                { durationMs: 7000 }
              );
            }
          } catch {
            // Ignore session check failures; auth success message already shown.
          }
        })();
        return;
      }
    }

    if (auth !== "success") return;

    const key = `success:${provider ?? ""}`;
    if (prevKey.current === key) return;
    prevKey.current = key;

    const providerLabel = formatProvider(provider ?? null);
    const message = providerLabel
      ? `Signed in with ${providerLabel} successfully.`
      : "Logged in successfully.";

    showAlert(message, "success", { durationMs: 2500 });

    // Derive verification state from the server-issued session token (not from query params).
    // If the email is not verified, remind the user to verify from Profile.
    void (async () => {
      try {
        const decision = await fetch("/api/user/verification-reminder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider }),
          cache: "no-store",
        })
          .then(async (r) => ({ ok: r.ok, data: (await r.json().catch(() => null)) as unknown }))
          .catch(() => ({ ok: false, data: null as unknown }));

        const show =
          decision.ok &&
          typeof decision.data === "object" &&
          decision.data !== null &&
          "show" in decision.data &&
          Boolean((decision.data as { show?: unknown }).show);

        if (show) {
          showAlert(
            "Please verify your account from Profile to secure your account.",
            "warning",
            { durationMs: 7000 }
          );
        }
      } catch {
        // Ignore session check failures; auth success message already shown.
      }
    })();

  }, [auth, provider, searchParams, showAlert]);

  return null;
}
