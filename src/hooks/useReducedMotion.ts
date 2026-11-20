import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    let waiting = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      waiting = false;
      setReduced(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (waiting) setReduced(enabled);
    }).catch(() => {});
    return () => {
      waiting = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
