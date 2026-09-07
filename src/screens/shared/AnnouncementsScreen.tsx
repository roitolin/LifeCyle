import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBackButton } from '@/components';
import LoadingBird from '@/components/LoadingBird';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import { colors, radii, spacing } from '@/theme';
import { useResponsive } from '@/utils/responsive';

type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: 'all' | 'users' | 'funeral_shops';
  isPinned: boolean;
  createdAt: string;
};

function getAnnouncementDate(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Recently published';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const publishedDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round((today.getTime() - publishedDay.getTime()) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (daysAgo === 0) return 'Today at ' + time;
  if (daysAgo === 1) return 'Yesterday at ' + time;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}
export default function AnnouncementsScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { role } = useAuth();
  const { isDesktop } = useResponsive();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const characterProgress = useRef(new Animated.Value(0)).current;
  const messageSheetProgress = useRef(new Animated.Value(0)).current;
  const selectedAnnouncementId = String(route?.params?.announcementId || '').trim();
  const audience = role === 'funeral_admin' ? 'funeral_shops' : 'users';

  useEffect(() => {
    characterProgress.setValue(0);
    messageSheetProgress.setValue(0);

    Animated.parallel([
      Animated.spring(characterProgress, {
        toValue: 1,
        damping: 19,
        stiffness: 210,
        mass: 0.85,
        useNativeDriver: true,
      }),
      Animated.spring(messageSheetProgress, {
        toValue: 1,
        damping: 19,
        stiffness: 210,
        mass: 0.85,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      characterProgress.stopAnimation();
      messageSheetProgress.stopAnimation();
    };
  }, [characterProgress, messageSheetProgress]);

  const loadAnnouncements = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, body, audience, isPinned, createdAt')
        .eq('status', 'active')
        .in('audience', ['all', audience])
        .order('isPinned', { ascending: false })
        .order('createdAt', { ascending: false });
      if (error) throw error;
      setAnnouncements((data || []) as Announcement[]);
    } catch (error) {
      console.warn('Unable to load announcements:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [audience]);

  useEffect(() => {
    void loadAnnouncements(true);
    const channel = supabase
      .channel('user-announcements-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => void loadAnnouncements()
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadAnnouncements]);

  const visibleAnnouncements = useMemo(() => {
    if (!selectedAnnouncementId) return announcements;
    const selectedIndex = announcements.findIndex((item) => item.id === selectedAnnouncementId);
    if (selectedIndex <= 0) return announcements;
    const selected = announcements[selectedIndex];
    return [selected, ...announcements.filter((item) => item.id !== selectedAnnouncementId)];
  }, [announcements, selectedAnnouncementId]);

  const refresh = () => {
    setRefreshing(true);
    void loadAnnouncements();
  };
  const renderAnnouncement = ({ item }: { item: Announcement }) => {
    return (
      <View style={styles.announcementItem}>
        <Text style={styles.messageTitle}>{item.title || 'LifeCycle update'}</Text>
        <Text style={styles.messageBody}>{item.body}</Text>
        <Text style={styles.dateText}>{getAnnouncementDate(item.createdAt)}</Text>
      </View>
    );
  };
  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <View style={[styles.floatingHeader, { paddingTop: insets.top + spacing.sm }]}>
        <AppBackButton style={styles.floatingBackButton} onPress={() => navigation.goBack()} />
      </View>
      <View style={styles.heroStage}>
        <Animated.View
          style={[
            styles.animatedCharacter,
            {
              opacity: characterProgress.interpolate({
                inputRange: [0, 0.12, 1],
                outputRange: [0, 1, 1],
                extrapolate: 'clamp',
              }),
              transform: [
                {
                  translateY: characterProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [72, 0],
                  }),
                },
                {
                  scale: characterProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <AnnouncementHeader />
        </Animated.View>
      </View>
      <Animated.View
        style={[
          styles.messageSheet,
          isDesktop && styles.messageSheetDesktop,
          {
            opacity: messageSheetProgress.interpolate({
              inputRange: [0, 0.12, 1],
              outputRange: [0, 1, 1],
              extrapolate: 'clamp',
            }),
            transform: [
              {
                translateY: messageSheetProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [120, 0],
                }),
              },
              {
                scale: messageSheetProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.985, 1],
                }),
              },
            ],
          },
        ]}
      >
        <FlatList
          data={loading ? [] : visibleAnnouncements}
          keyExtractor={(item) => item.id}
          renderItem={renderAnnouncement}
          ItemSeparatorComponent={() => <View style={styles.messageSeparator} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.messageListContent,
            { paddingBottom: spacing.xxl + insets.bottom },
            (loading || visibleAnnouncements.length === 0) && styles.emptyContent,
          ]}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          )}
          ListEmptyComponent={loading ? (
            <LoadingBird compact style={styles.loader} />
          ) : (
            <AnnouncementEmptyState
              hasError={loadError}
              onRetry={() => void loadAnnouncements(true)}
            />
          )}
        />
      </Animated.View>
    </SafeAreaView>
  );
}

function AnnouncementHeader() {
  const { width } = useWindowDimensions();
  const illustrationSize = Math.min(Math.max(width - spacing.xxl, 1), 320);

  return (
    <View style={styles.illustrationHeader}>
      <Image
        source={require('../../../assets/Character/Announcement-character.png')}
        resizeMode='contain'
        style={[styles.illustration, { width: illustrationSize, height: illustrationSize }]}
      />
    </View>
  );
}

function AnnouncementEmptyState({ hasError, onRetry }: { hasError: boolean; onRetry: () => void }) {
  return (
    <View style={styles.stateCard}>
      <View style={[styles.stateIcon, hasError && styles.errorIcon]}>
        <Ionicons
          name={hasError ? 'cloud-offline-outline' : 'checkmark-circle-outline'}
          size={30}
          color={hasError ? colors.danger : colors.primary}
        />
      </View>
      <Text style={styles.stateTitle}>{hasError ? 'Couldn’t load announcements' : 'You’re all caught up'}</Text>
      <Text style={styles.stateText}>
        {hasError ? 'Check your connection, then try again.' : 'New announcements from LifeCycle will appear here.'}
      </Text>
      {hasError ? (
        <TouchableOpacity accessibilityRole='button' activeOpacity={0.75} style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#d7d8d5' },
  loader: {
    flex: 1,
    minHeight: 180,
    backgroundColor: colors.surface,
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  floatingBackButton: {
    borderWidth: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
  },
  heroStage: {
    flex: 1.12,
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: '#d7d8d5',
  },
  illustrationHeader: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  animatedCharacter: {
    width: '100%',
    alignItems: 'center',
  },
  illustration: {
    backgroundColor: 'transparent',
    transform: [{ translateY: -22 }],
  },
  messageSheet: {
    flex: 0.88,
    marginTop: -40,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 8,
    zIndex: 2,
  },
  messageSheetDesktop: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  messageListContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  emptyContent: { flexGrow: 1 },
  announcementItem: {
    paddingVertical: spacing.md,
  },
  messageSeparator: {
    height: 1,
    backgroundColor: '#eceeea',
  },
  dateText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  messageTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  messageBody: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  stateCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: 48,
  },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f0ec',
  },
  errorIcon: { backgroundColor: '#fbefed' },
  stateTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  stateText: {
    maxWidth: 320,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    marginTop: spacing.lg,
  },
  retryText: { color: colors.surface, fontSize: 13, fontWeight: '800' },
});
