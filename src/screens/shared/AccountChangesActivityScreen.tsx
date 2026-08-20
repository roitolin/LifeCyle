import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from '@/components';
import { supabase } from '@/services/supabaseClient';
import { formatStoredDeviceName } from '@/utils/deviceModelNames';

type AccountChangeItem = {
  id: string;
  event:
    | 'password_changed'
    | 'profile_updated'
    | 'session_revoked'
    | 'other_sessions_signed_out'
    | 'all_sessions_signed_out';
  device_name?: string;
  device_type?: string;
  platform?: string;
  os_version?: string;
  ip_address?: string;
  country?: string;
  created_at?: string;
};

const eventDetails = {
  password_changed: {
    title: 'Password changed',
    badge: 'SECURITY',
    icon: 'key-outline',
  },
  profile_updated: {
    title: 'Profile updated',
    badge: 'ACCOUNT',
    icon: 'person-outline',
  },
  session_revoked: {
    title: 'Device session revoked',
    badge: 'SESSION',
    icon: 'phone-portrait-outline',
  },
  other_sessions_signed_out: {
    title: 'Other devices signed out',
    badge: 'SESSION',
    icon: 'shield-checkmark-outline',
  },
  all_sessions_signed_out: {
    title: 'All sessions signed out',
    badge: 'SESSION',
    icon: 'log-out-outline',
  },
} as const;

export default function AccountChangesActivityScreen() {
  const [activity, setActivity] = useState<AccountChangeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadActivity = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const result = await supabase
        .from('account_activity_log')
        .select('id,event,device_name,device_type,platform,os_version,ip_address,country,created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (result.error) throw result.error;
      setActivity((result.data || []) as AccountChangeItem[]);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Account activity could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name='reader-outline' size={28} color='#ffffff' />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Activity log</Text>
            <Text style={styles.heroText}>Review security changes made to your account.</Text>
          </View>
          <TouchableOpacity accessibilityLabel='Refresh activity log' disabled={loading} onPress={loadActivity} style={styles.refreshButton}>
            <Ionicons name='refresh-outline' size={19} color='#ffffff' />
          </TouchableOpacity>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.sectionTitle}>Account changes</Text>
          <Text style={styles.eventCount}>{activity.length} events</Text>
        </View>

        {loading && activity.length === 0 ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color='#41514d' />
            <Text style={styles.stateText}>Loading activity...</Text>
          </View>
        ) : null}

        {!loading && errorMessage ? (
          <View style={styles.stateCard}>
            <Ionicons name='alert-circle-outline' size={30} color='#9a5b32' />
            <Text style={styles.stateTitle}>Activity log unavailable</Text>
            <Text style={styles.stateText}>Please check your connection and try again.</Text>
            <TouchableOpacity onPress={loadActivity} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !errorMessage && activity.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name='shield-checkmark-outline' size={32} color='#7a8580' />
            <Text style={styles.stateTitle}>No account changes yet</Text>
            <Text style={styles.stateText}>Password and other security changes will appear here.</Text>
          </View>
        ) : null}

        {!errorMessage ? activity.map((item) => <AccountChangeRow key={item.id} item={item} />) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function AccountChangeRow({ item }: { item: AccountChangeItem }) {
  const detail = eventDetails[item.event] || eventDetails.profile_updated;
  const deviceMeta = [item.device_type, item.platform, item.os_version].filter(Boolean).join(' / ');
  const location = [item.ip_address, item.country].filter(Boolean).join(' / ');
  const occurredAt = item.created_at
    ? new Date(item.created_at).toLocaleString(undefined, { hour12: true })
    : 'Time unavailable';

  return (
    <View style={styles.activityCard}>
      <View style={styles.eventIcon}>
        <Ionicons name={detail.icon} size={21} color='#2f6b4f' />
      </View>
      <View style={styles.activityBody}>
        <View style={styles.activityTitleRow}>
          <Text style={styles.activityTitle}>{detail.title}</Text>
          <Text style={styles.eventBadge}>{detail.badge}</Text>
        </View>
        <Text style={styles.deviceName}>{formatStoredDeviceName(item.device_name)}</Text>
        {deviceMeta ? <Text style={styles.activityMeta}>{deviceMeta}</Text> : null}
        {location ? <Text style={styles.activityMeta}>{location}</Text> : null}
        <Text style={styles.activityTime}>{occurredAt}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef1ec' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 18, paddingBottom: 120 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 17, borderRadius: 18,
    backgroundColor: '#22312d', marginBottom: 20,
  },
  heroIcon: {
    width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroCopy: { flex: 1 },
  heroTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  heroText: { color: '#d6dfda', fontSize: 12, lineHeight: 18, marginTop: 3 },
  refreshButton: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  summaryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10,
  },
  sectionTitle: { color: '#22312d', fontSize: 16, fontWeight: '800' },
  eventCount: { color: '#7a8580', fontSize: 11, fontWeight: '700' },
  stateCard: {
    minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 24, borderRadius: 17,
    borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#ffffff',
  },
  stateTitle: { color: '#22312d', fontSize: 15, fontWeight: '800', marginTop: 9 },
  stateText: { color: '#7a8580', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 6 },
  retryButton: { marginTop: 13, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#ebf1e8' },
  retryText: { color: '#2f6b4f', fontSize: 12, fontWeight: '800' },
  activityCard: {
    flexDirection: 'row', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1,
    borderColor: '#d9d6cd', backgroundColor: '#ffffff', marginBottom: 9,
  },
  eventIcon: {
    width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e3f1e8',
  },
  activityBody: { flex: 1, minWidth: 0 },
  activityTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  activityTitle: { flex: 1, color: '#22312d', fontSize: 14, fontWeight: '800' },
  eventBadge: {
    color: '#2f6b4f', backgroundColor: '#e3f1e8', borderRadius: 999,
    paddingVertical: 3, paddingHorizontal: 7, fontSize: 8, fontWeight: '900',
  },
  deviceName: { color: '#41514d', fontSize: 12, fontWeight: '700', marginTop: 5 },
  activityMeta: { color: '#7a8580', fontSize: 11, marginTop: 2 },
  activityTime: { color: '#8d9692', fontSize: 10, marginTop: 5 },
});
