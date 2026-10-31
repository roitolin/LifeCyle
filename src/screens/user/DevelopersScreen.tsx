import { useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Alert,
  Animated,
  Image,
  type ImageSourcePropType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

type Developer = {
  name: string;
  image: ImageSourcePropType;
  color: string;
};

const CARD_GAP = 16;

const developers: Developer[] = [
  { name: 'Ezra M. Baguhin', image: require('../../../assets/Members/BAGUHIN, EZRA M.png'), color: '#ffe7ad' },
  { name: 'Jared M. Cuerbo', image: require('../../../assets/Members/CUERBO, JARED M.png'), color: '#f8edf1' },
  { name: 'Daisy Y. Derial', image: require('../../../assets/Members/DERIAL, DAISY Y.png'), color: '#dfe8f8' },
  { name: 'Elenne Antonette P. Garbo', image: require('../../../assets/Members/GARBO, ELENNE ANTONETTE P.png'), color: '#f8d9c5' },
  { name: 'Princess Mecca P. Quijano', image: require('../../../assets/Members/QUIJANO, PRINCESS MECCA P.png'), color: '#dcefdc' },
  { name: 'Roi Veinze A. Tolin', image: require('../../../assets/Members/TOLIN, ROI VEINZE A.png'), color: '#e6dcf4' },
];

export default function DevelopersScreen() {
  const { width, height } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedDeveloper, setSelectedDeveloper] = useState<Developer | null>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const cardWidth = Math.min(250, Math.max(210, width * 0.68));
  const cardHeight = Math.min(430, Math.max(300, height - 380));
  const imageHeight = Math.round(cardHeight * 0.7);
  const snapInterval = cardWidth + CARD_GAP;
  const sidePadding = (width - cardWidth) / 2;

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / snapInterval);
    setActiveIndex(Math.max(0, Math.min(developers.length - 1, nextIndex)));
  };

  const showUnavailableContact = (channel: 'Gmail' | 'phone number' | 'Facebook profile') => {
    if (!selectedDeveloper) return;
    Alert.alert(
      'Contact details coming soon',
      `${selectedDeveloper.name}'s ${channel} has not been added yet.`,
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <View style={styles.introduction}>
        <Text style={styles.eyebrow}>THE LIFECYCLE TEAM</Text>
        <Text accessibilityRole='header' style={styles.title}>Built by people who care.</Text>
        <Text style={styles.subtitle}>Swipe left or right to meet every member of the development team.</Text>
        <View style={styles.swipeHint}>
          <Ionicons name='swap-horizontal' size={17} color={colors.primary} />
          <Text style={styles.swipeHintText}>Swipe to explore</Text>
        </View>
      </View>

      <Animated.FlatList
        style={styles.carousel}
        horizontal
        data={developers}
        accessibilityLabel='Developer carousel. Swipe left or right to browse the team.'
        keyExtractor={(item) => item.name}
        showsHorizontalScrollIndicator={false}
        decelerationRate='fast'
        snapToInterval={snapInterval}
        snapToAlignment='start'
        disableIntervalMomentum
        onMomentumScrollEnd={handleScrollEnd}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.carouselContent, { paddingHorizontal: sidePadding }]}
        getItemLayout={(_, index) => ({ length: snapInterval, offset: snapInterval * index, index })}
        renderItem={({ item, index }) => {
          const inputRange = [
            (index - 1) * snapInterval,
            index * snapInterval,
            (index + 1) * snapInterval,
          ];
          const scale = scrollX.interpolate({
            inputRange,
            outputRange: [0.82, 1, 0.82],
            extrapolate: 'clamp',
          });
          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.52, 1, 0.52],
            extrapolate: 'clamp',
          });
          const translateY = scrollX.interpolate({
            inputRange,
            outputRange: [18, 0, 18],
            extrapolate: 'clamp',
          });

          return (
            <Animated.View
              style={[
                styles.developerCard,
                {
                  width: cardWidth,
                  height: cardHeight,
                  backgroundColor: item.color,
                  opacity,
                  transform: [{ translateY }, { scale }],
                },
              ]}
            >
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={`View ${item.name}'s developer profile, ${index + 1} of ${developers.length}`}
                accessibilityHint='Opens a full-screen developer profile'
                onPress={() => setSelectedDeveloper(item)}
                style={({ pressed }) => [styles.cardPressable, pressed && styles.cardPressed]}
              >
                <View style={styles.developerCopy}>
                  <Text style={styles.developerName} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.developerRole}>LifeCycle developer</Text>
                </View>
                <Image
                  source={item.image}
                  resizeMode='cover'
                  style={[styles.developerImage, { height: imageHeight }]}
                  accessibilityIgnoresInvertColors
                />
                <View style={styles.openProfileHint}>
                  <Ionicons name='expand-outline' size={14} color='#ffffff' />
                  <Text style={styles.openProfileHintText}>View profile</Text>
                </View>
              </Pressable>
            </Animated.View>
          );
        }}
      />

      <View style={styles.pagination} accessibilityLiveRegion='polite'>
        <Text style={styles.paginationCount}>{activeIndex + 1} / {developers.length}</Text>
        <View style={styles.paginationDots}>
          {developers.map((developer, index) => (
            <View key={developer.name} style={[styles.paginationDot, index === activeIndex && styles.paginationDotActive]} />
          ))}
        </View>
      </View>

      <Modal
        visible={selectedDeveloper !== null}
        animationType='fade'
        presentationStyle='fullScreen'
        statusBarTranslucent
        onRequestClose={() => setSelectedDeveloper(null)}
      >
        <View style={styles.profileScreen}>
          {selectedDeveloper ? (
            <>
              <Image
                source={selectedDeveloper.image}
                resizeMode='cover'
                style={[styles.profileImage, { width, height }]}
                accessibilityLabel={`${selectedDeveloper.name}, LifeCycle developer`}
                accessibilityIgnoresInvertColors
              />
              <LinearGradient
                pointerEvents='none'
                colors={['rgba(15,18,16,0.05)', 'rgba(15,18,16,0.2)', 'rgba(15,18,16,0.95)']}
                locations={[0, 0.48, 1]}
                style={StyleSheet.absoluteFill}
              />
              <SafeAreaView style={styles.profileSafeArea} edges={['top', 'left', 'right', 'bottom']}>
                <View style={styles.profileTopRow}>
                  <View style={styles.profileBadge}>
                    <Ionicons name='code-slash-outline' size={14} color='#ffffff' />
                    <Text style={styles.profileBadgeText}>LIFECYCLE TEAM</Text>
                  </View>
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Close developer profile'
                    hitSlop={8}
                    onPress={() => setSelectedDeveloper(null)}
                    style={({ pressed }) => [styles.closeButton, pressed && styles.cardPressed]}
                  >
                    <Ionicons name='close' size={24} color='#ffffff' />
                  </Pressable>
                </View>

                <View style={styles.profileContent}>
                  <Text style={styles.profileRole}>LIFECYCLE DEVELOPER</Text>
                  <Text accessibilityRole='header' style={styles.profileName}>{selectedDeveloper.name}</Text>
                  <Text style={styles.profileDescription}>Part of the team designing and building the LifeCycle experience.</Text>

                  <Text style={styles.contactHeading}>Contact</Text>
                  <View style={styles.contactActions}>
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel={`Contact ${selectedDeveloper.name} through Gmail`}
                      onPress={() => showUnavailableContact('Gmail')}
                      style={({ pressed }) => [styles.contactButton, pressed && styles.contactButtonPressed]}
                    >
                      <View style={styles.contactIconWrap}>
                        <Ionicons name='mail' size={22} color='#EA4335' />
                      </View>
                      <Text style={styles.contactLabel}>Gmail</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel={`Call ${selectedDeveloper.name}`}
                      onPress={() => showUnavailableContact('phone number')}
                      style={({ pressed }) => [styles.contactButton, pressed && styles.contactButtonPressed]}
                    >
                      <View style={styles.contactIconWrap}>
                        <Ionicons name='call' size={22} color='#34A853' />
                      </View>
                      <Text style={styles.contactLabel}>Phone</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel={`Open ${selectedDeveloper.name}'s Facebook profile`}
                      onPress={() => showUnavailableContact('Facebook profile')}
                      style={({ pressed }) => [styles.contactButton, pressed && styles.contactButtonPressed]}
                    >
                      <View style={styles.contactIconWrap}>
                        <Ionicons name='logo-facebook' size={23} color='#1877F2' />
                      </View>
                      <Text style={styles.contactLabel}>Facebook</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.contactNote}>Contact links will be connected when the team details are available.</Text>
                </View>
              </SafeAreaView>
            </>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceMuted },
  introduction: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 18 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 29, lineHeight: 35, fontWeight: '900', marginTop: 8 },
  subtitle: { maxWidth: 430, color: colors.textMuted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  swipeHint: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: colors.borderWarm, borderRadius: 999, backgroundColor: colors.surfaceWarm, paddingHorizontal: 12, paddingVertical: 8, marginTop: 14 },
  swipeHintText: { color: colors.primaryDark, fontSize: 11, fontWeight: '700' },
  carousel: { flex: 1 },
  carouselContent: { alignItems: 'center', paddingBottom: 12 },
  developerCard: { borderRadius: 130, overflow: 'hidden', marginRight: CARD_GAP, paddingTop: 42 },
  cardPressable: { flex: 1 },
  cardPressed: { opacity: 0.86 },
  developerCopy: { zIndex: 1, alignItems: 'center', paddingHorizontal: 24 },
  developerName: { color: '#202421', fontSize: 20, lineHeight: 25, fontWeight: '800', textAlign: 'center' },
  developerRole: { color: '#59615d', fontSize: 13, fontWeight: '600', marginTop: 4 },
  developerImage: { position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', borderTopLeftRadius: 130, borderTopRightRadius: 130 },
  openProfileHint: { position: 'absolute', left: 0, right: 0, bottom: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginHorizontal: 48, borderRadius: 999, backgroundColor: 'rgba(20,24,21,0.72)', paddingHorizontal: 10, paddingVertical: 7 },
  openProfileHintText: { color: '#ffffff', fontSize: 10, fontWeight: '800' },
  pagination: { alignItems: 'center', gap: 9, paddingTop: 8, paddingBottom: 10 },
  paginationCount: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
  paginationDots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paginationDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderWarm },
  paginationDotActive: { width: 20, backgroundColor: colors.primary },
  profileScreen: { flex: 1, backgroundColor: '#111411' },
  profileImage: { position: 'absolute', top: 0, left: 0 },
  profileSafeArea: { flex: 1, paddingHorizontal: 20 },
  profileTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 },
  profileBadge: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 999, backgroundColor: 'rgba(22,27,23,0.68)', paddingHorizontal: 12 },
  profileBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(22,27,23,0.68)' },
  profileContent: { marginTop: 'auto', paddingBottom: 22 },
  profileRole: { color: '#cbd7d0', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  profileName: { maxWidth: 330, color: '#ffffff', fontSize: 38, lineHeight: 43, fontWeight: '900', marginTop: 7 },
  profileDescription: { maxWidth: 360, color: '#e1e7e3', fontSize: 13, lineHeight: 20, marginTop: 9 },
  contactHeading: { color: '#ffffff', fontSize: 13, fontWeight: '900', marginTop: 22, marginBottom: 10 },
  contactActions: { flexDirection: 'row', gap: 9 },
  contactButton: { flex: 1, minHeight: 82, alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)' },
  contactButtonPressed: { backgroundColor: 'rgba(255,255,255,0.2)', transform: [{ scale: 0.97 }] },
  contactIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  contactLabel: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  contactNote: { color: '#b9c3bd', fontSize: 10, lineHeight: 15, marginTop: 10 },
});
