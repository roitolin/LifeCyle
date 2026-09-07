import { isRunningInExpoGo } from 'expo';
import { StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
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
