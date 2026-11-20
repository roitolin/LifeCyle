import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, { Easing as ReanimatedEasing, FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/useReducedMotion';
const PLACEHOLDERS = [0, 1, 2, 3];

export default function ContentSkeleton({ children, label, style }: { children: ReactNode; label: string; style?: StyleProp<ViewStyle> }) {
  const [progress] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => progress.interpolate({
    inputRange: [0, 0.5, 1], outputRange: [1, 0.8, 1], easing: Easing.inOut(Easing.sin),
  }));
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    progress.setValue(0);
    if (reducedMotion) return;
    const pulse = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: 1750, easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    }));
    pulse.start();
    return () => pulse.stop();
  }, [progress, reducedMotion]);

  return (
    <Animated.View style={[style, { opacity: reducedMotion ? 1 : opacity }]} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }}>
      {children}
    </Animated.View>
  );
}

export function SkeletonBlock({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View importantForAccessibility="no" style={[styles.block, style]} />;
}

type ProductSkeletonProps = {
  gridStyle: StyleProp<ViewStyle>;
  cardStyle: StyleProp<ViewStyle>;
  imageStyle: StyleProp<ViewStyle>;
  bodyStyle: StyleProp<ViewStyle>;
};

export function ProductGridPlaceholders({ gridStyle, cardStyle, imageStyle, bodyStyle }: ProductSkeletonProps) {
  return (
    <View style={gridStyle}>
      {PLACEHOLDERS.map(id => (
        <View key={id} style={cardStyle}>
          <SkeletonBlock style={[imageStyle, { height: 'auto' }]} />
          <View style={bodyStyle}>
            <SkeletonBlock style={styles.productTitle} />
            <SkeletonBlock style={styles.productPrice} />
            <SkeletonBlock style={styles.productMeta} />
            <SkeletonBlock style={styles.productShop} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function MetricPlaceholders({ gridStyle, tileStyle, count = 4, valueFirst = false }: {
  gridStyle: StyleProp<ViewStyle>; tileStyle: StyleProp<ViewStyle>; count?: number; valueFirst?: boolean;
}) {
  return (
    <View style={gridStyle}>
      {PLACEHOLDERS.slice(0, count).map(id => (
        <View style={tileStyle} key={id}>
          <SkeletonBlock style={valueFirst ? styles.metricValue : styles.metricLabel} />
          <SkeletonBlock style={valueFirst ? styles.metricLabel : styles.metricValue} />
        </View>
      ))}
    </View>
  );
}

export function ChartPlotPlaceholder({ height }: { height: number }) {
  return (
    <View style={[styles.chart, { height }]}>
      {PLACEHOLDERS.map(id => <SkeletonBlock key={id} style={styles.chartLine} />)}
      <View style={styles.chartTicks}>
        {[0, 1, 2, 3, 4, 5].map(id => <SkeletonBlock key={id} style={styles.chartTick} />)}
      </View>
    </View>
  );
}

export const contentFade = FadeIn.duration(220)
  .easing(ReanimatedEasing.bezier(.2, .65, .3, 1))
  .withInitialValues({ opacity: .72 })
  .reduceMotion(ReduceMotion.System);

export function ContentReveal({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Reanimated.View entering={contentFade} style={style}>{children}</Reanimated.View>;
}

const styles = StyleSheet.create({
  block: { width: '70%', height: 10, borderRadius: 5, backgroundColor: '#dfe7df' },
  productTitle: { width: '88%', height: 12 },
  productPrice: { width: '44%', height: 12, marginTop: 4 },
  productMeta: { width: '68%', height: 8, marginTop: 5 },
  productShop: { width: '54%', height: 8, marginTop: 4 },
  metricValue: { width: '50%', height: 18, marginTop: 4 },
  metricLabel: { width: '72%', height: 9, marginTop: 4 },
  chart: { justifyContent: 'space-between', marginTop: 6 },
  chartLine: { width: '100%', height: StyleSheet.hairlineWidth },
  chartTicks: { flexDirection: 'row', justifyContent: 'space-between' },
  chartTick: { width: '8%', height: 7 },
});
