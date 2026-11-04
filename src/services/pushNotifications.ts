import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

import { supabase } from '@/services/supabaseClient';
import type { NotificationPreferences } from '@/utils/notificationPreferences';

// Android does not let apps raise the importance of a channel after it has
// been created. Use a versioned ID so existing installs receive the new
// heads-up/MAX-importance configuration on their next launch.
export const PUSH_ALERTS_CHANNEL_ID = 'lifecycle-alerts-v2';
export const PUSH_SILENT_CHANNEL_ID = 'lifecycle-silent';

const STORED_EXPO_TOKEN_KEY = '@lifecycle/expo-push-token';
const PUSH_REGISTRATION_CACHE_KEY = '@lifecycle/push-registration-cache';
const PUSH_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;
let notificationHandlerConfigured = false;
let notificationsModule: typeof import('expo-notifications') | null = null;

type PushRegistrationCache = {
  userId: string;
  token: string;
  appVersion: string | null;
  syncedAt: number;
};

export function getNotificationsModule() {
  if (Platform.OS === 'web' || isRunningInExpoGo()) return null;

  // A static import crashes while expo-notifications initializes in Android Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  notificationsModule ??= require('expo-notifications') as typeof import('expo-notifications');
  return notificationsModule;
}

export function configureForegroundPushNotifications() {
  const Notifications = getNotificationsModule();
  if (!Notifications) return;
  if (notificationHandlerConfigured) return;
  notificationHandlerConfigured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      // Android suppresses the heads-up/drop-down alert whenever this is false,
      // even for a MAX-importance channel. The selected channel still decides
      // whether the notification is audible for the user's sound preference.
      shouldPlaySound: Platform.OS === 'android',
      shouldSetBadge: true,
    }),
  });
}

async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  const Notifications = getNotificationsModule();
  if (!Notifications) return;

  await Promise.all([
    Notifications.setNotificationChannelAsync(PUSH_ALERTS_CHANNEL_ID, {
      name: 'LifeCycle updates',
      description: 'Service status, payment, message, and announcement alerts.',
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableLights: true,
      lightColor: '#d8c58f',
      enableVibrate: true,
      vibrationPattern: [0, 250, 180, 250],
      showBadge: true,
      sound: 'default',
    }),
    Notifications.setNotificationChannelAsync(PUSH_SILENT_CHANNEL_ID, {
      name: 'LifeCycle silent updates',
      description: 'Visible notifications with sound disabled in app preferences.',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableLights: true,
      lightColor: '#d8c58f',
      enableVibrate: false,
      showBadge: true,
      sound: null,
    }),
  ]);
}

async function getGrantedNotificationPermissions() {
  const Notifications = getNotificationsModule();
  if (!Notifications) return false;

  let permissions = await Notifications.getPermissionsAsync();
  if (permissions.granted) return true;

  permissions = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  return permissions.granted;
}

function getProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

function deviceLabel() {
  return [Device.brand, Device.modelName].filter(Boolean).join(' ') || null;
}

async function saveTokenForUser(
  userId: string,
  expoPushToken: string,
  preferences: NotificationPreferences
) {
  const appVersion = Constants.expoConfig?.version ?? null;
  const { error } = await supabase.rpc('register_push_token', {
    p_expo_push_token: expoPushToken,
    p_platform: Platform.OS,
    p_device_name: deviceLabel(),
    p_app_version: appVersion,
    p_preferences: preferences,
  });
  if (error) throw error;

  const registration: PushRegistrationCache = {
    userId,
    token: expoPushToken,
    appVersion,
    syncedAt: Date.now(),
  };
  await AsyncStorage.multiSet([
    [STORED_EXPO_TOKEN_KEY, expoPushToken],
    [PUSH_REGISTRATION_CACHE_KEY, JSON.stringify(registration)],
  ]);
}

export async function registerCurrentDeviceForPush(
  userId: string,
  preferences: NotificationPreferences
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId || Platform.OS === 'web' || !Device.isDevice) return null;

  // SDK 53+ does not support remote push inside Expo Go. A development or
  // release build is required so the app owns its FCM/APNs credentials.
  const Notifications = getNotificationsModule();
  if (!Notifications) {
    if (__DEV__) console.warn('Push notifications require a development build.');
    return null;
  }

  try {
    await ensureAndroidChannels();
    const permissionGranted = await getGrantedNotificationPermissions();
    if (!permissionGranted) return null;

    const projectId = getProjectId();
    if (!projectId) {
      console.warn('Push registration skipped because the EAS project ID is missing.');
      return null;
    }

    const appVersion = Constants.expoConfig?.version ?? null;
    const cachedRegistration = await AsyncStorage.getItem(PUSH_REGISTRATION_CACHE_KEY);
    if (cachedRegistration) {
      try {
        const cached = JSON.parse(cachedRegistration) as Partial<PushRegistrationCache>;
        if (
          cached.userId === normalizedUserId
          && typeof cached.token === 'string'
          && cached.token.length > 0
          && cached.appVersion === appVersion
          && typeof cached.syncedAt === 'number'
          && Date.now() - cached.syncedAt < PUSH_REGISTRATION_TTL_MS
        ) {
          return cached.token;
        }
      } catch {
        // Replace malformed or outdated cache data below.
      }
    }

    const expoPushToken = (
      await Notifications.getExpoPushTokenAsync({ projectId })
    ).data;
    await saveTokenForUser(normalizedUserId, expoPushToken, preferences);
    return expoPushToken;
  } catch (error) {
    console.warn('Unable to register this device for push notifications:', error);
    return null;
  }
}

export async function updateCurrentPushPreferences(
  userId: string,
  preferences: NotificationPreferences,
  knownToken?: string | null
) {
  const expoPushToken =
    knownToken ?? (await AsyncStorage.getItem(STORED_EXPO_TOKEN_KEY));
  if (!userId.trim() || !expoPushToken) return;

  try {
    await saveTokenForUser(userId.trim(), expoPushToken, preferences);
  } catch (error) {
    console.warn('Unable to synchronize push notification preferences:', error);
  }
}

export async function unregisterCurrentDevicePushToken() {
  const expoPushToken = await AsyncStorage.getItem(STORED_EXPO_TOKEN_KEY);
  if (!expoPushToken) return;

  try {
    const { error } = await supabase.rpc('unregister_push_token', {
      p_expo_push_token: expoPushToken,
    });
    if (error) throw error;
    await AsyncStorage.multiRemove([STORED_EXPO_TOKEN_KEY, PUSH_REGISTRATION_CACHE_KEY]);
  } catch (error) {
    // Logout should still succeed if the device is temporarily offline.
    console.warn('Unable to unregister this device push token:', error);
  }
}
