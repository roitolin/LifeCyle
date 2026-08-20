import { StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { RootNavigator } from '@/navigation';
import { AppProviders } from '@/providers';

void SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash may already be managed by Expo Go during local development.
});

SplashScreen.setOptions({
  duration: 0,
  fade: false,
});

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
    backgroundColor: '#17382f',
  },
});
