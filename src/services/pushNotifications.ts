import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/services/supabaseClient';
import type { NotificationPreferences } from '@/utils/notificationPreferences';

export const PUSH_ALERTS_CHANNEL_ID = 'lifecycle-alerts';
export const PUSH_SILENT_CHANNEL_ID = 'lifecycle-silent';

const STORED_EXPO_TOKEN_KEY = '@lifecycle/expo-push-token';
let notificationHandlerConfigured = false;

export function configureForegroundPushNotifications() {
  if (notificationHandlerConfigured) return;
  notificationHandlerConfigured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      // Realtime uses the app's custom sound while foregrounded. The remote
      // payload/channel supplies the system sound in background or terminated.
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;

  await Promise.all([
    Notifications.setNotificationChannelAsync(PUSH_ALERTS_CHANNEL_ID, {
      name: 'LifeCycle updates',
      description: 'Service status, payment, message, and announcement alerts.',
      importance: Notifications.AndroidImportance.HIGH,
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
  expoPushToken: string,
  preferences: NotificationPreferences
) {
  const { error } = await supabase.rpc('register_push_token', {
    p_expo_push_token: expoPushToken,
    p_platform: Platform.OS,
    p_device_name: deviceLabel(),
    p_app_version: Constants.expoConfig?.version ?? null,
    p_preferences: preferences,
  });
  if (error) throw error;

  await AsyncStorage.setItem(STORED_EXPO_TOKEN_KEY, expoPushToken);
}

export async function registerCurrentDeviceForPush(
  userId: string,
  preferences: NotificationPreferences
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId || Platform.OS === 'web' || !Device.isDevice) return null;

  // SDK 53+ does not support remote push inside Expo Go. A development or
  // release build is required so the app owns its FCM/APNs credentials.
  if (Constants.appOwnership === 'expo') {
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

    const expoPushToken = (
      await Notifications.getExpoPushTokenAsync({ projectId })
    ).data;
    await saveTokenForUser(expoPushToken, preferences);
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
    await saveTokenForUser(expoPushToken, preferences);
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
    await AsyncStorage.removeItem(STORED_EXPO_TOKEN_KEY);
  } catch (error) {
    // Logout should still succeed if the device is temporarily offline.
    console.warn('Unable to unregister this device push token:', error);
  }
}
