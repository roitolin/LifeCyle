import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { recordAccountActivity } from '@/utils/accountActivity';
import { formatStoredDeviceName } from '@/utils/deviceModelNames';
import {
  listActiveAccountSessions,
  revokeAccountSession,
  signOutOtherAccountSessions,
  type AccountSessionItem,
} from '@/utils/accountSessions';

function sessionIcon(session: AccountSessionItem): keyof typeof Ionicons.glyphMap {
  const type = String(session.device_type || '').toLowerCase();
  if (type.includes('web') || session.platform === 'web') return 'desktop-outline';
  if (type.includes('tablet')) return 'tablet-portrait-outline';
  return 'phone-portrait-outline';
}

function formatLastActive(value: string, isCurrent: boolean) {
  if (isCurrent) return 'Active now';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Activity time unavailable';

  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) return 'Active moments ago';
  if (elapsedMinutes < 60) return 'Active ' + elapsedMinutes + ' min ago';

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return 'Active ' + elapsedHours + (elapsedHours === 1 ? ' hour ago' : ' hours ago');

  return 'Last active ' + new Date(value).toLocaleString(undefined, { hour12: true });
}

export default function ActiveSessionsScreen() {
  const { logoutEverywhere } = useAuth();
  const [sessions, setSessions] = useState<AccountSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<'others' | 'all' | null>(null);

  const loadSessions = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage('');

    try {
      setSessions(await listActiveAccountSessions());
    } catch (error: any) {
      const message = String(error?.message || '');
      setErrorMessage(
        message.includes('list_active_account_sessions')
          ? 'Active sessions need the account session database setup.'
          : message || 'Active sessions could not be loaded.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const otherSessionCount = useMemo(
    () => sessions.filter((session) => !session.is_current).length,
    [sessions]
  );

  const confirmSessionSignOut = (session: AccountSessionItem) => {
    const deviceName = formatStoredDeviceName(session.device_name);
    Alert.alert(
      'Sign out this device?',
      deviceName +
        ' will lose access when LifeCycle next verifies or refreshes its session.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setRevokingSessionId(session.session_id);
            try {
              await revokeAccountSession(session.session_id);
              await recordAccountActivity('session_revoked');
              await loadSessions();
            } catch (error: any) {
              Alert.alert('Could Not Sign Out Device', error?.message || 'Please try again.');
            } finally {
              setRevokingSessionId(null);
            }
          },
        },
      ]
    );
  };

  const confirmOtherSessionsSignOut = () => {
    if (otherSessionCount === 0) return;
    Alert.alert(
      'Sign out other devices?',
      'This device will stay signed in. Every other active session will be revoked.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out Others',
          style: 'destructive',
          onPress: async () => {
            setBulkAction('others');
            try {
              await signOutOtherAccountSessions();
              await recordAccountActivity('other_sessions_signed_out');
              await loadSessions();
              Alert.alert('Other Devices Signed Out', 'Only this device remains signed in.');
            } catch (error: any) {
              Alert.alert('Could Not Sign Out Devices', error?.message || 'Please try again.');
            } finally {
              setBulkAction(null);
            }
          },
        },
      ]
    );
  };

  const confirmEverywhereSignOut = () => {
    Alert.alert(
      'Sign out everywhere?',
      'Every LifeCycle session will be revoked, including this device. You will need to log in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out Everywhere',
          style: 'destructive',
          onPress: async () => {
            setBulkAction('all');
            try {
              await logoutEverywhere();
            } catch (error: any) {
              setBulkAction(null);
              Alert.alert('Could Not Sign Out', error?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadSessions(true)}
            tintColor='#2f6b4f'
          />
        }
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name='phone-portrait-outline' size={27} color='#ffffff' />
          </View>
          <View style={styles.heroCopy}>
            <Text accessibilityRole='header' style={styles.heroTitle}>
              Active sessions
            </Text>
            <Text style={styles.heroText}>
              Review devices currently signed in to your LifeCycle account.
            </Text>
          </View>
          <TouchableOpacity
            accessibilityLabel='Refresh active sessions'
            disabled={loading}
            onPress={() => void loadSessions(true)}
            style={styles.refreshButton}
          >
            <Ionicons name='refresh-outline' size={19} color='#ffffff' />
          </TouchableOpacity>
        </View>

        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.sectionTitle}>Signed-in devices</Text>
            <Text style={styles.sectionSubtitle}>
              {sessions.length} active {sessions.length === 1 ? 'session' : 'sessions'}
            </Text>
          </View>
          <View style={styles.secureBadge}>
            <Ionicons name='shield-checkmark-outline' size={14} color='#2f6b4f' />
            <Text style={styles.secureBadgeText}>PRIVATE</Text>
          </View>
        </View>

        {loading && sessions.length === 0 ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color='#2f6b4f' />
            <Text style={styles.stateText}>Checking your active sessions...</Text>
          </View>
        ) : null}

        {!loading && errorMessage ? (
          <View style={styles.stateCard}>
            <View style={styles.stateIcon}>
              <Ionicons name='alert-circle-outline' size={29} color='#9a5b32' />
            </View>
            <Text style={styles.stateTitle}>Sessions unavailable</Text>
            <Text style={styles.stateText}>{errorMessage}</Text>
            <TouchableOpacity onPress={() => void loadSessions()} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !errorMessage && sessions.length === 0 ? (
          <View style={styles.stateCard}>
            <View style={styles.stateIcon}>
              <Ionicons name='shield-checkmark-outline' size={29} color='#2f6b4f' />
            </View>
            <Text style={styles.stateTitle}>No active sessions found</Text>
            <Text style={styles.stateText}>Refresh to register and display this device.</Text>
          </View>
        ) : null}

        {!errorMessage
          ? sessions.map((session) => (
              <View
                key={session.session_id}
                style={[styles.sessionCard, session.is_current && styles.currentSessionCard]}
              >
                <View style={styles.deviceIcon}>
                  <Ionicons name={sessionIcon(session)} size={24} color='#2f6b4f' />
                </View>
                <View style={styles.sessionBody}>
                  <View style={styles.sessionTitleRow}>
                    <Text style={styles.deviceName}>
                      {formatStoredDeviceName(session.device_name)}
                    </Text>
                    {session.is_current ? (
                      <Text style={styles.currentBadge}>THIS DEVICE</Text>
                    ) : null}
                  </View>
                  <Text style={styles.sessionMeta}>
                    {[session.browser, session.device_type, session.platform, session.os_version]
                      .filter(Boolean)
                      .join(' / ') || 'Device details unavailable'}
                  </Text>
                  {[session.ip_address, session.country].filter(Boolean).length ? (
                    <View style={styles.locationRow}>
                      <Ionicons name='location-outline' size={13} color='#7a8580' />
                      <Text style={styles.sessionMeta}>
                        {[session.ip_address, session.country].filter(Boolean).join(' / ')}
                      </Text>
                    </View>
                  ) : null}
                  <Text style={styles.lastActive}>
                    {formatLastActive(session.last_active_at, session.is_current)}
                  </Text>
                  <Text style={styles.signedInAt}>
                    Signed in {new Date(session.created_at).toLocaleString(undefined, { hour12: true })}
                  </Text>
                </View>
                {!session.is_current ? (
                  <TouchableOpacity
                    accessibilityRole='button'
                    accessibilityLabel={'Sign out ' + formatStoredDeviceName(session.device_name)}
                    disabled={Boolean(revokingSessionId || bulkAction)}
                    onPress={() => confirmSessionSignOut(session)}
                    style={styles.sessionSignOutButton}
                  >
                    {revokingSessionId === session.session_id ? (
                      <ActivityIndicator size='small' color='#8f2929' />
                    ) : (
                      <Ionicons name='log-out-outline' size={19} color='#8f2929' />
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
            ))
          : null}

        {!errorMessage && sessions.length > 0 ? (
          <>
            <Text style={styles.actionsLabel}>SESSION CONTROLS</Text>
            <View style={styles.actionsCard}>
              <TouchableOpacity
                accessibilityRole='button'
                disabled={otherSessionCount === 0 || Boolean(bulkAction)}
                onPress={confirmOtherSessionsSignOut}
                style={[
                  styles.actionRow,
                  (otherSessionCount === 0 || bulkAction) && styles.disabledAction,
                ]}
              >
                <View style={styles.actionIcon}>
                  <Ionicons name='phone-portrait-outline' size={21} color='#41514d' />
                </View>
                <View style={styles.actionCopy}>
                  <Text style={styles.actionTitle}>Sign out other devices</Text>
                  <Text style={styles.actionDescription}>
                    Keep this device signed in and revoke the other {otherSessionCount}.
                  </Text>
                </View>
                {bulkAction === 'others' ? (
                  <ActivityIndicator size='small' color='#2f6b4f' />
                ) : (
                  <Ionicons name='chevron-forward' size={18} color='#8a928d' />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole='button'
                disabled={Boolean(bulkAction)}
                onPress={confirmEverywhereSignOut}
                style={[styles.actionRow, styles.lastActionRow, bulkAction && styles.disabledAction]}
              >
                <View style={[styles.actionIcon, styles.dangerActionIcon]}>
                  <Ionicons name='log-out-outline' size={21} color='#8f2929' />
                </View>
                <View style={styles.actionCopy}>
                  <Text style={styles.dangerActionTitle}>Sign out everywhere</Text>
                  <Text style={styles.actionDescription}>
                    Revoke every session, including this device.
                  </Text>
                </View>
                {bulkAction === 'all' ? (
                  <ActivityIndicator size='small' color='#8f2929' />
                ) : (
                  <Ionicons name='chevron-forward' size={18} color='#8f2929' />
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        <View style={styles.notice}>
          <Ionicons name='information-circle-outline' size={20} color='#2f6b4f' />
          <Text style={styles.noticeText}>
            A revoked device is signed out when it next verifies or refreshes its access.
            Devices using an older app version appear after opening LifeCycle again.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#eef1ec',
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: 18,
    paddingBottom: 90,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 18,
    borderRadius: 19,
    backgroundColor: '#22312d',
    marginBottom: 22,
  },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroCopy: {
    flex: 1,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 21,
    fontWeight: '900',
  },
  heroText: {
    color: '#d6dfda',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#22312d',
    fontSize: 16,
    fontWeight: '900',
  },
  sectionSubtitle: {
    color: '#7a8580',
    fontSize: 11,
    marginTop: 2,
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: '#e5efe5',
  },
  secureBadgeText: {
    color: '#2f6b4f',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  stateCard: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
  },
  stateIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef1ec',
  },
  stateTitle: {
    color: '#22312d',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 10,
  },
  stateText: {
    color: '#7a8580',
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 5,
  },
  retryButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#e5efe5',
  },
  retryText: {
    color: '#2f6b4f',
    fontSize: 11,
    fontWeight: '900',
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
    marginBottom: 9,
  },
  currentSessionCard: {
    borderColor: '#b9cfbf',
    backgroundColor: '#fbfdf9',
  },
  deviceIcon: {
    width: 45,
    height: 45,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5efe5',
  },
  sessionBody: {
    flex: 1,
    minWidth: 0,
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  deviceName: {
    color: '#22312d',
    fontSize: 14,
    fontWeight: '900',
  },
  currentBadge: {
    color: '#166534',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
  },
  sessionMeta: {
    color: '#7a8580',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  lastActive: {
    color: '#2f6b4f',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 6,
  },
  signedInAt: {
    color: '#8a928d',
    fontSize: 9,
    marginTop: 2,
  },
  sessionSignOutButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff0f0',
  },
  actionsLabel: {
    color: '#62706b',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 16,
    marginLeft: 2,
    marginBottom: 9,
  },
  actionsCard: {
    overflow: 'hidden',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
  },
  actionRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#e7e5df',
  },
  lastActionRow: {
    borderBottomWidth: 0,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef1ec',
  },
  dangerActionIcon: {
    backgroundColor: '#fff0f0',
  },
  actionCopy: {
    flex: 1,
  },
  actionTitle: {
    color: '#22312d',
    fontSize: 13,
    fontWeight: '900',
  },
  dangerActionTitle: {
    color: '#8f2929',
    fontSize: 13,
    fontWeight: '900',
  },
  actionDescription: {
    color: '#7a8580',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  disabledAction: {
    opacity: 0.45,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 13,
    borderRadius: 14,
    backgroundColor: '#e5efe5',
    marginTop: 14,
  },
  noticeText: {
    flex: 1,
    color: '#41514d',
    fontSize: 10,
    lineHeight: 16,
  },
});
