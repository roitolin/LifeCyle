import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Defs, Mask, Polygon, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

export type MeasuredTarget = {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
};

type AppSpotlightTutorialProps = {
  visible: boolean;
  onClose: () => void;
  tabBarHeight?: number;
  headerActionsTarget?: MeasuredTarget | null;
  searchRowTarget?: MeasuredTarget | null;
  heroCardTarget?: MeasuredTarget | null;
};

type DimensionsContext = {
  screenWidth: number;
  screenHeight: number;
  safeTop: number;
  bottomSystemBarInset: number;
  tabBarHeight: number;
};

type TargetProps = {
  headerActionsTarget?: MeasuredTarget | null;
  searchRowTarget?: MeasuredTarget | null;
  heroCardTarget?: MeasuredTarget | null;
};

type StepConfig = {
  id: string;
  message: string;
  pointerDirection: 'up' | 'down';
  pointerOffsetAlign: 'center' | 'left' | 'right' | 'targetCenter';
  getTarget: (dims: DimensionsContext, props: TargetProps) => MeasuredTarget;
  getPlacement: (
    target: MeasuredTarget,
    dims: DimensionsContext
  ) => {
    top?: number;
    bottom?: number;
    left: number;
    right: number;
  };
};

const TUTORIAL_STEPS: StepConfig[] = [
  {
    id: 'tabs',
    message:
      'Navigate through the app by tapping the icons at the bottom of your screen — explore products and services, browse accredited funeral shops, manage your carts, and view your profile.',
    pointerDirection: 'down',
    pointerOffsetAlign: 'center',
    getTarget: (dims) => {
      // The reported tab-bar height includes any safe-area padding. Add only
      // the Android system-bar space that sits outside the app window.
      const tabY = dims.screenHeight - dims.tabBarHeight - dims.bottomSystemBarInset;
      return {
        x: 0,
        y: Math.max(0, tabY),
        width: dims.screenWidth,
        height: dims.tabBarHeight,
        rx: 0,
      };
    },
    getPlacement: (_target, dims) => ({
      // Keep the card just above the tab bar, including any external nav bar.
      bottom: dims.tabBarHeight + dims.bottomSystemBarInset + 14,
      left: 16,
      right: 16,
    }),
  },
  {
    id: 'search_explore',
    message:
      'Search caskets, packages, and accredited funeral shops easily! Use filters to quickly compare services, inclusions, and transparent pricing.',
    pointerDirection: 'up',
    pointerOffsetAlign: 'center',
    getTarget: (dims, props) => {
      if (props.searchRowTarget && props.searchRowTarget.height > 30) {
        return {
          x: Math.max(10, props.searchRowTarget.x - 4),
          y: props.searchRowTarget.y - 4,
          width: props.searchRowTarget.width + 8,
          height: props.searchRowTarget.height + 8,
          rx: 16,
        };
      }
      if (props.heroCardTarget && props.heroCardTarget.height > 40) {
        return {
          x: Math.max(10, props.heroCardTarget.x - 4),
          y: props.heroCardTarget.y - 4,
          width: props.heroCardTarget.width + 8,
          height: props.heroCardTarget.height + 8,
          rx: 18,
        };
      }
      // Safe fallback
      return {
        x: 16,
        y: dims.safeTop + 115,
        width: dims.screenWidth - 32,
        height: 155,
        rx: 18,
      };
    },
    getPlacement: (target) => ({
      top: target.y + target.height + 14,
      left: 16,
      right: 16,
    }),
  },
  {
    id: 'header_actions',
    message:
      'Stay updated and connected! View your notifications and message funeral directors directly to get quick answers and updates on your requests.',
    pointerDirection: 'up',
    pointerOffsetAlign: 'targetCenter',
    getTarget: (dims, props) => {
      if (props.headerActionsTarget && props.headerActionsTarget.width > 20) {
        return {
          x: Math.max(0, props.headerActionsTarget.x - 6),
          y: props.headerActionsTarget.y - 4,
          width: props.headerActionsTarget.width + 12,
          height: props.headerActionsTarget.height + 8,
          rx: 22,
        };
      }
      // Safe fallback matching top right icons
      const width = 96;
      return {
        x: dims.screenWidth - 16 - width,
        y: dims.safeTop + 8,
        width,
        height: 44,
        rx: 22,
      };
    },
    getPlacement: (target) => ({
      top: target.y + target.height + 14,
      left: 16,
      right: 16,
    }),
  },
];

