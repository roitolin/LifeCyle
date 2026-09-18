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
  StatusBar,
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
  paymentProvider: 'manual' | 'paymongo' | 'xendit';
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

const SETTING_KEY = 'payment_qr_code';

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
      : row.paymentProvider === 'paymongo'
        ? 'paymongo'
        : 'manual',
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
  if (!value) return 'Not provided';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not provided';
  return parsed.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getShopReceiptStatus(status?: string) {
  const normalized = String(status || '').toLowerCase();
  if (['verified', 'paid', 'completed'].includes(normalized)) {
    return {
      title: 'Payment Verified',
      message: 'This shop subscription payment was reviewed and confirmed by LifeCycle Admin.',
      icon: 'checkmark' as const,
      badge: '#59c57d',
    };
  }
  if (['pending', 'submitted'].includes(normalized)) {
    return {
      title: 'Payment Under Review',
      message: 'Your payment was submitted and is awaiting gateway verification or review.',
      icon: 'receipt-outline' as const,
      badge: '#f0b253',
    };
  }
  return {
    title: 'Payment Unsuccessful',
    message: 'This payment attempt could not be completed or was rejected.',
    icon: 'close' as const,
    badge: '#ef4444',
  };
}

function statusMeta(payment: Payment) {
  if (payment.status === 'verified') return { label: 'Paid', color: '#166534', bg: '#dcfce7', icon: 'checkmark-circle' as const };
  if (payment.status === 'rejected') return { label: 'Not completed', color: '#991b1b', bg: '#fee2e2', icon: 'close-circle' as const };
  return { label: payment.paymentProvider === 'xendit' ? 'Awaiting checkout' : 'Admin review', color: '#92400e', bg: '#fef3c7', icon: 'time' as const };
}

function methodLabel(payment: Payment) {
  if (payment.paymentProvider === 'manual') return 'Manual payment';
  const method = String(payment.providerPaymentMethod || '').replace(/_/g, ' ').trim();
  return method ? `Xendit · ${method}` : 'Xendit hosted checkout';
}

