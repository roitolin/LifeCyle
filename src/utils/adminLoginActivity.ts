import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Platform } from 'react-native';
import { supabase } from '@/services/supabaseClient';
import { generateId } from './generateId';
import { resolveFriendlyDeviceName } from './deviceModelNames';

export type AdminLoginEvent = 'login_success' | 'logout' | 'other_sessions_signed_out';

export type AdminDeviceInfo = {
  device_id: string;
  device_name: string;
  device_type: string;
  platform: string;
  os_version: string;
  browser: string | null;
  screen_size: string;
  user_agent: string | null;
};

const DEVICE_ID_KEY = '@lifecycle/admin-device-id';
const ADMIN_ROLES = new Set(['admin', 'super_admin', 'funeral_admin']);

const readBrowserName = (userAgent: string) => {
  if (/edg/i.test(userAgent)) return 'Microsoft Edge';
  if (/chrome|crios/i.test(userAgent)) return 'Google Chrome';
  if (/firefox|fxios/i.test(userAgent)) return 'Mozilla Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  return 'Web browser';
};

const getOrCreateDeviceId = async () => {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const created = generateId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
};

export const getAdminDeviceInfo = async (): Promise<AdminDeviceInfo> => {
  const constants = Platform.constants as Record<string, unknown>;
  const userAgent = typeof globalThis.navigator?.userAgent === 'string' ? globalThis.navigator.userAgent : null;
  const manufacturer = String(constants.Manufacturer || constants.manufacturer || '').trim();
  const brand = String(constants.Brand || constants.brand || '').trim();
  const model = String(constants.Model || constants.model || '').trim();
  const browserName = Platform.OS === 'web' ? readBrowserName(userAgent || '') : null;
  const deviceName = resolveFriendlyDeviceName({
    manufacturer,
    brand,
    model,
    platform: Platform.OS,
    browserName,
  });
  const { width, height } = Dimensions.get('screen');

  return {
    device_id: await getOrCreateDeviceId(),
    device_name: deviceName,
    device_type: Platform.OS === 'web' ? 'Web browser' : (Platform as any).isPad ? 'Tablet' : 'Mobile device',
    platform: Platform.OS,
    os_version: String(Platform.Version || 'Unknown'),
    browser: browserName,
    screen_size: `${Math.round(width)}x${Math.round(height)}`,
    user_agent: userAgent,
  };
};

export const recordAdminLoginActivity = async (event: AdminLoginEvent, role?: string | null) => {
  if (role && !ADMIN_ROLES.has(role)) return;

  try {
    const device = await getAdminDeviceInfo();
    const { error } = await supabase.rpc('record_admin_login_activity', {
      p_event: event,
      p_device: device,
    });
    if (error) console.warn('Admin login activity could not be recorded:', error.message);
  } catch (error) {
    console.warn('Admin login activity could not be recorded:', error);
  }
};
