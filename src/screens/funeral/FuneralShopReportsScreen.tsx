import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppBackButton, SimpleBarChart } from '@/components';
import LoadingBird from '@/components/LoadingBird';
import { auth } from '@/services';
import { supabase } from '@/services/supabaseClient';
import { formatPhilippinePeso } from '@/utils/funeralCatalog';
import { computeSalesOverview, formatCompactPeso, type SalesOverview } from '@/utils/salesAnalytics';

type ReportRequest = {
  id: string;
  status: string;
  productPrice?: string | number | null;
  paymentAmount?: string | number | null;
  createdAt?: string | null;
  paymentVerifiedAt?: string | null;
  completedAt?: string | null;
  acceptedAt?: string | null;
  declinedAt?: string | null;
  cancelledAt?: string | null;
};

type InventorySummary = { total: number; live: number; lowStock: number; unavailable: number };

export default function FuneralShopReportsScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<SalesOverview | null>(null);
  const [inventory, setInventory] = useState<InventorySummary>({ total: 0, live: 0, lowStock: 0, unavailable: 0 });
  const [allRequests, setAllRequests] = useState<ReportRequest[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let shopId = auth.currentUser?.uid || null;
      if (!shopId) {
        const { data } = await supabase.auth.getSession();
        shopId = data.session?.user?.id || null;
      }
      if (!shopId) return;
      const from = new Date();
      from.setMonth(from.getMonth() - 5, 1);
      from.setHours(0, 0, 0, 0);
      const [requestResult, productResult] = await Promise.all([
        supabase.from('funeral_service_requests').select('id, status, productPrice, paymentAmount, createdAt, paymentVerifiedAt, completedAt, acceptedAt, declinedAt, cancelledAt').eq('shopId', shopId).gte('createdAt', from.toISOString()).limit(2000),
        supabase.from('funeral_products').select('id, stock, active').eq('shopId', shopId),
      ]);
      if (requestResult.error) throw requestResult.error;
      if (productResult.error) throw productResult.error;
      const requests = (requestResult.data || []) as ReportRequest[];
      const products = productResult.data || [];
      setAllRequests(requests);
      setOverview(computeSalesOverview(requests));
      setInventory({
        total: products.length,
        live: products.filter((item) => item.active && Number(item.stock) > 0).length,
        lowStock: products.filter((item) => item.active && Number(item.stock) > 0 && Number(item.stock) <= 3).length,
        unavailable: products.filter((item) => !item.active || Number(item.stock) <= 0).length,
      });
    } catch (error) {
      console.error('Unable to load shop reports', error);
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const acceptanceRate = useMemo(() => {
    if (!allRequests.length) return 0;
    const accepted = allRequests.filter((item) => !['pending_shop_acceptance', 'declined_by_shop', 'cancelled', 'cancelled_by_requester'].includes(String(item.status).toLowerCase())).length;
    return Math.round((accepted / allRequests.length) * 100);
  }, [allRequests]);

  if (loading) return <SafeAreaView style={styles.screen}><LoadingBird fullScreen /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <AppBackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerCopy}><Text style={styles.title}>Shop Reports</Text><Text style={styles.subtitle}>Last six months</Text></View>
        <TouchableOpacity style={styles.iconButton} onPress={() => void load()}><Ionicons name='refresh-outline' size={20} color='#33453f' /></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!overview ? (
          <View style={styles.empty}><Ionicons name='bar-chart-outline' size={30} color='#87918d' /><Text style={styles.emptyTitle}>Reports are unavailable</Text><Text style={styles.emptyText}>Try refreshing after your shop receives service requests.</Text></View>
        ) : (
          <>
            <View style={styles.metrics}>
              <View style={styles.metricCard}><Text style={styles.metricLabel}>Confirmed revenue</Text><Text style={styles.metricValue}>{formatPhilippinePeso(overview.totalRevenue)}</Text></View>
              <View style={styles.metricCard}><Text style={styles.metricLabel}>This month</Text><Text style={styles.metricValue}>{formatPhilippinePeso(overview.revenueThisMonth)}</Text></View>
              <View style={styles.metricCard}><Text style={styles.metricLabel}>Confirmed sales</Text><Text style={styles.metricValue}>{overview.totalSales}</Text></View>
              <View style={styles.metricCard}><Text style={styles.metricLabel}>Acceptance rate</Text><Text style={styles.metricValue}>{acceptanceRate}%</Text></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Revenue</Text><Text style={styles.cardSub}>Confirmed revenue by month</Text>
              <SimpleBarChart data={overview.monthlyRevenue} formatValue={formatCompactPeso} showValues barColor='#4d7568' height={160} />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Cases</Text><Text style={styles.cardSub}>Confirmed sales by month</Text>
              <SimpleBarChart data={overview.monthlySales} showValues barColor='#486a84' height={150} />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Case pipeline</Text><Text style={styles.cardSub}>Current request status</Text>
              {overview.breakdown.map((item) => {
                const max = overview.breakdown.reduce((highest, entry) => Math.max(highest, entry.value), 1);
                return <View key={item.label} style={styles.pipelineRow}><Text style={styles.pipelineLabel}>{item.label}</Text><View style={styles.track}><View style={[styles.fill, { width: `${Math.max(3, Math.round((item.value / max) * 100))}%`, backgroundColor: item.color }]} /></View><Text style={styles.pipelineValue}>{item.value}</Text></View>;
              })}
            </View>

            <View style={styles.card}>
              <View style={styles.cardHead}><View><Text style={styles.cardTitle}>Inventory health</Text><Text style={styles.cardSub}>Products that need attention</Text></View><TouchableOpacity style={styles.reviewButton} onPress={() => navigation.navigate('ShopCatalog')}><Text style={styles.reviewText}>Review</Text></TouchableOpacity></View>
              <View style={styles.inventoryRow}>
                <View><Text style={styles.inventoryValue}>{inventory.total}</Text><Text style={styles.inventoryLabel}>Total</Text></View>
                <View><Text style={styles.inventoryValue}>{inventory.live}</Text><Text style={styles.inventoryLabel}>Live</Text></View>
                <View><Text style={styles.inventoryValue}>{inventory.lowStock}</Text><Text style={styles.inventoryLabel}>Low stock</Text></View>
                <View><Text style={styles.inventoryValue}>{inventory.unavailable}</Text><Text style={styles.inventoryLabel}>Unavailable</Text></View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f1f3ef' }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dce1dd' }, headerCopy: { flex: 1, marginLeft: 10 }, title: { color: '#22312d', fontSize: 20, fontWeight: '800' }, subtitle: { marginTop: 2, color: '#73807b', fontSize: 12 }, iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#eef2ef' },
  content: { padding: 14, paddingBottom: 36, gap: 12 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metricCard: { width: '48.5%', padding: 15, borderWidth: 1, borderColor: '#dce1dd', borderRadius: 13, backgroundColor: '#fff' }, metricLabel: { color: '#76817c', fontSize: 10 }, metricValue: { marginTop: 7, color: '#263832', fontSize: 17, fontWeight: '800' },
  card: { padding: 16, borderWidth: 1, borderColor: '#dce1dd', borderRadius: 14, backgroundColor: '#fff' }, cardTitle: { color: '#263832', fontSize: 15, fontWeight: '800' }, cardSub: { marginTop: 3, marginBottom: 12, color: '#79847f', fontSize: 11 }, cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  pipelineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }, pipelineLabel: { width: 88, color: '#56635e', fontSize: 10 }, track: { flex: 1, height: 7, overflow: 'hidden', borderRadius: 4, backgroundColor: '#edf0ee' }, fill: { height: '100%', borderRadius: 4 }, pipelineValue: { width: 22, color: '#45534e', fontSize: 11, fontWeight: '700', textAlign: 'right' },
  reviewButton: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 8, backgroundColor: '#e8efea' }, reviewText: { color: '#365347', fontSize: 11, fontWeight: '700' }, inventoryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }, inventoryValue: { color: '#263832', fontSize: 17, fontWeight: '800', textAlign: 'center' }, inventoryLabel: { marginTop: 3, color: '#7a8580', fontSize: 9, textAlign: 'center' },
  empty: { alignItems: 'center', padding: 34, borderWidth: 1, borderColor: '#dce1dd', borderRadius: 16, backgroundColor: '#fff' }, emptyTitle: { marginTop: 12, color: '#263832', fontSize: 16, fontWeight: '700' }, emptyText: { marginTop: 6, color: '#77827d', fontSize: 13, textAlign: 'center' },
});
