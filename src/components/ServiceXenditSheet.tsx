import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  Image,
  ImageStyle,
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
import {
  chooseServicePaymentOption,
  createServiceXenditCheckout,
  getServicePaymentMethods,
  prepareServicePaymentOption,
  type ServicePaymentOption,
  type ServicePaymentMethod,
  syncServiceXenditCheckout,
} from '@/services/serviceXendit';
import { formatPhilippinePeso } from '@/utils/funeralCatalog';

export type XenditServiceRequest = {
  id: string;
  shopName?: string | null;
  productName?: string | null;
  productPrice?: number | string | null;
  paymentAmount?: number | string | null;
  paymentOption?: 'pending' | ServicePaymentOption | null;
  productFullPrice?: number | string | null;
  downpaymentAmountSnapshot?: number | string | null;
  downpaymentPercentageSnapshot?: number | string | null;
  remainingBalance?: number | string | null;
  providerCheckoutId?: string | null;
  productImageUrl?: string | null;
  variationName?: string | null;
  status?: string | null;
  commissionRate?: number | string | null;
  commissionAmount?: number | string | null;
  shopNetAmount?: number | string | null;
  [key: string]: unknown;
};

type Props = {
  visible: boolean;
  request: XenditServiceRequest | null;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
};

export default function ServiceXenditSheet({ visible, request, onClose, onChanged }: Props) {
  const insets = useSafeAreaInsets();
  const [starting, setStarting] = useState(false);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<ServicePaymentMethod[]>([]);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [selectedPaymentOption, setSelectedPaymentOption] = useState<ServicePaymentOption | ''>('');

  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const [sheetProgress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      backdropOpacity.setValue(0);
      sheetProgress.setValue(0);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 210,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(sheetProgress, {
          toValue: 1,
          damping: 19,
          stiffness: 165,
          mass: 0.9,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, backdropOpacity, sheetProgress]);

  useEffect(() => {
    if (!visible || !request) return;

    const fullPrice = Number(request.productFullPrice ?? request.productPrice) || 0;
    const downpaymentAmount = Number(request.downpaymentAmountSnapshot) || 0;
    const hasDownpayment = downpaymentAmount > 0 && downpaymentAmount <= fullPrice;
    const savedOption = request.paymentOption === 'full' || request.paymentOption === 'downpayment'
      ? request.paymentOption
      : '';
    const checkoutStarted = Boolean(request.providerCheckoutId);
    setSelectedPaymentOption(checkoutStarted ? savedOption : (hasDownpayment ? '' : 'full'));

    const targetRequestId = String(request.id || (request as any)?.requestId || (request as any)?._id || '').trim();
    if (!targetRequestId) return;

    let active = true;

    void Promise.resolve()
      .then(() => {
        if (!active) return null;
        setLoadingMethods(true);
        setPaymentMethods([]);
        setMethodsError(null);
        return getServicePaymentMethods(targetRequestId);
      })
      .then((result) => {
        if (!active || !result) return;
        setPaymentMethods(result.methods);
      })
      .catch((error) => {
        if (!active) return;
        setMethodsError(error instanceof Error ? error.message : 'Unable to load payment methods.');
      })
      .finally(() => {
        if (active) setLoadingMethods(false);
      });

    return () => {
      active = false;
    };
  }, [request, visible]);

  const handleClose = useCallback(() => {
    if (starting) return;
    Animated.parallel([
      Animated.timing(sheetProgress, {
        toValue: 0,
        duration: 170,
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

  useEffect(() => {
    if (!visible || !request) return;
    const targetRequestId = String(request.id || (request as any)?.requestId || (request as any)?._id || '').trim();
    if (!targetRequestId) return;

    const subscription = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        try {
          const syncResult = await syncServiceXenditCheckout(targetRequestId);
          if (syncResult?.paid) {
            await onChanged?.();
            Alert.alert(
              selectedPaymentOption === 'downpayment' ? 'Downpayment Confirmed' : 'Payment Confirmed',
              'Your payment has been confirmed.',
            );
            handleClose();
            return;
          }
        } catch {
          // ignore error and fallback to onChanged
        }
        void onChanged?.();
      }
    });
    return () => subscription.remove();
  }, [handleClose, onChanged, visible, request, selectedPaymentOption]);

  const fullPrice = useMemo(() => {
    const raw = request?.productFullPrice ?? request?.productPrice ?? 0;
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.]/g, ''));
    return Number.isFinite(num) && num > 0 ? num : 0;
  }, [request?.productFullPrice, request?.productPrice]);

  const downpaymentAmount = useMemo(() => {
    const num = Number(request?.downpaymentAmountSnapshot);
    return Number.isFinite(num) && num > 0 && num <= fullPrice ? num : 0;
  }, [fullPrice, request?.downpaymentAmountSnapshot]);

  const downpaymentPercentage = Number(request?.downpaymentPercentageSnapshot) || 0;
  const hasDownpayment = downpaymentAmount > 0 && downpaymentPercentage > 0;
  const remainingAfterDownpayment = Math.max(0, fullPrice - downpaymentAmount);
  const totalAmount = selectedPaymentOption === 'downpayment' ? downpaymentAmount : fullPrice;

  const handleOneClickPay = async () => {
    if (!request || paymentMethods.length === 0 || !selectedPaymentOption || starting) return;
    const targetRequestId = String(request.id || (request as any)?.requestId || (request as any)?._id || '').trim();
    if (!targetRequestId) {
      Alert.alert(
        'Unable to complete payment',
        'Could not identify this service request. Please reopen the request details and try again.',
      );
      return;
    }
    setStarting(true);
    try {
      const prepared = await prepareServicePaymentOption(targetRequestId, selectedPaymentOption);
      if (prepared.paid) {
        await onChanged?.();
        Alert.alert('Payment Confirmed', 'Your payment has been confirmed.');
        handleClose();
        return;
      }
      if (!prepared.checkoutActive || prepared.paymentOption !== selectedPaymentOption) {
        await chooseServicePaymentOption(targetRequestId, selectedPaymentOption);
      }
      const result = await createServiceXenditCheckout(targetRequestId);
      if (result.paid) {
        await onChanged?.();
        Alert.alert(
          selectedPaymentOption === 'downpayment' ? 'Downpayment Confirmed' : 'Payment Confirmed',
          'Your payment has been confirmed.',
        );
        handleClose();
        return;
      }
      if (!result.checkoutUrl) {
        throw new Error('Checkout link is unavailable.');
      }
      await Linking.openURL(result.checkoutUrl);
    } catch (error) {
      Alert.alert(
        'Unable to complete payment',
        error instanceof Error ? error.message : 'Please try again in a moment.',
      );
    } finally {
      setStarting(false);
    }
  };

  if (!visible) return null;

  const bottomPadding = Math.max(
    insets.bottom + 16,
    Platform.OS === 'android' ? 40 : 24,
  );

  const canPay = !starting && !loadingMethods && Boolean(request) && paymentMethods.length > 0 && Boolean(selectedPaymentOption) && totalAmount > 0;

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
              <Text style={styles.headerTitle}>Online Payment</Text>
              <Text style={styles.headerSubtitle}>
                {hasDownpayment ? 'Choose how much to pay, then continue to secure checkout.' : 'Review the amount and continue to secure checkout.'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={handleClose}
              disabled={starting}
              accessibilityLabel="Close"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={19} color="#42524c" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Service & Price Summary Banner */}
            <View style={styles.summaryBanner}>
              <View style={styles.productRow}>
                {request?.productImageUrl ? (
                  <Image
                    source={{ uri: request.productImageUrl }}
                    style={styles.productThumbnail as ImageStyle}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.productIconFallback}>
                    <Ionicons name="cube-outline" size={22} color="#2f6b55" />
                  </View>
                )}
                <View style={styles.productInfo}>
                  <Text style={styles.productName} numberOfLines={2}>
                    {request?.productName || 'Funeral Service'}
                  </Text>
                  <View style={styles.shopMetaRow}>
                    <Ionicons name="storefront-outline" size={13} color="#62706b" />
                    <Text style={styles.shopName} numberOfLines={1}>
                      {request?.shopName || 'Funeral Shop'}
                    </Text>
                  </View>
                  {request?.variationName ? (
                    <View style={styles.variationPill}>
                      <Text style={styles.variationText}>{request.variationName}</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={styles.bannerDivider} />

              <View style={styles.breakdownRows}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Total service price</Text>
                  <Text style={styles.breakdownValue}>{formatPhilippinePeso(fullPrice)}</Text>
                </View>
                {selectedPaymentOption === 'downpayment' ? (
                  <>
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Downpayment ({downpaymentPercentage}%)</Text>
                      <Text style={styles.breakdownValue}>{formatPhilippinePeso(downpaymentAmount)}</Text>
                    </View>
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Remaining balance</Text>
                      <Text style={styles.breakdownValue}>{formatPhilippinePeso(remainingAfterDownpayment)}</Text>
                    </View>
                  </>
                ) : null}
                <View style={styles.dueRow}>
                  <Text style={styles.dueLabel}>
                    {selectedPaymentOption === 'downpayment' ? 'Downpayment due now' : 'Amount due now'}
                  </Text>
                  <Text style={styles.dueValue}>
                    {selectedPaymentOption ? formatPhilippinePeso(totalAmount) : formatPhilippinePeso(fullPrice)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Payment Option Selection */}
            {hasDownpayment ? (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>PAYMENT OPTION</Text>
                <View style={styles.optionGroup}>
                  <TouchableOpacity
                    style={[styles.optionItem, selectedPaymentOption === 'full' && styles.optionItemSelected]}
                    onPress={() => setSelectedPaymentOption('full')}
                    activeOpacity={0.8}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selectedPaymentOption === 'full' }}
                  >
                    <View style={styles.optionCopy}>
                      <View style={styles.optionTitleRow}>
                        <Text style={styles.optionTitle}>Full payment</Text>
                        <Text style={styles.optionAmount}>{formatPhilippinePeso(fullPrice)}</Text>
                      </View>
                      <Text style={styles.optionSub}>Settle the entire service price now</Text>
                    </View>
                    <Ionicons
                      name={selectedPaymentOption === 'full' ? 'checkmark-circle' : 'ellipse-outline'}
                      size={21}
                      color={selectedPaymentOption === 'full' ? '#2f6b55' : '#b7c2bc'}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.optionItem, selectedPaymentOption === 'downpayment' && styles.optionItemSelected]}
                    onPress={() => setSelectedPaymentOption('downpayment')}
                    activeOpacity={0.8}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selectedPaymentOption === 'downpayment' }}
                  >
                    <View style={styles.optionCopy}>
                      <View style={styles.optionTitleRow}>
                        <Text style={styles.optionTitle}>Downpayment ({downpaymentPercentage}%)</Text>
                        <Text style={styles.optionAmount}>{formatPhilippinePeso(downpaymentAmount)}</Text>
                      </View>
                      <Text style={styles.optionSub}>
                        Remaining balance: {formatPhilippinePeso(remainingAfterDownpayment)}
                      </Text>
                    </View>
                    <Ionicons
                      name={selectedPaymentOption === 'downpayment' ? 'checkmark-circle' : 'ellipse-outline'}
                      size={21}
                      color={selectedPaymentOption === 'downpayment' ? '#2f6b55' : '#b7c2bc'}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {!loadingMethods && paymentMethods.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="alert-circle-outline" size={19} color="#9a6700" />
                <Text style={styles.emptyBoxText}>
                  {methodsError || 'Online checkout is unavailable for this shop right now.'}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <TouchableOpacity
            style={[styles.payButton, !canPay && styles.buttonDisabled]}
            disabled={!canPay}
            onPress={() => void handleOneClickPay()}
            activeOpacity={0.88}
          >
            {starting ? (
              <View style={styles.buttonInnerRow}>
                <ActivityIndicator size="small" color="#ffffff" />
                <Text style={styles.payButtonText}>Opening payment…</Text>
              </View>
            ) : (
              <View style={styles.buttonInnerRow}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#ffffff" />
                <Text style={styles.payButtonText}>
                  {!selectedPaymentOption
                    ? 'Select full payment or downpayment'
                    : `Pay ${formatPhilippinePeso(totalAmount)} online`}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(18, 28, 25, 0.54)',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '92%',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d0d7d4',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#edf1ef',
  },
  headerCopy: {
    flex: 1,
    paddingRight: 12,
  },
  headerTitle: {
    color: '#1d2d28',
    fontSize: 18,
    fontWeight: '900',
  },
  headerSubtitle: {
    color: '#62706b',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f2efe9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArea: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingVertical: 14,
    gap: 16,
  },
  summaryBanner: {
    backgroundColor: '#f8f6f2',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e6e2d8',
    padding: 14,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  productThumbnail: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#e6e2d8',
  },
  productIconFallback: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#e7f2ec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    color: '#1d2d28',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  shopMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  shopName: {
    color: '#62706b',
    fontSize: 12,
    fontWeight: '600',
  },
  variationPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#eae6dc',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 5,
  },
  variationText: {
    color: '#42524c',
    fontSize: 11,
    fontWeight: '700',
  },
  bannerDivider: {
    height: 1,
    backgroundColor: '#e6e2d8',
    marginVertical: 12,
  },
  breakdownRows: {
    gap: 6,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  breakdownLabel: {
    color: '#62706b',
    fontSize: 12,
    fontWeight: '600',
  },
  breakdownValue: {
    color: '#22312d',
    fontSize: 13,
    fontWeight: '700',
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#eae6dc',
  },
  dueLabel: {
    color: '#1d2d28',
    fontSize: 14,
    fontWeight: '800',
  },
  dueValue: {
    color: '#2f6b55',
    fontSize: 19,
    fontWeight: '900',
  },
  sectionBlock: {
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    color: '#6f7c77',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  sectionCount: {
    color: '#62706b',
    fontSize: 11,
    fontWeight: '600',
  },
  methodSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    backgroundColor: '#f8faf9',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#dbe5df',
  },
  optionGroup: {
    gap: 8,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e3e8e5',
    backgroundColor: '#ffffff',
  },
  optionItemSelected: {
    borderColor: '#2f6b55',
    backgroundColor: '#f2f8f5',
  },
  optionCopy: {
    flex: 1,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  optionTitle: {
    color: '#1d2d28',
    fontSize: 14,
    fontWeight: '800',
  },
  optionAmount: {
    color: '#2f6b55',
    fontSize: 14,
    fontWeight: '900',
  },
  optionSub: {
    color: '#62706b',
    fontSize: 12,
    marginTop: 2,
  },
  methodItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e3e8e5',
    backgroundColor: '#ffffff',
  },
  paymentMethodLogo: {
    width: 36,
    height: 24,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#f8faf9',
  },
  statusText: {
    color: '#53615d',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderRadius: 14,
    backgroundColor: '#fef9ec',
    borderWidth: 1,
    borderColor: '#f5e1b5',
  },
  emptyBoxText: {
    flex: 1,
    color: '#7c5211',
    fontSize: 13,
    lineHeight: 18,
  },
  payButton: {
    minHeight: 50,
    borderRadius: 15,
    backgroundColor: '#22312d',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonInnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  payButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});
