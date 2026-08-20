import { supabase } from '@/services/supabaseClient';
import { getAccountDeviceInfo } from './accountLoginActivity';

export type AccountActivityEvent =
  | 'password_changed'
  | 'profile_updated'
  | 'session_revoked'
  | 'other_sessions_signed_out'
  | 'all_sessions_signed_out';

export async function recordAccountActivity(event: AccountActivityEvent) {
  try {
    const device = await getAccountDeviceInfo();
    const result = await supabase.rpc('record_account_activity', {
      p_event: event,
      p_device: device,
    });
    if (result.error) console.warn('Account activity could not be recorded:', result.error.message);
  } catch (error) {
    console.warn('Account activity could not be recorded:', error);
  }
}
