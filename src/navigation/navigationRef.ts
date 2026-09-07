import { createNavigationContainerRef } from '@react-navigation/native';

type PushNavigationTarget = {
  notificationId: string;
  receivedAt: number;
};

export const rootNavigationRef = createNavigationContainerRef<any>();

let pendingPushTarget: PushNavigationTarget | null = null;

export function queuePushNotificationNavigation(
  rawData: Record<string, unknown> | null | undefined,
  currentUserId: string
) {
  const notificationId = String(rawData?.notificationId ?? '').trim();
  const targetUserId = String(rawData?.userId ?? '').trim();

  if (!notificationId) return false;
  if (targetUserId && targetUserId !== currentUserId) return false;

  pendingPushTarget = { notificationId, receivedAt: Date.now() };
  return flushPendingPushNavigation();
}

export function flushPendingPushNavigation() {
  if (!pendingPushTarget || !rootNavigationRef.isReady()) return false;

  const target = pendingPushTarget;
  pendingPushTarget = null;
  rootNavigationRef.navigate('Notifications', {
    openNotificationId: target.notificationId,
    refreshToken: target.receivedAt,
  });
  return true;
}
