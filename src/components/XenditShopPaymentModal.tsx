import { useCallback, useEffect, useMemo, useState, useRef, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Modal, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/services/supabaseClient';
import { createXenditShopCheckout, syncXenditShopPayment, type XenditShopPaymentMethod } from '@/services/xenditShop';
import { formatPhilippinePeso } from '@/utils/funeralCatalog';
import KeyboardAwareScrollView from './KeyboardAwareScrollView';

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

type Props = { visible: boolean; onClose: () => void; onChanged?: () => void };
const SETTING_KEY = 'payment_qr_code';
type IoniconName = ComponentProps<typeof Ionicons>['name'];

const PAYMENT_METHODS: { id: XenditShopPaymentMethod; label: string; detail: string; icon: IoniconName }[] = [
  { id: 'gcash', label: 'GCash', detail: 'LifeCycle password required', icon: 'phone-portrait-outline' },
  { id: 'ewallets', label: 'Other e-wallets', detail: 'GrabPay and ShopeePay test channels', icon: 'wallet-outline' },
  { id: 'cards', label: 'Cards', detail: 'Xendit sandbox test cards', icon: 'card-outline' },
  { id: 'qrph', label: 'QR Ph', detail: 'Xendit Test Mode QR payment', icon: 'qr-code-outline' },
  { id: 'bank_transfer', label: 'Bank transfer', detail: 'Xendit Test Mode bank transfer', icon: 'business-outline' },
];

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
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function statusMeta(payment: Payment) {
  if (payment.status === 'verified') return { label: 'Paid', color: '#166534', bg: '#dcfce7', icon: 'checkmark-circle' as const };
  if (payment.status === 'rejected') return { label: 'Not completed', color: '#991b1b', bg: '#fee2e2', icon: 'close-circle' as const };
  return { label: payment.paymentProvider === 'xendit' ? 'Awaiting checkout' : payment.paymentProvider === 'paymongo' ? 'Legacy checkout' : 'Admin review', color: '#92400e', bg: '#fef3c7', icon: 'time' as const };
}

function methodLabel(payment: Payment) {
  if (payment.paymentProvider === 'manual') return 'Legacy manual payment';
  const method = String(payment.providerPaymentMethod || '').replace(/_/g, ' ').trim();
  if (payment.paymentProvider === 'paymongo') return method ? `Legacy PayMongo · ${method}` : 'Legacy PayMongo checkout';
  return method ? `Xendit · ${method}` : 'Xendit hosted checkout';
}

function receiptNumber(payment: Payment) {
  return `LC-${payment.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function receiptMessage(payment: Payment) {
  if (payment.status === 'verified') {
    return 'This registration payment was confirmed automatically by Xendit.';
  }
  if (payment.status === 'rejected') {
    return 'This payment was not completed. Review the note below before trying again.';
  }
  return payment.paymentProvider === 'manual'
    ? 'This payment is waiting for administrator review.'
    : 'This checkout is waiting for confirmation from the payment provider.';
}

function maskPhone(phone: string) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.length < 4) return phone || '';
  return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 3)}${'*'.repeat(Math.max(0, cleaned.length - 7))}${cleaned.slice(-4)}`;
}

function normalizePhilippinePhone(input: string) {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith('63') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('9') && digits.length === 10) return `+63${digits}`;
  return null;
}

