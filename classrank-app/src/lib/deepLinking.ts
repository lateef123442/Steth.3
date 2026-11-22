import * as Linking from "expo-linking";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { savePendingReferral } from "./referralApi";

/**
 * Handles an incoming Supabase PKCE callback from a password-reset email.
 * Supabase's exchangeCodeForSession API expects the one-time `code` value,
 * not the full callback URL.
 */
async function handleUrl(url: string | null) {
  if (!url) return;

  // Invite link, e.g. classrank://invite?ref=ABC1234.
  if (/[?&]ref=/i.test(url) && (/invite/i.test(url) || /^https?:/i.test(url))) {
    try {
      const ref = Linking.parse(url).queryParams?.ref;
      if (typeof ref === "string") await savePendingReferral(ref);
    } catch {
      // Ignore malformed referral links.
    }
    return;
  }

  let code: string | null = null;
  try {
    const parsed = new URL(url);
    code = parsed.searchParams.get("code");
    // Support providers that return the code in the URL fragment.
    if (!code && parsed.hash.length > 1) {
      code = new URLSearchParams(parsed.hash.slice(1)).get("code");
    }
  } catch {
    // Ignore malformed or unrelated URLs.
    return;
  }
  if (!code) return;

  // Remove the one-time code from browser history/address bar once captured.
  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("code");
      clean.searchParams.delete("type");
      window.history.replaceState(window.history.state, "", `${clean.pathname}${clean.search}${clean.hash}`);
    } catch {
      // URL cleanup must not prevent the recovery exchange.
    }
  }

  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[deepLinking] Password recovery code exchange failed:", error.message);
    }
  } catch (err) {
    console.error("[deepLinking] Password recovery code exchange threw:", err);
  }
}

/**
 * Call once at app startup. Explicitly reads the browser URL on web and uses
 * Expo Linking for native cold starts and links opened while the app is live.
 */
export function initDeepLinking(): () => void {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    void handleUrl(window.location.href);
    const handleBrowserNavigation = () => {
      void handleUrl(window.location.href);
    };
    window.addEventListener("popstate", handleBrowserNavigation);
    window.addEventListener("hashchange", handleBrowserNavigation);
    return () => {
      window.removeEventListener("popstate", handleBrowserNavigation);
      window.removeEventListener("hashchange", handleBrowserNavigation);
    };
  }

  void Linking.getInitialURL().then(handleUrl);
  const subscription = Linking.addEventListener("url", (event) => {
    void handleUrl(event.url);
  });
  return () => subscription.remove();
}

/** The URL the password-reset email should redirect back to. */
export function getPasswordResetRedirectUrl(): string {
  if (Platform.OS === "web") return "https://steth-app-v1.vercel.app/";
  return Linking.createURL("reset-password");
}
