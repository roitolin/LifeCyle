import { isRunningInExpoGo } from 'expo';
import { NavigationBar } from 'expo-navigation-bar';
import { StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { RootNavigator } from '@/navigation';
import { AppProviders } from '@/providers';
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
  return (
    <View style={styles.app}>
      <StatusBar hidden={false} style="dark" />
      <NavigationBar hidden={false} style="dark" />
      <AppProviders>
        <RootNavigator />
      </AppProviders>
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
});