function receiptNumber(payment: Payment) {
  return `LC-${payment.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
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

  // Spring animation matching the customer ServiceXenditSheet
  useEffect(() => {
    if (visible) {
      backdropOpacity.setValue(0);
      sheetProgress.setValue(0);
      setShowHistory(false);
      setSelectedReceipt(null);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(sheetProgress, {
          toValue: 1,
          damping: 18,
          stiffness: 160,
          mass: 0.9,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, backdropOpacity, sheetProgress]);

  const handleClose = () => {
    if (starting) return;
    Animated.parallel([
      Animated.timing(sheetProgress, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 160,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  };

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

    const channel = supabase.channel('shop-xendit-mobile-sub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_payments' }, () => {
        void load().then(() => onChanged?.()).catch(() => undefined);
      })
      .subscribe();

    const stateSubscription = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        try {
          const syncRes = await syncXenditShopPayment();
          if (syncRes.paid) {
            Alert.alert('Payment Confirmed', 'Your shop subscription payment was verified successfully!');
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
  }, [load, onChanged, visible]);

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
        `Your shop subscription is already paid and active through ${formatDate(paidUntil)}. Renewal payment will only become available once this subscription period expires.`
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
        throw new Error('The secure Xendit checkout link is unavailable.');
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
    Platform.OS === 'android' ? 44 : 24
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
        {/* Animated backdrop */}
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleClose}
            accessibilityLabel="Close checkout"
          />
        </Animated.View>

        {/* Animated Bottom Sheet */}
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
                {
                  scale: sheetProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Grab Handle */}
          <View style={styles.handle} />

          {/* Header Row */}
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <Text style={styles.brandText}>LifeCycle</Text>
              <View style={styles.secureBadge}>
                <Ionicons name="shield-checkmark" size={13} color="#059669" />
                <Text style={styles.secureBadgeText}>SECURE CHECKOUT</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={handleClose}
              disabled={starting}
              accessibilityLabel="Close"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color="#059669" />
              <Text style={styles.loadingText}>Preparing checkout details...</Text>
            </View>
          ) : (
            <>
              {/* Product / Service Summary Row */}
              <View style={styles.productRow}>
                <View style={styles.productIconWrap}>
                  <Ionicons name="storefront" size={26} color="#059669" />
                </View>
                <View style={styles.productInfo}>
                  <Text style={styles.productName} numberOfLines={2}>
                    Shop Registration & Renewal
                  </Text>
                  <View style={styles.shopMetaRow}>
                    <Ionicons name="business-outline" size={13} color="#64748b" />
                    <Text style={styles.shopName} numberOfLines={1}>
                      LifeCycle Admin Platform • {shopName}
                    </Text>
                  </View>
                  {Boolean(paidUntil) && (
                    <View style={styles.activePill}>
                      <Ionicons name={isSubscriptionActive ? "checkmark-circle" : "time-outline"} size={11} color={isSubscriptionActive ? "#059669" : "#d97706"} />
                      <Text style={[styles.activePillText, !isSubscriptionActive && styles.expiredPillText]}>
                        {isSubscriptionActive ? `Active through ${formatDate(paidUntil)}` : `Expired on ${formatDate(paidUntil)}`}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Clean Order Total Summary Card */}
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>
                    {isSubscriptionActive ? 'Current Subscription' : 'Registration / Renewal Fee'}
                  </Text>
                  <Text style={styles.summaryValue}>{formatPhilippinePeso(fee)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Packages & Services</Text>
                  <Text style={styles.summaryFreeValue}>Included</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.totalRow}>
                  <View>
                    <Text style={styles.totalMainLabel}>
                      {isSubscriptionActive ? 'Subscription Status' : 'Total Amount'}
                    </Text>
                    <Text style={styles.totalSubNotice}>
                      {isSubscriptionActive ? `Active until ${formatDate(paidUntil)}` : 'Authorized & encrypted'}
                    </Text>
                  </View>
                  <Text style={[styles.totalMainValue, isSubscriptionActive && styles.totalActiveText]}>
                    {isSubscriptionActive ? 'PAID' : formatPhilippinePeso(fee)}
                  </Text>
                </View>
              </View>

              {/* Payment Method Info Badge */}
              <View style={styles.methodRow}>
                <View style={styles.methodIcon}>
                  <Ionicons name="card-outline" size={18} color="#059669" />
                </View>
                <View style={styles.methodInfo}>
                  <Text style={styles.methodTitle}>Xendit Payment Gateway</Text>
                  <Text style={styles.methodSubtitle}>Credit/Debit Cards, Online Banking & E-Wallets</Text>
                </View>
                <Ionicons name="checkmark-circle" size={18} color="#059669" />
              </View>

              {/* High-visibility Action Button or Already Paid Status */}
              {isSubscriptionActive ? (
                <View style={styles.alreadyPaidBtnWrap}>
                  <View style={styles.alreadyPaidBtn}>
                    <Ionicons name="checkmark-circle" size={18} color="#059669" />
                    <Text style={styles.alreadyPaidBtnText}>
                      Already Paid • Renews After {formatDate(paidUntil)}
                    </Text>
                  </View>
                  {payments.length > 0 && (
                    <TouchableOpacity
                      style={styles.viewActiveReceiptBtn}
                      onPress={() => {
                        const verified = payments.find((p) => p.status === 'verified') || payments[0];
                        if (verified) setSelectedReceipt(verified);
                      }}
                      activeOpacity={0.84}
                    >
                      <Ionicons name="receipt-outline" size={16} color="#065f46" />
                      <Text style={styles.viewActiveReceiptBtnText}>View Payment Receipt</Text>
                    </TouchableOpacity>
                  )}
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
                      <Text style={styles.payButtonText}>Connecting to Xendit...</Text>
                    </View>
                  ) : (
                    <View style={styles.buttonInnerRow}>
                      <Ionicons name="lock-closed" size={17} color="#ffffff" />
                      <Text style={styles.payButtonText}>
                        Pay {formatPhilippinePeso(fee)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}

              {/* Discrete Payment History Link */}
              {payments.length > 0 && (
                <TouchableOpacity
                  style={styles.historyToggleRow}
                  onPress={() => setShowHistory(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="receipt-outline" size={15} color="#64748b" />
                  <Text style={styles.historyToggleText}>
                    View Payment History ({payments.length})
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </>
          )}
        </Animated.View>
      </View>

      {/* History Slide-Over Modal */}
      <Modal
        visible={showHistory}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowHistory(false)}
      >
        <View style={styles.historyScreen}>
          <View style={styles.historyHeader}>
            <TouchableOpacity onPress={() => setShowHistory(false)} style={styles.historyCloseBtn}>
              <Ionicons name="close" size={22} color="#0f172a" />
            </TouchableOpacity>
            <Text style={styles.historyHeaderTitle}>Payment History</Text>
            <View style={{ width: 36 }} />
          </View>
          <ScrollView contentContainerStyle={styles.historyListContent}>
            {payments.map((p) => {
              const meta = statusMeta(p);
              return (
                <TouchableOpacity
                  key={p.id}
                  style={styles.historyCard}
                  onPress={() => setSelectedReceipt(p)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.historyStatusIcon, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon} size={20} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyCardAmount}>{formatPhilippinePeso(p.amount)}</Text>
                    <Text style={styles.historyCardDate}>{methodLabel(p)} • {formatDate(p.createdAt)}</Text>
                  </View>
                  <View style={[styles.historyBadge, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.historyBadgeText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Customer & Shop Styled Receipt Modal */}
      <Modal
        visible={Boolean(selectedReceipt)}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setSelectedReceipt(null)}
        statusBarTranslucent={false}
      >
        {selectedReceipt ? (
          <View style={styles.receiptScreen}>
            <StatusBar barStyle="light-content" backgroundColor="#101312" />
            <ScrollView
              contentContainerStyle={styles.receiptScrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Dark Hero Section matching customer & shop receipt */}
              <View style={[styles.receiptHero, { paddingTop: Math.max(38, insets.top + 18) }]}>
                <TouchableOpacity
                  activeOpacity={0.84}
                  style={[styles.receiptHeroClose, { top: Math.max(14, insets.top + 6) }]}
                  onPress={() => setSelectedReceipt(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close payment receipt"
                >
                  <Ionicons name="close" size={24} color="#ffffff" />
                </TouchableOpacity>
                <View style={[styles.receiptStatusIcon, { backgroundColor: getShopReceiptStatus(selectedReceipt.status).badge }]}>
                  <Ionicons name={getShopReceiptStatus(selectedReceipt.status).icon} size={29} color="#18201d" />
                </View>
                <Text style={styles.receiptHeroTitle}>{getShopReceiptStatus(selectedReceipt.status).title}</Text>
                <Text style={styles.receiptHeroMessage}>{getShopReceiptStatus(selectedReceipt.status).message}</Text>
              </View>

              {/* Receipt Body */}
              <View style={[styles.receiptBody, { paddingBottom: Math.max(30, insets.bottom + 20) }]}>
                <Text style={styles.sectionTitle}>Order Details</Text>
                <View style={styles.detailsBlock}>
                  <DetailLine
                    label="Order Date"
                    value={formatTimestamp(selectedReceipt.verifiedAt || selectedReceipt.createdAt)}
                  />
                  <DetailLine label="Order ID" value={`#${receiptNumber(selectedReceipt)}`} />
                  <DetailLine label="Shop Name" value={shopName} />
                  <DetailLine
                    label="Access Valid Until"
                    value={selectedReceipt.expiresAt ? formatDate(selectedReceipt.expiresAt) : paidUntil ? formatDate(paidUntil) : 'Active Monthly'}
                  />
                </View>

                <View style={styles.receiptDivider} />

                {/* Service Row */}
                <View style={styles.serviceRow}>
                  <View style={[styles.serviceImage, styles.serviceImageFallback]}>
                    <Ionicons name="storefront" size={26} color="#059669" />
                  </View>
                  <View style={styles.serviceCopy}>
                    <Text style={styles.serviceName} numberOfLines={2}>
                      LifeCycle Shop Registration & Renewal
                    </Text>
                    <Text style={styles.serviceMeta}>Admin Platform Monthly Access</Text>
                    <Text style={styles.serviceMeta}>Verified Merchant Account • Full Access</Text>
                  </View>
                  <Text style={styles.serviceAmount}>{formatPhilippinePeso(selectedReceipt.amount)}</Text>
                </View>

                <View style={styles.receiptDivider} />

                {/* Receipt Information Section */}
                <View style={styles.sectionHeadingRow}>
                  <Text style={styles.sectionTitle}>Receipt Information</Text>
                  <View style={styles.sectionHeadingIcon}>
                    <Ionicons name="receipt-outline" size={18} color="#53615d" />
                  </View>
                </View>
                <View style={styles.receiptInfoCard}>
                  <DetailLine label="Payment Method" value={methodLabel(selectedReceipt)} />
                  <DetailLine label="Shop / Payer" value={selectedReceipt.payerName || shopName} />
                  <DetailLine label="Reference Number" value={selectedReceipt.referenceNumber || receiptNumber(selectedReceipt)} />
                  <DetailLine
                    label="Provider Reference"
                    value={selectedReceipt.providerPaymentId || selectedReceipt.providerCheckoutId || 'Xendit Gateway'}
                  />
                  <DetailLine label="Status" value={getShopReceiptStatus(selectedReceipt.status).title} />
                  <DetailLine label="Amount" value={formatPhilippinePeso(selectedReceipt.amount)} />
                  <DetailLine
                    label="Confirmed Date"
                    value={formatTimestamp(selectedReceipt.verifiedAt || selectedReceipt.createdAt)}
                  />
                </View>

                {/* Rejection / Problem Reason if present */}
                {selectedReceipt.rejectionReason ? (
                  <View style={styles.receiptRejectionBox}>
                    <Ionicons name="alert-circle-outline" size={20} color="#991b1b" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.receiptRejectionTitle}>Payment Issue</Text>
                      <Text style={styles.receiptRejectionText}>{selectedReceipt.rejectionReason}</Text>
                    </View>
                  </View>
                ) : null}

                {/* Security Trust Note */}
                <View style={styles.providerTrustRow}>
                  <Ionicons name="shield-checkmark" size={15} color="#059669" />
                  <Text style={styles.providerTrustText}>Verified by Xendit Payment Gateway</Text>
                </View>

                {/* Close Button */}
                <TouchableOpacity
                  style={styles.closeReceiptButton}
                  activeOpacity={0.88}
                  onPress={() => setSelectedReceipt(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close receipt"
                >
                  <Ionicons name="checkmark-circle-outline" size={18} color="#ffffff" />
                  <Text style={styles.closeReceiptButtonText}>Close Receipt</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        ) : null}
      </Modal>
    </Modal>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} selectable>{value}</Text>
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
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandText: {
    color: '#0f172a',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  secureBadgeText: {
    color: '#065f46',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#64748b',
    fontSize: 13,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  productIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  shopMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  shopName: {
    color: '#64748b',
    fontSize: 12.5,
    fontWeight: '500',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  activePillText: {
    color: '#065f46',
    fontSize: 11,
    fontWeight: '600',
  },
  expiredPillText: {
    color: '#d97706',
  },
  activeNoticeCard: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 16,
    padding: 13,
    marginBottom: 12,
  },
  activeNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  activeNoticeTitle: {
    color: '#065f46',
    fontSize: 13.5,
    fontWeight: '700',
  },
  activeNoticeDesc: {
    color: '#047857',
    fontSize: 12,
    lineHeight: 17,
  },
  summaryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  summaryLabel: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '500',
  },
  summaryValue: {
    color: '#1e293b',
    fontSize: 13,
    fontWeight: '600',
  },
  summaryFreeValue: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '700',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 10,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalMainLabel: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
  },
  totalSubNotice: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 1,
  },
  totalMainValue: {
    color: '#0f172a',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  totalActiveText: {
    color: '#059669',
    fontSize: 20,
  },
  alreadyPaidBtnWrap: {
    width: '100%',
    alignItems: 'center',
  },
  alreadyPaidBtn: {
    width: '100%',
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#ecfdf5',
    borderWidth: 1.5,
    borderColor: '#a7f3d0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  alreadyPaidBtnText: {
    color: '#065f46',
    fontSize: 14,
    fontWeight: '800',
  },
  alreadyPaidHint: {
    color: '#64748b',
    fontSize: 11.5,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 16,
  },
  viewActiveReceiptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#a7f3d0',
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 16,
    width: '100%',
    marginTop: 10,
  },
  viewActiveReceiptBtnText: {
    color: '#065f46',
    fontSize: 13.5,
    fontWeight: '700',
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 18,
  },
  methodIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodInfo: {
    flex: 1,
  },
  methodTitle: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
  },
  methodSubtitle: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 1,
  },
  payButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  buttonInnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  payButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  historyToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 4,
  },
  historyToggleText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
  },
  historyScreen: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  historyHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  historyCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyHeaderTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  historyListContent: {
    padding: 16,
    gap: 10,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  historyStatusIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCardAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  historyCardDate: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  historyBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
  },
  historyBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  receiptScreen: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  receiptScrollContent: {
    flexGrow: 1,
    backgroundColor: '#ffffff',
  },
  receiptHero: {
    minHeight: 255,
    backgroundColor: '#101312',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 30,
  },
  receiptHeroClose: {
    position: 'absolute',
    right: 18,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#303332',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptStatusIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptHeroTitle: {
    color: '#ffffff',
    fontSize: 23,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 22,
  },
  receiptHeroMessage: {
    color: '#b9bfbc',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 330,
    marginTop: 9,
  },
  receiptBody: {
    paddingHorizontal: 22,
    paddingTop: 26,
  },
  sectionTitle: {
    color: '#191c1b',
    fontSize: 16,
    fontWeight: '900',
  },
  detailsBlock: {
    gap: 16,
    marginTop: 22,
  },
  detailLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 18,
  },
  detailLabel: {
    flex: 1,
    color: '#858c88',
    fontSize: 12,
  },
  detailValue: {
    flex: 1.35,
    color: '#303634',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'right',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: '#e5e8e6',
    marginVertical: 24,
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  serviceImage: {
    width: 58,
    height: 70,
    borderRadius: 12,
    backgroundColor: '#edf0ee',
  },
  serviceImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceCopy: {
    flex: 1,
    minWidth: 0,
  },
  serviceName: {
    color: '#282e2b',
    fontSize: 14,
    fontWeight: '900',
  },
  serviceMeta: {
    color: '#868d89',
    fontSize: 11,
    marginTop: 3,
  },
  serviceAmount: {
    color: '#222725',
    fontSize: 14,
    fontWeight: '900',
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionHeadingIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f1f3f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptInfoCard: {
    borderRadius: 15,
    backgroundColor: '#f7f8f7',
    gap: 15,
    padding: 14,
    marginTop: 12,
  },
  receiptRejectionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 15,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 14,
    marginTop: 14,
  },
  receiptRejectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#991b1b',
  },
  receiptRejectionText: {
    fontSize: 12,
    color: '#b91c1c',
    marginTop: 2,
    lineHeight: 16,
  },
  providerTrustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 6,
  },
  providerTrustText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  closeReceiptButton: {
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: '#22312d',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
  },
  closeReceiptButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
});
