import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  Image,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createServiceXenditCheckout } from '@/services/serviceXendit';
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

  // Spring animation matching the Google Play / Product Filter style
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
    if (!visible) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void onChanged?.();
    });
    return () => subscription.remove();
  }, [onChanged, visible]);

  // Compute 30% admin commission and 70% shop payout strictly
  const { totalAmount, adminCommission, shopPayout } = useMemo(() => {
    const raw = request?.paymentAmount ?? request?.productPrice ?? 0;
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.]/g, ''));
    const safeAmount = Number.isFinite(num) && num > 0 ? num : 0;
    const commission = Math.round(safeAmount * 0.30 * 100) / 100;
    const net = Math.round((safeAmount - commission) * 100) / 100;
    return {
      totalAmount: safeAmount,
      adminCommission: commission,
      shopPayout: net,
    };
  }, [request?.paymentAmount, request?.productPrice]);

  const handleOneClickPay = async () => {
    if (!request || starting) return;
    setStarting(true);
    try {
      const result = await createServiceXenditCheckout(request.id);
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
      // Instant 1-click launch of Xendit checkout
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

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose} statusBarTranslucent>
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
              paddingBottom: Math.max(insets.bottom, 20),
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
                <Ionicons name="shield-checkmark" size={12} color="#4ade80" />
                <Text style={styles.secureBadgeText}>1-CLICK CHECKOUT</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={handleClose}
              disabled={starting}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {/* Product Summary Row */}
          <View style={styles.productRow}>
            {request?.productImageUrl ? (
              <Image source={{ uri: request.productImageUrl }} style={styles.productThumbnail} resizeMode="cover" />
            ) : (
              <View style={styles.productIconFallback}>
                <Ionicons name="cube-outline" size={26} color="#93c5fd" />
              </View>
            )}
            <View style={styles.productInfo}>
              <Text style={styles.productName} numberOfLines={2}>
                {request?.productName || 'Funeral Casket / Product'}
              </Text>
              <View style={styles.shopMetaRow}>
                <Ionicons name="storefront-outline" size={13} color="#94a3b8" />
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

          {/* 30% Admin & 70% Shop Split Breakdown Card */}
          <View style={styles.splitCard}>
            <View style={styles.splitCardHeader}>
              <Ionicons name="git-branch-outline" size={16} color="#86efac" />
              <Text style={styles.splitCardTitle}>Automatic Split Breakdown (Xendit)</Text>
            </View>

            <View style={styles.splitRow}>
              <View style={styles.splitTargetCol}>
                <View style={styles.splitIconWrapAdmin}>
                  <Ionicons name="business" size={14} color="#60a5fa" />
                </View>
                <View>
                  <Text style={styles.splitTargetName}>LifeCycle Admin (30%)</Text>
                  <Text style={styles.splitTargetNote}>Platform commission</Text>
                </View>
              </View>
              <Text style={styles.splitAmountAdmin}>
                {formatPhilippinePeso(adminCommission)}
              </Text>
            </View>

            <View style={styles.splitDivider} />

            <View style={styles.splitRow}>
              <View style={styles.splitTargetCol}>
                <View style={styles.splitIconWrapShop}>
                  <Ionicons name="storefront" size={14} color="#4ade80" />
                </View>
                <View>
                  <Text style={styles.splitTargetName}>Shop Payout (70%)</Text>
                  <Text style={styles.splitTargetNote}>Direct net earnings</Text>
                </View>
              </View>
              <Text style={styles.splitAmountShop}>
                {formatPhilippinePeso(shopPayout)}
              </Text>
            </View>

            <View style={styles.splitNoticeBox}>
              <Ionicons name="information-circle-outline" size={14} color="#86efac" />
              <Text style={styles.splitNoticeText}>
                Xendit XenPlatform automatically sends 30% commission to admin and 70% to the shop in one transaction.
              </Text>
            </View>
          </View>

          {/* Payment Method Badge */}
          <View style={styles.methodRow}>
            <View style={styles.methodIcon}>
              <Ionicons name="card-outline" size={20} color="#60a5fa" />
            </View>
            <View style={styles.methodInfo}>
              <Text style={styles.methodTitle}>Xendit Payment Gateway</Text>
              <Text style={styles.methodSubtitle}>Cards, GCash, Maya, QR Ph • Test Mode Sandbox</Text>
            </View>
            <Ionicons name="checkmark-circle" size={18} color="#4ade80" />
          </View>

          {/* Total Price & 1-Click Pay Button */}
          <View style={styles.footerRow}>
            <View>
              <Text style={styles.totalLabel}>Total Price</Text>
              <Text style={styles.totalValue}>{formatPhilippinePeso(totalAmount)}</Text>
            </View>
          </View>

          {/* High-visibility 1-Click Action Button */}
          <TouchableOpacity
            style={[styles.oneClickButton, (starting || !request) && styles.buttonDisabled]}
            disabled={starting || !request}
            onPress={() => void handleOneClickPay()}
            activeOpacity={0.88}
          >
            {starting ? (
              <View style={styles.buttonLoadingRow}>
                <ActivityIndicator size="small" color="#032014" />
                <Text style={styles.oneClickButtonText}>Connecting to Xendit...</Text>
              </View>
            ) : (
              <View style={styles.buttonInnerRow}>
                <Ionicons name="flash" size={18} color="#032014" />
                <Text style={styles.oneClickButtonText}>
                  1-Click Pay {formatPhilippinePeso(totalAmount)}
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
    backgroundColor: 'rgba(2, 6, 23, 0.76)',
  },
  sheet: {
    backgroundColor: '#111413',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    borderWidth: 1,
    borderColor: '#1e2925',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#374151',
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
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#064e3b',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  secureBadgeText: {
    color: '#86efac',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1f2925',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    backgroundColor: '#181e1b',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#24302b',
    marginBottom: 14,
  },
  productThumbnail: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: '#0f172a',
  },
  productIconFallback: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  shopMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  shopName: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
  },
  variationPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#26332c',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 5,
  },
  variationText: {
    color: '#a7f3d0',
    fontSize: 11,
    fontWeight: '600',
  },
  splitCard: {
    backgroundColor: '#131b17',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1d2e24',
    marginBottom: 14,
  },
  splitCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 12,
  },
  splitCardTitle: {
    color: '#bbf7d0',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  splitTargetCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  splitIconWrapAdmin: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#1e3a8a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitIconWrapShop: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#064e3b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitTargetName: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '700',
  },
  splitTargetNote: {
    color: '#94a3b8',
    fontSize: 11,
  },
  splitAmountAdmin: {
    color: '#93c5fd',
    fontSize: 14,
    fontWeight: '800',
  },
  splitAmountShop: {
    color: '#86efac',
    fontSize: 14,
    fontWeight: '800',
  },
  splitDivider: {
    height: 1,
    backgroundColor: '#1f2e27',
    marginVertical: 10,
  },
  splitNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(6, 78, 59, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 10,
  },
  splitNoticeText: {
    flex: 1,
    color: '#86efac',
    fontSize: 11,
    lineHeight: 15,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#171c1a',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#222d28',
    marginBottom: 16,
  },
  methodIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0f2744',
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodInfo: {
    flex: 1,
  },
  methodTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  methodSubtitle: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  totalLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  totalValue: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 1,
  },
  oneClickButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#5eead4',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5eead4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
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
  oneClickButtonText: {
    color: '#032014',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
