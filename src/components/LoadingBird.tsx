import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/theme';

type LoadingBirdProps = {
  compact?: boolean;
  fullScreen?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function LoadingBird({ compact = false, fullScreen = false, style }: LoadingBirdProps) {
  const dotAnimations = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.stagger(
        140,
        dotAnimations.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 1,
              duration: 320,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0,
              duration: 320,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ),
      ),
    );

    animation.start();
    return () => animation.stop();
  }, [dotAnimations]);

  return (
    <View
      accessibilityLabel='Loading, please wait'
      accessibilityRole='progressbar'
      style={[styles.container, compact && styles.compactContainer, fullScreen && styles.fullScreen, style]}
    >
      <View accessibilityElementsHidden importantForAccessibility='no-hide-descendants' style={styles.dots}>
        {dotAnimations.map((dot, index) => (
          <Animated.View
            key={index}
            style={[
              styles.dot,
              compact && styles.compactDot,
              {
                opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                transform: [
                  { translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
                  { scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
                ],
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceWarm,
  },
  fullScreen: { flex: 1, minHeight: undefined },
  compactContainer: { minHeight: 96 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 13 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  compactDot: { width: 6, height: 6, borderRadius: 3 },
});
