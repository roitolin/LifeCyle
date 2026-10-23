import { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppBackButton } from '@/components';
import LoadingBird from '@/components/LoadingBird';
import { auth } from '@/services';
import { supabase } from '@/services/supabaseClient';
import { formatPhilippinePeso } from '@/utils/funeralCatalog';
import { getProfileImageSource } from '@/utils/defaultProfileImage';

type Request = {
  id: string;
  requesterId: string;
  requesterName?: string | null;
  familyCoordinatorName?: string | null;
  paymentPayerName?: string | null;
  contactNumber?: string | null;
  deceasedFullName?: string | null;
  productName?: string | null;
  productPrice?: string | number | null;
  paymentAmount?: string | number | null;
  status: string;
  createdAt?: string | null;
  acceptedAt?: string | null;
  paymentVerifiedAt?: string | null;
  completedAt?: string | null;
};

type Customer = {
  id: string;
  name: string;
  phone: string;
  photoURL?: string | null;
  gender?: string | null;
  requests: Request[];
  active: number;
  value: number;
  lastActivity: string | null;
};

const terminal = new Set(['completed', 'declined_by_shop', 'cancelled', 'cancelled_by_requester']);
const valued = new Set(['payment_verified', 'awaiting_customer_confirmation', 'completed']);

