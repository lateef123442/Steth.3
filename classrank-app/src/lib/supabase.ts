import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// These must be set in a .env file at the project root (see .env.example).
// Expo automatically inlines any var prefixed with EXPO_PUBLIC_ at build time.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.example to .env and fill in your Supabase project values."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE (not the older implicit flow) is what makes the password-reset
    // deep link work correctly — see src/lib/deepLinking.ts. It exchanges a
    // one-time `code` from the reset email's URL for a session, rather than
    // relying on tokens embedded directly in the URL.
    flowType: "pkce",
  },
});
