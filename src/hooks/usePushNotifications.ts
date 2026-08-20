import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import {
  registerCurrentDeviceForPush,
  updateCurrentPushPreferences,
} from '@/services/pushNotifications';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferenceCategory,
  getNotificationPreferences,
  isNotificationTypeEnabled,
  subscribeNotificationPreferences,
  type NotificationPreferences,
} from '@/utils/notificationPreferences';
import { queueNotificationSoundOnce } from '@/utils/notificationSound';

export function usePushNotifications() {
  const { user } = useAuth();
  const userId = user?.id;
  const preferencesRef = useRef<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });

  useEffect(() => {
    if (!userId) return undefined;

    let active = true;
    let syncing = false;
    let expoPushToken: string | null = null;

    const synchronizeDevice = async () => {
      if (!active || syncing) return;
      syncing = true;
      try {
        const preferences = await getNotificationPreferences(userId);
        if (!active) return;
        preferencesRef.current = preferences;
        expoPushToken = await registerCurrentDeviceForPush(userId, preferences);
      } finally {
        syncing = false;
      }
    };

    const unsubscribePreferences = subscribeNotificationPreferences(
      userId,
      (preferences) => {
        preferencesRef.current = preferences;
        void updateCurrentPushPreferences(userId, preferences, expoPushToken);
      }
    );

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void synchronizeDevice();
    });

    const receivedSubscription =
      Notifications.addNotificationReceivedListener((notification) => {
        if (!active || AppState.currentState !== 'active') return;

        const data = notification.request.content.data;
        const targetUserId = String(data?.userId ?? '').trim();
        if (targetUserId && targetUserId !== userId) return;

        const notificationId = String(data?.notificationId ?? '').trim();
        const notificationType = String(data?.type ?? '').trim();
        const preferences = preferencesRef.current;
        if (!notificationId || !notificationType || !preferences.sound) return;
        if (getNotificationPreferenceCategory(notificationType) === 'messages') return;
        if (!isNotificationTypeEnabled(notificationType, preferences)) return;

        queueNotificationSoundOnce(notificationId);
      });

    void synchronizeDevice();

    return () => {
      active = false;
      unsubscribePreferences();
      appStateSubscription.remove();
      receivedSubscription.remove();
    };
  }, [userId]);

  return null;
}