function friendlyPhoneAuthError(error: unknown, action: 'send' | 'verify') {
  if (error instanceof Error) {
    if (error.message.includes('rate')) return 'Too many attempts. Please wait a moment and try again.';
    if (error.message.includes('invalid')) return action === 'verify' ? 'The code you entered is incorrect. Please try again.' : 'This mobile number is not valid.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export default function XenditShopPaymentModal({ visible, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [fee, setFee] = useState(0);
  const [paidUntil, setPaidUntil] = useState<string | null>(null);
  const [shopName, setShopName] = useState('Funeral shop');
  const [userEmail, setUserEmail] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selected, setSelected] = useState<Payment | null>(null);
  const [purchaseConfirmVisible, setPurchaseConfirmVisible] = useState(false);
  const [paymentMethodMenuVisible, setPaymentMethodMenuVisible] = useState(false);
  const [passwordPromptVisible, setPasswordPromptVisible] = useState(false);
  const [phoneVerificationVisible, setPhoneVerificationVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<XenditShopPaymentMethod>('gcash');
  const [accountPassword, setAccountPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [checkingPassword, setCheckingPassword] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [pendingPhone, setPendingPhone] = useState('');
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneVerificationBusy, setPhoneVerificationBusy] = useState(false);

  const purchaseBackdropOpacity = useRef(new Animated.Value(0)).current;
  const purchaseSheetProgress = useRef(new Animated.Value(0)).current;

  const openPurchaseConfirm = () => {
    purchaseBackdropOpacity.stopAnimation();
    purchaseSheetProgress.stopAnimation();
    purchaseBackdropOpacity.setValue(0);
    purchaseSheetProgress.setValue(0);
    setPurchaseConfirmVisible(true);
    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(purchaseBackdropOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(purchaseSheetProgress, {
          toValue: 1,
          damping: 19,
          stiffness: 210,
          mass: 0.85,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const closePurchaseConfirm = () => {
    if (starting || checkingPassword) return;
    purchaseBackdropOpacity.stopAnimation();
    purchaseSheetProgress.stopAnimation();
    Animated.parallel([
      Animated.timing(purchaseBackdropOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(purchaseSheetProgress, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => setPurchaseConfirmVisible(false));
  };


  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('You must be signed in to manage shop payments.');
    await syncXenditShopPayment().catch(() => undefined);
    const [settingResult, shopResult, paymentsResult] = await Promise.all([
      supabase.from('settings').select('value').eq('key', SETTING_KEY).maybeSingle(),
      supabase.from('funeral_shops').select('paidUntil, shopName, shopPhoneNumber').eq('id', user.id).maybeSingle(),
      supabase.from('shop_payments')
        .select('id, status, amount, referenceNumber, createdAt, verifiedAt, expiresAt, rejectionReason, payerName, paymentProvider, providerCheckoutId, providerCheckoutUrl, providerPaymentId, providerPaymentMethod, providerLivemode')
        .eq('shopId', user.id)
        .order('createdAt', { ascending: false }),
    ]);
    if (paymentsResult.error) throw paymentsResult.error;
    const value = settingResult.data?.value as { feeAmount?: number } | null;
    const resolvedShopName = String((shopResult.data as any)?.shopName || 'Funeral shop');
    const authPhone = String(user.phone || '');
    const isPhoneConfirmed = Boolean(authPhone && user.phone_confirmed_at);
    setFee(Number(value?.feeAmount) || 0);
    setPaidUntil((shopResult.data as any)?.paidUntil || null);
    setShopName(resolvedShopName);
    setUserEmail(String(user.email || ''));
    setPayments((paymentsResult.data || []).map(fromRow));
    setVerifiedPhone(isPhoneConfirmed ? authPhone : '');
    setPhoneInput((current) => current || authPhone || String((shopResult.data as any)?.shopPhoneNumber || ''));
  }, []);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    const initialLoad = setTimeout(() => {
      load().catch((error) => {
        if (mounted) Alert.alert('Unable to load payments', error instanceof Error ? error.message : 'Please try again.');
      }).finally(() => mounted && setLoading(false));
    }, 0);
    const channel = supabase.channel('shop-xendit-mobile')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_payments' }, () => {
        void load().then(() => onChanged?.()).catch(() => undefined);
      }).subscribe();
    const stateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load().then(() => onChanged?.()).catch(() => undefined);
    });
    return () => {
      mounted = false;
      clearTimeout(initialLoad);
      stateSubscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [load, onChanged, visible]);

  const latestPending = useMemo(() => payments.find((item) => item.status === 'pending') || null, [payments]);
  const selectedMethod = useMemo(
    () => PAYMENT_METHODS.find((item) => item.id === paymentMethod) || PAYMENT_METHODS[0],
    [paymentMethod],
  );

  const confirmLifecyclePassword = async () => {
    if (!accountPassword || checkingPassword) return;
    setCheckingPassword(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('Your signed-in email is unavailable.');
      const result = await supabase.auth.signInWithPassword({ email: user.email, password: accountPassword });
      if (result.error || result.data.user?.id !== user.id) throw new Error('Your LifeCycle password is incorrect.');
      setAccountPassword('');
      setPasswordPromptVisible(false);
      await beginCheckout(true);
    } catch (error) {
      Alert.alert('Password not confirmed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setCheckingPassword(false);
    }
  };

  const sendPhoneVerification = async () => {
    const normalizedPhone = normalizePhilippinePhone(phoneInput);
    if (!normalizedPhone) {
      Alert.alert('Invalid mobile number', 'Enter a Philippine mobile number such as 09XX XXX XXXX.');
      return;
    }
    setPhoneVerificationBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalizedPhone });
      if (error) throw error;
      setPendingPhone(normalizedPhone);
      setPhoneOtp('');
      setPhoneOtpSent(true);
      Alert.alert('Verification code sent', 'Enter the six-digit code sent to this mobile number.');
    } catch (error) {
      Alert.alert('Unable to send code', friendlyPhoneAuthError(error, 'send'));
    } finally {
      setPhoneVerificationBusy(false);
    }
  };

  const verifyPhoneCode = async () => {
    if (!pendingPhone || !/^\d{6}$/.test(phoneOtp.trim())) {
      Alert.alert('Verification code required', 'Enter the six-digit SMS code.');
      return;
    }
    setPhoneVerificationBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: pendingPhone, token: phoneOtp.trim(), type: 'phone_change' });
      if (error) throw error;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.phone || !user.phone_confirmed_at) throw new Error('The mobile number was not confirmed.');
      setVerifiedPhone(user.phone);
      setPhoneInput(user.phone);
      setPhoneOtp('');
      setPhoneOtpSent(false);
      setPhoneVerificationVisible(false);
      await supabase.from('funeral_shops').update({ shopPhoneNumber: user.phone }).eq('id', user.id);
      Alert.alert('Mobile number verified', 'This number is now linked to the shop owner. LifeCycle payment push alerts remain enabled for this device.');
    } catch (error) {
      Alert.alert('Code not verified', friendlyPhoneAuthError(error, 'verify'));
    } finally {
      setPhoneVerificationBusy(false);
    }
  };

  const choosePaymentMethod = (nextMethod: XenditShopPaymentMethod) => {
    setPaymentMethod(nextMethod);
    setPaymentMethodMenuVisible(false);
    setAccountPassword('');
    if (nextMethod === 'gcash' && !verifiedPhone) setPhoneVerificationVisible(true);
  };

  const beginCheckout = async (passwordJustConfirmed = false) => {
    if (starting) return;
    if (fee <= 0) {
      Alert.alert('Payment unavailable', 'The registration fee has not been configured yet.');
      return;
    }
    if (paymentMethod === 'gcash' && !verifiedPhone) {
      Alert.alert('Verify your mobile number', 'GCash checkout requires a verified shop-owner mobile number.');
      return;
    }
    if (paymentMethod === 'gcash' && !passwordJustConfirmed) {
      Alert.alert('Confirm your password', 'Enter your LifeCycle account password before opening GCash checkout.');
      return;
    }
    setStarting(true);
    try {
      const result = await createXenditShopCheckout(paymentMethod);
      if (result.paid) {
        closePurchaseConfirm();
        await load();
        onChanged?.();
        Alert.alert('Payment received', 'Your Xendit test payment has been confirmed.');
        return;
      }
      if (result.livemode !== false) {
        throw new Error('Checkout was blocked because LifeCycle only allows Xendit test payments.');
      }
      if (!result.checkoutUrl || !(await Linking.canOpenURL(result.checkoutUrl))) {
        throw new Error('The secure Xendit checkout page could not be opened.');
      }
      await Linking.openURL(result.checkoutUrl);
      closePurchaseConfirm();
      await load();
    } catch (error) {
      Alert.alert('Unable to start payment', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setStarting(false);
    }
  };

  const handleBuyPress = () => {
    if (starting) return;
    if (paymentMethod !== 'gcash') {
      void beginCheckout();
      return;
    }
    if (!verifiedPhone) {
      setPhoneVerificationVisible(true);
      return;
    }
    // Password is shown inline in the purchase sheet — just confirm directly
    void confirmLifecyclePassword();
  };

  const continueCheckout = async (payment: Payment) => {
    if (!payment.providerCheckoutUrl) return;
    try { await Linking.openURL(payment.providerCheckoutUrl); }
    catch { Alert.alert('Unable to open checkout', 'Please start a new Xendit checkout.'); }
  };

  return (
    <Modal visible={visible} animationType='slide' presentationStyle='pageSheet' onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconButton}><Ionicons name='close' size={24} color='#0f172a' /></TouchableOpacity>
          <Text style={styles.headerTitle}>Shop payment</Text>
          <TouchableOpacity onPress={() => void load()} style={styles.iconButton}><Ionicons name='refresh' size={21} color='#0f766e' /></TouchableOpacity>
        </View>
        {loading ? <View style={styles.loading}><ActivityIndicator size='large' color='#0f766e' /></View> : (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.hero}>
              <View style={styles.xenditMark}><Ionicons name='shield-checkmark' size={25} color='#fff' /></View>
              <View style={styles.flex}>
                <Text style={styles.eyebrow}>XENDIT TEST MODE</Text>
                <Text style={styles.heroTitle}>Pay with Xendit</Text>
                <Text style={styles.heroText}>The hosted test checkout sends the registration fee directly to the LifeCycle admin account. No real money is used.</Text>
              </View>
            </View>
            <View style={styles.amountCard}>
              <Text style={styles.amountLabel}>Registration / renewal fee</Text>
              <Text style={styles.amount}>{formatPhilippinePeso(fee)}</Text>
              {paidUntil ? <Text style={styles.paidUntil}>Current access through {formatDate(paidUntil)}</Text> : null}
            </View>
            {latestPending?.paymentProvider === 'manual' ? (
              <View style={styles.notice}><Ionicons name='time-outline' size={20} color='#92400e' /><Text style={styles.noticeText}>Your previous manual payment is awaiting admin review. It must be resolved before starting Xendit checkout.</Text></View>
            ) : null}
            <TouchableOpacity
              style={[styles.payButton, (starting || fee <= 0 || latestPending?.paymentProvider === 'manual') && styles.buttonDisabled]}
              disabled={starting || fee <= 0 || latestPending?.paymentProvider === 'manual'}
              onPress={() => {
                setAccountPassword('');
                setPasswordVisible(false);
                openPurchaseConfirm();
              }}
            >
              <Ionicons name='lock-closed' size={18} color='#fff' /><Text style={styles.payButtonText}>{latestPending?.paymentProvider === 'xendit' ? 'Review test checkout' : 'Review test payment'}</Text>
            </TouchableOpacity>
            <Text style={styles.helper}>Choose an available Xendit Test Mode e-wallet, card, QR Ph, or bank-transfer channel. Never enter real payment credentials.</Text>
            <Text style={styles.sectionTitle}>Payment history</Text>
            {payments.length === 0 ? <View style={styles.empty}><Ionicons name='receipt-outline' size={28} color='#94a3b8' /><Text style={styles.emptyText}>No payments yet</Text></View> : payments.map((payment) => {
              const meta = statusMeta(payment);
              return (
                <TouchableOpacity key={payment.id} style={styles.paymentRow} onPress={() => setSelected(payment)}>
                  <View style={[styles.statusIcon, { backgroundColor: meta.bg }]}><Ionicons name={meta.icon} size={21} color={meta.color} /></View>
                  <View style={styles.flex}><Text style={styles.rowTitle}>{formatPhilippinePeso(payment.amount)}</Text><Text style={styles.rowSub}>{methodLabel(payment)} - {formatDate(payment.createdAt)}</Text></View>
                  <View style={[styles.badge, { backgroundColor: meta.bg }]}><Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text></View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        <Modal
          visible={purchaseConfirmVisible}
          transparent
          animationType='none'
          statusBarTranslucent
          onRequestClose={() => !starting && !checkingPassword && closePurchaseConfirm()}
        >
          <View style={styles.purchaseModalRoot}>
            <Animated.View style={[styles.purchaseBackdropAnimated, { opacity: purchaseBackdropOpacity }]}>
              <TouchableOpacity style={styles.purchaseBackdropPressable} activeOpacity={1} onPress={() => !starting && !checkingPassword && closePurchaseConfirm()} accessibilityLabel='Close test payment confirmation' />
            </Animated.View>
            <Animated.View
              style={[
                styles.purchaseSheetContainer,
                {
                  transform: [
                    {
                      translateY: purchaseSheetProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [600, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <SafeAreaView style={styles.purchaseSheet} edges={['bottom']}>
                <View style={styles.purchaseHandle} />
              <KeyboardAwareScrollView
                style={styles.purchaseScrollView}
                contentContainerStyle={styles.purchaseScrollContent}
                keyboardShouldPersistTaps='handled'
                bottomOffset={24}
                showsVerticalScrollIndicator={false}
              >
              {/* Brand row */}
              <View style={styles.purchaseBrandRow}>
                <Text style={styles.purchaseBrand}>LifeCycle</Text>
                <TouchableOpacity onPress={() => !starting && !checkingPassword && closePurchaseConfirm()} accessibilityLabel='Close'>
                  <Ionicons name='close' size={20} color='#9ea5a1' />
                </TouchableOpacity>
              </View>
              {/* Product row */}
              <View style={styles.purchaseProductRow}>
                <View style={styles.purchaseAppIcon}><Ionicons name='storefront' size={25} color='#ffffff' /></View>
                <View style={styles.flex}>
                  <Text style={styles.purchaseProductName}>LifeCycle Shop Registration</Text>
                  <Text style={styles.purchaseMerchant}>LifeCycle Admin</Text>
                </View>
              </View>
              {/* Price box */}
              <View style={styles.purchasePriceBox}>
                <View style={styles.purchasePriceRow}>
                  <Text style={styles.purchasePriceLabel}>Registration fee</Text>
                  <Text style={styles.purchasePriceValue}>{formatPhilippinePeso(fee)}</Text>
                </View>
              </View>
              {/* Bullet terms */}
              <View style={styles.purchaseBullets}>
                {[
                  'Verified shops can go live immediately after payment.',
                  'Subscription renews monthly. You can stop anytime.',
                  'Payment is processed securely through Xendit Test Mode.',
                ].map((item) => (
                  <View key={item} style={styles.purchaseBulletRow}>
                    <Text style={styles.purchaseBulletDot}>•</Text>
                    <Text style={styles.purchaseBulletText}>{item}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.purchaseDivider} />
              {/* Payment method row */}
              <TouchableOpacity style={styles.purchaseMethodRow} onPress={() => setPaymentMethodMenuVisible(true)} accessibilityLabel='Choose payment method'>
                <View style={styles.purchaseMethodIcon}><Ionicons name={selectedMethod.icon} size={21} color='#7db1ff' /></View>
                <View style={styles.flex}>
                  <Text style={styles.purchaseMethodTitle}>{paymentMethod === 'gcash' && verifiedPhone ? `GCash: ${maskPhone(verifiedPhone)}` : selectedMethod.label}</Text>
                </View>
                <Ionicons name='chevron-forward' size={19} color='#aeb5b1' />
              </TouchableOpacity>
              {/* Inline GCash password section */}
              {paymentMethod === 'gcash' && verifiedPhone ? (
                <>
                  <Text style={styles.purchasePasswordNotice}>
                    By tapping "Subscribe", you agree to the LifeCycle Terms of Service. You'll be asked to verify each time you make a purchase through GCash on this device.
                  </Text>
                  {/* Email display */}
                  <View style={styles.purchaseEmailField}>
                    <Text style={styles.purchaseEmailText} numberOfLines={1}>{userEmail}</Text>
                  </View>
                  {/* Password input */}
                  <View style={styles.purchasePasswordWrap}>
                    <TextInput
                      style={styles.purchasePasswordInput}
                      value={accountPassword}
                      onChangeText={setAccountPassword}
                      placeholder='Enter your password'
                      placeholderTextColor='#6b7580'
                      secureTextEntry={!passwordVisible}
                      editable={!checkingPassword && !starting}
                      autoCapitalize='none'
                      autoCorrect={false}
                      onSubmitEditing={() => accountPassword && !checkingPassword && void confirmLifecyclePassword()}
                    />
                    <TouchableOpacity style={styles.purchaseEyeBtn} onPress={() => setPasswordVisible((v) => !v)}>
                      <Ionicons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={19} color='#8a9298' />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.purchaseBiometricHint}>
                    Instead of a password, use any fingerprint or face stored on this device to verify purchases for this LifeCycle account
                  </Text>
                  <TouchableOpacity style={styles.purchaseForgotRow}>
                    <Text style={styles.purchaseForgotText}>Forgotten password?</Text>
                  </TouchableOpacity>
                  {/* Subscribe button */}
                  <TouchableOpacity
                    style={[styles.purchaseSubscribeBtn, (!accountPassword || checkingPassword || starting) && styles.purchaseSubscribeBtnDisabled]}
                    disabled={!accountPassword || checkingPassword || starting}
                    onPress={() => void confirmLifecyclePassword()}
                  >
                    {checkingPassword || starting ? <ActivityIndicator color='#10233f' /> : <Text style={styles.purchaseSubscribeBtnText}>Subscribe</Text>}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.purchaseNotice}>Tap "Buy" to complete your test purchase. Payment alerts are delivered through LifeCycle notifications on this device.</Text>
                  <TouchableOpacity
                    style={[styles.purchaseBuyButton, starting && styles.buttonDisabled]}
                    disabled={starting}
                    onPress={handleBuyPress}
                  >
                    {starting ? <ActivityIndicator color='#10233f' /> : <Text style={styles.purchaseBuyText}>Buy</Text>}
                  </TouchableOpacity>
                </>
              )}
              </KeyboardAwareScrollView>
            </SafeAreaView>
            </Animated.View>
          </View>
        </Modal>
        <Modal visible={paymentMethodMenuVisible} animationType='slide' onRequestClose={() => setPaymentMethodMenuVisible(false)}>
          <SafeAreaView style={styles.methodScreen}>
            <StatusBar barStyle='light-content' backgroundColor='#111312' />
            <View style={styles.methodScreenHeader}>
              <TouchableOpacity style={styles.methodBackButton} onPress={() => setPaymentMethodMenuVisible(false)} accessibilityLabel='Back to purchase'>
                <Ionicons name='arrow-back' size={24} color='#e7ebe9' />
              </TouchableOpacity>
              <View style={styles.flex}>
                <Text style={styles.methodScreenTitle}>Payment methods</Text>
                <Text style={styles.methodScreenEmail}>{userEmail}</Text>
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.methodScreenContent}>
              <Text style={styles.methodSectionLabel}>CURRENT PAYMENT METHOD</Text>
              {PAYMENT_METHODS.filter((method) => method.id === paymentMethod).map((method) => (
                <TouchableOpacity key={method.id} style={styles.methodScreenOption} onPress={() => choosePaymentMethod(method.id)}>
                  <View style={styles.methodScreenIcon}><Ionicons name={method.icon} size={22} color='#4e91ff' /></View>
                  <View style={styles.flex}>
                    <Text style={styles.methodScreenOptionTitle}>{method.id === 'gcash' && verifiedPhone ? `GCash: ${maskPhone(verifiedPhone)}` : method.label}</Text>
                    <Text style={styles.methodScreenOptionDetail}>{method.id === 'gcash' && !verifiedPhone ? 'Tap to verify the shop-owner mobile number' : method.detail}</Text>
                  </View>
                  <Ionicons name='checkmark-circle' size={21} color='#8db8ff' />
                </TouchableOpacity>
              ))}
              <View style={styles.methodScreenDivider} />
              <Text style={styles.methodSectionLabel}>OTHER XENDIT TEST PAYMENT METHODS</Text>
              {PAYMENT_METHODS.filter((method) => method.id !== paymentMethod).map((method) => (
                <TouchableOpacity key={method.id} style={styles.methodScreenOption} onPress={() => choosePaymentMethod(method.id)}>
                  <View style={styles.methodScreenIcon}><Ionicons name={method.icon} size={22} color='#a8afab' /></View>
                  <View style={styles.flex}>
                    <Text style={styles.methodScreenOptionTitle}>{method.label}</Text>
                    <Text style={styles.methodScreenOptionDetail}>{method.detail}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              <Text style={styles.methodTestNotice}>Test Mode only. Available checkout channels depend on the Xendit test business configuration.</Text>
            </ScrollView>
          </SafeAreaView>
        </Modal>
        <Modal visible={phoneVerificationVisible} transparent animationType='fade' statusBarTranslucent onRequestClose={() => !phoneVerificationBusy && setPhoneVerificationVisible(false)}>
          <View style={styles.authPromptOverlay}>
            <TouchableOpacity style={styles.authPromptBackdrop} activeOpacity={1} onPress={() => !phoneVerificationBusy && setPhoneVerificationVisible(false)} accessibilityLabel='Close phone verification' />
            <View style={styles.authPromptCard}>
              <View style={styles.authPromptHeader}>
                <View style={styles.authPromptIcon}><Ionicons name='phone-portrait-outline' size={23} color='#8db8ff' /></View>
                <View style={styles.flex}>
                  <Text style={styles.authPromptTitle}>Verify shop-owner number</Text>
                  <Text style={styles.authPromptSubtitle}>Required before using GCash</Text>
                </View>
              </View>
              <Text style={styles.authPromptText}>{phoneOtpSent ? `Enter the six-digit code sent to ${maskPhone(pendingPhone)}.` : 'Enter the mobile number owned by the funeral shop owner. We will send a real SMS verification code.'}</Text>
              <TextInput
                style={styles.authPromptInput}
                value={phoneOtpSent ? phoneOtp : phoneInput}
                onChangeText={phoneOtpSent ? (value) => setPhoneOtp(value.replace(/\D/g, '').slice(0, 6)) : setPhoneInput}
                placeholder={phoneOtpSent ? '6-digit SMS code' : '09XX XXX XXXX'}
                placeholderTextColor='#777e7a'
                keyboardType={phoneOtpSent ? 'number-pad' : 'phone-pad'}
                maxLength={phoneOtpSent ? 6 : 18}
                editable={!phoneVerificationBusy}
                autoFocus
              />
              <View style={styles.authPromptActions}>
                <TouchableOpacity style={styles.authPromptCancel} onPress={() => setPhoneVerificationVisible(false)} disabled={phoneVerificationBusy}>
                  <Text style={styles.authPromptCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.authPromptPrimary, phoneVerificationBusy && styles.buttonDisabled]} onPress={() => void (phoneOtpSent ? verifyPhoneCode() : sendPhoneVerification())} disabled={phoneVerificationBusy}>
                  {phoneVerificationBusy ? <ActivityIndicator color='#10233f' /> : <Text style={styles.authPromptPrimaryText}>{phoneOtpSent ? 'Verify' : 'Send Code'}</Text>}
                </TouchableOpacity>
              </View>
              {phoneOtpSent ? (
                <TouchableOpacity style={styles.authPromptLink} onPress={() => { setPhoneOtpSent(false); setPhoneOtp(''); }} disabled={phoneVerificationBusy}>
                  <Text style={styles.authPromptLinkText}>Use a different mobile number</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </Modal>
        {/* Password prompt is now inline inside the purchaseConfirmVisible sheet above */}
        <Modal visible={Boolean(selected)} animationType='slide' onRequestClose={() => setSelected(null)}>
          {selected ? (
            <View style={styles.receiptScreen}>
              <StatusBar barStyle='light-content' backgroundColor='#101312' />
              <ScrollView contentContainerStyle={styles.receiptContent} showsVerticalScrollIndicator={false}>
                <View style={styles.receiptHero}>
                  <TouchableOpacity style={styles.receiptClose} onPress={() => setSelected(null)} accessibilityLabel='Close payment receipt'>
                    <Ionicons name='close' size={24} color='#ffffff' />
                  </TouchableOpacity>
                  <View style={[styles.receiptStatusIcon, { backgroundColor: statusMeta(selected).bg }]}>
                    <Ionicons name={statusMeta(selected).icon} size={31} color={statusMeta(selected).color} />
                  </View>
                  <Text style={styles.receiptHeroTitle}>{selected.status === 'verified' ? 'Payment Verified' : selected.status === 'rejected' ? 'Payment Not Completed' : 'Payment Pending'}</Text>
                  <Text style={styles.receiptHeroMessage}>{receiptMessage(selected)}</Text>
                </View>

                <View style={styles.receiptBody}>
                  <Text style={styles.receiptSectionTitle}>Payment Details</Text>
                  <View style={styles.receiptDetailsBlock}>
                    <ReceiptLine label='Payment Date' value={formatDate(selected.verifiedAt || selected.createdAt)} />
                    <ReceiptLine label='Receipt No.' value={receiptNumber(selected)} />
                    <ReceiptLine label='Shop' value={shopName} />
                    {selected.expiresAt ? <ReceiptLine label='Access Valid Until' value={formatDate(selected.expiresAt)} /> : null}
                  </View>

                  <View style={styles.receiptDivider} />

                  <View style={styles.receiptServiceRow}>
                    <View style={styles.receiptServiceLogo}><Text style={styles.receiptServiceLogoText}>LC</Text></View>
                    <View style={styles.flex}>
                      <Text style={styles.receiptServiceName}>LifeCycle registration</Text>
                      <Text style={styles.receiptServiceMeta}>Shop registration / renewal</Text>
                      <Text style={styles.receiptServiceMeta}>One month of shop access</Text>
                    </View>
                    <Text style={styles.receiptServiceAmount}>{formatPhilippinePeso(selected.amount)}</Text>
                  </View>

                  <View style={styles.receiptDivider} />

                  <View style={styles.receiptSectionHeading}>
                    <Text style={styles.receiptSectionTitle}>Receipt Information</Text>
                    <View style={styles.receiptSectionIcon}><Ionicons name='receipt-outline' size={18} color='#53615d' /></View>
                  </View>
                  <View style={styles.receiptInfoCard}>
                    <ReceiptLine label='Payment Method' value={methodLabel(selected)} />
                    <ReceiptLine label='Paid By' value={selected.payerName || shopName} />
                    <ReceiptLine label='Reference Number' value={selected.referenceNumber || 'Not provided'} />
                    <ReceiptLine label='Provider Payment ID' value={selected.providerPaymentId || 'Pending'} />
                    <ReceiptLine label='Status' value={statusMeta(selected).label} />
                    <ReceiptLine label='Amount' value={formatPhilippinePeso(selected.amount)} />
                    {selected.verifiedAt ? <ReceiptLine label='Confirmed At' value={formatDate(selected.verifiedAt)} /> : null}
                  </View>

                  {selected.paymentProvider === 'xendit' ? (
                    <View style={styles.receiptProviderNote}>
                      <Ionicons name={selected.status === 'verified' ? 'shield-checkmark' : 'hourglass-outline'} size={22} color={selected.status === 'verified' ? '#166534' : '#92400e'} />
                      <View style={styles.flex}>
                        <Text style={styles.receiptProviderTitle}>{selected.status === 'verified' ? 'Verified by Xendit' : 'Xendit confirmation pending'}</Text>
                        <Text style={styles.receiptProviderText}>{selected.status === 'verified' ? 'LifeCycle confirmed this payment directly with Xendit. No screenshot or manual admin approval was required.' : 'This receipt will update automatically after Xendit confirms the Test Mode payment.'}</Text>
                      </View>
                    </View>
                  ) : null}

                  {selected.rejectionReason ? (
                    <View style={styles.receiptErrorNote}>
                      <Ionicons name='alert-circle-outline' size={21} color='#991b1b' />
                      <Text style={styles.receiptErrorText}>{selected.rejectionReason}</Text>
                    </View>
                  ) : null}

                  {selected.status === 'pending' && selected.paymentProvider === 'xendit' && selected.providerCheckoutUrl ? (
                    <TouchableOpacity style={styles.receiptPrimaryButton} onPress={() => void continueCheckout(selected)}>
                      <Ionicons name='lock-closed' size={18} color='#ffffff' />
                      <Text style={styles.receiptPrimaryButtonText}>Continue Xendit Checkout</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={styles.receiptCloseButton} onPress={() => setSelected(null)}>
                    <Text style={styles.receiptCloseButtonText}>Close Receipt</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          ) : null}
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

function ReceiptLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.receiptLine}><Text style={styles.receiptLabel}>{label}</Text><Text style={styles.receiptValue} selectable>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  header: { height: 58, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 40, gap: 14 },
  hero: { flexDirection: 'row', gap: 14, padding: 18, borderRadius: 20, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0' },
  xenditMark: { width: 48, height: 48, borderRadius: 15, backgroundColor: '#0f766e', alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: '#0f766e' },
  heroTitle: { marginTop: 3, fontSize: 21, fontWeight: '900', color: '#0f172a' },
  heroText: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#475569' },
  amountCard: { padding: 20, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  amountLabel: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  amount: { marginTop: 5, fontSize: 32, fontWeight: '900', color: '#0f172a' },
  paidUntil: { marginTop: 8, fontSize: 12, color: '#0f766e' },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 13, borderRadius: 13, backgroundColor: '#fffbeb' },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#92400e' },
  payButton: { minHeight: 52, paddingHorizontal: 18, borderRadius: 14, backgroundColor: '#0f766e', flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { opacity: 0.48 },
  payButtonText: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  helper: { paddingHorizontal: 8, textAlign: 'center', fontSize: 11, lineHeight: 17, color: '#64748b' },
  sectionTitle: { marginTop: 8, fontSize: 17, fontWeight: '900', color: '#0f172a' },
  empty: { padding: 28, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', gap: 7 },
  emptyText: { color: '#64748b', fontWeight: '600' },
  paymentRow: { minHeight: 72, padding: 13, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center', gap: 11 },
  statusIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  rowSub: { marginTop: 3, fontSize: 11, color: '#64748b' },
  badge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '900' },
  overlay: { flex: 1, padding: 18, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center' },
  sheet: { padding: 20, borderRadius: 20, backgroundColor: '#fff', gap: 2 },
  sheetHeader: { marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 19, fontWeight: '900', color: '#0f172a' },
  detailRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', flexDirection: 'row', gap: 10 },
  detailLabel: { width: 86, fontSize: 12, fontWeight: '700', color: '#64748b' },
  detailValue: { flex: 1, fontSize: 12, color: '#0f172a', textAlign: 'right' },
  receiptScreen: { flex: 1, backgroundColor: '#ffffff' },
  receiptContent: { flexGrow: 1, backgroundColor: '#ffffff' },
  receiptHero: { minHeight: 255, paddingHorizontal: 24, paddingTop: 48, paddingBottom: 30, backgroundColor: '#101312', alignItems: 'center', justifyContent: 'center' },
  receiptClose: { position: 'absolute', top: 16, right: 18, width: 44, height: 44, borderRadius: 22, backgroundColor: '#303332', alignItems: 'center', justifyContent: 'center' },
  receiptStatusIcon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  receiptHeroTitle: { marginTop: 22, color: '#ffffff', fontSize: 23, fontWeight: '900', textAlign: 'center' },
  receiptHeroMessage: { marginTop: 9, maxWidth: 340, color: '#b9bfbc', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  receiptBody: { paddingHorizontal: 22, paddingTop: 26, paddingBottom: 36 },
  receiptSectionTitle: { color: '#191c1b', fontSize: 16, fontWeight: '900' },
  receiptDetailsBlock: { gap: 16, marginTop: 22 },
  receiptLine: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18 },
  receiptLabel: { flex: 1, color: '#858c88', fontSize: 12 },
  receiptValue: { flex: 1.35, color: '#303634', fontSize: 12, fontWeight: '900', textAlign: 'right' },
  receiptDivider: { height: 1, marginVertical: 24, backgroundColor: '#e5e8e6' },
  receiptServiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  receiptServiceLogo: { width: 58, height: 70, borderRadius: 12, backgroundColor: '#22312d', alignItems: 'center', justifyContent: 'center' },
  receiptServiceLogoText: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  receiptServiceName: { color: '#282e2b', fontSize: 14, fontWeight: '900' },
  receiptServiceMeta: { marginTop: 3, color: '#868d89', fontSize: 11 },
  receiptServiceAmount: { color: '#222725', fontSize: 14, fontWeight: '900' },
  receiptSectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  receiptSectionIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#f1f3f2', alignItems: 'center', justifyContent: 'center' },
  receiptInfoCard: { marginTop: 12, padding: 14, gap: 15, borderRadius: 15, backgroundColor: '#f7f8f7' },
  receiptProviderNote: { marginTop: 20, padding: 15, borderRadius: 15, backgroundColor: '#f0fdf4', flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  receiptProviderTitle: { color: '#166534', fontSize: 13, fontWeight: '900' },
  receiptProviderText: { marginTop: 4, color: '#4b6355', fontSize: 11, lineHeight: 17 },
  receiptErrorNote: { marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: '#fef2f2', flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  receiptErrorText: { flex: 1, color: '#991b1b', fontSize: 12, lineHeight: 18 },
  receiptPrimaryButton: { minHeight: 52, marginTop: 24, borderRadius: 15, backgroundColor: '#22312d', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  receiptPrimaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  receiptCloseButton: { minHeight: 48, marginTop: 12, borderRadius: 15, borderWidth: 1, borderColor: '#d7dcda', alignItems: 'center', justifyContent: 'center' },
  receiptCloseButtonText: { color: '#52615c', fontSize: 13, fontWeight: '900' },
  purchaseModalRoot: { flex: 1, justifyContent: 'flex-end' },
  purchaseBackdropAnimated: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.72)' },
  purchaseBackdropPressable: { flex: 1 },
  purchaseSheetContainer: { width: '100%' },
  purchaseOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.72)' },
  purchaseBackdrop: { flex: 1 },
  purchaseSheet: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#171918' },
  purchaseScrollView: { flexShrink: 1 },
  purchaseScrollContent: { paddingBottom: 8 },
  purchaseHandle: { width: 38, height: 4, marginBottom: 14, borderRadius: 2, backgroundColor: '#4b4e4c', alignSelf: 'center' },
  purchaseBrandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  purchaseBrand: { color: '#cdd2cf', fontSize: 16, fontWeight: '800' },
  purchaseTestBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: '#253a31' },
  purchaseTestBadgeText: { color: '#75d49a', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  purchaseProductRow: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 12 },
  purchaseAppIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#0f766e', alignItems: 'center', justifyContent: 'center' },
  purchaseProductName: { color: '#f4f6f5', fontSize: 15, fontWeight: '800' },
  purchaseMerchant: { marginTop: 3, color: '#8e9691', fontSize: 11 },
  purchasePrice: { color: '#f4f6f5', fontSize: 15, fontWeight: '800' },
  purchaseDivider: { height: 1, backgroundColor: '#303330' },
  purchaseMethodRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12 },
  purchaseMethodIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#1d2b3d', alignItems: 'center', justifyContent: 'center' },
  purchaseMethodTitle: { color: '#e8ece9', fontSize: 13, fontWeight: '700' },
  purchaseMethodMeta: { marginTop: 3, color: '#949b97', fontSize: 10 },
  purchaseNotice: { paddingTop: 14, color: '#aeb5b1', fontSize: 11, lineHeight: 17 },
  purchaseBuyButton: { minHeight: 52, marginTop: 19, borderRadius: 26, backgroundColor: '#9fc5ff', alignItems: 'center', justifyContent: 'center' },
  purchaseBuyText: { color: '#10233f', fontSize: 14, fontWeight: '900' },
  // Inline GP-style elements inside purchase sheet
  purchasePriceBox: { marginTop: 2, marginBottom: 4, borderRadius: 6, backgroundColor: '#1e4e7a', paddingHorizontal: 13, paddingVertical: 11 },
  purchasePriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  purchasePriceLabel: { color: '#c8ddf5', fontSize: 12, fontWeight: '600' },
  purchasePriceValue: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  purchaseBullets: { paddingTop: 10, paddingBottom: 4, gap: 5 },
  purchaseBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  purchaseBulletDot: { color: '#8a9298', fontSize: 12, lineHeight: 17 },
  purchaseBulletText: { flex: 1, color: '#9ca5a1', fontSize: 11, lineHeight: 17 },
  purchasePasswordNotice: { marginTop: 8, color: '#9ba3a0', fontSize: 10, lineHeight: 15 },
  purchaseEmailField: { marginTop: 10, minHeight: 42, borderWidth: 2, borderColor: '#4a90d9', borderRadius: 4, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#1c2928' },
  purchaseEmailText: { color: '#c8d5d2', fontSize: 13, fontWeight: '500' },
  purchasePasswordWrap: { minHeight: 44, borderBottomWidth: 2, borderBottomColor: '#3a4540', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2, marginTop: 8 },
  purchasePasswordInput: { flex: 1, color: '#e8ecea', fontSize: 14, paddingVertical: 8 },
  purchaseEyeBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  purchaseBiometricHint: { marginTop: 8, fontSize: 10, lineHeight: 15, color: '#6b7580' },
  purchaseForgotRow: { alignSelf: 'flex-start', marginTop: 6, marginBottom: 14, paddingVertical: 4 },
  purchaseForgotText: { fontSize: 11, color: '#7db1ff', fontWeight: '600' },
  purchaseSubscribeBtn: { minHeight: 50, borderRadius: 26, backgroundColor: '#9fc5ff', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  purchaseSubscribeBtnDisabled: { backgroundColor: '#3a5470' },
  purchaseSubscribeBtnText: { color: '#10233f', fontSize: 14, fontWeight: '900' },

  methodScreen: { flex: 1, backgroundColor: '#111312' },
  methodScreenHeader: { minHeight: 74, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#282b29' },
  methodBackButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  methodScreenTitle: { color: '#f3f5f4', fontSize: 17, fontWeight: '900' },
  methodScreenEmail: { marginTop: 2, color: '#999f9c', fontSize: 11 },
  methodScreenContent: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 40 },
  methodSectionLabel: { marginBottom: 8, color: '#8b928e', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  methodScreenOption: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: 1, borderBottomColor: '#292c2a' },
  methodScreenIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#192334', alignItems: 'center', justifyContent: 'center' },
  methodScreenOptionTitle: { color: '#edf0ee', fontSize: 13, fontWeight: '800' },
  methodScreenOptionDetail: { marginTop: 3, color: '#8f9692', fontSize: 9, lineHeight: 13 },
  methodScreenDivider: { height: 1, marginVertical: 22, backgroundColor: '#343735' },
  methodTestNotice: { marginTop: 24, color: '#7f8682', fontSize: 10, lineHeight: 16, textAlign: 'center' },
  authPromptOverlay: { flex: 1, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.78)' },
  authPromptBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  authPromptCard: { width: '100%', maxWidth: 430, padding: 20, borderRadius: 18, borderWidth: 1, borderColor: '#343936', backgroundColor: '#171918' },
  authPromptHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  authPromptIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#192b43', alignItems: 'center', justifyContent: 'center' },
  authPromptTitle: { color: '#f3f5f4', fontSize: 16, fontWeight: '900' },
  authPromptSubtitle: { marginTop: 3, color: '#939b96', fontSize: 10 },
  authPromptText: { marginTop: 18, color: '#b6bcb8', fontSize: 12, lineHeight: 18 },
  authPromptInput: { minHeight: 50, marginTop: 15, paddingHorizontal: 13, borderRadius: 7, borderWidth: 2, borderColor: '#73aaff', backgroundColor: '#111312', color: '#ffffff', fontSize: 14 },
  authPromptActions: { marginTop: 18, flexDirection: 'row', justifyContent: 'flex-end', gap: 9 },
  authPromptCancel: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, borderWidth: 1, borderColor: '#414744', alignItems: 'center', justifyContent: 'center' },
  authPromptCancelText: { color: '#d0d5d2', fontSize: 12, fontWeight: '800' },
  authPromptPrimary: { minHeight: 44, minWidth: 112, paddingHorizontal: 18, borderRadius: 22, backgroundColor: '#9fc5ff', alignItems: 'center', justifyContent: 'center' },
  authPromptPrimaryText: { color: '#10233f', fontSize: 12, fontWeight: '900' },
  authPromptLink: { minHeight: 38, marginTop: 7, alignItems: 'center', justifyContent: 'center' },
  authPromptLinkText: { color: '#8db8ff', fontSize: 11, fontWeight: '700' },
  passwordPromptCard: { width: '100%', maxWidth: 450, padding: 20, borderRadius: 8, borderWidth: 1, borderColor: '#343936', backgroundColor: '#171918' },
  passwordProductRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  passwordProductIcon: { width: 42, height: 42, borderRadius: 10, backgroundColor: '#0f766e', alignItems: 'center', justifyContent: 'center' },
  passwordProductName: { color: '#f2f4f3', fontSize: 13, fontWeight: '900' },
  passwordProductMethod: { marginTop: 3, color: '#909793', fontSize: 10 },
  passwordProductPrice: { color: '#f2f4f3', fontSize: 13, fontWeight: '900' },
  passwordPromptText: { marginTop: 18, color: '#b5bbb7', fontSize: 11, lineHeight: 17 },
  passwordPromptLabel: { marginTop: 16, marginBottom: 7, color: '#aeb5b1', fontSize: 10, fontWeight: '800' },
  passwordPromptInputWrap: { minHeight: 50, paddingLeft: 13, paddingRight: 5, borderRadius: 7, borderWidth: 2, borderColor: '#73aaff', backgroundColor: '#111312', flexDirection: 'row', alignItems: 'center' },
  passwordPromptInput: { flex: 1, color: '#ffffff', fontSize: 14 },
  passwordEyeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  // Google Play-style payment card
  gpCard: { width: '100%', maxWidth: 440, borderRadius: 10, backgroundColor: '#ffffff', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, shadowColor: '#000', shadowOpacity: 0.26, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 12 },
  gpAppName: { fontSize: 13, fontWeight: '700', color: '#202124', marginBottom: 14 },
  gpProductRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  gpProductIcon: { width: 46, height: 46, borderRadius: 10, backgroundColor: '#22312d', alignItems: 'center', justifyContent: 'center' },
  gpProductName: { fontSize: 14, fontWeight: '700', color: '#202124' },
  gpProductMerchant: { marginTop: 2, fontSize: 11, color: '#5f6368' },
  gpProductPrice: { fontSize: 15, fontWeight: '800', color: '#202124' },
  gpMethodRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  gpMethodText: { fontSize: 12, color: '#1a73e8', fontWeight: '600' },
  gpVerifyNotice: { fontSize: 11, lineHeight: 16, color: '#5f6368', marginBottom: 14 },
  gpEmailField: { minHeight: 44, borderWidth: 2, borderColor: '#1a73e8', borderRadius: 4, paddingHorizontal: 12, justifyContent: 'center', marginBottom: 10, backgroundColor: '#f8f9fa' },
  gpEmailText: { fontSize: 14, color: '#202124', fontWeight: '500' },
  gpPasswordWrap: { minHeight: 44, borderBottomWidth: 2, borderBottomColor: '#bdc1c6', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2, marginBottom: 10 },
  gpPasswordInput: { flex: 1, color: '#202124', fontSize: 14, paddingVertical: 8 },
  gpEyeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  gpBiometricHint: { fontSize: 10, lineHeight: 15, color: '#80868b', marginBottom: 8 },
  gpForgotRow: { alignSelf: 'flex-start', marginBottom: 18 },
  gpForgotText: { fontSize: 12, color: '#1a73e8', fontWeight: '600' },
  gpActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  gpCancelBtn: { minHeight: 38, paddingHorizontal: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  gpCancelText: { fontSize: 13, fontWeight: '700', color: '#1a73e8' },
  gpBuyBtn: { minHeight: 38, paddingHorizontal: 22, borderRadius: 4, backgroundColor: '#1a73e8', alignItems: 'center', justifyContent: 'center' },
  gpBuyBtnDisabled: { backgroundColor: '#9dc3f7' },
  gpBuyText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
});
