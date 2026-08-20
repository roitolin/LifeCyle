import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from '@/components';
import { auth } from '@/services/supabaseAuth';
import { supabase } from '@/services/supabaseClient';

type UserPayment = {
  id: string;
  shopName?: string;
  productName?: string;
  variationName?: string;
  status: string;
  paymentAmount?: number | string | null;
  paymentPayerName?: string | null;
  paymentGcashName?: string | null;
  paymentReferenceNumber?: string | null;
  paymentSubmittedAt?: string | null;
  paymentVerifiedAt?: string | null;
  paymentRejectionReason?: string | null;
  createdAt?: string | null;
};

const formatPeso = (value: number | string | null | undefined) => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString(undefined, { hour12: true });
};

const getPaymentStatus = (payment: UserPayment) => {
  if (payment.paymentRejectionReason) {
    return { label: 'Needs attention', color: '#991b1b', background: '#fee2e2' };
  }
  if (payment.status === 'payment_verified' || payment.status === 'completed') {
    return { label: 'Paid', color: '#166534', background: '#dcfce7' };
  }
  if (payment.status === 'payment_submitted') {
    return { label: 'Under review', color: '#8a5a16', background: '#fef3c7' };
  }
  return { label: 'Payment due', color: '#7f1d1d', background: '#fee2e2' };
};

export default function UserPaymentsScreen({ navigation }: any) {
  const [payments, setPayments] = useState<UserPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadPayments = useCallback(async () => {
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId) return;

    setLoading(true);
    setErrorMessage('');
    try {
      const result = await supabase
        .from('funeral_service_requests')
        .select('id,shopName,productName,variationName,status,paymentAmount,paymentPayerName,paymentGcashName,paymentReferenceNumber,paymentSubmittedAt,paymentVerifiedAt,paymentRejectionReason,createdAt')
        .eq('requesterId', currentUserId)
        .gt('paymentAmount', 0)
        .order('createdAt', { ascending: false });
      if (result.error) throw result.error;
      setPayments((result.data || []) as UserPayment[]);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Payments could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadPayments();
  }, [loadPayments]));

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name='wallet-outline' size={28} color='#ffffff' />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>My payments</Text>
            <Text style={styles.heroText}>Only payments connected to your account are shown here.</Text>
          </View>
          <TouchableOpacity accessibilityLabel='Refresh payments' disabled={loading} onPress={loadPayments} style={styles.refreshButton}>
            <Ionicons name='refresh-outline' size={19} color='#ffffff' />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Payment history</Text>
          <Text style={styles.count}>{payments.length} records</Text>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color='#41514d' />
            <Text style={styles.stateText}>Loading your payments...</Text>
          </View>
        ) : null}

        {!loading && errorMessage ? (
          <View style={styles.stateCard}>
            <Ionicons name='alert-circle-outline' size={30} color='#9a5b32' />
            <Text style={styles.stateTitle}>Payments unavailable</Text>
            <Text style={styles.stateText}>Please check your connection and try again.</Text>
            <TouchableOpacity onPress={loadPayments} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !errorMessage && payments.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name='receipt-outline' size={32} color='#7a8580' />
            <Text style={styles.stateTitle}>No payments yet</Text>
            <Text style={styles.stateText}>Service request payments will appear here when a shop requests payment.</Text>
          </View>
        ) : null}

        {!loading && !errorMessage ? payments.map((payment) => {
          const status = getPaymentStatus(payment);
          return (
            <View key={payment.id} style={styles.paymentCard}>
              <View style={styles.paymentHeader}>
                <View style={styles.paymentIcon}>
                  <Ionicons name='receipt-outline' size={21} color='#41514d' />
                </View>
                <View style={styles.paymentTitleCopy}>
                  <Text numberOfLines={1} style={styles.paymentTitle}>{payment.productName || 'Funeral service'}</Text>
                  <Text numberOfLines={1} style={styles.shopName}>{payment.shopName || 'Funeral shop'}</Text>
                </View>
                <Text style={[styles.statusBadge, { color: status.color, backgroundColor: status.background }]}>{status.label}</Text>
              </View>

              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>Amount</Text>
                <Text style={styles.amountValue}>{formatPeso(payment.paymentAmount)}</Text>
              </View>

              {payment.paymentReferenceNumber ? (
                <DetailRow label='Reference number' value={payment.paymentReferenceNumber} />
              ) : null}
              {payment.paymentPayerName ? <DetailRow label='Paid by' value={payment.paymentPayerName} /> : null}
              <DetailRow
                label={payment.paymentVerifiedAt ? 'Verified' : payment.paymentSubmittedAt ? 'Submitted' : 'Created'}
                value={formatDate(payment.paymentVerifiedAt || payment.paymentSubmittedAt || payment.createdAt)}
              />
              {payment.paymentRejectionReason ? (
                <View style={styles.rejectionCard}>
                  <Text style={styles.rejectionTitle}>Payment needs attention</Text>
                  <Text style={styles.rejectionText}>{payment.paymentRejectionReason}</Text>
                </View>
              ) : null}

              <TouchableOpacity onPress={() => navigation.navigate('MyServiceRequests')} style={styles.requestButton}>
                <Text style={styles.requestButtonText}>View service request</Text>
                <Ionicons name='chevron-forward' size={16} color='#41514d' />
              </TouchableOpacity>
            </View>
          );
        }) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef1ec' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 18, paddingBottom: 120 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 17, borderRadius: 18,
    backgroundColor: '#22312d', marginBottom: 22,
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
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10,
  },
  sectionTitle: { color: '#22312d', fontSize: 16, fontWeight: '800' },
  count: { color: '#7a8580', fontSize: 11, fontWeight: '700' },
  stateCard: {
    minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 24, borderRadius: 17,
    borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#ffffff',
  },
  stateTitle: { color: '#22312d', fontSize: 15, fontWeight: '800', marginTop: 9 },
  stateText: { color: '#7a8580', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 6 },
  retryButton: { marginTop: 13, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#ebf1e8' },
  retryText: { color: '#2f6b4f', fontSize: 12, fontWeight: '800' },
  paymentCard: {
    padding: 15, borderRadius: 17, borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#ffffff', marginBottom: 10,
  },
  paymentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  paymentIcon: {
    width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ebf1e8',
  },
  paymentTitleCopy: { flex: 1, minWidth: 0 },
  paymentTitle: { color: '#22312d', fontSize: 14, fontWeight: '800' },
  shopName: { color: '#7a8580', fontSize: 11, marginTop: 2 },
  statusBadge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8, fontSize: 9, fontWeight: '900' },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14,
    padding: 12, borderRadius: 13, backgroundColor: '#f1ebe4',
  },
  amountLabel: { color: '#62706b', fontSize: 12, fontWeight: '700' },
  amountValue: { color: '#22312d', fontSize: 18, fontWeight: '900' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingTop: 11 },
  detailLabel: { color: '#7a8580', fontSize: 11 },
  detailValue: { flex: 1, color: '#41514d', fontSize: 11, fontWeight: '700', textAlign: 'right' },
  rejectionCard: { marginTop: 12, padding: 11, borderRadius: 12, backgroundColor: '#fff7ed' },
  rejectionTitle: { color: '#9a3412', fontSize: 12, fontWeight: '800' },
  rejectionText: { color: '#9a5b32', fontSize: 11, lineHeight: 17, marginTop: 3 },
  requestButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 40,
    borderRadius: 12, backgroundColor: '#ebf1e8', marginTop: 14,
  },
  requestButtonText: { color: '#41514d', fontSize: 12, fontWeight: '800' },
});