function dateLabel(value: string | null) {
  if (!value) return 'No recent activity';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No recent activity' : date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusLabel(value: string) {
  return String(value || 'pending').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function FuneralShopCustomersScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<Request[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { fullName?: string | null; photoURL?: string | null; gender?: string | null }>>({});
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let shopId = auth.currentUser?.uid || null;
      if (!shopId) {
        const { data } = await supabase.auth.getSession();
        shopId = data.session?.user?.id || null;
      }
      if (!shopId) return setRequests([]);
      const { data, error } = await supabase.from('funeral_service_requests').select('*').eq('shopId', shopId).order('createdAt', { ascending: false }).limit(250);
      if (error) throw error;
      const requesterIds = [...new Set((data || []).map((request: any) => String(request.requesterId || '')).filter(Boolean))];
      if (requesterIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('users')
          .select('id, fullName, photoURL, gender')
          .in('id', requesterIds);
        const profileMap: Record<string, { fullName?: string | null; photoURL?: string | null; gender?: string | null }> = {};
        (profileRows || []).forEach((profile: any) => {
          profileMap[String(profile.id)] = profile;
        });
        setProfiles(profileMap);
      } else {
        setProfiles({});
      }
      setRequests((data || []) as Request[]);
    } catch (error) {
      console.error('Unable to load shop customers', error);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const callCustomer = useCallback(async (phone: string) => {
    const normalized = String(phone || '').replace(/[^\d+]/g, '');
    if (!normalized) {
      Alert.alert('Unavailable', 'This customer has not provided a contact number.');
      return;
    }
    try {
      await Linking.openURL(`tel:${normalized}`);
    } catch {
      Alert.alert('Unavailable', 'Calling is not available on this device.');
    }
  }, []);

  const chatWithCustomer = useCallback((customer: Customer) => {
    if (!customer.id || customer.id === auth.currentUser?.uid) {
      Alert.alert('Chat unavailable', 'This customer does not have an account available to contact.');
      return;
    }
    navigation.navigate('Chat', {
      otherUserId: customer.id,
      otherUserName: customer.name,
    });
  }, [navigation]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const customers = useMemo<Customer[]>(() => {
    const map = new Map<string, Customer>();
    requests.forEach((request) => {
      const id = String(request.requesterId || request.contactNumber || request.id);
      const profile = profiles[id];
      const status = String(request.status || '').toLowerCase();
      const activity = request.completedAt || request.paymentVerifiedAt || request.acceptedAt || request.createdAt || null;
      const value = Number(request.paymentAmount ?? request.productPrice) || 0;
      const current = map.get(id);
      if (!current) {
        map.set(id, {
          id,
            name: profile?.fullName || request.requesterName || request.familyCoordinatorName || request.paymentPayerName || `Customer ${id.slice(0, 8)}`,
            phone: String(request.contactNumber || ''),
            photoURL: profile?.photoURL || null,
            gender: profile?.gender || null,
          requests: [request],
          active: terminal.has(status) ? 0 : 1,
          value: valued.has(status) ? value : 0,
          lastActivity: activity,
        });
        return;
      }
      current.requests.push(request);
      if (!current.phone && request.contactNumber) current.phone = request.contactNumber;
      if (!current.photoURL && profile?.photoURL) current.photoURL = profile.photoURL;
      if (!current.gender && profile?.gender) current.gender = profile.gender;
      if (!terminal.has(status)) current.active += 1;
      if (valued.has(status)) current.value += value;
      if (activity && (!current.lastActivity || new Date(activity).getTime() > new Date(current.lastActivity).getTime())) current.lastActivity = activity;
    });
    return [...map.values()].sort((a, b) => new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime());
  }, [profiles, requests]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? customers.filter((item) => `${item.name} ${item.phone}`.toLowerCase().includes(query)) : customers;
  }, [customers, search]);

  if (loading) return <SafeAreaView style={styles.screen}><LoadingBird fullScreen /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <AppBackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerCopy}><Text style={styles.title}>Customers</Text><Text style={styles.subtitle}>{customers.length} family contacts</Text></View>
        <TouchableOpacity style={styles.iconButton} onPress={() => void load()}><Ionicons name='refresh-outline' size={20} color='#33453f' /></TouchableOpacity>
      </View>
      <View style={styles.search}><Ionicons name='search-outline' size={18} color='#75817c' /><TextInput value={search} onChangeText={setSearch} placeholder='Search name or contact number' placeholderTextColor='#929b97' style={styles.searchInput} /></View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {visible.length === 0 ? (
          <View style={styles.empty}><Ionicons name='people-outline' size={30} color='#87918d' /><Text style={styles.emptyTitle}>No customers yet</Text><Text style={styles.emptyText}>Profiles appear automatically from family service requests.</Text></View>
        ) : visible.map((customer) => {
          const isOpen = expanded === customer.id;
          return (
            <View key={customer.id} style={styles.card}>
              <TouchableOpacity style={styles.cardHead} onPress={() => setExpanded(isOpen ? null : customer.id)}>
                <View style={styles.avatar}>
                  <Image source={getProfileImageSource(customer.photoURL, customer.gender)} style={styles.avatarImage} resizeMode="cover" />
                </View>
                <View style={styles.grow}><Text style={styles.name} numberOfLines={1}>{customer.name}</Text><Text style={styles.meta}>{customer.phone || 'No contact number'} · {dateLabel(customer.lastActivity)}</Text></View>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color='#77827d' />
              </TouchableOpacity>
              <View style={styles.metrics}>
                <View><Text style={styles.metricValue}>{customer.requests.length}</Text><Text style={styles.metricLabel}>Cases</Text></View>
                <View><Text style={styles.metricValue}>{customer.active}</Text><Text style={styles.metricLabel}>Active</Text></View>
                <View style={styles.value}><Text style={styles.metricValue}>{formatPhilippinePeso(customer.value)}</Text><Text style={styles.metricLabel}>Confirmed value</Text></View>
              </View>
              <View style={styles.contactActions}>
                <TouchableOpacity
                  style={[styles.contactButton, !customer.phone ? styles.contactButtonDisabled : null]}
                  onPress={() => void callCustomer(customer.phone)}
                  disabled={!customer.phone}
                >
                  <Ionicons name='call-outline' size={15} color='#315f50' />
                  <Text style={styles.contactButtonText}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.contactButton} onPress={() => chatWithCustomer(customer)}>
                  <Ionicons name='chatbubble-ellipses-outline' size={15} color='#315f50' />
                  <Text style={styles.contactButtonText}>Chat</Text>
                </TouchableOpacity>
              </View>
              {isOpen ? <View style={styles.history}>
                <Text style={styles.historyTitle}>Arrangement history</Text>
                {customer.requests.map((request) => (
                  <TouchableOpacity key={request.id} style={styles.historyRow} onPress={() => navigation.navigate('ServiceRequestDetails', { request })}>
                    <View style={styles.grow}><Text style={styles.historyName} numberOfLines={1}>{request.deceasedFullName || request.productName || 'Arrangement case'}</Text><Text style={styles.meta}>{request.productName || 'Custom service'} · {dateLabel(request.createdAt || null)}</Text></View>
                    <Text style={styles.status}>{statusLabel(request.status)}</Text><Ionicons name='chevron-forward' size={16} color='#8a948f' />
                  </TouchableOpacity>
                ))}
              </View> : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f1f3ef' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dce1dd' },
  headerCopy: { flex: 1, marginLeft: 10 }, title: { color: '#22312d', fontSize: 20, fontWeight: '800' }, subtitle: { marginTop: 2, color: '#73807b', fontSize: 12 },
  iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#eef2ef' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 14, marginBottom: 2, paddingHorizontal: 12, borderWidth: 1, borderColor: '#d5dcd7', borderRadius: 12, backgroundColor: '#fff' },
  searchInput: { flex: 1, minHeight: 44, color: '#22312d', fontSize: 14 }, content: { padding: 14, paddingBottom: 36, gap: 12 },
  empty: { alignItems: 'center', padding: 34, borderWidth: 1, borderColor: '#dce1dd', borderRadius: 16, backgroundColor: '#fff' }, emptyTitle: { marginTop: 12, color: '#263832', fontSize: 16, fontWeight: '700' }, emptyText: { marginTop: 6, color: '#77827d', fontSize: 13 },
  card: { overflow: 'hidden', borderWidth: 1, borderColor: '#dce1dd', borderRadius: 14, backgroundColor: '#fff' }, cardHead: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14 },
  avatar: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, overflow: 'hidden', backgroundColor: '#e4eee8' }, avatarImage: { width: '100%', height: '100%' }, avatarText: { color: '#315246', fontSize: 16, fontWeight: '800' }, grow: { flex: 1, minWidth: 0 }, name: { color: '#22312d', fontSize: 15, fontWeight: '700' }, meta: { marginTop: 4, color: '#75817c', fontSize: 10 },
  metrics: { flexDirection: 'row', gap: 24, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e6eae7', backgroundColor: '#fafbf9' }, metricValue: { color: '#263832', fontSize: 14, fontWeight: '800' }, metricLabel: { marginTop: 2, color: '#7a8580', fontSize: 10 }, value: { flex: 1, alignItems: 'flex-end' },
  contactActions: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 12 }, contactButton: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, borderRadius: 10, borderWidth: 1, borderColor: '#c8d7ce', backgroundColor: '#f7faf7' }, contactButtonDisabled: { opacity: 0.45 }, contactButtonText: { color: '#315f50', fontSize: 12, fontWeight: '800' },
  history: { padding: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#dfe4e0' }, historyTitle: { marginBottom: 7, color: '#53615c', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' }, historyRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#edf0ee' }, historyName: { color: '#263832', fontSize: 12, fontWeight: '700' }, status: { maxWidth: 105, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, overflow: 'hidden', backgroundColor: '#edf2ee', color: '#52615c', fontSize: 8, fontWeight: '700', textAlign: 'center' },
});
