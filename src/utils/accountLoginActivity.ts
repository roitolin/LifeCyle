import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Platform } from 'react-native';
import { supabase } from '@/services/supabaseClient';
import { generateId } from './generateId';
import { resolveFriendlyDeviceName } from './deviceModelNames';

export type AccountLoginEvent = 'login_success' | 'logout';

export type AccountDeviceInfo = {
  device_id: string;
  device_name: string;
  device_type: string;
  platform: string;
  os_version: string;
  browser: string | null;
  screen_size: string;
  user_agent: string | null;
};

const DEVICE_ID_KEY = '@lifecycle/account-device-id';
function readBrowserName(userAgent: string) {
  if (/edg/i.test(userAgent)) return 'Microsoft Edge';
  if (/chrome/i.test(userAgent)) return 'Google Chrome';
  if (/crios/i.test(userAgent)) return 'Google Chrome';
  if (/firefox/i.test(userAgent)) return 'Mozilla Firefox';
  if (/fxios/i.test(userAgent)) return 'Mozilla Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  return 'Web browser';
}

async function getOrCreateDeviceId() {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const created = generateId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export async function getAccountDeviceInfo(): Promise<AccountDeviceInfo> {
  const constants = Platform.constants as Record<string, unknown>;
  const userAgent = typeof globalThis.navigator?.userAgent === 'string' ? globalThis.navigator.userAgent : null;
  const manufacturer = String(constants.Manufacturer || constants.manufacturer || '').trim();
  const brand = String(constants.Brand || constants.brand || '').trim();
  const model = String(constants.Model || constants.model || '').trim();
  const browserName = Platform.OS === 'web' ? readBrowserName(userAgent || '') : null;
  const screen = Dimensions.get('screen');

  return {
    device_id: await getOrCreateDeviceId(),
    device_name: resolveFriendlyDeviceName({
      manufacturer,
      brand,
      model,
      platform: Platform.OS,
      browserName,
    }),
    device_type: Platform.OS === 'web' ? 'Web browser' : (Platform as any).isPad ? 'Tablet' : 'Mobile device',
    platform: Platform.OS,
    os_version: String(Platform.Version || 'Unknown'),
    browser: browserName,
    screen_size: `${Math.round(screen.width)}x${Math.round(screen.height)}`,
    user_agent: userAgent,
  };
}

export async function recordAccountLoginActivity(event: AccountLoginEvent) {
  try {
    const device = await getAccountDeviceInfo();
    const result = await supabase.rpc('record_account_login_activity', {
      p_event: event,
      p_device: device,
    });
    if (result.error) console.warn('Account login activity could not be recorded:', result.error.message);
  } catch (error) {
    console.warn('Account login activity could not be recorded:', error);
  }
}
