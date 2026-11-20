import { useEffect, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  type ImageURISource,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '@/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type Props = {
  source: number | ImageURISource;
  style: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export default function ImageWithSkeleton(props: Props) {
  const key = typeof props.source === 'number' ? props.source : props.source.uri;
  return <ImageFrame key={key} {...props} />;
}

function ImageFrame({ source, style, accessibilityLabel }: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    typeof source === 'number' || source.uri ? 'loading' : 'failed',
  );
  const [opacity] = useState(() => new Animated.Value(0));
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (status !== 'ready') return;
    if (reducedMotion) {
      opacity.setValue(1);
      return;
    }
    const reveal = Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true, isInteraction: false });
    reveal.start();
    return () => reveal.stop();
  }, [opacity, reducedMotion, status]);

  return (
    <View style={[styles.frame, style]}>
      {status === 'failed' ? <Text style={styles.unavailable}>Image unavailable</Text> : (
        <Animated.Image
          source={source}
          resizeMode="cover"
          fadeDuration={0}
          style={[styles.image, { opacity }]}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('failed')}
          accessibilityLabel={accessibilityLabel}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: '#e3eae3', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { position: 'absolute', width: '100%', height: '100%' },
  unavailable: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
