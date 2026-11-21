import { useEffect, useState } from 'react';
import {
  Animated,
  type ImageResizeMode,
  type ImageStyle,
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
  fallbackSource?: ImageURISource;
  imageStyle?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  pulsePlaceholder?: boolean;
  onError?: () => void;
};

export default function ImageWithSkeleton(props: Props) {
  const key = typeof props.source === 'number' ? props.source : props.source.uri;
  return <ImageFrame key={key} {...props} />;
}

function ImageFrame({ source, style, accessibilityLabel, fallbackSource, imageStyle, resizeMode = 'cover', pulsePlaceholder, onError }: Props) {
  const [usingFallback, setUsingFallback] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    typeof source === 'number' || source.uri ? 'loading' : 'failed',
  );
  const [opacity] = useState(() => new Animated.Value(0));
  const [pulseOpacity] = useState(() => new Animated.Value(0.45));
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (status !== 'loading' || reducedMotion || !pulsePlaceholder) return;
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseOpacity, { toValue: 0.9, duration: 650, useNativeDriver: true, isInteraction: false }),
      Animated.timing(pulseOpacity, { toValue: 0.45, duration: 650, useNativeDriver: true, isInteraction: false }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [pulseOpacity, pulsePlaceholder, reducedMotion, status]);

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
      {status === 'loading' && pulsePlaceholder && !reducedMotion ? (
        <Animated.View pointerEvents="none" style={[styles.placeholder, { opacity: pulseOpacity }]} />
      ) : null}
      {status === 'failed' ? <Text style={styles.unavailable}>Image unavailable</Text> : (
        <Animated.Image
          source={usingFallback ? fallbackSource : source}
          resizeMode={resizeMode}
          fadeDuration={0}
          style={[styles.image, imageStyle, { opacity }]}
          onLoad={() => setStatus('ready')}
          onError={() => {
            if (fallbackSource && !usingFallback) {
              setUsingFallback(true);
              return;
            }
            setStatus('failed');
            onError?.();
          }}
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
  placeholder: { ...StyleSheet.absoluteFill, backgroundColor: '#cbd9d0' },
  unavailable: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
