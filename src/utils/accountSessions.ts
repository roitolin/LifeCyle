import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/services/supabaseClient';
import { getAccountDeviceInfo } from './accountLoginActivity';

export type AccountSessionItem = {
  session_id: string;
  device_id: string | null;
  device_name: string;
  device_type: string | null;
  platform: string | null;
  os_version: string | null;
  browser: string | null;
  ip_address: string | null;
  country: string | null;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
};

export type AccountSessionHealth = 'active' | 'revoked' | 'unavailable';

async function resolveSession(session?: Session | null) {
  if (session) return session;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function resolveSessionId(session?: Session | null) {
  const activeSession = await resolveSession(session);
  if (!activeSession) return null;

  const { data, error } = await supabase.auth.getClaims(activeSession.access_token);
  if (error) throw error;

  const sessionId = String(data?.claims?.session_id || '').trim();
  return sessionId || null;
}

export async function registerCurrentAccountSession(session?: Session | null) {
  try {
    const sessionId = await resolveSessionId(session);
    if (!sessionId) return { available: true, registered: false, sessionId: null };

    const device = await getAccountDeviceInfo();
    const { data, error } = await supabase.rpc('register_account_session', {
      p_session_id: sessionId,
      p_device: device,
    });
    if (error) {
      console.warn('Current account session could not be registered:', error.message);
      return { available: false, registered: false, sessionId };
    }

    return {
      available: true,
      registered: Boolean(data),
      sessionId,
    };
  } catch (error) {
    console.warn('Current account session could not be registered:', error);
    return { available: false, registered: false, sessionId: null };
  }
}

export async function listActiveAccountSessions(): Promise<AccountSessionItem[]> {
  await registerCurrentAccountSession();

  const { data, error } = await supabase.rpc('list_active_account_sessions');
  if (error) throw error;
  return (data || []) as AccountSessionItem[];
}

export async function revokeAccountSession(sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) throw new Error('A session is required.');

  const { data, error } = await supabase.rpc('revoke_account_session', {
    p_session_id: normalizedSessionId,
  });
  if (error) throw error;
  if (!data) throw new Error('That session is no longer active.');
}

export async function signOutOtherAccountSessions() {
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) throw error;
}

export async function markCurrentAccountSessionSignedOut(reason = 'signed_out') {
  try {
    const sessionId = await resolveSessionId();
    if (!sessionId) return;

    const { error } = await supabase.rpc('mark_current_account_session_signed_out', {
      p_session_id: sessionId,
      p_reason: reason,
    });
    if (error) {
      console.warn('Current session status could not be updated:', error.message);
    }
  } catch (error) {
    console.warn('Current session status could not be updated:', error);
  }
}

export async function verifyCurrentAccountSession(): Promise<AccountSessionHealth> {
  try {
    const sessionId = await resolveSessionId();
    if (!sessionId) return 'revoked';

    const { data, error } = await supabase.rpc('touch_account_session', {
      p_session_id: sessionId,
    });
    if (error) {
      console.warn('Current session could not be verified:', error.message);
      return 'unavailable';
    }
    return data ? 'active' : 'revoked';
  } catch (error) {
    console.warn('Current session could not be verified:', error);
    return 'unavailable';
  }
}
