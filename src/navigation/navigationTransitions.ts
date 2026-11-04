import { Platform } from 'react-native';
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

export const smoothStackTransition = {
  animation: Platform.select({
    ios: 'simple_push',
    android: 'ios_from_right',
    default: 'fade',
  }),
  animationDuration: 220,
  animationMatchesGesture: true,
  gestureEnabled: true,
} satisfies NativeStackNavigationOptions;

export const smoothAuthTransition = {
  ...smoothStackTransition,
  animation: 'fade_from_bottom',
  animationDuration: 200,
} satisfies NativeStackNavigationOptions;

export const smoothTabTransition = {
  animation: 'fade',
  transitionSpec: {
    animation: 'timing',
    config: { duration: 120 },
  },
} satisfies BottomTabNavigationOptions;
