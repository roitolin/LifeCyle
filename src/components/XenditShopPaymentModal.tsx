import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/services/supabaseClient';
import { createXenditShopCheckout, syncXenditShopPayment } from '@/services/xenditShop';
import { formatPhilippinePeso } from '@/utils/funeralCatalog';

type Payment = {
  id: string;
  status: 'pending' | 'verified' | 'rejected';
  amount: number;
  referenceNumber: string;
  createdAt: string;
  verifiedAt: string | null;
  expiresAt: string | null;
  rejectionReason: string | null;
  payerName: string | null;
  paymentProvider: 'manual' | 'legacy' | 'xendit';
  providerCheckoutId: string | null;
  providerCheckoutUrl: string | null;
  providerPaymentId: string | null;
  providerPaymentMethod: string | null;
  providerLivemode: boolean | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

const SETTING_KEY = 'shop_payment_settings';

function fromRow(row: any): Payment {
  return {
    id: row.id,
    status: row.status || 'pending',
    amount: Number(row.amount) || 0,
    referenceNumber: row.referenceNumber || '',
    createdAt: row.createdAt || '',
    verifiedAt: row.verifiedAt || null,
    expiresAt: row.expiresAt || null,
    rejectionReason: row.rejectionReason || null,
    payerName: row.payerName || null,
    paymentProvider: row.paymentProvider === 'xendit'
      ? 'xendit'
      : row.paymentProvider === 'manual'
        ? 'manual'
        : 'legacy',
    providerCheckoutId: row.providerCheckoutId || null,
    providerCheckoutUrl: row.providerCheckoutUrl || null,
    providerPaymentId: row.providerPaymentId || null,
    providerPaymentMethod: row.providerPaymentMethod || null,
    providerLivemode: typeof row.providerLivemode === 'boolean' ? row.providerLivemode : null,
  };
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString([], {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function formatTimestamp(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusMeta(payment: Payment) {
  if (payment.status === 'verified') return { label: 'Paid', color: '#166534', bg: '#e7f5ec', icon: 'checkmark-circle' as const };
  if (payment.status === 'rejected') return { label: 'Not completed', color: '#991b1b', bg: '#fee2e2', icon: 'close-circle' as const };
  return { label: 'Pending', color: '#86654a', bg: '#fef3c7', icon: 'time-outline' as const };
}

function methodLabel(payment: Payment) {
  if (payment.paymentProvider === 'manual') return 'Manual payment';
  const method = String(payment.providerPaymentMethod || '').replace(/^PH_/, '').replace(/_/g, ' ').trim();
  return method ? `Online (${method})` : 'Online payment';
}

function receiptNumber(payment: Payment) {
  return `LC-${payment.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

export default function XenditShopPaymentModal({ visible, onClose, onChanged }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [fee, setFee] = useState(0);
  const [paidUntil, setPaidUntil] = useState<string | null>(null);
  const [shopName, setShopName] = useState('Funeral shop');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<Payment | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      backdropOpacity.setValue(0);
      sheetProgress.setValue(0);
      setShowHistory(false);
      setSelectedReceipt(null);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(sheetProgress, {
          toValue: 1,
          damping: 20,
          stiffness: 170,
          mass: 0.9,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, backdropOpacity, sheetProgress]);

  const handleClose = useCallback(() => {
    if (starting) return;
    Animated.parallel([
      Animated.timing(sheetProgress, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 150,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  }, [backdropOpacity, onClose, sheetProgress, starting]);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await syncXenditShopPayment().catch(() => undefined);
    const [settingResult, shopResult, paymentsResult] = await Promise.all([
      supabase.from('settings').select('value').eq('key', SETTING_KEY).maybeSingle(),
      supabase.from('funeral_shops').select('paidUntil, shopName').eq('id', user.id).maybeSingle(),
      supabase.from('shop_payments')
        .select('id, status, amount, referenceNumber, createdAt, verifiedAt, expiresAt, rejectionReason, payerName, paymentProvider, providerCheckoutId, providerCheckoutUrl, providerPaymentId, providerPaymentMethod, providerLivemode')
        .eq('shopId', user.id)
        .order('createdAt', { ascending: false }),
    ]);
    const value = settingResult.data?.value as { feeAmount?: number } | null;
    const resolvedShopName = String((shopResult.data as any)?.shopName || 'Funeral shop');
    setFee(Number(value?.feeAmount) || 0);
    setPaidUntil((shopResult.data as any)?.paidUntil || null);
    setShopName(resolvedShopName);
    setPayments((paymentsResult.data || []).map(fromRow));
  }, []);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    setLoading(true);
    load()
      .catch((error) => {
        if (mounted) Alert.alert('Unable to load subscription info', error instanceof Error ? error.message : 'Please try again.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const channel = supabase.channel('shop-payment-mobile-sub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_payments' }, () => {
        void load().then(() => onChanged?.()).catch(() => undefined);
      })
      .subscribe();

    const stateSubscription = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        try {
          const syncRes = await syncXenditShopPayment();
          if (syncRes.paid) {
            Alert.alert('Payment Confirmed', 'Your shop subscription payment was confirmed.');
            await load();
            onChanged?.();
            handleClose();
            return;
          }
        } catch {
          // ignore
        }
        void load().then(() => onChanged?.()).catch(() => undefined);
      }
    });

    return () => {
      mounted = false;
      stateSubscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [handleClose, load, onChanged, visible]);

  const isSubscriptionActive = useMemo(() => {
    if (!paidUntil) return false;
    const time = new Date(paidUntil).getTime();
    return Number.isFinite(time) && time > Date.now();
  }, [paidUntil]);

  const handlePay = async () => {
    if (starting) return;
    if (isSubscriptionActive) {
      Alert.alert(
        'Subscription Active',
        `Your shop subscription is active through ${formatDate(paidUntil)}.`,
      );
      return;
    }
    if (fee <= 0) {
      Alert.alert('Payment unavailable', 'The registration fee has not been configured yet.');
      return;
    }
    setStarting(true);
    try {
      const result = await createXenditShopCheckout('all');
      if (result.paid) {
        Alert.alert('Payment Confirmed', 'Your shop payment has been confirmed.');
        await load();
        onChanged?.();
        handleClose();
        return;
      }
      if (!result.checkoutUrl || !(await Linking.canOpenURL(result.checkoutUrl))) {
        throw new Error('Checkout link is unavailable.');
      }
      await Linking.openURL(result.checkoutUrl);
    } catch (error) {
      Alert.alert('Unable to start payment', error instanceof Error ? error.message : 'Please try again in a moment.');
    } finally {
      setStarting(false);
    }
  };

  if (!visible) return null;

  const bottomPadding = Math.max(
    insets.bottom + 16,
    Platform.OS === 'android' ? 40 : 24,
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent={false}
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleClose}
            accessibilityLabel="Close payment"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: bottomPadding,
              transform: [
                {
                  translateY: sheetProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [600, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.headerTitle}>Shop Subscription</Text>
              <Text style={styles.headerSubtitle}>Registration and marketplace listing access</Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={handleClose}
              disabled={starting}
              accessibilityLabel="Close"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={18} color="#475569" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color="#22312d" />
              <Text style={styles.statusText}>Loading subscription details…</Text>
            </View>
          ) : (
            <View style={styles.body}>
              <View style={styles.summaryBanner}>
                <View style={styles.productRow}>
                  <View style={styles.shopIconBox}>
                    <Ionicons name="storefront-outline" size={20} color="#2f6b55" />
                  </View>
                  <View style={styles.productInfo}>
                    <Text style={styles.productName}>Shop Registration & Renewal</Text>
                    <Text style={styles.shopName} numberOfLines={1}>{shopName}</Text>
                  </View>
                  <View style={[styles.statusBadge, isSubscriptionActive ? styles.statusBadgeActive : styles.statusBadgeInactive]}>
                    <Ionicons
                      name={isSubscriptionActive ? 'checkmark-circle' : 'time-outline'}
                      size={13}
                      color={isSubscriptionActive ? '#166534' : '#86654a'}
                    />
                    <Text style={[styles.statusBadgeText, isSubscriptionActive ? styles.statusBadgeTextActive : styles.statusBadgeTextInactive]}>
                      {isSubscriptionActive ? 'Active' : 'Renewal Due'}
                    </Text>
                  </View>
                </View>

                <View style={styles.bannerDivider} />

                <View style={styles.breakdown}>
                  {paidUntil ? (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>{isSubscriptionActive ? 'Active through' : 'Expired on'}</Text>
                      <Text style={styles.summaryValue}>{formatDate(paidUntil)}</Text>
                    </View>
                  ) : null}
                  <View style={styles.summaryRow}>
                    <Text style={styles.totalMainLabel}>{isSubscriptionActive ? 'Subscription status' : 'Subscription fee'}</Text>
                    <Text style={[styles.totalMainValue, isSubscriptionActive && styles.paidText]}>
                      {isSubscriptionActive ? 'Paid' : formatPhilippinePeso(fee)}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.channelCard}>
                <Ionicons name="card-outline" size={21} color="#2f6b55" />
                <View style={styles.flatRowCopy}>
                  <Text style={styles.flatRowTitle}>Online payment</Text>
                  <Text style={styles.flatRowSub}>GCash, Maya, Cards & Online Banking</Text>
                </View>
                <Ionicons name="checkmark-circle" size={19} color="#2f6b55" />
              </View>

              {isSubscriptionActive ? (
                <View style={styles.actionGroup}>
                  {payments.length > 0 ? (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => {
                        const verified = payments.find((p) => p.status === 'verified') || payments[0];
                        if (verified) setSelectedReceipt(verified);
                      }}
                      activeOpacity={0.84}
                    >
                      <Ionicons name="receipt-outline" size={17} color="#22312d" />
                      <Text style={styles.secondaryButtonText}>View payment receipt</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.payButton, (starting || fee <= 0) && styles.buttonDisabled]}
                  disabled={starting || fee <= 0}
                  onPress={() => void handlePay()}
                  activeOpacity={0.88}
                >
                  {starting ? (
                    <View style={styles.buttonLoadingRow}>
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text style={styles.payButtonText}>Opening payment…</Text>
                    </View>
                  ) : (
                    <View style={styles.buttonLoadingRow}>
                      <Ionicons name="shield-checkmark-outline" size={18} color="#ffffff" />
                      <Text style={styles.payButtonText}>Pay {formatPhilippinePeso(fee)}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}

              {payments.length > 0 ? (
                <TouchableOpacity
                  style={styles.historyToggleRow}
                  onPress={() => setShowHistory(true)}
                  activeOpacity={0.75}
                >
                  <View style={styles.historyToggleLeft}>
                    <Ionicons name="time-outline" size={16} color="#53615d" />
                    <Text style={styles.historyToggleText}>Payment history ({payments.length})</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color="#62706b" />
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </Animated.View>
      </View>

      <Modal
        visible={showHistory}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHistory(false)}
      >
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogSheet}>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.headerTitle}>Payment History</Text>
                <Text style={styles.headerSubtitle}>{shopName}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowHistory(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#475569" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={styles.historyList} showsVerticalScrollIndicator={false}>
              {payments.map((p) => {
                const meta = statusMeta(p);
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.historyRowCard}
                    onPress={() => {
                      setShowHistory(false);
                      setSelectedReceipt(p);
                    }}
                    activeOpacity={0.78}
                  >
                    <View style={styles.flatRowCopy}>
                      <Text style={styles.flatRowTitle}>{formatPhilippinePeso(p.amount)}</Text>
                      <Text style={styles.flatRowSub}>{methodLabel(p)} · {formatDate(p.createdAt)}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                      <Ionicons name={meta.icon} size={12} color={meta.color} />
                      <Text style={[styles.statusBadgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(selectedReceipt)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedReceipt(null)}
      >
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogSheet}>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.headerTitle}>Payment Receipt</Text>
                <Text style={styles.headerSubtitle}>{shopName}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedReceipt(null)} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#475569" />
              </TouchableOpacity>
            </View>
            {selectedReceipt ? (
              <View style={styles.receiptBody}>
                <View style={styles.receiptHeroBanner}>
                  <View style={styles.receiptHeroTop}>
                    <Text style={styles.receiptHeroLabel}>Subscription payment</Text>
                    <View style={[styles.statusBadge, { backgroundColor: statusMeta(selectedReceipt).bg }]}>
                      <Ionicons name={statusMeta(selectedReceipt).icon} size={12} color={statusMeta(selectedReceipt).color} />
                      <Text style={[styles.statusBadgeText, { color: statusMeta(selectedReceipt).color }]}>
                        {statusMeta(selectedReceipt).label}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.receiptHeroAmount}>{formatPhilippinePeso(selectedReceipt.amount)}</Text>
                </View>

                <DetailLine label="Receipt no." value={`#${receiptNumber(selectedReceipt)}`} />
                <DetailLine label="Shop" value={shopName} />
                <DetailLine label="Payment method" value={methodLabel(selectedReceipt)} />
                <DetailLine label="Reference" value={selectedReceipt.referenceNumber || receiptNumber(selectedReceipt)} />
                <DetailLine label="Date" value={formatTimestamp(selectedReceipt.verifiedAt || selectedReceipt.createdAt)} />
                {selectedReceipt.expiresAt ? (
                  <DetailLine label="Valid until" value={formatDate(selectedReceipt.expiresAt)} />
                ) : null}
                <View style={styles.receiptDivider} />
                <DetailLine label="Total paid" value={formatPhilippinePeso(selectedReceipt.amount)} strong />
                {selectedReceipt.rejectionReason ? (
                  <Text style={styles.errorText}>{selectedReceipt.rejectionReason}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

function DetailLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, strong && styles.detailValueStrong]} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.52)',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '90%',
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d4dbd8',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    color: '#1d2d28',
    fontSize: 18,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#6e7c77',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f2efe9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    gap: 12,
  },
  summaryBanner: {
    backgroundColor: '#f8f6f2',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e6e2d8',
    gap: 12,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  shopIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#e7f2ec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
    gap: 2,
  },
  productName: {
    color: '#1d2d28',
    fontSize: 14,
    fontWeight: '800',
  },
  shopName: {
    color: '#5a6964',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusBadgeActive: {
    backgroundColor: '#e7f5ec',
  },
  statusBadgeInactive: {
    backgroundColor: '#fef3c7',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  statusBadgeTextActive: {
    color: '#166534',
  },
  statusBadgeTextInactive: {
    color: '#86654a',
  },
  bannerDivider: {
    height: 1,
    backgroundColor: '#e6e2d8',
  },
  breakdown: {
    gap: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    color: '#62706b',
    fontSize: 12,
  },
  summaryValue: {
    color: '#22312d',
    fontSize: 13,
    fontWeight: '700',
  },
  totalMainLabel: {
    color: '#1d2d28',
    fontSize: 13,
    fontWeight: '800',
  },
  totalMainValue: {
    color: '#2f6b55',
    fontSize: 17,
    fontWeight: '900',
  },
  paidText: {
    color: '#166534',
  },
  channelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2f6b55',
    backgroundColor: '#f2f8f5',
  },
  flatRowCopy: {
    flex: 1,
    gap: 2,
  },
  flatRowTitle: {
    color: '#1d2d28',
    fontSize: 14,
    fontWeight: '800',
  },
  flatRowSub: {
    color: '#62706b',
    fontSize: 11,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 18,
  },
  statusText: {
    color: '#62706b',
    fontSize: 13,
  },
  actionGroup: {
    marginTop: 2,
  },
  payButton: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: '#22312d',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#fbfaf7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: '#22312d',
    fontSize: 13,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  payButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  historyToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f8f6f2',
    borderWidth: 1,
    borderColor: '#e6e2d8',
  },
  historyToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  historyToggleText: {
    color: '#3c4b46',
    fontSize: 13,
    fontWeight: '700',
  },
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  dialogSheet: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
  },
  historyList: {
    gap: 8,
    paddingTop: 4,
  },
  historyRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e3e8e5',
    backgroundColor: '#fbfcfa',
  },
  receiptBody: {
    paddingTop: 4,
    gap: 9,
  },
  receiptHeroBanner: {
    backgroundColor: '#f8f6f2',
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: '#e6e2d8',
    marginBottom: 4,
    gap: 6,
  },
  receiptHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  receiptHeroLabel: {
    color: '#62706b',
    fontSize: 12,
    fontWeight: '700',
  },
  receiptHeroAmount: {
    color: '#1d2d28',
    fontSize: 22,
    fontWeight: '900',
  },
  detailLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailLabel: {
    color: '#62706b',
    fontSize: 13,
  },
  detailValue: {
    color: '#22312d',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },
  detailValueStrong: {
    color: '#1d2d28',
    fontSize: 15,
    fontWeight: '900',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: '#edf1ef',
    marginVertical: 4,
  },
  errorText: {
    color: '#991b1b',
    fontSize: 13,
    marginTop: 4,
  },
});
