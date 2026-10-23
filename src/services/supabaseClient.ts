import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";

const requireEnv = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const TRANSIENT_NETWORK_ERROR_PATTERN = /network|fetch failed|network request failed|socketexception|connection reset|econnreset|timed out|timeout/i;

const fetchWithRetry: typeof fetch = async (input, init) => {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error || '');
      if (!TRANSIENT_NETWORK_ERROR_PATTERN.test(message) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Network request failed.');
};

export const supabase = createClient(
  requireEnv("EXPO_PUBLIC_SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL),
  requireEnv(
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
  {
    auth: {
      storage: ReactNativeAsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: {
      fetch: fetchWithRetry,
    },
  },
);
