import { useMemo, useState } from 'react';
import {
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Button } from 'react-native-paper';

import { useAuth } from '@/context/AuthContext';
import { termsSections } from '@/screens/shared/TermsOfUseScreen';
import { confirmLogout } from '@/utils/logoutConfirmation';

const EFFECTIVE_DATE = 'April 2, 2026';

export default function TermsAndConditionsScreen() {
  const [hasReachedEnd, setHasReachedEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [readProgress, setReadProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const { acceptTerms, logout, user } = useAuth();

  const ownerName = useMemo(() => {
    const displayName = String(user?.displayName || '').trim();
    if (displayName) return displayName.split(/\s+/)[0];
    const emailName = String(user?.email || '').split('@')[0].trim();
    return emailName || 'there';
  }, [user?.displayName, user?.email]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const scrollableDistance = Math.max(
      contentSize.height - layoutMeasurement.height,
      1
    );
    const nextProgress = Math.min(
      1,
      Math.max(0, contentOffset.y / scrollableDistance)
    );
    setReadProgress(nextProgress);

    if (
      layoutMeasurement.height + contentOffset.y >=
      contentSize.height - 24
    ) {
      setHasReachedEnd(true);
      setReadProgress(1);
    }
  };

  const handleContinue = async () => {
    if (!hasReachedEnd) {
      Alert.alert('Keep reading', 'Reach the end of the document before continuing.');
      return;
    }
    if (!accepted) {
      Alert.alert('Confirmation required', 'Confirm that you reviewed the agreement.');
      return;
    }

    setSaving(true);
    try {
      await acceptTerms();
    } catch (error) {
      Alert.alert(
        'Acceptance not saved',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const canContinue = hasReachedEnd && accepted && !saving;
  const progressPercent = Math.round(readProgress * 100);
  const progressWidth = (progressPercent + '%') as `${number}%`;

  return (
    <View style={styles.page}>
      <StatusBar style='dark' />
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.hero}>
          <Text accessibilityRole='header' style={styles.heroTitle}>Review the LifeCycle agreement</Text>
          <Text style={styles.heroText}>
            Signed in as {ownerName}. Read every section before confirming your agreement.
          </Text>
        </View>

        <View style={styles.documentCard}>
          <View style={styles.documentHeader}>
            <View style={styles.documentTitleRow}>
              <View style={styles.documentTitleCopy}>
                <Text style={styles.documentTitle}>LifeCycle Agreement</Text>
                <Text style={styles.updated}>Effective {EFFECTIVE_DATE}</Text>
              </View>
              <View style={styles.progressBadge}>
                <Text style={styles.progressBadgeText}>{progressPercent}%</Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
          </View>

          <ScrollView
            style={styles.documentScroll}
            contentContainerStyle={styles.documentContent}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator
          >
            <Text style={styles.introduction}>
              This agreement explains the responsibilities of families, account owners, and funeral-service providers when using LifeCycle.
            </Text>

            {termsSections.map((section, index) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {index + 1}. {section.title}
                </Text>
                {section.paragraphs.map((paragraph) => (
                  <Text key={paragraph} style={styles.paragraph}>
                    {paragraph}
                  </Text>
                ))}
                {section.bulletPoints?.map((point) => (
                  <View key={point} style={styles.bulletRow}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.bulletText}>{point}</Text>
                  </View>
                ))}
              </View>
            ))}

            <View style={styles.endMarker}>
              <Ionicons name='checkmark-circle' size={23} color='#3f6f58' />
              <View style={styles.endMarkerCopy}>
                <Text style={styles.endMarkerTitle}>You reached the end</Text>
                <Text style={styles.endMarkerText}>
                  Confirm your review below to unlock the continue button.
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole='checkbox'
              accessibilityState={{ checked: accepted, disabled: !hasReachedEnd }}
              disabled={!hasReachedEnd}
              onPress={() => setAccepted((current) => !current)}
              style={[styles.acceptRow, !hasReachedEnd && styles.acceptRowDisabled]}
            >
              <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
                {accepted ? <Ionicons name='checkmark' size={16} color='#ffffff' /> : null}
              </View>
              <Text style={styles.acceptText}>
                I reviewed this agreement and consent to follow it while using LifeCycle.
              </Text>
            </Pressable>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.unlockStatus}>
              <Ionicons
                name={hasReachedEnd ? 'lock-open-outline' : 'lock-closed-outline'}
                size={16}
                color={hasReachedEnd ? '#3f6f58' : '#8a7950'}
              />
              <Text style={styles.unlockText}>
                {hasReachedEnd
                  ? accepted
                    ? 'Ready to continue'
                    : 'Confirm your review above'
                  : 'Scroll through every section to continue'}
              </Text>
            </View>

            <View style={styles.actions}>
              <Button
                mode='outlined'
                disabled={saving}
                onPress={() => confirmLogout({ logout })}
                style={styles.actionButton}
                textColor='#5a6b64'
              >
                Sign out
              </Button>
              <Button
                mode='contained'
                buttonColor='#22312d'
                disabled={!canContinue}
                loading={saving}
                onPress={handleContinue}
                style={styles.actionButton}
              >
                Agree and continue
              </Button>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f3f5f7',
  },
  screen: {
    flex: 1,
  },
  hero: {
    minHeight: 112,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 18,
    justifyContent: 'center',
    backgroundColor: '#f3f5f7',
  },
  heroTitle: {
    color: '#17243d',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    marginBottom: 5,
  },
  heroText: {
    maxWidth: 520,
    color: '#58677b',
    fontSize: 13,
    lineHeight: 19,
  },
  documentCard: {
    flex: 1,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: '#d8e0e8',
    backgroundColor: '#ffffff',
  },
  documentHeader: {
    paddingHorizontal: 20,
    paddingTop: 19,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#ece9e1',
  },
  documentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  documentTitleCopy: {
    flex: 1,
    minWidth: 0,
  },
  documentTitle: {
    color: '#22312d',
    fontSize: 23,
    fontWeight: '900',
  },
  updated: {
    color: '#8a928d',
    fontSize: 10,
    marginTop: 4,
  },
  progressBadge: {
    minWidth: 42,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    backgroundColor: '#ebf1e8',
  },
  progressBadgeText: {
    color: '#41514d',
    fontSize: 10,
    fontWeight: '900',
  },
  progressTrack: {
    height: 4,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: '#e7e5df',
    marginTop: 13,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#8a7950',
  },
  documentScroll: {
    flex: 1,
  },
  documentContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  introduction: {
    color: '#41514d',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 18,
  },
  section: {
    marginBottom: 17,
  },
  sectionTitle: {
    color: '#22312d',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    marginBottom: 7,
  },
  paragraph: {
    color: '#4f5c57',
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginBottom: 7,
    paddingLeft: 4,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#8a7950',
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    color: '#4f5c57',
    fontSize: 12,
    lineHeight: 19,
  },
  endMarker: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#ebf1e8',
    marginTop: 3,
    marginBottom: 12,
  },
  endMarkerCopy: {
    flex: 1,
  },
  endMarkerTitle: {
    color: '#22312d',
    fontSize: 12,
    fontWeight: '900',
  },
  endMarkerText: {
    color: '#62706b',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  acceptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d7cba9',
    backgroundColor: '#fbf7ea',
  },
  acceptRowDisabled: {
    opacity: 0.55,
  },
  checkbox: {
    width: 23,
    height: 23,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#8a7950',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  checkboxChecked: {
    borderColor: '#3f6f58',
    backgroundColor: '#3f6f58',
  },
  acceptText: {
    flex: 1,
    color: '#41514d',
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '700',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#e7e5df',
    backgroundColor: '#ffffff',
  },
  unlockStatus: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 7,
  },
  unlockText: {
    color: '#62706b',
    fontSize: 10,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 9,
  },
  actionButton: {
    flex: 1,
    borderRadius: 999,
  },
});
