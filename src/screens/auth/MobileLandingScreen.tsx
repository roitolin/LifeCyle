import { Ionicons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Easing,
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type OnboardingStep = {
  label: string;
  title: string;
  body: string;
  image: ImageSourcePropType;
  imageScale?: number;
  imageOffsetY?: number;
  imageOffsetRatio?: number;
};

const ROI_IMAGE_MODULES = [
  require('../../../assets/Character/roi-wave.png'),
  require('../../../assets/Character/roi-guide.png'),
  require('../../../assets/Character/roi-explore.png'),
  require('../../../assets/Character/roi-organize.png'),
  require('../../../assets/Character/roi-ready.png'),
] as number[];

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    label: 'WELCOME TO LIFECYCLE',
    title: 'Hi, I’m Roi.',
    body: '',
    image: ROI_IMAGE_MODULES[0],
  },
  {
    label: 'CLEAR GUIDANCE',
    title: 'I’ll make each next step easier to follow.',
    body: 'Find funeral support and understand your options without unnecessary pressure or clutter.',
    image: ROI_IMAGE_MODULES[1],
  },
  {
    label: 'EXPLORE WITH CLARITY',
    title: 'Find the right funeral shop.',
    body: 'Browse approved shops and review their products, prices, availability, and service information.',
    image: ROI_IMAGE_MODULES[2],
    imageScale: 1.05,
    imageOffsetY: 18,
    imageOffsetRatio: 0.02,
  },
  {
    label: 'KEEP THINGS TOGETHER',
    title: 'Every important detail stays in one place.',
    body: 'Follow requests, messages, payments, and important updates without losing track of what comes next.',
    image: ROI_IMAGE_MODULES[3],
    imageScale: 1.04,
  },
  {
    label: 'READY WHEN YOU ARE',
    title: 'Move forward at your own pace.',
    body: 'Create your account to save shops, contact providers, and manage each next step securely.',
    image: ROI_IMAGE_MODULES[4],
  },
];

function springIn(value: Animated.Value) {
  return Animated.spring(value, {
    toValue: 1,
    damping: 22,
    stiffness: 185,
    mass: 0.9,
    useNativeDriver: true,
  });
}

