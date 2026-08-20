import { createClient } from '@supabase/supabase-js'

const requireEnv = (name: string): string => {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const supabase = createClient(
  requireEnv('VITE_SUPABASE_URL'),
  requireEnv('VITE_SUPABASE_PUBLISHABLE_KEY'),
)
