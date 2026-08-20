import { supabase } from './supabase'
import { db } from './supabaseDbCompat'

type CompatUser = {
  id: string
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  emailVerified: boolean
  email_confirmed_at?: string | null
}

const toCompatUser = (user: any): CompatUser | null => {
  if (!user || !user.id) return null;
  return {
    ...user,
    id: user.id,
    uid: user.id,
    email: user.email ?? null,
    displayName: user.user_metadata?.fullName || user.user_metadata?.name || null,
    photoURL: user.user_metadata?.avatar_url || null,
    emailVerified: Boolean(user.email_confirmed_at),
    email_confirmed_at: user.email_confirmed_at,
  };
}

export const auth = {
  currentUser: null as CompatUser | null,
  signOut: () => supabase.auth.signOut(),
}

void supabase.auth.getSession().then(({ data }) => {
  auth.currentUser = toCompatUser(data.session?.user)
})

supabase.auth.onAuthStateChange((_event, session) => {
  auth.currentUser = toCompatUser(session?.user)
})

export const storage = null
export { db }
