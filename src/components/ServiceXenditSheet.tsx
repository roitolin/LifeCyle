import { useEffect, useMemo, useRef, useState } from 'react';
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
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createServiceXenditCheckout, syncServiceXenditCheckout } from '@/services/serviceXendit';
import { formatPhilippinePeso } from '@/utils/funeralCatalog';

export type XenditServiceRequest = {
  id: string;
  shopName?: string | null;
  productName?: string | null;
  productPrice?: number | string | null;
  paymentAmount?: number | string | null;
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

  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetProgress = useRef(new Animated.Value(0)).current;

  // Spring animation for bottom sheet presentation
  useEffect(() => {
    if (visible) {
      backdropOpacity.setValue(0);
      sheetProgress.setValue(0);
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

  // Listen for AppState changes when user returns from Xendit checkout
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
            Alert.alert('Payment Confirmed', 'Payment succeeded! The order has been verified.');
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
  }, [onChanged, visible, request]);

  // Compute clean full price only
  const totalAmount = useMemo(() => {
    const raw = request?.paymentAmount ?? request?.productPrice ?? 0;
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.]/g, ''));
    return Number.isFinite(num) && num > 0 ? num : 0;
  }, [request?.paymentAmount, request?.productPrice]);

  const handleOneClickPay = async () => {
    if (!request || starting) return;
    const targetRequestId = String(request.id || (request as any)?.requestId || (request as any)?._id || '').trim();
    if (!targetRequestId) {
      Alert.alert(
        'Unable to complete checkout',
        'Could not identify this service request. Please reopen the request details and try again.',
      );
      return;
    }
    setStarting(true);
    try {
      const result = await createServiceXenditCheckout(targetRequestId);
      if (result.paid) {
        await onChanged?.();
        Alert.alert(
          'Payment Confirmed',
          'Payment succeeded! The order has been verified.',
        );
        handleClose();
        return;
      }
      if (!result.checkoutUrl) {
        throw new Error('The secure Xendit checkout link is unavailable.');
      }
      // Instant launch of Xendit checkout
      await Linking.openURL(result.checkoutUrl);
    } catch (error) {
      Alert.alert(
        'Unable to complete checkout',
        error instanceof Error ? error.message : 'Please try again in a moment.',
      );
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

          {/* Product Summary Row */}
          <View style={styles.productRow}>
            {request?.productImageUrl ? (
              <Image source={{ uri: request.productImageUrl }} style={styles.productThumbnail as ImageStyle} resizeMode="cover" />
            ) : (
              <View style={styles.productIconFallback}>
                <Ionicons name="cube-outline" size={26} color="#3b82f6" />
              </View>
            )}
            <View style={styles.productInfo}>
              <Text style={styles.productName} numberOfLines={2}>
                {request?.productName || 'Funeral Casket / Product'}
              </Text>
              <View style={styles.shopMetaRow}>
                <Ionicons name="storefront-outline" size={13} color="#64748b" />
                <Text style={styles.shopName} numberOfLines={1}>
                  {request?.shopName || 'Funeral Shop'}
                </Text>
              </View>
              {Boolean(request?.variationName) && (
                <View style={styles.variationPill}>
                  <Text style={styles.variationText}>{request?.variationName}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Clean Order Total Summary Card */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Order Subtotal</Text>
              <Text style={styles.summaryValue}>{formatPhilippinePeso(totalAmount)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Packages & Services</Text>
              <Text style={styles.summaryFreeValue}>Included</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.totalRow}>
              <View>
                <Text style={styles.totalMainLabel}>Total Amount</Text>
                <Text style={styles.totalSubNotice}>Authorized & encrypted</Text>
              </View>
              <Text style={styles.totalMainValue}>{formatPhilippinePeso(totalAmount)}</Text>
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

          {/* High-visibility Action Button */}
          <TouchableOpacity
            style={[styles.payButton, (starting || !request) && styles.buttonDisabled]}
            disabled={starting || !request}
            onPress={() => void handleOneClickPay()}
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
                  Pay {formatPhilippinePeso(totalAmount)}
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
  productThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
  },
  productIconFallback: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
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
    fontSize: 13,
    fontWeight: '500',
  },
  variationPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  variationText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '600',
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
});