function AppSpotlightTutorial({
  visible,
  onClose,
  tabBarHeight = 65,
  headerActionsTarget,
  searchRowTarget,
  heroCardTarget,
}: AppSpotlightTutorialProps) {
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const isTransitioningRef = useRef(false);

  // The transparent modal extends into the system bars, so use full-screen
  // dimensions when positioning the spotlight over the bottom tabs.
  const screenDims = Dimensions.get('screen');
  const windowDims = Dimensions.get('window');
  const screenWidth = screenDims.width;
  const screenHeight = screenDims.height;

  // Compute safe top clearance accounting for notch/punch-hole status bars
  const rawStatusBar = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) : 24;
  const safeTop = Math.max(
    insets.top,
    rawStatusBar,
    Platform.OS === 'android' ? 44 : 48
  );
  const statusBarHeight = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0;
  // If the app window stops above Android's system navigation bar, account
  // for that space. In edge-to-edge layouts the tab-bar height already
  // includes insets.bottom, so the window-size difference is zero here.
  const bottomSystemBarInset = Platform.OS === 'android'
    ? Math.max(0, screenHeight - windowDims.height - statusBarHeight)
    : 0;

  const measuredTabBarHeight = Math.max(48, tabBarHeight);

  const dimsContext = useMemo<DimensionsContext>(() => ({
    screenWidth,
    screenHeight,
    safeTop,
    bottomSystemBarInset,
    tabBarHeight: measuredTabBarHeight,
  }), [bottomSystemBarInset, measuredTabBarHeight, safeTop, screenHeight, screenWidth]);

  const targetProps = useMemo<TargetProps>(() => ({
    headerActionsTarget,
    searchRowTarget,
    heroCardTarget,
  }), [headerActionsTarget, heroCardTarget, searchRowTarget]);
  // Card transition animations
  const modalFadeAnim = useRef(new Animated.Value(0)).current;
  const cardFadeAnim = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(12)).current;
  const cardScale = useRef(new Animated.Value(0.96)).current;

  // Button press scale feedback
  const buttonScale = useRef(new Animated.Value(1)).current;
  const currentStep = TUTORIAL_STEPS[stepIndex] || TUTORIAL_STEPS[0];
  const currentTarget = currentStep.getTarget(dimsContext, targetProps);
  const tooltipPlacement = currentStep.getPlacement(currentTarget, dimsContext);

  const animateCardEntrance = useCallback((pointerDirection: 'up' | 'down') => {
    cardFadeAnim.setValue(0);
    cardTranslateY.setValue(pointerDirection === 'down' ? 14 : -14);
    cardScale.setValue(0.96);

    Animated.parallel([
      Animated.timing(cardFadeAnim, {
        toValue: 1,
        duration: 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateY, {
        toValue: 0,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      isTransitioningRef.current = false;
    });
  }, [cardFadeAnim, cardScale, cardTranslateY]);

  // Initialize and run entrance transitions
  useEffect(() => {
    if (visible) {
      setStepIndex(0);
      isTransitioningRef.current = false;
      const initialStep = TUTORIAL_STEPS[0];

      if (Platform.OS === 'android') {
        // Avoid recompositing a full-screen translucent SVG on lower-end
        // Android devices. The tooltip still receives a native-driver entrance.
        modalFadeAnim.setValue(1);
      } else {
        Animated.timing(modalFadeAnim, {
          toValue: 1,
          duration: 160,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      }

      animateCardEntrance(initialStep.pointerDirection);
    } else {
      modalFadeAnim.setValue(0);
    }
  }, [visible, animateCardEntrance, modalFadeAnim]);

  const handleNext = () => {
    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;

    if (stepIndex >= TUTORIAL_STEPS.length - 1) {
      handleFinish();
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // Button tap bounce
    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.88, duration: 80, useNativeDriver: true }),
      Animated.spring(buttonScale, { toValue: 1, damping: 12, stiffness: 200, useNativeDriver: true }),
    ]).start();

    const nextIndex = stepIndex + 1;
    const nextStep = TUTORIAL_STEPS[nextIndex];

    // Only animate composited card properties. Animating SVG geometry on the
    // JavaScript thread causes dropped frames on lower-end Android devices.
    Animated.parallel([
      Animated.timing(cardFadeAnim, {
        toValue: 0,
        duration: 70,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateY, {
        toValue: currentStep.pointerDirection === 'down' ? 8 : -8,
        duration: 70,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setStepIndex(nextIndex);
      requestAnimationFrame(() => animateCardEntrance(nextStep.pointerDirection));
    });
  };

  const handleFinish = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const finishAnimation = Platform.OS === 'android'
      ? Animated.parallel([
          Animated.timing(cardFadeAnim, {
            toValue: 0,
            duration: 100,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(cardScale, {
            toValue: 0.98,
            duration: 100,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      : Animated.timing(modalFadeAnim, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        });
    finishAnimation.start(onClose);
  };

  if (!visible) return null;

  const totalSteps = TUTORIAL_STEPS.length;
  const isLastStep = stepIndex === totalSteps - 1;

  // Compute horizontal pointer indent inside the card container
  const cardHorizontalMargin = 16;
  const cardWidth = screenWidth - cardHorizontalMargin * 2;
  const getPointerIndent = () => {
    if (currentStep.pointerOffsetAlign === 'targetCenter') {
      const targetCenter = currentTarget.x + currentTarget.width / 2;
      return Math.max(22, Math.min(cardWidth - 40, targetCenter - cardHorizontalMargin - 9));
    }
    if (currentStep.pointerOffsetAlign === 'right') {
      return cardWidth - 54;
    }
    if (currentStep.pointerOffsetAlign === 'left') {
      return 36;
    }
    return (cardWidth - 18) / 2;
  };

  // Check if header actions step is active to avoid top right Skip overlap
  const isHeaderStep = currentStep.id === 'header_actions';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      hardwareAccelerated
      onRequestClose={handleFinish}
    >
      <Animated.View style={[styles.overlay, { opacity: modalFadeAnim }]}>
        {/* SVG Spotlight Cutout Backdrop with Animated Morphing */}
        <Svg
          width={screenWidth + 2}
          height={screenHeight + 2}
          style={styles.spotlightCanvas}
        >
          <Defs>
            <Mask id="spotlightMask" x="0" y="0" width={screenWidth + 2} height={screenHeight + 2}>
              <Rect x="0" y="0" width={screenWidth + 2} height={screenHeight + 2} fill="#ffffff" />
              <Rect
                x={currentTarget.x}
                y={currentTarget.y}
                width={currentTarget.width}
                height={currentTarget.height}
                rx={currentTarget.rx || 0}
                ry={currentTarget.rx || 0}
                fill="#000000"
              />
            </Mask>
          </Defs>

          {/* Dark translucent backdrop */}
          <Rect
            x="0"
            y="0"
            width={screenWidth + 2}
            height={screenHeight + 2}
            fill="rgba(10, 14, 22, 0.76)"
            mask="url(#spotlightMask)"
          />

          {/* Static ring keeps the spotlight crisp without JS-thread animation. */}
          <Rect
            x={currentTarget.x + 1}
            y={currentTarget.y + 1}
            width={Math.max(0, currentTarget.width - 2)}
            height={Math.max(0, currentTarget.height - 2)}
            rx={currentTarget.rx || 0}
            ry={currentTarget.rx || 0}
            fill="none"
            stroke="rgba(255, 255, 255, 0.72)"
            strokeOpacity={0.72}
            strokeWidth={1.5}
          />
        </Svg>

        {/* Top Header Row safely placed below notch and status bar */}
        <View style={[styles.topBar, { top: safeTop + 10 }]}>
          <View style={styles.appBadge}>
            <Ionicons name="sparkles" size={13} color="#ffffff" style={styles.appBadgeIcon} />
            <Text style={styles.appBadgeText}>Quick tour</Text>
          </View>
          {!isLastStep && !isHeaderStep && (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleFinish}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Skip tutorial"
            >
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Tooltip Card & Flush Pointer */}
        <Animated.View
          renderToHardwareTextureAndroid
          style={[
            styles.tooltipContainer,
            tooltipPlacement,
            {
              opacity: cardFadeAnim,
              transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
            },
          ]}
        >
          {/* Upward Pointer */}
          {currentStep.pointerDirection === 'up' && (
            <View style={[styles.pointerUpWrapper, { paddingLeft: getPointerIndent() }]}>
              <Svg width={18} height={9} viewBox="0 0 18 9">
                <Polygon points="0,9 18,9 9,0" fill="#1c202d" />
              </Svg>
            </View>
          )}

          {/* Card Body */}
          <View style={styles.card}>
            <Text style={styles.messageText}>{currentStep.message}</Text>

            {/* Bottom Row: Step Dots, Skip link, & Action Button */}
            <View style={styles.bottomRow}>
              {/* Dots Indicator & In-Card Skip Button */}
              <View style={styles.footerLeft}>
                <View style={styles.dotsContainer}>
                  {TUTORIAL_STEPS.map((_, idx) => (
                    <View
                      key={`dot-${idx}`}
                      style={[styles.dot, idx === stepIndex ? styles.dotActive : styles.dotInactive]}
                    />
                  ))}
                </View>

                {!isLastStep && (
                  <TouchableOpacity
                    onPress={handleFinish}
                    activeOpacity={0.65}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Skip tutorial"
                    style={styles.cardSkipBtn}
                  >
                    <Text style={styles.cardSkipText}>Skip</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Action Button with Tap Feedback */}
              <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
                <TouchableOpacity
                  style={styles.nextButton}
                  onPress={handleNext}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={isLastStep ? 'Finish tutorial' : 'Next step'}
                >
                  <Ionicons
                    name={isLastStep ? 'checkmark' : 'arrow-forward'}
                    size={17}
                    color="#1c202d"
                  />
                </TouchableOpacity>
              </Animated.View>
            </View>
          </View>

          {/* Downward Pointer */}
          {currentStep.pointerDirection === 'down' && (
            <View style={[styles.pointerDownWrapper, { paddingLeft: getPointerIndent() }]}>
              <Svg width={18} height={9} viewBox="0 0 18 9">
                <Polygon points="0,0 18,0 9,9" fill="#1c202d" />
              </Svg>
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    overflow: 'hidden',
  },
  spotlightCanvas: {
    position: 'absolute',
    top: -1,
    left: -1,
  },
  topBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10001,
  },
  appBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  appBadgeIcon: {
    marginRight: 5,
  },
  appBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  skipButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
  skipText: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '700',
  },
  tooltipContainer: {
    position: 'absolute',
    zIndex: 10002,
  },
  pointerUpWrapper: {
    width: '100%',
    height: 9,
    justifyContent: 'flex-end',
  },
  pointerDownWrapper: {
    width: '100%',
    height: 9,
    justifyContent: 'flex-start',
  },
  card: {
    backgroundColor: '#1c202d',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 16,
    borderWidth: Platform.OS === 'ios' ? 0.5 : 0,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  messageText: {
    color: '#ffffff',
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 18,
    height: 4.5,
    borderRadius: 2.25,
    backgroundColor: '#ffffff',
  },
  dotActive: {
    opacity: 1,
  },
  dotInactive: {
    opacity: 0.35,
    transform: [{ scaleX: 0.32 }],
  },
  cardSkipBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cardSkipText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12,
    fontWeight: '600',
  },
  nextButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
});

export default React.memo(AppSpotlightTutorial);
