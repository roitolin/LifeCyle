import { isRunningInExpoGo } from 'expo';
import { NavigationBar } from 'expo-navigation-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { RootNavigator } from '@/navigation';
import { AppProviders } from '@/providers';
import { configureForegroundPushNotifications } from '@/services/pushNotifications';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash may already be managed by Expo Go during local development.
});

if (!isRunningInExpoGo()) {
  SplashScreen.setOptions({
    duration: 0,
    fade: false,
  });
}

export default function App() {
  useEffect(() => {
    // Notification handler setup is non-critical for the first paint. Deferring
    // it until after the root view mounts keeps the initial app screen responsive.
    configureForegroundPushNotifications();
  }, []);

  return (
    <GestureHandlerRootView style={styles.app}>
      <StatusBar hidden={false} style="dark" />
      <NavigationBar hidden={false} style="dark" />
      <AppProviders>
        <RootNavigator />
      </AppProviders>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
});
