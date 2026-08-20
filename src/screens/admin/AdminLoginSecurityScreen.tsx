import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from 'react-native-paper';
import LoadingBird from '@/components/LoadingBird';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import { logAdminAction } from '@/utils/adminAuditLog';
import {
  getAdminDeviceInfo,
  recordAdminLoginActivity,
  type AdminDeviceInfo,
} from '@/utils/adminLoginActivity';
import { useResponsive } from '@/utils/responsive';
import { formatStoredDeviceName } from '@/utils/deviceModelNames';

type LoginActivityItem = {
  id: string;
  adminId: string;
  adminEmail?: string;
  event: 'login_success' | 'logout' | 'other_sessions_signed_out';
  deviceId?: string;
  deviceName?: string;
  deviceType?: string;
  platform?: string;
  osVersion?: string;
  browser?: string;
  screenSize?: string;
  ipAddress?: string;
  country?: string;
  createdAt?: string;
};

const eventDetails = {
  login_success: { label: 'Successful sign-in', icon: 'log-in-outline', color: '#166534', background: '#e7f5ec' },
  logout: { label: 'Signed out', icon: 'log-out-outline', color: '#53615d', background: '#ecefed' },
  other_sessions_signed_out: { label: 'Other sessions secured', icon: 'shield-checkmark-outline', color: '#8f2525', background: '#fde8e8' },
} as const;

