import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import {
  getNotificationsModule,
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
import { queuePushNotificationNavigation } from '@/navigation/navigationRef';

type UsePushNotificationsOptions = {
  canNavigate?: boolean;
};

export function usePushNotifications({ canNavigate = true }: UsePushNotificationsOptions = {}) {
  const { user } = useAuth();
  const userId = user?.id;
  const preferencesRef = useRef<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });

  useEffect(() => {
    if (!userId) return undefined;
    const Notifications = getNotificationsModule();
    if (!Notifications) return undefined;

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

  useEffect(() => {
    if (!userId || !canNavigate) return undefined;
    const Notifications = getNotificationsModule();
    if (!Notifications) return undefined;

    let active = true;
    const handledResponseIds = new Set<string>();

    const handleResponse = (
      response: Awaited<ReturnType<typeof Notifications.getLastNotificationResponseAsync>>
    ) => {
      if (!active || !response) return;
      const responseId = response.notification.request.identifier;
      if (handledResponseIds.has(responseId)) return;
      handledResponseIds.add(responseId);

      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | null
        | undefined;
      queuePushNotificationNavigation(data, userId);
    };

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(handleResponse);

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        handleResponse(response);
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch((error) => {
        if (__DEV__) console.warn('Unable to read the notification that opened the app:', error);
      });

    return () => {
      active = false;
      responseSubscription.remove();
    };
  }, [canNavigate, userId]);

  return null;
}
