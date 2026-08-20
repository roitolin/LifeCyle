import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from '@/components';
import { supabase } from '@/services/supabaseClient';
import { formatStoredDeviceName } from '@/utils/deviceModelNames';

type AccountActivityItem = {
  id: string;
  event: 'login_success' | 'logout';
  device_name?: string;
  device_type?: string;
  platform?: string;
  os_version?: string;
  ip_address?: string;
  country?: string;
  created_at?: string;
};

type ActivityFilter = 'all' | 'login_success' | 'logout';

export default function AccountActivityLogScreen() {
  const [activity, setActivity] = useState<AccountActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [filter, setFilter] = useState<ActivityFilter>('all');

  const loadActivity = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const result = await supabase
        .from('account_login_activity')
        .select('id,event,device_name,device_type,platform,os_version,ip_address,country,created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (result.error) throw result.error;
      setActivity((result.data || []) as AccountActivityItem[]);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Activity log could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const visibleActivity = useMemo(
    () => filter === 'all' ? activity : activity.filter((item) => item.event === filter),
    [activity, filter],
  );

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name='time-outline' size={28} color='#ffffff' />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Login & logout history</Text>
            <Text style={styles.heroText}>Review when and where your account was accessed.</Text>
          </View>
          <TouchableOpacity accessibilityLabel='Refresh activity log' disabled={loading} onPress={loadActivity} style={styles.refreshButton}>
            <Ionicons name='refresh-outline' size={19} color='#ffffff' />
          </TouchableOpacity>
        </View>

        <View style={styles.filters}>
          <FilterButton label='All' selected={filter === 'all'} onPress={() => setFilter('all')} />
          <FilterButton label='Logins' selected={filter === 'login_success'} onPress={() => setFilter('login_success')} />
          <FilterButton label='Logouts' selected={filter === 'logout'} onPress={() => setFilter('logout')} />
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.sectionTitle}>Access history</Text>
          <Text style={styles.eventCount}>{visibleActivity.length} events</Text>
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

        {!loading && !errorMessage && visibleActivity.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name='finger-print-outline' size={32} color='#7a8580' />
            <Text style={styles.stateTitle}>No activity found</Text>
            <Text style={styles.stateText}>
              {filter === 'all' ? 'Your next login or logout will appear here.' : 'There are no events for this filter.'}
            </Text>
          </View>
        ) : null}

        {!errorMessage ? visibleActivity.map((item) => <ActivityRow key={item.id} item={item} />) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function FilterButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole='button'
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.filterButton, selected && styles.filterButtonSelected]}
    >
      <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ActivityRow({ item }: { item: AccountActivityItem }) {
  const isLogin = item.event === 'login_success';
  const deviceMeta = [item.device_type, item.platform, item.os_version].filter(Boolean).join(' / ');
  const location = [item.ip_address, item.country].filter(Boolean).join(' / ');
  const occurredAt = item.created_at
    ? new Date(item.created_at).toLocaleString(undefined, { hour12: true })
    : 'Time unavailable';

  return (
    <View style={styles.activityCard}>
      <View style={[styles.eventIcon, isLogin ? styles.loginIcon : styles.logoutIcon]}>
        <Ionicons name={isLogin ? 'log-in-outline' : 'log-out-outline'} size={21} color={isLogin ? '#2f6b4f' : '#62706b'} />
      </View>
      <View style={styles.activityBody}>
        <View style={styles.activityTitleRow}>
          <Text style={styles.activityTitle}>{isLogin ? 'Logged in' : 'Logged out'}</Text>
          <Text style={[styles.eventBadge, isLogin ? styles.loginBadge : styles.logoutBadge]}>
            {isLogin ? 'LOGIN' : 'LOGOUT'}
          </Text>
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
    backgroundColor: '#22312d', marginBottom: 14,
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
  filters: { flexDirection: 'row', gap: 8, padding: 5, borderRadius: 14, backgroundColor: '#dde4dd', marginBottom: 19 },
  filterButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  filterButtonSelected: { backgroundColor: '#ffffff' },
  filterText: { color: '#62706b', fontSize: 12, fontWeight: '700' },
  filterTextSelected: { color: '#22312d', fontWeight: '900' },
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
  eventIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  loginIcon: { backgroundColor: '#e3f1e8' },
  logoutIcon: { backgroundColor: '#ecefed' },
  activityBody: { flex: 1, minWidth: 0 },
  activityTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  activityTitle: { flex: 1, color: '#22312d', fontSize: 14, fontWeight: '800' },
  eventBadge: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 7, fontSize: 8, fontWeight: '900' },
  loginBadge: { color: '#2f6b4f', backgroundColor: '#e3f1e8' },
  logoutBadge: { color: '#62706b', backgroundColor: '#ecefed' },
  deviceName: { color: '#41514d', fontSize: 12, fontWeight: '700', marginTop: 5 },
  activityMeta: { color: '#7a8580', fontSize: 11, marginTop: 2 },
  activityTime: { color: '#8d9692', fontSize: 10, marginTop: 5 },
});
