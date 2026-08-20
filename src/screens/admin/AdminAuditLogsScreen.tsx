import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Searchbar, Text } from 'react-native-paper';
import LoadingBird from '@/components/LoadingBird';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import { useResponsive } from '@/utils/responsive';

type ActivityLogItem = {
  id: string;
  adminId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  targetUserId?: string;
  summary?: string;
  details?: string;
  metadata?: Record<string, any>;
  createdAt?: string;
};

type ActivityCategory = 'all' | 'navigation' | 'actions' | 'security' | 'system';

const categories: { value: ActivityCategory; label: string }[] = [
  { value: 'all', label: 'All activity' },
  { value: 'navigation', label: 'Screen visits' },
  { value: 'actions', label: 'Admin actions' },
  { value: 'security', label: 'Security' },
  { value: 'system', label: 'System' },
];

const getCategory = (item: ActivityLogItem): ActivityCategory => {
  if (item.targetType === 'screen' || item.action === 'screen_viewed') return 'navigation';
  if (item.targetType === 'security' || String(item.action).includes('session')) return 'security';
  if (item.targetType === 'system') return 'system';
  return 'actions';
};

const readableAction = (value?: string) =>
  String(value || 'activity')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function AdminAuditLogsScreen() {
  const { user, role } = useAuth();
  const { isDesktop } = useResponsive();
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [adminNames, setAdminNames] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<ActivityCategory>('all');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const { data, error } = await supabase
        .from('admin_audit_logs')
        .select('*')
        .order('createdAt', { ascending: false })
        .limit(250);
      if (error) throw error;

      const nextLogs = (data || []) as ActivityLogItem[];
      setLogs(nextLogs);
      const adminIds = [...new Set(nextLogs.map((item) => item.adminId).filter(Boolean))] as string[];
      if (adminIds.length) {
        const { data: admins } = await supabase.from('users').select('id,email,fullName').in('id', adminIds);
        const names = Object.fromEntries(
          (admins || []).map((admin: any) => [admin.id, admin.fullName || admin.email || admin.id]),
        );
        setAdminNames(names);
      }
    } catch (error: any) {
      setErrorMessage(error?.message || 'Activity logs could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const counts = useMemo(() => {
    const next: Record<ActivityCategory, number> = { all: logs.length, navigation: 0, actions: 0, security: 0, system: 0 };
    logs.forEach((item) => { next[getCategory(item)] += 1; });
    return next;
  }, [logs]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return logs.filter((item) => {
      if (category !== 'all' && getCategory(item) !== category) return false;
      if (!query) return true;
      const actor = item.adminId ? adminNames[item.adminId] : '';
      return [item.summary, item.details, item.action, item.targetType, item.targetId, actor]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [adminNames, category, logs, searchQuery]);

  const renderItem = ({ item }: { item: ActivityLogItem }) => {
    const itemCategory = getCategory(item);
    const isOwn = item.adminId === user?.id;
    const actor = isOwn ? 'You' : item.adminId ? adminNames[item.adminId] || item.adminId : 'Unknown admin';
    const icon = itemCategory === 'navigation' ? 'navigate-outline' : itemCategory === 'security' ? 'shield-checkmark-outline' : itemCategory === 'actions' ? 'flash-outline' : 'settings-outline';
    const iconStyle = itemCategory === 'navigation'
      ? styles.navigationIcon
      : itemCategory === 'security'
        ? styles.securityIcon
        : itemCategory === 'actions'
          ? styles.actionsIcon
          : styles.systemIcon;
    const time = item.createdAt ? new Date(item.createdAt).toLocaleString(undefined, { hour12: true }) : 'No timestamp';
    const targetId = item.targetId || item.targetUserId;

    return (
      <View style={styles.logCard}>
        <View style={[styles.iconWrap, iconStyle]}>
          <Ionicons name={icon as any} size={19} color='#22312d' />
        </View>
        <View style={styles.logBody}>
          <View style={styles.rowBetween}>
            <Text style={styles.logAction}>{readableAction(item.action)}</Text>
            <Text style={styles.logTime}>{time}</Text>
          </View>
          <Text style={styles.logSummary}>{item.summary || item.details || 'Activity recorded'}</Text>
          <Text style={styles.logMeta}>By {actor}</Text>
          {item.targetType ? (
            <Text style={styles.logMeta}>Target: {readableAction(item.targetType)}{targetId ? ` · ${targetId}` : ''}</Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <View style={styles.headerCard}>
        <View style={styles.headerIcon}><Ionicons name='pulse' size={24} color='#ffffff' /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Activity Logs</Text>
          <Text style={styles.subtitle}>
            {role === 'super_admin' ? 'Review admin screen visits, actions, and security events.' : 'Review your screen visits, actions, and security events.'}
          </Text>
        </View>
      </View>

      <Searchbar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder='Search activity, admin, or target'
        style={styles.search}
        inputStyle={styles.searchInput}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {categories.map((item) => {
          const selected = category === item.value;
          return (
            <TouchableOpacity key={item.value} onPress={() => setCategory(item.value)} style={[styles.filterChip, selected && styles.filterChipSelected]}>
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{item.label}</Text>
              <View style={[styles.countBadge, selected && styles.countBadgeSelected]}>
                <Text style={[styles.countText, selected && styles.countTextSelected]}>{counts[item.value]}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading && !logs.length ? <LoadingBird compact /> : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={loadLogs} tintColor='#d32f2f' />}
          ListEmptyComponent={<View style={styles.emptyCard}><Ionicons name='file-tray-outline' size={30} color='#8b938c' /><Text style={styles.emptyTitle}>{errorMessage ? 'Activity unavailable' : 'No activity found'}</Text><Text style={styles.emptyText}>{errorMessage || 'New admin activity will appear here.'}</Text></View>}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f4f1', padding: 16 },
  containerDesktop: { maxWidth: 1040, width: '100%', alignSelf: 'center' },
  headerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18,
    backgroundColor: '#22312d', marginBottom: 12,
  },
  headerIcon: {
    width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  headerCopy: { flex: 1 },
  title: { color: '#ffffff', fontSize: 23, fontWeight: '800' },
  subtitle: { color: '#d6dfda', marginTop: 3, lineHeight: 19 },
  search: {
    minHeight: 48, marginBottom: 10, borderRadius: 15, borderWidth: 1,
    borderColor: '#e2dfd7', backgroundColor: '#ffffff', elevation: 0,
  },
  searchInput: { minHeight: 46, fontSize: 14 },
  filterRow: { gap: 8, paddingBottom: 12 },
  filterChip: {
    minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: 1, borderColor: '#d9d6cd', borderRadius: 999,
    backgroundColor: '#ffffff', paddingVertical: 8, paddingHorizontal: 12,
  },
  filterChipSelected: { backgroundColor: '#22312d', borderColor: '#22312d' },
  filterText: { color: '#53615d', fontWeight: '700', fontSize: 12 },
  filterTextSelected: { color: '#ffffff' },
  countBadge: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#ece9e3',
  },
  countBadgeSelected: { backgroundColor: '#d32f2f' },
  countText: { color: '#53615d', fontSize: 10, fontWeight: '800' },
  countTextSelected: { color: '#ffffff' },
  listContent: { paddingBottom: 28, flexGrow: 1 },
  logCard: {
    flexDirection: 'row', gap: 12, padding: 14, marginBottom: 9, borderRadius: 16,
    borderWidth: 1, borderColor: '#e6e3da', backgroundColor: '#ffffff',
  },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navigationIcon: { backgroundColor: '#e7f0eb' },
  actionsIcon: { backgroundColor: '#fff0df' },
  securityIcon: { backgroundColor: '#fde8e8' },
  systemIcon: { backgroundColor: '#ece9f2' },
  logBody: { flex: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  logAction: { flex: 1, color: '#22312d', fontWeight: '800', fontSize: 13 },
  logTime: { color: '#8b938c', fontSize: 10, textAlign: 'right', maxWidth: 125 },
  logSummary: { marginTop: 4, color: '#3d4a46', lineHeight: 19 },
  logMeta: { marginTop: 3, color: '#77827d', fontSize: 11 },
  emptyCard: {
    marginTop: 24, padding: 28, borderRadius: 18, alignItems: 'center',
    borderWidth: 1, borderColor: '#e6e3da', backgroundColor: '#ffffff',
  },
  emptyTitle: { marginTop: 10, color: '#22312d', fontSize: 16, fontWeight: '800' },
  emptyText: { marginTop: 4, color: '#77827d', textAlign: 'center', lineHeight: 19 },
});
