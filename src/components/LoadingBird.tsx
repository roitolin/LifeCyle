import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

const appMark = require('../../assets/Icon/AppICONTransparents.png');

type LoadingBirdProps = {
  compact?: boolean;
  fullScreen?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function LoadingBird({ compact = false, fullScreen = false, style }: LoadingBirdProps) {
  const float = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const floating = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    const orbiting = Animated.loop(Animated.timing(orbit, {
      toValue: 1,
      duration: 2200,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    const pulsing = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));

    floating.start();
    orbiting.start();
    pulsing.start();
    return () => {
      floating.stop();
      orbiting.stop();
      pulsing.stop();
    };
  }, [float, orbit, pulse]);

  const markSize = compact ? 48 : 66;
  const stageSize = compact ? 66 : 92;
  const orbitRotation = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.24] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0, 0.28, 0] });
  const markTranslateY = float.interpolate({ inputRange: [0, 1], outputRange: [2, -4] });
  const markScale = float.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.03] });

  return (
    <View
      accessibilityLabel='Loading, please wait'
      accessibilityRole='progressbar'
      style={[styles.container, compact && styles.compactContainer, fullScreen && styles.fullScreen, style]}
    >
      <View style={[styles.stage, { width: stageSize, height: stageSize }]}>
        <Animated.View style={[
          styles.halo,
          {
            width: stageSize,
            height: stageSize,
            borderRadius: stageSize / 2,
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          },
        ]} />
        <Animated.View style={[
          styles.orbit,
          {
            width: stageSize,
            height: stageSize,
            borderRadius: stageSize / 2,
            transform: [{ rotate: orbitRotation }],
          },
        ]}>
          <View style={[styles.orbitDot, compact && styles.compactOrbitDot]} />
        </Animated.View>
        <Animated.View style={[
          styles.markShell,
          {
            width: markSize,
            height: markSize,
            borderRadius: markSize / 2,
            transform: [{ translateY: markTranslateY }, { scale: markScale }],
          },
        ]}>
          <Animated.Image
            accessibilityIgnoresInvertColors
            source={appMark}
            resizeMode='contain'
            style={{ width: markSize - 8, height: markSize - 8 }}
          />
        </Animated.View>
      </View>
      {!compact && (
        <View style={styles.copy}>
          <Text style={styles.brand}>LIFECYCLE</Text>
          <Text style={styles.message}>Preparing everything for you</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%', minHeight: 180, alignItems: 'center', justifyContent: 'center',
    gap: 14, backgroundColor: '#f8f6f2', overflow: 'hidden',
  },
  fullScreen: { flex: 1, minHeight: undefined },
  compactContainer: { minHeight: 96, gap: 0 },
  stage: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', backgroundColor: '#d32f2f' },
  orbit: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(34, 49, 45, 0.14)' },
  orbitDot: {
    position: 'absolute', top: -4, left: '50%', width: 9, height: 9, marginLeft: -4.5,
    borderRadius: 5, backgroundColor: '#d32f2f', borderWidth: 2, borderColor: '#f8f6f2',
  },
  compactOrbitDot: { width: 8, height: 8, marginLeft: -4 },
  markShell: {
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff',
    borderWidth: 1, borderColor: '#e6e3da', shadowColor: '#22312d',
    shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.14, shadowRadius: 10, elevation: 4,
  },
  copy: { alignItems: 'center', gap: 3 },
  brand: { color: '#22312d', fontSize: 13, fontWeight: '800', letterSpacing: 2.2 },
  message: { color: '#77827d', fontSize: 12, fontWeight: '500', letterSpacing: 0.1 },
});