export default function MobileLandingScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [assetsReady, setAssetsReady] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const sceneProgress = useRef(new Animated.Value(0)).current;
  const sheetProgress = useRef(new Animated.Value(0)).current;
  const backButtonProgress = useRef(new Animated.Value(0)).current;
  const completionProgress = useRef(new Animated.Value(0)).current;
  const dotProgress = useRef(
    ONBOARDING_STEPS.map((_, index) => new Animated.Value(index === 0 ? 1 : 0))
  ).current;
  const transitioning = useRef(false);
  const currentStep = ONBOARDING_STEPS[currentIndex];
  const isLastStep = currentIndex === ONBOARDING_STEPS.length - 1;
  const isCompact = height < 720;
  const illustrationSize = Math.min(Math.max(width - 32, 1), 320);

  useEffect(() => {
    let active = true;
    void Asset.loadAsync(ROI_IMAGE_MODULES)
      .catch((error) => {
        console.warn('Unable to preload onboarding images:', error);
      })
      .finally(() => {
        if (active) setAssetsReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!assetsReady) return;
    sceneProgress.setValue(0);
    sheetProgress.setValue(0);
    const entrance = Animated.parallel([
      springIn(sceneProgress),
      springIn(sheetProgress),
    ]);
    entrance.start();
    return () => {
      entrance.stop();
      sceneProgress.stopAnimation();
      sheetProgress.stopAnimation();
    };
  }, [assetsReady, sceneProgress, sheetProgress]);

  useEffect(() => {
    const navigationAnimation = Animated.parallel([
      Animated.timing(backButtonProgress, {
        toValue: currentIndex > 0 ? 1 : 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(completionProgress, {
        toValue: isLastStep ? 1 : 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      ...dotProgress.map((dot, index) => Animated.timing(dot, {
        toValue: index === currentIndex ? 1 : 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      })),
    ]);
    navigationAnimation.start();
    return () => navigationAnimation.stop();
  }, [backButtonProgress, completionProgress, currentIndex, dotProgress, isLastStep]);

  const showStep = (nextIndex: number) => {
    if (
      transitioning.current
      || nextIndex < 0
      || nextIndex >= ONBOARDING_STEPS.length
      || nextIndex === currentIndex
    ) {
      return;
    }

    transitioning.current = true;
    sceneProgress.stopAnimation();
    Animated.timing(sceneProgress, {
      toValue: 0,
      duration: 170,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        transitioning.current = false;
        return;
      }

      setCurrentIndex(nextIndex);
      sceneProgress.setValue(0);
      requestAnimationFrame(() => {
        springIn(sceneProgress).start(() => {
          transitioning.current = false;
        });
      });
    });
  };

  const completeOnboarding = (destination: 'Login' | 'Register') => {
    navigation.replace(destination);
  };

  const sceneOpacity = sceneProgress.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 1, 1],
    extrapolate: 'clamp',
  });
  const characterTranslateY = sceneProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [44, 0],
  });
  const characterScale = sceneProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });
  const messageTranslateY = sceneProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [22, 0],
  });
  const sheetOpacity = sheetProgress.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 1, 1],
    extrapolate: 'clamp',
  });
  const sheetTranslateY = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [120, 0],
  });
  const sheetScale = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.985, 1],
  });
  const backButtonWidth = backButtonProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 52],
  });
  const backButtonSpacing = backButtonProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 10],
  });
  const backButtonScale = backButtonProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.84, 1],
  });
  const completionHeight = completionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 44],
  });
  const skipOpacity = completionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });
  if (!assetsReady) {
    return (
      <SafeAreaView edges={['left', 'right']} style={styles.screen}>
        <StatusBar style='dark' translucent backgroundColor='transparent' />
        <View style={styles.loadingState}>
          <ActivityIndicator color='#315f52' size='small' />
          <Text style={styles.loadingText}>Preparing LifeCycle</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <StatusBar style='dark' translucent backgroundColor='transparent' />

      <View style={[styles.floatingHeader, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerRow}>
          <View style={styles.brand}>
            <Image
              accessible={false}
              resizeMode='contain'
              source={require('../../../assets/Icon/AppICONTransparents.png')}
              style={styles.brandIcon}
            />
            <Text style={styles.brandName}>LifeCycle</Text>
          </View>

          <Animated.View
            pointerEvents={isLastStep ? 'none' : 'auto'}
            style={[styles.skipSlot, { opacity: skipOpacity }]}
          >
            <Pressable
              accessibilityLabel='Skip onboarding'
              accessibilityRole='button'
              hitSlop={10}
              onPress={() => completeOnboarding('Login')}
              style={({ pressed }) => [styles.skipButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          </Animated.View>
        </View>

      </View>

      <View style={styles.heroStage}>
        <Animated.View
          style={[
            styles.characterContainer,
            {
              opacity: sceneOpacity,
              transform: [
                { translateY: characterTranslateY },
                { scale: characterScale },
              ],
            },
          ]}
        >
          <Image
            key={'roi-onboarding-' + currentIndex}
            accessibilityIgnoresInvertColors
            fadeDuration={0}
            resizeMode='contain'
            source={currentStep.image}
            style={[
              styles.character,
              {
                width: illustrationSize,
                height: illustrationSize,
                transform: [
                  {
                    translateY: -22
                      + (currentStep.imageOffsetY || 0)
                      + illustrationSize * (currentStep.imageOffsetRatio || 0),
                  },
                  { scale: currentStep.imageScale || 1 },
                ],
              },
            ]}
          />
        </Animated.View>
      </View>

      <Animated.View
        style={[
          styles.messageSheet,
          {
            paddingBottom: Math.max(insets.bottom, 12) + 10,
            opacity: sheetOpacity,
            transform: [
              { translateY: sheetTranslateY },
              { scale: sheetScale },
            ],
          },
        ]}
      >
        <Animated.View
          accessibilityLiveRegion='polite'
          style={[
            styles.messageContent,
            {
              opacity: sceneOpacity,
              transform: [{ translateY: messageTranslateY }],
            },
          ]}
        >
          <Text style={styles.stepLabel}>{currentStep.label}</Text>
          <Text accessibilityRole='header' style={[styles.title, isCompact && styles.titleCompact]}>
            {currentStep.title}
          </Text>
          {currentStep.body ? (
            <Text style={[styles.body, isCompact && styles.bodyCompact]}>{currentStep.body}</Text>
          ) : null}
        </Animated.View>

        <View style={styles.footer}>
          <View
            accessibilityLabel={'Step ' + (currentIndex + 1) + ' of ' + ONBOARDING_STEPS.length}
            accessibilityRole='progressbar'
            accessibilityValue={{ min: 1, max: ONBOARDING_STEPS.length, now: currentIndex + 1 }}
            style={styles.pageIndicator}
          >
            {ONBOARDING_STEPS.map((step, index) => (
              <Animated.View
                key={step.label}
                style={[
                  styles.pageDot,
                  {
                    width: dotProgress[index].interpolate({
                      inputRange: [0, 1],
                      outputRange: [6, 20],
                    }),
                    backgroundColor: dotProgress[index].interpolate({
                      inputRange: [0, 1],
                      outputRange: ['#d7ddda', '#315f52'],
                    }),
                  },
                ]}
              />
            ))}
          </View>

          <View style={styles.actionRow}>
            <Animated.View
              pointerEvents={currentIndex > 0 ? 'auto' : 'none'}
              style={[
                styles.backButtonSlot,
                {
                  width: backButtonWidth,
                  marginRight: backButtonSpacing,
                  opacity: backButtonProgress,
                  transform: [{ scale: backButtonScale }],
                },
              ]}
            >
              <Pressable
                accessibilityLabel='Previous step'
                accessibilityRole='button'
                hitSlop={6}
                onPress={() => showStep(currentIndex - 1)}
                style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
              >
                <Ionicons name='arrow-back' size={21} color='#22312d' />
              </Pressable>
            </Animated.View>

            <Pressable
              accessibilityRole='button'
              onPress={() => {
                if (isLastStep) {
                  completeOnboarding('Register');
                  return;
                }
                showStep(currentIndex + 1);
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            >
              <View style={styles.primaryButtonLabelStack}>
                <Animated.View
                  pointerEvents='none'
                  style={[styles.primaryButtonContent, styles.primaryButtonLabelLayer, { opacity: skipOpacity }]}
                >
                  <Text style={styles.primaryButtonText}>Next</Text>
                  <Ionicons name='arrow-forward' size={20} color='#ffffff' />
                </Animated.View>
                <Animated.View
                  pointerEvents='none'
                  style={[
                    styles.primaryButtonContent,
                    styles.primaryButtonLabelLayer,
                    { opacity: completionProgress },
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Get started</Text>
                  <Ionicons name='checkmark' size={20} color='#ffffff' />
                </Animated.View>
              </View>
            </Pressable>
          </View>

          <Animated.View
            pointerEvents={isLastStep ? 'auto' : 'none'}
            style={[
              styles.signInSlot,
              {
                height: completionHeight,
                opacity: completionProgress,
              },
            ]}
          >
            <Pressable
              accessibilityRole='button'
              hitSlop={8}
              onPress={() => completeOnboarding('Login')}
              style={({ pressed }) => [styles.signInButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.signInText}>Already have an account? </Text>
              <Text style={styles.signInLink}>Sign in</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#d7d8d5',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#56645f',
    fontSize: 12,
    fontWeight: '700',
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 20,
  },
  headerRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIcon: {
    width: 28,
    height: 28,
  },
  brandName: {
    color: '#22312d',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  skipButton: {
    minWidth: 50,
    minHeight: 38,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipSlot: {
    width: 50,
  },
  skipText: {
    color: '#485a54',
    fontSize: 13,
    fontWeight: '800',
  },
  heroStage: {
    flex: 1.12,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  characterContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  character: {
    backgroundColor: 'transparent',
  },
  messageSheet: {
    flex: 0.88,
    marginTop: -40,
    paddingTop: 28,
    paddingHorizontal: 25,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 8,
    zIndex: 2,
  },
  messageContent: {
    flex: 1,
    alignItems: 'center',
  },
  stepLabel: {
    color: '#527266',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1.25,
    textAlign: 'center',
  },
  title: {
    maxWidth: 340,
    color: '#20322c',
    fontSize: 27,
    lineHeight: 33,
    fontWeight: '900',
    letterSpacing: -0.65,
    marginTop: 9,
    textAlign: 'center',
  },
  titleCompact: {
    fontSize: 24,
    lineHeight: 29,
  },
  body: {
    maxWidth: 340,
    color: '#69746f',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 12,
    textAlign: 'center',
  },
  bodyCompact: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 9,
  },
  footer: {
    paddingTop: 16,
  },
  pageIndicator: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 12,
  },
  pageDot: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#d7ddda',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButtonSlot: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  backButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dce1dd',
    backgroundColor: '#f5f7f4',
  },
  primaryButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderRadius: 26,
    backgroundColor: '#244d42',
  },
  primaryButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryButtonLabelStack: {
    width: 130,
    height: 24,
  },
  primaryButtonLabelLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  primaryButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  signInSlot: {
    overflow: 'hidden',
  },
  signInButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  signInText: {
    color: '#6b7772',
    fontSize: 12,
  },
  signInLink: {
    color: '#244d42',
    fontSize: 12,
    fontWeight: '900',
  },
  buttonPressed: {
    opacity: 0.62,
  },
});
