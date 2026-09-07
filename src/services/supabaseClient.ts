import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";

const requireEnv = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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
  },
);
