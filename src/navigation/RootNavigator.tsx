import { NavigationContainer } from "@react-navigation/native";
import { useCallback, useEffect, useRef } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from "../context/AuthContext";
import { useAppNotificationSound, useChatDeliveryReceipts, useChatNotificationSound, usePushNotifications } from "@/hooks";
import LoadingBird from '@/components/LoadingBird';
import { navigationTheme } from "../theme";
import AuthNavigator from "./AuthNavigator";
import AdminStackNavigator from "./AdminStackNavigator";
import VerificationStackNavigator from "./VerificationStackNavigator";
import FuneralNavigator from "./FuneralNavigator";
import TermsNavigator from "./TermsNavigator";
import {
  flushPendingPushNavigation,
  rootNavigationRef,
} from './navigationRef';

function ChatRuntimeListener() {
  useChatDeliveryReceipts();
  useChatNotificationSound();
  return null;
}

function NotificationRuntimeListener({ canNavigate }: { canNavigate: boolean }) {
  useAppNotificationSound();
  usePushNotifications({ canNavigate });
  return null;
}

export default function RootNavigator() {
  const { user, role, termsAccepted, loading } = useAuth();
  const hasHiddenNativeSplashRef = useRef(false);
  const navigationKey = user?.id
    ? `auth-${user.id}-${role || "user"}-${termsAccepted ? "terms-ok" : "terms-required"}`
    : "guest";
  const emailVerified = Boolean(user?.email_confirmed_at);
  const isAdminRole = role === "super_admin" || role === "admin" || role === "funeral_admin";
  const canNavigateFromPush = Boolean(user && emailVerified && termsAccepted);

  const revealApp = useCallback(() => {
    if (hasHiddenNativeSplashRef.current) return;
    hasHiddenNativeSplashRef.current = true;
    void SplashScreen.hideAsync().catch(() => {
      // The native splash may already be hidden during fast refresh.
    });
  }, []);

  useEffect(() => {
    if (loading) revealApp();
  }, [loading, revealApp]);

  // Never choose an authenticated navigator until the matching user profile
  // (including saved agreement acceptance) has finished loading. Otherwise a
  // previously accepted user briefly mounts TermsNavigator with the default
  // `termsAccepted = false` value during sign-in or account switching.
  if (loading) return <LoadingBird fullScreen />;

  return (
    <NavigationContainer
      key={navigationKey}
      ref={rootNavigationRef}
      onReady={() => {
        revealApp();
        flushPendingPushNavigation();
      }}
      onStateChange={flushPendingPushNavigation}
      theme={navigationTheme}
    >
      {user && <NotificationRuntimeListener canNavigate={canNavigateFromPush} />}
      {user && emailVerified && <ChatRuntimeListener />}
      {!user && <AuthNavigator />}
      {user && !emailVerified && <VerificationStackNavigator />}
      {user && emailVerified && !termsAccepted && <TermsNavigator />}
      {user && emailVerified && termsAccepted && isAdminRole && <AdminStackNavigator />}
      {user && emailVerified && termsAccepted && !isAdminRole && <FuneralNavigator />}
    </NavigationContainer>
  );
}
