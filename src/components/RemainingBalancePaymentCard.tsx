import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  type ImageStyle,
  Modal,
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPhilippinePeso } from '@/utils/funeralCatalog';
import {
  approveShopCashBalancePayment,
  balanceChannelLabel,
  canPayRemainingBalance,
  getBalanceReceiptUrl,
  loadBalancePayments,
  reviewBalancePayment,
  submitBalancePayment,
  submitOnlineBalancePayment,
  syncOnlineBalancePayment,
  type BalancePayment,
  type BalanceReceiver,
  type BalanceRequest,
} from '@/services/remainingBalancePayments';

type Props = { request: BalanceRequest; isShop?: boolean };

const SUBMITTED_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  wallet: 'Online · E-wallet',
  bank: 'Online · Bank transfer',
};

const errorMessage = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Please try again.';

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { hour12: true });
};

export default function RemainingBalancePaymentCard(props: Props) {
  return canPayRemainingBalance(props.request) ? <BalancePanel key={props.request.id} {...props} /> : null;
}

function BalancePanel({ request, isShop = false }: Props) {
  const insets = useSafeAreaInsets();
  const [payments, setPayments] = useState<BalancePayment[]>([]);
  const [receivers, setReceivers] = useState<BalanceReceiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlineSheetVisible, setOnlineSheetVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [viewerUrl, setViewerUrl] = useState('');
  const [openingReceipt, setOpeningReceipt] = useState(false);
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);
  const checkoutOpenedRef = useRef(false);
  const checkoutSyncingRef = useRef(false);
  const [checkoutSyncing, setCheckoutSyncing] = useState(false);

  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const [sheetProgress] = useState(() => new Animated.Value(0));

  const { id: requestId, shopId } = request;

  useEffect(() => {
    if (onlineSheetVisible) {
      backdropOpacity.setValue(0);
      sheetProgress.setValue(0);
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
  }, [onlineSheetVisible, backdropOpacity, sheetProgress]);

  const closeOnlineSheet = useCallback(() => {
    if (busyRef.current || checkoutSyncingRef.current) return;
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
      setOnlineSheetVisible(false);
    });
  }, [backdropOpacity, sheetProgress]);

  const fetchData = useCallback(() => loadBalancePayments({ id: requestId, shopId }), [requestId, shopId]);
  const refresh = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError('');
    try {
      const data = await fetchData();
      setPayments(data.payments);
      setReceivers(data.receivers);
    } catch (e) { setError(errorMessage(e)); }
    finally { if (showLoader) setLoading(false); }
  }, [fetchData]);

  const syncCheckoutStatus = useCallback(async () => {
    if (checkoutSyncingRef.current) return;
    checkoutSyncingRef.current = true;
    setCheckoutSyncing(true);
    try {
      await syncOnlineBalancePayment(requestId);
    } catch (syncError) {
      console.warn('Unable to sync remaining balance checkout:', syncError);
    } finally {
      await refresh(false);
      checkoutSyncingRef.current = false;
      setCheckoutSyncing(false);
    }
  }, [requestId, refresh]);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetchData().then((data) => {
      if (active) {
        setPayments(data.payments);
        setReceivers(data.receivers);
        const providerPayment = data.payments.find((payment) =>
          payment.status === 'submitted' && Boolean(payment.provider_reference_id),
        );
        if (!isShop && providerPayment) void syncCheckoutStatus();
      }
    }).catch((e: unknown) => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchData, isShop, syncCheckoutStatus]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !checkoutOpenedRef.current) return;
      checkoutOpenedRef.current = false;
      void syncCheckoutStatus();
    });
    return () => subscription.remove();
  }, [syncCheckoutStatus]);

  const current = payments.find((p) => p.status !== 'rejected');
  const latestRejection = !current ? payments[0] : undefined;
  const paid = current?.status === 'verified';

  const fullPrice = useMemo(() => {
    const raw = request.productFullPrice ?? request.productPrice ?? 0;
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.]/g, ''));
    return Number.isFinite(num) && num > 0 ? num : 0;
  }, [request.productFullPrice, request.productPrice]);

  const downpaymentAmount = useMemo(() => {
    const num = Number(request.downpaymentAmountSnapshot ?? request.paymentAmount);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }, [request.downpaymentAmountSnapshot, request.paymentAmount]);

  const remainingBalanceAmount = useMemo(() => {
    const num = Number(request.remainingBalance);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }, [request.remainingBalance]);

  const totalOrderAmount = useMemo(() => {
    if (fullPrice > 0) return fullPrice;
    return downpaymentAmount + remainingBalanceAmount;
  }, [fullPrice, downpaymentAmount, remainingBalanceAmount]);

  const formatBalancePaymentType = useCallback((p: BalancePayment) => {
    if (p.method === 'cash') return 'Cash';
    if (p.provider_reference_id && p.receiver_channel) {
      const channel = p.provider_payment_method || p.receiver_channel;
      return channel === 'ANY' ? 'Online payment' : `Online · ${balanceChannelLabel(channel)}`;
    }
    const base = SUBMITTED_METHOD_LABELS[p.method] || p.method;
    return p.receiver_channel ? `${base} (${balanceChannelLabel(p.receiver_channel)})` : base;
  }, []);

  const activityEvents = useMemo(() => {
    const events: { key: string; label: string; value: string; tone: 'pending' | 'verified' | 'rejected' }[] = [];
    const chronological = [...payments].reverse();
    chronological.forEach((p) => {
      const paymentTypeLabel = formatBalancePaymentType(p);
      const amountNum = Number(p.amount) || 0;
      events.push({
        key: `${p.id}-submitted`,
        label: p.provider_reference_id ? `Online checkout started · ${paymentTypeLabel}` : `Remaining balance submitted · ${paymentTypeLabel}`,
        value: `Amount: ${formatPhilippinePeso(amountNum)} · ${formatDateTime(p.submitted_at)}`,
        tone: 'pending',
      });
      if (p.status === 'verified' && p.reviewed_at) {
        const cumulativeTotal = downpaymentAmount + amountNum;
        events.push({
          key: `${p.id}-verified`,
          label: `Balance payment approved · ${paymentTypeLabel}`,
          value: `Shop received ${formatPhilippinePeso(amountNum)} · Total received: ${formatPhilippinePeso(cumulativeTotal)} of ${formatPhilippinePeso(totalOrderAmount)} · ${formatDateTime(p.reviewed_at)}`,
          tone: 'verified',
        });
      } else if (p.status === 'rejected' && p.reviewed_at) {
        events.push({
          key: `${p.id}-rejected`,
          label: `Remaining balance rejected (${paymentTypeLabel})${p.rejection_reason ? `: ${p.rejection_reason}` : ''}`,
          value: formatDateTime(p.reviewed_at),
          tone: 'rejected',
        });
      }
    });
    return events;
  }, [payments, downpaymentAmount, totalOrderAmount, formatBalancePaymentType]);

  const openOnlinePayment = () => {
    if (busyRef.current || checkoutSyncingRef.current || checkoutOpenedRef.current) return;
    setOnlineSheetVisible(true);
  };

  const submitCash = async () => {
    if (busyRef.current || current) return;
    busyRef.current = true; setBusy(true);
    try {
      const saved = await submitBalancePayment({
        requestId,
        method: 'cash',
      });
      setPayments((previous) => [saved, ...previous]);
    } catch (e) { Alert.alert('Unable to submit', errorMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const handleOneClickOnlinePay = async () => {
    if (receivers.length === 0 || busyRef.current || checkoutSyncingRef.current || checkoutOpenedRef.current || current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const saved = await submitOnlineBalancePayment({
        requestId,
      });
      setOnlineSheetVisible(false);
      if (saved.paid) {
        await refresh();
        Alert.alert('Payment Confirmed', 'Your remaining balance payment has been confirmed.');
        return;
      }
      if (!saved.checkoutUrl) throw new Error('Checkout link is unavailable.');
      checkoutOpenedRef.current = true;
      await Linking.openURL(saved.checkoutUrl);
      // Load the new pending record before the customer returns from checkout,
      // preventing an accidental second payment-method selection.
      await refresh();
    } catch (e) {
      checkoutOpenedRef.current = false;
      await refresh(false);
      Alert.alert('Unable to complete payment', errorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const continueOnlineCheckout = async () => {
    if (!current?.provider_checkout_url || busyRef.current || checkoutSyncingRef.current) return;
    busyRef.current = true;
    setBusy(true);
    checkoutOpenedRef.current = true;
    try {
      await Linking.openURL(current.provider_checkout_url);
    } catch (e) {
      checkoutOpenedRef.current = false;
      Alert.alert('Checkout unavailable', errorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const openReceipt = async (path: string) => {
    if (openingReceipt) return;
    setOpeningReceipt(true);
    try { setViewerUrl(await getBalanceReceiptUrl(path)); }
    catch (e) { Alert.alert('Receipt unavailable', errorMessage(e)); }
    finally { setOpeningReceipt(false); }
  };

  const review = async (status: 'verified' | 'rejected') => {
    if (!current || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const saved = await reviewBalancePayment(current.id, status, reason);
      setPayments((previous) => previous.map((p) => p.id === saved.id ? saved : p));
      setRejecting(false); setReason('');
    } catch (e) { Alert.alert('Unable to review payment', errorMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const approveCashDirectly = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const saved = await approveShopCashBalancePayment(requestId);
      setPayments((previous) => {
        const exists = previous.some((p) => p.id === saved.id);
        return exists ? previous.map((p) => p.id === saved.id ? saved : p) : [saved, ...previous];
      });
    } catch (e) { Alert.alert('Unable to approve cash payment', errorMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const paymentActionBusy = busy || checkoutSyncing;
  const onlineSubmitDisabled = paymentActionBusy || receivers.length === 0;
  const bottomPadding = Math.max(
    insets.bottom + 16,
    Platform.OS === 'android' ? 40 : 24,
  );

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Remaining balance</Text>
        <TouchableOpacity
          onPress={() => void (current?.provider_reference_id ? syncCheckoutStatus() : refresh())}
          disabled={loading || paymentActionBusy}
          accessibilityLabel="Refresh balance payment status"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="refresh-outline" size={17} color="#7c8a84" />
        </TouchableOpacity>
      </View>

      <View style={styles.infoRow}>
        <Ionicons name="cash-outline" size={18} color="#7c8a84" style={styles.infoRowIcon} />
        <View style={styles.infoRowCopy}>
          <Text style={styles.infoRowLabel}>REMAINING BALANCE</Text>
          <Text style={styles.infoRowValueStrong}>
            {formatPhilippinePeso(paid ? 0 : remainingBalanceAmount)}
            {paid ? ` (Received ${formatPhilippinePeso(remainingBalanceAmount)} · Total: ${formatPhilippinePeso(downpaymentAmount + remainingBalanceAmount)})` : ''}
          </Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#22312d" style={styles.loader} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : current ? (
        <View style={styles.content}>
          <View style={styles.infoRow}>
            <Ionicons
              name={paid ? 'checkmark-circle-outline' : 'time-outline'}
              size={18}
              color="#7c8a84"
              style={styles.infoRowIcon}
            />
            <View style={styles.infoRowCopy}>
              <Text style={styles.infoRowLabel}>BALANCE STATUS</Text>
              <Text style={[styles.infoRowValue, paid ? styles.paidText : styles.pendingText]}>
                {paid
                  ? 'Paid'
                  : current.provider_reference_id
                    ? 'Awaiting online payment confirmation'
                    : 'Awaiting shop confirmation'}
              </Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="card-outline" size={18} color="#7c8a84" style={styles.infoRowIcon} />
            <View style={styles.infoRowCopy}>
              <Text style={styles.infoRowLabel}>PAYMENT TYPE</Text>
              <Text style={styles.infoRowValue}>{formatBalancePaymentType(current)}</Text>
            </View>
          </View>

          {current.receiver_channel ? (
            <View style={styles.infoRow}>
              <Ionicons name="wallet-outline" size={18} color="#7c8a84" style={styles.infoRowIcon} />
              <View style={styles.infoRowCopy}>
                <Text style={styles.infoRowLabel}>SHOP ACCOUNT</Text>
                <Text style={styles.infoRowValue}>
                  {balanceChannelLabel(current.receiver_channel)} · {current.receiver_name} ({current.receiver_number})
                </Text>
              </View>
            </View>
          ) : null}

          {current.payer_name ? (
            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={18} color="#7c8a84" style={styles.infoRowIcon} />
              <View style={styles.infoRowCopy}>
                <Text style={styles.infoRowLabel}>SENDER</Text>
                <Text style={styles.infoRowValue}>{current.payer_name}</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.infoRow}>
            <Ionicons name="document-text-outline" size={18} color="#7c8a84" style={styles.infoRowIcon} />
            <View style={styles.infoRowCopy}>
              <Text style={styles.infoRowLabel}>REFERENCE NUMBER</Text>
              <Text selectable style={styles.infoRowValue}>
                {current.reference_number || (current.method === 'cash' ? `#CASH-${current.id.slice(0, 8).toUpperCase()}` : `#BAL-${current.id.slice(0, 8).toUpperCase()}`)}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.secondaryButton}
            accessibilityRole="button"
            onPress={() => setReceiptModalVisible(true)}
          >
            <Ionicons name="receipt-outline" size={17} color="#22312d" />
            <Text style={styles.secondaryButtonText}>View balance receipt</Text>
          </TouchableOpacity>

          {!isShop && !paid && current.provider_checkout_url ? (
            <TouchableOpacity
              style={[styles.primaryButton, paymentActionBusy && styles.disabled]}
              accessibilityRole="button"
              disabled={paymentActionBusy}
              onPress={() => void continueOnlineCheckout()}
            >
              <Ionicons name="open-outline" size={17} color="#ffffff" />
              <Text style={styles.primaryButtonText}>
                {checkoutSyncing ? 'Checking payment…' : 'Continue secure checkout'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {isShop && !paid && !current.provider_reference_id ? (
            <View style={styles.actionGroup}>
              <TouchableOpacity
                disabled={busy}
                style={[styles.primaryButton, busy && styles.disabled]}
                accessibilityRole="button"
                onPress={() => Alert.alert(
                  current.method === 'cash' ? 'Approve cash payment?' : 'Confirm payment?',
                  `Confirm receiving ${formatPhilippinePeso(Number(current.amount))}${current.method === 'cash' ? ' in cash' : ''}?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: current.method === 'cash' ? 'Approve' : 'Confirm', onPress: () => void review('verified') },
                  ],
                )}
              >
                <Text style={styles.primaryButtonText}>
                  {busy ? 'Saving…' : current.method === 'cash' ? 'Approve cash payment' : 'Confirm payment'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy}
                style={styles.rejectToggleButton}
                onPress={() => setRejecting(!rejecting)}
                accessibilityRole="button"
              >
                <Text style={styles.rejectToggleText}>Reject</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {isShop && !paid && rejecting ? (
            <View style={styles.rejectBox}>
              <TextInput
                style={styles.input}
                value={reason}
                onChangeText={setReason}
                maxLength={500}
                placeholder="Reason for rejection"
                placeholderTextColor="#9aa39d"
                editable={!busy}
              />
              <TouchableOpacity
                disabled={busy || reason.trim().length < 3}
                style={[styles.primaryButton, (busy || reason.trim().length < 3) && styles.disabled]}
                onPress={() => void review('rejected')}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Send rejection</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : isShop ? (
        <View style={styles.content}>
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={18} color="#7c8a84" style={styles.infoRowIcon} />
            <View style={styles.infoRowCopy}>
              <Text style={styles.infoRowLabel}>BALANCE STATUS</Text>
              <Text style={styles.infoRowValue}>Unpaid</Text>
            </View>
          </View>
          <TouchableOpacity
            disabled={busy}
            style={[styles.primaryButton, busy && styles.disabled]}
            accessibilityRole="button"
            onPress={() => Alert.alert(
              'Approve cash payment?',
              `Mark ${formatPhilippinePeso(remainingBalanceAmount)} as paid in cash?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Approve', onPress: () => void approveCashDirectly() },
              ],
            )}
          >
            <Text style={styles.primaryButtonText}>
              {busy ? 'Saving…' : 'Approve cash payment'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.content}>
          {latestRejection?.status === 'rejected' ? (
            <Text style={styles.error}>Rejected: {latestRejection.rejection_reason}</Text>
          ) : null}
          <View style={styles.methodRow}>
            <TouchableOpacity
              disabled={paymentActionBusy}
              style={[styles.secondaryButton, styles.methodButton, paymentActionBusy && styles.disabled]}
              accessibilityRole="button"
              onPress={() => Alert.alert(
                'Pay in cash?',
                `Pay ${formatPhilippinePeso(remainingBalanceAmount)} in cash at the shop.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Confirm', onPress: () => void submitCash() },
                ],
              )}
            >
              <Ionicons name="cash-outline" size={18} color="#22312d" />
              <Text style={styles.secondaryButtonText}>Cash</Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={paymentActionBusy}
              style={[styles.primaryButton, styles.methodButton, paymentActionBusy && styles.disabled]}
              accessibilityRole="button"
              onPress={openOnlinePayment}
            >
              <Ionicons name="flash-outline" size={18} color="#ffffff" />
              <Text style={styles.primaryButtonText}>Pay Online</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {activityEvents.length > 0 ? (
        <View style={styles.timelineList}>
          {activityEvents.map((event, idx) => (
            <View key={event.key} style={styles.timelineItem}>
              <View style={styles.timelineRail}>
                <View style={[styles.timelineDotActive, event.tone === 'pending' && styles.timelineDotPending, event.tone === 'rejected' && styles.timelineDotRejected]}>
                  <Ionicons name={event.tone === 'verified' ? 'checkmark' : event.tone === 'rejected' ? 'close' : 'time-outline'} size={12} color="#ffffff" />
                </View>
                {idx < activityEvents.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineCopy}>
                <Text style={styles.timelineLabel}>{event.label}</Text>
                <Text style={styles.timelineValue}>{event.value}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Online Payment Sheet */}
      <Modal
        visible={onlineSheetVisible}
        transparent
        animationType="none"
        onRequestClose={closeOnlineSheet}
        statusBarTranslucent={false}
      >
        <View style={styles.sheetOverlay}>
          <Animated.View style={[styles.sheetBackdrop, { opacity: backdropOpacity }]}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={closeOnlineSheet}
              accessibilityLabel="Close online balance payment"
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
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text style={styles.sheetTitle}>Online Payment</Text>
                <Text style={styles.sheetSubtitle}>Review remaining balance and continue to secure checkout.</Text>
              </View>
              <TouchableOpacity
                style={styles.sheetCloseBtn}
                onPress={closeOnlineSheet}
                disabled={paymentActionBusy}
                accessibilityLabel="Close"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={18} color="#475569" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.sheetScrollArea}
              contentContainerStyle={styles.sheetScrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.sheetSummaryBanner}>
                <View style={styles.sheetProductRow}>
                  {request.productImageUrl ? (
                    <Image source={{ uri: request.productImageUrl }} style={styles.sheetProductThumbnail as ImageStyle} resizeMode="cover" />
                  ) : (
                    <View style={styles.sheetProductFallback}>
                      <Ionicons name="flower-outline" size={20} color="#2f6b55" />
                    </View>
                  )}
                  <View style={styles.sheetProductInfo}>
                    <Text style={styles.sheetProductName} numberOfLines={1}>
                      {request.productName || 'Funeral Service'}
                    </Text>
                    <View style={styles.sheetShopLine}>
                      <Ionicons name="storefront-outline" size={12} color="#62706b" />
                      <Text style={styles.sheetShopName} numberOfLines={1}>
                        {request.shopName || 'Funeral Shop'}
                        {request.variationName ? ` · ${request.variationName}` : ''}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.sheetBannerDivider} />

                <View style={styles.sheetBreakdown}>
                  {fullPrice > 0 ? (
                    <View style={styles.sheetSummaryRow}>
                      <Text style={styles.sheetSummaryLabel}>Total service price</Text>
                      <Text style={styles.sheetSummaryValue}>{formatPhilippinePeso(fullPrice)}</Text>
                    </View>
                  ) : null}
                  {downpaymentAmount > 0 ? (
                    <View style={styles.sheetSummaryRow}>
                      <Text style={styles.sheetSummaryLabel}>Downpayment paid</Text>
                      <Text style={styles.sheetSummaryValue}>-{formatPhilippinePeso(downpaymentAmount)}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.sheetSummaryRow, (fullPrice > 0 || downpaymentAmount > 0) && styles.sheetSummaryTotalRow]}>
                    <Text style={styles.sheetTotalMainLabel}>Remaining balance due</Text>
                    <Text style={styles.sheetTotalMainValue}>
                      {formatPhilippinePeso(remainingBalanceAmount)}
                    </Text>
                  </View>
                </View>
              </View>

              {receivers.length === 0 ? (
                <Text style={styles.error}>Online checkout is unavailable for this shop right now.</Text>
              ) : null}
            </ScrollView>

            <TouchableOpacity
              style={[styles.primaryButton, styles.sheetSubmitButton, onlineSubmitDisabled && styles.disabled]}
              disabled={onlineSubmitDisabled}
              onPress={() => void handleOneClickOnlinePay()}
              activeOpacity={0.88}
              accessibilityRole="button"
            >
              {paymentActionBusy ? (
                <View style={styles.buttonInnerRow}>
                  <ActivityIndicator size="small" color="#ffffff" />
                  <Text style={styles.primaryButtonText}>
                    {checkoutSyncing ? 'Checking payment…' : 'Processing payment…'}
                  </Text>
                </View>
              ) : (
                <View style={styles.buttonInnerRow}>
                  <Ionicons name="shield-checkmark-outline" size={18} color="#ffffff" />
                  <Text style={styles.primaryButtonText}>
                    {`Pay ${formatPhilippinePeso(remainingBalanceAmount)} online`}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={receiptModalVisible && Boolean(current)}
        transparent
        animationType="fade"
        onRequestClose={() => setReceiptModalVisible(false)}
      >
        <View style={styles.receiptOverlay}>
          <View style={styles.receiptSheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text style={styles.sheetTitle}>Balance Payment Receipt</Text>
                <Text style={styles.sheetSubtitle}>{request.shopName || 'Funeral Home'}</Text>
              </View>
              <TouchableOpacity
                style={styles.sheetCloseBtn}
                onPress={() => setReceiptModalVisible(false)}
                accessibilityLabel="Close balance receipt"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={18} color="#475569" />
              </TouchableOpacity>
            </View>

            {current ? (
              <View style={styles.receiptBody}>
                <View style={styles.receiptHeroBanner}>
                  <View style={styles.receiptHeroTop}>
                    <Text style={styles.receiptHeroLabel}>Remaining balance paid</Text>
                    <View style={[styles.receiptBadge, paid ? styles.receiptBadgePaid : styles.receiptBadgePending]}>
                      <Ionicons
                        name={paid ? 'checkmark-circle' : 'time-outline'}
                        size={13}
                        color={paid ? '#166534' : '#86654a'}
                      />
                      <Text style={[styles.receiptBadgeText, paid ? styles.receiptBadgeTextPaid : styles.receiptBadgeTextPending]}>
                        {paid ? 'Paid' : 'Awaiting Confirmation'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.receiptHeroAmount}>{formatPhilippinePeso(Number(current.amount))}</Text>
                </View>

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptRowLabel}>Receipt no.</Text>
                  <Text selectable style={styles.receiptRowValue}>
                    {current.reference_number || (current.method === 'cash' ? `#CASH-${current.id.slice(0, 8).toUpperCase()}` : `#BAL-${current.id.slice(0, 8).toUpperCase()}`)}
                  </Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptRowLabel}>Service</Text>
                  <Text style={styles.receiptRowValue}>{request.productName || 'Funeral Service'}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptRowLabel}>Payment method</Text>
                  <Text style={styles.receiptRowValue}>{formatBalancePaymentType(current)}</Text>
                </View>
                {current.payer_name ? (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Sender</Text>
                    <Text style={styles.receiptRowValue}>{current.payer_name}</Text>
                  </View>
                ) : null}
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptRowLabel}>Submitted on</Text>
                  <Text style={styles.receiptRowValue}>{formatDateTime(current.submitted_at)}</Text>
                </View>
                {current.reviewed_at ? (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Approved on</Text>
                    <Text style={styles.receiptRowValue}>{formatDateTime(current.reviewed_at)}</Text>
                  </View>
                ) : null}
                <View style={styles.receiptDivider} />
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptRowLabel}>Total service price</Text>
                  <Text style={styles.receiptRowValue}>{formatPhilippinePeso(totalOrderAmount)}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptRowLabel}>Downpayment paid</Text>
                  <Text style={styles.receiptRowValue}>{formatPhilippinePeso(downpaymentAmount)}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptRowLabel}>Total received by shop</Text>
                  <Text style={[styles.receiptRowValueStrong, paid ? styles.paidText : null]}>
                    {formatPhilippinePeso(downpaymentAmount + (paid ? Number(current.amount) : 0))}
                  </Text>
                </View>

                {current.proof_image_path ? (
                  <TouchableOpacity
                    style={[styles.secondaryButton, { marginTop: 8 }]}
                    disabled={openingReceipt}
                    accessibilityRole="button"
                    onPress={() => {
                      setReceiptModalVisible(false);
                      void openReceipt(current.proof_image_path || '');
                    }}
                  >
                    <Ionicons name="image-outline" size={17} color="#22312d" />
                    <Text style={styles.secondaryButtonText}>
                      {openingReceipt ? 'Opening…' : 'View transfer screenshot'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(viewerUrl)} transparent animationType="fade" onRequestClose={() => setViewerUrl('')}>
        <View style={styles.viewer}>
          {viewerUrl ? <Image source={{ uri: viewerUrl }} style={styles.viewerImage} resizeMode="contain" /> : null}
          <TouchableOpacity
            style={styles.viewerClose}
            onPress={() => setViewerUrl('')}
            accessibilityRole="button"
            accessibilityLabel="Close receipt"
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#efede7',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sectionTitle: {
    color: '#22312d',
    fontSize: 13,
    fontWeight: '900',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    gap: 10,
  },
  infoRowIcon: {
    width: 22,
    marginTop: 3,
    textAlign: 'center',
  },
  infoRowCopy: {
    flex: 1,
  },
  infoRowLabel: {
    color: '#7a8580',
    fontSize: 10,
    fontWeight: '900',
  },
  infoRowValue: {
    color: '#33413d',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
  },
  infoRowValueStrong: {
    color: '#1d2d28',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 3,
  },
  paidText: {
    color: '#1f6f4a',
    fontWeight: '800',
  },
  pendingText: {
    color: '#9a6700',
    fontWeight: '800',
  },
  loader: {
    marginTop: 8,
  },
  content: {
    gap: 6,
  },
  methodRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  methodButton: {
    flex: 1,
  },
  actionGroup: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#22312d',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 44,
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
  rejectToggleButton: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  rejectToggleText: {
    color: '#991b1b',
    fontSize: 13,
    fontWeight: '800',
  },
  rejectBox: {
    gap: 10,
    marginTop: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#53615d',
    marginTop: 4,
  },
  input: {
    backgroundColor: '#ffffff',
    color: '#22312d',
    borderWidth: 1,
    borderColor: '#d6e2dc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 44,
  },
  disabled: {
    opacity: 0.45,
  },
  error: {
    color: '#991b1b',
    fontSize: 13,
    marginTop: 6,
  },
  timelineList: {
    paddingTop: 10,
  },
  timelineItem: {
    minHeight: 50,
    flexDirection: 'row',
  },
  timelineRail: {
    width: 26,
    alignItems: 'center',
  },
  timelineDotActive: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2f6b55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotPending: {
    backgroundColor: '#64748b',
  },
  timelineDotRejected: {
    backgroundColor: '#b42318',
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#dce5e1',
  },
  timelineCopy: {
    flex: 1,
    paddingLeft: 8,
    paddingBottom: 12,
  },
  timelineLabel: {
    color: '#263631',
    fontSize: 13,
    fontWeight: '900',
  },
  timelineValue: {
    color: '#7b8782',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.52)',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '92%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d4dbd8',
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
  },
  sheetHeaderCopy: {
    flex: 1,
  },
  sheetTitle: {
    color: '#1d2d28',
    fontSize: 18,
    fontWeight: '800',
  },
  sheetSubtitle: {
    color: '#6e7c77',
    fontSize: 12,
    marginTop: 2,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f2efe9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetScrollArea: {
    flexShrink: 1,
  },
  sheetScrollContent: {
    paddingBottom: 10,
    gap: 14,
  },
  sheetSummaryBanner: {
    backgroundColor: '#f8f6f2',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e6e2d8',
    gap: 12,
  },
  sheetProductRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetProductThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#e6eae8',
  },
  sheetProductFallback: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#e7f2ec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetProductInfo: {
    flex: 1,
    gap: 3,
  },
  sheetProductName: {
    color: '#1d2d28',
    fontSize: 15,
    fontWeight: '800',
  },
  sheetShopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sheetShopName: {
    color: '#5a6964',
    fontSize: 12,
    fontWeight: '600',
  },
  sheetBannerDivider: {
    height: 1,
    backgroundColor: '#e6e2d8',
  },
  sheetBreakdown: {
    gap: 6,
  },
  sheetSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetSummaryTotalRow: {
    paddingTop: 6,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: '#e6e2d8',
  },
  sheetSummaryLabel: {
    color: '#62706b',
    fontSize: 12,
  },
  sheetSummaryValue: {
    color: '#22312d',
    fontSize: 13,
    fontWeight: '700',
  },
  sheetTotalMainLabel: {
    color: '#1d2d28',
    fontSize: 13,
    fontWeight: '800',
  },
  sheetTotalMainValue: {
    color: '#2f6b55',
    fontSize: 17,
    fontWeight: '900',
  },
  sheetSectionBlock: {
    gap: 8,
  },
  sheetSectionLabel: {
    color: '#3c4b46',
    fontSize: 13,
    fontWeight: '800',
  },
  sheetChannelCount: {
    color: '#6c7d76',
    fontSize: 12,
    fontWeight: '600',
  },
  buttonInnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sheetMethodList: {
    gap: 8,
  },
  sheetMethodSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    backgroundColor: '#f8faf9',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#dbe5df',
  },
  sheetMethodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e3e8e5',
    backgroundColor: '#ffffff',
  },
  sheetMethodRowSelected: {
    borderColor: '#2f6b55',
    backgroundColor: '#f2f8f5',
  },
  sheetMethodCopy: {
    flex: 1,
    gap: 2,
  },
  sheetMethodTitle: {
    color: '#22312d',
    fontSize: 14,
    fontWeight: '700',
  },
  sheetMethodTitleSelected: {
    color: '#1d2d28',
    fontWeight: '800',
  },
  sheetMethodSubtitle: {
    color: '#6c7a75',
    fontSize: 11,
  },
  sheetFormCard: {
    backgroundColor: '#f8f6f2',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e6e2d8',
    gap: 10,
  },
  fieldGroup: {
    gap: 5,
  },
  secondaryButtonSuccess: {
    borderColor: '#b7dec9',
    backgroundColor: '#eff8f3',
  },
  secondaryButtonTextSuccess: {
    color: '#166534',
  },
  receiptActions: {
    flexDirection: 'row',
    gap: 8,
  },
  flexButton: {
    flex: 1,
  },
  sheetSubmitButton: {
    flex: 0,
    minHeight: 50,
    borderRadius: 14,
    marginTop: 10,
  },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '85%',
  },
  viewerClose: {
    position: 'absolute',
    top: 48,
    right: 18,
    backgroundColor: '#22312d',
    borderRadius: 20,
    padding: 8,
  },
  receiptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  receiptSheet: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
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
  receiptBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  receiptBadgePaid: {
    backgroundColor: '#e7f5ec',
  },
  receiptBadgePending: {
    backgroundColor: '#fef3c7',
  },
  receiptBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  receiptBadgeTextPaid: {
    color: '#166534',
  },
  receiptBadgeTextPending: {
    color: '#86654a',
  },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  receiptRowLabel: {
    color: '#62706b',
    fontSize: 13,
  },
  receiptRowValue: {
    color: '#22312d',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },
  receiptRowValueStrong: {
    color: '#22312d',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'right',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: '#edf1ef',
    marginVertical: 4,
  },
});