export default function AdminLoginSecurityScreen() {
  const { user, role } = useAuth();
  const { isDesktop } = useResponsive();
  const [activity, setActivity] = useState<LoginActivityItem[]>([]);
  const [device, setDevice] = useState<AdminDeviceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [securing, setSecuring] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadActivity = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const currentDevice = await getAdminDeviceInfo();
      setDevice(currentDevice);
      const { data, error } = await supabase
        .from('admin_login_activity')
        .select('*')
        .order('createdAt', { ascending: false })
        .limit(100);
      if (error) throw error;
      setActivity((data || []) as LoginActivityItem[]);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Login activity could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const secureOtherSessions = () => {
    Alert.alert(
      'Sign out other devices?',
      'This keeps this device signed in and revokes your other active sessions.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out Others',
          style: 'destructive',
          onPress: async () => {
            setSecuring(true);
            try {
              const { error } = await supabase.auth.signOut({ scope: 'others' });
              if (error) throw error;
              await Promise.all([
                recordAdminLoginActivity('other_sessions_signed_out', role),
                logAdminAction({
                  adminId: user?.id,
                  action: 'other_sessions_signed_out',
                  targetType: 'security',
                  targetId: user?.id,
                  summary: 'Signed out all other account sessions.',
                }),
              ]);
              await loadActivity();
              Alert.alert('Account Secured', 'Your other sessions have been signed out.');
            } catch (error: any) {
              Alert.alert('Could Not Sign Out Sessions', error?.message || 'Please try again.');
            } finally {
              setSecuring(false);
            }
          },
        },
      ],
    );
  };

  const renderActivity = ({ item }: { item: LoginActivityItem }) => {
    const detail = eventDetails[item.event] || eventDetails.login_success;
    const isCurrentDevice = Boolean(device?.device_id && item.deviceId === device.device_id);
    const location = [item.ipAddress, item.country].filter(Boolean).join(' · ') || 'IP unavailable';
    const platform = [item.platform, item.osVersion].filter(Boolean).join(' ') || 'Platform unavailable';
    const occurredAt = item.createdAt
      ? new Date(item.createdAt).toLocaleString(undefined, { hour12: true })
      : 'No timestamp';

    return (
      <View style={styles.activityCard}>
        <View style={[styles.eventIcon, { backgroundColor: detail.background }]}>
          <Ionicons name={detail.icon} size={20} color={detail.color} />
        </View>
        <View style={styles.activityBody}>
          <View style={styles.rowBetween}>
            <Text style={styles.eventTitle}>{detail.label}</Text>
            {isCurrentDevice ? <Text style={styles.currentBadge}>THIS DEVICE</Text> : null}
          </View>
          {role === 'super_admin' && item.adminEmail ? <Text style={styles.adminEmail}>{item.adminEmail}</Text> : null}
          <Text style={styles.deviceName}>{formatStoredDeviceName(item.deviceName)}</Text>
          <Text style={styles.meta}>{item.browser ? `${item.browser} · ${platform}` : platform}</Text>
          <View style={styles.locationRow}>
            <Ionicons name='location-outline' size={13} color='#77827d' />
            <Text style={styles.meta}>{location}</Text>
          </View>
          <Text style={styles.time}>{occurredAt}</Text>
        </View>
      </View>
    );
  };

  const listHeader = (
    <>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name='shield-checkmark' size={28} color='#ffffff' /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.title}>Login & Security</Text>
          <Text style={styles.subtitle}>Know when, where, and which device accessed your admin account.</Text>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Current device</Text>
        <TouchableOpacity onPress={loadActivity} disabled={loading} style={styles.refreshButton}>
          <Ionicons name='refresh' size={16} color='#22312d' />
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.currentCard}>
        <View style={styles.deviceIcon}><Ionicons name={device?.device_type === 'Web browser' ? 'desktop-outline' : 'phone-portrait-outline'} size={24} color='#22312d' /></View>
        <View style={styles.currentBody}>
          <View style={styles.currentTitleRow}>
            <Text style={styles.currentTitle}>{device?.device_name || 'Detecting this device…'}</Text>
            <Text style={styles.activeBadge}>ACTIVE</Text>
          </View>
          <Text style={styles.currentMeta}>{device ? `${device.device_type} · ${device.platform} ${device.os_version}` : 'Loading device details'}</Text>
          <Text style={styles.currentMeta}>Last account sign-in: {user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString(undefined, { hour12: true }) : 'Unavailable'}</Text>
        </View>
      </View>

      <View style={styles.securityCard}>
        <View style={styles.securityCopy}>
          <Text style={styles.securityTitle}>Do not recognize an access?</Text>
          <Text style={styles.securityText}>Sign out every other device. Your current session will stay active.</Text>
        </View>
        <TouchableOpacity onPress={secureOtherSessions} disabled={securing} style={[styles.secureButton, securing && styles.buttonDisabled]}>
          <Ionicons name='lock-closed-outline' size={16} color='#ffffff' />
          <Text style={styles.secureButtonText}>{securing ? 'Securing…' : 'Sign Out Other Devices'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.historyHeader}>
        <Text style={styles.sectionTitle}>{role === 'super_admin' ? 'Admin login activity' : 'Your login activity'}</Text>
        <Text style={styles.historyCount}>{activity.length} events</Text>
      </View>
      {loading && !activity.length ? <LoadingBird compact /> : null}
    </>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}
      data={loading && !activity.length ? [] : activity}
      keyExtractor={(item) => item.id}
      renderItem={renderActivity}
      ListHeaderComponent={listHeader}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadActivity} tintColor='#d32f2f' />}
      ListEmptyComponent={!loading ? <View style={styles.emptyCard}><Ionicons name='finger-print-outline' size={30} color='#8b938c' /><Text style={styles.emptyTitle}>{errorMessage ? 'Login history unavailable' : 'No login history yet'}</Text><Text style={styles.emptyText}>{errorMessage || 'Your next admin sign-in will appear here.'}</Text></View> : null}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f4f1' },
  container: { flexGrow: 1, padding: 16, paddingBottom: 32 },
  containerDesktop: { maxWidth: 980, width: '100%', alignSelf: 'center' },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 13, padding: 17,
    borderRadius: 18, backgroundColor: '#22312d', marginBottom: 18,
  },
  heroIcon: {
    width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroCopy: { flex: 1 },
  title: { color: '#ffffff', fontSize: 23, fontWeight: '800' },
  subtitle: { color: '#d6dfda', marginTop: 3, lineHeight: 19 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  sectionTitle: { color: '#22312d', fontSize: 17, fontWeight: '800' },
  refreshButton: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 10,
    borderRadius: 999, backgroundColor: '#e7ece8',
  },
  refreshText: { color: '#22312d', fontSize: 12, fontWeight: '700' },
  currentCard: {
    flexDirection: 'row', gap: 12, padding: 15, borderRadius: 17, borderWidth: 1,
    borderColor: '#d9e2dc', backgroundColor: '#ffffff',
  },
  deviceIcon: {
    width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#e7f0eb',
  },
  currentBody: { flex: 1 },
  currentTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  currentTitle: { color: '#22312d', fontSize: 15, fontWeight: '800' },
  activeBadge: {
    color: '#166534', fontSize: 9, fontWeight: '900', letterSpacing: 0.6,
    backgroundColor: '#dcfce7', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 7,
  },
  currentMeta: { color: '#62706b', fontSize: 11, marginTop: 4, lineHeight: 16 },
  securityCard: {
    marginTop: 12, padding: 15, borderRadius: 17, borderWidth: 1,
    borderColor: '#efc4c4', backgroundColor: '#fff8f8',
  },
  securityCopy: { marginBottom: 12 },
  securityTitle: { color: '#7f1d1d', fontSize: 15, fontWeight: '800' },
  securityText: { color: '#7a4e4e', marginTop: 3, lineHeight: 18 },
  secureButton: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7,
    minHeight: 40, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12,
    backgroundColor: '#a52b2b',
  },
  buttonDisabled: { opacity: 0.6 },
  secureButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  historyHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 22, marginBottom: 10,
  },
  historyCount: { color: '#77827d', fontSize: 11, fontWeight: '700' },
  activityCard: {
    flexDirection: 'row', gap: 12, marginBottom: 9, padding: 14,
    borderRadius: 16, borderWidth: 1, borderColor: '#e6e3da', backgroundColor: '#ffffff',
  },
  eventIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  activityBody: { flex: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eventTitle: { flex: 1, color: '#22312d', fontSize: 13, fontWeight: '800' },
  currentBadge: {
    color: '#166534', fontSize: 8, fontWeight: '900', letterSpacing: 0.5,
    backgroundColor: '#dcfce7', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 6,
  },
  adminEmail: { marginTop: 3, color: '#8f2525', fontSize: 11, fontWeight: '700' },
  deviceName: { marginTop: 5, color: '#3d4a46', fontWeight: '700' },
  meta: { color: '#77827d', fontSize: 11, marginTop: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  time: { color: '#8b938c', fontSize: 10, marginTop: 5 },
  emptyCard: {
    padding: 28, borderRadius: 18, alignItems: 'center', borderWidth: 1,
    borderColor: '#e6e3da', backgroundColor: '#ffffff',
  },
  emptyTitle: { marginTop: 10, color: '#22312d', fontSize: 16, fontWeight: '800' },
  emptyText: { marginTop: 4, color: '#77827d', textAlign: 'center', lineHeight: 19 },
});
