import { useCallback, useRef } from "react";

type TapAction = () => void | Promise<void>;

export function useDoubleTapAction(action: TapAction, maxDelayMs = 420) {
  const lastTapRef = useRef(0);

  return useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastTapRef.current;

    if (elapsed > 0 && elapsed <= maxDelayMs) {
      lastTapRef.current = 0;
      void Promise.resolve(action());
      return;
    }

    lastTapRef.current = now;
  }, [action, maxDelayMs]);
}
