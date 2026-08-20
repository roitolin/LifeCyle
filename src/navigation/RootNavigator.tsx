import { NavigationContainer } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from "../context/AuthContext";
import { useAppNotificationSound, useChatDeliveryReceipts, useChatNotificationSound, usePushNotifications } from "@/hooks";
import { navigationTheme } from "../theme";
import AuthNavigator from "./AuthNavigator";
import AdminStackNavigator from "./AdminStackNavigator";
import VerificationStackNavigator from "./VerificationStackNavigator";
import FuneralNavigator from "./FuneralNavigator";
import TermsNavigator from "./TermsNavigator";

function ChatRuntimeListener() {
  useChatDeliveryReceipts();
  useChatNotificationSound();
  return null;
}

function NotificationRuntimeListener() {
  useAppNotificationSound();
  usePushNotifications();
  return null;
}

export default function RootNavigator() {
  const { user, role, termsAccepted, loading } = useAuth();
  const [startupComplete, setStartupComplete] = useState(false);
  const hasHiddenNativeSplashRef = useRef(false);
  const navigationKey = user?.id ? `auth-${user.id}-${role || "user"}` : "guest";
  const emailVerified = Boolean(user?.email_confirmed_at);
  const isAdminRole = role === "super_admin" || role === "admin" || role === "funeral_admin";

  useEffect(() => {
    if (!loading) setStartupComplete(true);
  }, [loading]);

  const revealApp = useCallback(() => {
    if (hasHiddenNativeSplashRef.current) return;
    hasHiddenNativeSplashRef.current = true;
    void SplashScreen.hideAsync().catch(() => {
      // The native splash may already be hidden during fast refresh.
    });
  }, []);

  if (loading && !startupComplete) return null;

  return (
    <NavigationContainer key={navigationKey} onReady={revealApp} theme={navigationTheme}>
      {user && <NotificationRuntimeListener />}
      {user && emailVerified && <ChatRuntimeListener />}
      {!user && <AuthNavigator />}
      {user && !emailVerified && <VerificationStackNavigator />}
      {user && emailVerified && !termsAccepted && <TermsNavigator />}
      {user && emailVerified && termsAccepted && isAdminRole && <AdminStackNavigator />}
      {user && emailVerified && termsAccepted && !isAdminRole && <FuneralNavigator />}
    </NavigationContainer>
  );
}
