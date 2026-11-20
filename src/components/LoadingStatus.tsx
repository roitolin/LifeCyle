import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/theme';

type LoadingStatusProps = {
  compact?: boolean;
  fullScreen?: boolean;
  label?: string;
  delayMs?: number;
  onStatusLayout?: () => void;
  style?: StyleProp<ViewStyle>;
};

export default function LoadingStatus({
  compact = false,
  fullScreen = false,
  label = 'Loading…',
  delayMs = 240,
  onStatusLayout,
  style,
}: LoadingStatusProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={[styles.container, compact && styles.compact, fullScreen && styles.fullScreen, style]}
    >
      {visible && <Text style={styles.label} onLayout={onStatusLayout}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', minHeight: 180, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  compact: { minHeight: 96 },
  fullScreen: { flex: 1, minHeight: undefined, backgroundColor: colors.surfaceWarm },
  label: { color: colors.primary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
