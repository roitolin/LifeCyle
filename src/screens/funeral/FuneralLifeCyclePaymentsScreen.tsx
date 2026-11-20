import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, FlatList, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AppBackButton from "@/components/AppBackButton";
import LoadingStatus from "@/components/LoadingStatus";
import { useAuth } from "@/context/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { supabase } from "@/services/supabaseClient";
import { createXenditShopCheckout, syncXenditShopPayment } from "@/services/xenditShop";
import { colors } from "@/theme";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";

const PAYMENT_FIELDS = "id, amount, status, referenceNumber, createdAt, verifiedAt, expiresAt, rejectionReason, paymentProvider, providerPaymentMethod";
const PAYMENT_BATCH_SIZE = 100;

type ShopPayment = {
  id: string;
  amount: number | string;
  status: "pending" | "verified" | "rejected";
  referenceNumber: string | null;
  createdAt: string;
  verifiedAt: string | null;
  expiresAt: string | null;
  rejectionReason: string | null;
  paymentProvider: string | null;
  providerPaymentMethod: string | null;
};

type PaymentHistory = {
  shopId: string;
  shopName: string;
  paidUntil: string | null;
  fee: number;
  payments: ShopPayment[];
};

async function fetchShopPayments(shopId: string) {
  const payments = new Map<string, ShopPayment>();
  for (let offset = 0; ; offset += PAYMENT_BATCH_SIZE) {
    const { data, error } = await supabase
      .from("shop_payments")
      .select(PAYMENT_FIELDS)
      .eq("shopId", shopId)
      .order("createdAt", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAYMENT_BATCH_SIZE - 1);
    if (error) throw error;
    for (const payment of data as ShopPayment[]) payments.set(payment.id, payment);
    if (data.length < PAYMENT_BATCH_SIZE) return [...payments.values()];
  }
}

function formatDate(value?: string | null, includeTime = false) {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return "—";
  return includeTime ? date.toLocaleString() : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function paymentMethod(payment: ShopPayment) {
  if (payment.paymentProvider === "manual") return "Manual payment";
  const method = payment.providerPaymentMethod?.replace(/^PH_/, "").replace(/_/g, " ");
  return method ? `Online (${method})` : "Online payment";
}

function PaymentStatus({ status }: { status: ShopPayment["status"] }) {
  const paid = status === "verified";
  const failed = status === "rejected";
  return (
    <View style={[styles.badge, paid ? styles.paidBadge : failed ? styles.failedBadge : styles.pendingBadge]}>
      <Text style={[styles.badgeText, paid ? styles.paidText : failed ? styles.failedText : styles.pendingText]}>
        {paid ? "Paid" : failed ? "Not completed" : "Pending"}
      </Text>
    </View>
  );
}

function PaymentHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <AppBackButton onPress={onBack} />
      <Text accessibilityRole="header" style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.detailValue} selectable>{value}</Text>
    </View>
  );
}

function PaymentLoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <View style={styles.loadError}>
      <Text style={styles.muted} accessibilityRole="alert">{message}</Text>
      <TouchableOpacity style={styles.retry} accessibilityRole="button" onPress={retry}>
        <Text style={styles.actionText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function FuneralLifeCyclePaymentsScreen({ navigation }: any) {
  const { user } = useAuth();
  const shopId = user?.uid;
  const [history, setHistory] = useState<PaymentHistory | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const requestNumber = useRef(0);
  const openingCheckout = useRef(false);

  const load = useCallback(async (showRefresh = false) => {
    const request = ++requestNumber.current;
    if (!shopId) {
      setError("Sign in to view your shop’s payments.");
      return;
    }
    if (showRefresh) setRefreshing(true);
    try {
      const [shop, setting, payments] = await Promise.all([
        supabase.from("funeral_shops").select("shopName, paidUntil").eq("id", shopId).maybeSingle(),
        supabase.from("settings").select("value").eq("key", "shop_payment_settings").maybeSingle(),
        fetchShopPayments(shopId),
      ]);
      if (request !== requestNumber.current) return;
      if (shop.error) throw shop.error;
      if (!shop.data) {
        setError("This account does not have a funeral shop.");
        return;
      }
      setHistory({
        shopId,
        shopName: shop.data.shopName || "Funeral shop",
        paidUntil: shop.data.paidUntil ?? null,
        fee: Number(setting.data?.value?.feeAmount) || 0,
        payments,
      });
      setError("");
    } catch {
      if (request === requestNumber.current) setError("Could not load payment history. Please try again.");
    } finally {
      if (request === requestNumber.current) setRefreshing(false);
    }
  }, [shopId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    const syncPayment = async () => {
      if (!shopId) return;
      try {
        const result = await syncXenditShopPayment();
        if (active && (result.synced || result.paid)) void load();
      } catch {
        // The history query still shows the saved payment statuses.
      }
    };
    void load();
    void syncPayment();
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncPayment();
    });
    return () => {
      active = false;
      requestNumber.current += 1;
      foreground.remove();
    };
  }, [load, shopId]));

  useRealtimeRefresh(shopId ? [
    { table: "shop_payments", filter: `shopId=eq.${shopId}` },
    { table: "funeral_shops", filter: `id=eq.${shopId}` },
  ] : [], load, Boolean(shopId));

  const data = history?.shopId === shopId ? history : null;
  const activeSubscription = Boolean(data?.paidUntil && Date.parse(data.paidUntil) > Date.now());
  const latestReceipt = data?.payments.find(payment => payment.status === "verified");

  const viewPayment = (payment: ShopPayment) => navigation.navigate("LifeCyclePaymentDetails", { paymentId: payment.id });
  const pay = async () => {
    if (openingCheckout.current || activeSubscription || !data?.fee) return;
    openingCheckout.current = true;
    setStarting(true);
    try {
      const result = await createXenditShopCheckout("all");
      if (result.paid) {
        await load();
        Alert.alert("Payment confirmed", "Your shop subscription payment was confirmed.");
      } else {
        if (!result.checkoutUrl || !(await Linking.canOpenURL(result.checkoutUrl))) {
          throw new Error("Checkout link is unavailable.");
        }
        await Linking.openURL(result.checkoutUrl);
      }
    } catch (err) {
      Alert.alert("Unable to start payment", err instanceof Error ? err.message : "Please try again.");
    } finally {
      openingCheckout.current = false;
      setStarting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <PaymentHeader title="LifeCycle Payments" onBack={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("ShopCenter")} />
      {!data ? (
        error ? <PaymentLoadError message={error} retry={() => void load(true)} /> : <LoadingStatus label="Loading payment history" />
      ) : (
        <FlatList
          data={data.payments}
          keyExtractor={payment => payment.id}
          contentContainerStyle={styles.content}
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          ListHeaderComponent={
            <View>
              <View style={styles.card}>
                <View style={styles.summaryTop}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.sectionTitle}>Shop subscription</Text>
                    <Text style={styles.muted}>{data.shopName}</Text>
                  </View>
                  <Text style={activeSubscription ? styles.paidText : styles.pendingText}>
                    {activeSubscription ? "Active" : data.paidUntil ? "Renewal due" : "Inactive"}
                  </Text>
                </View>
                <DetailLine label={activeSubscription ? "Valid through" : data.paidUntil ? "Expired on" : "Subscription fee"} value={data.paidUntil ? formatDate(data.paidUntil) : data.fee > 0 ? formatPhilippinePeso(data.fee) : "Unavailable"} />
                <DetailLine label="Payment methods" value="GCash, Maya, Cards" />
                {activeSubscription ? latestReceipt && (
                  <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={() => viewPayment(latestReceipt)}>
                    <Text style={styles.actionText}>View latest receipt</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: starting }} disabled={starting || data.fee <= 0}
                    style={[styles.primaryButton, (starting || data.fee <= 0) && styles.disabledButton]} onPress={() => void pay()}>
                    {starting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{data.fee > 0 ? `Pay ${formatPhilippinePeso(data.fee)}` : "Payment unavailable"}</Text>}
                  </TouchableOpacity>
                )}
              </View>
              {error ? <PaymentLoadError message={error} retry={() => void load(true)} /> : null}
              <View style={styles.historyHeading}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>Payment history</Text>
                <Text style={styles.muted}>{data.payments.length} {data.payments.length === 1 ? "record" : "records"}</Text>
              </View>
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>No payments recorded yet.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.historyRow} accessibilityRole="button"
              accessibilityHint="Opens payment details" onPress={() => viewPayment(item)}>
              <View style={styles.rowCopy}>
                <Text style={styles.amount}>{formatPhilippinePeso(Number(item.amount))}</Text>
                <Text style={styles.muted}>{formatDate(item.createdAt)} · {paymentMethod(item)}</Text>
                {item.referenceNumber ? <Text numberOfLines={1} style={styles.reference}>{item.referenceNumber}</Text> : null}
              </View>
              <PaymentStatus status={item.status} />
              <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

export function FuneralLifeCyclePaymentDetailsScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const shopId = user?.uid;
  const paymentId = typeof route.params?.paymentId === "string" ? route.params.paymentId : "";
  const [record, setRecord] = useState<{ payment: ShopPayment; shopId: string; shopName: string } | null>(null);
  const [error, setError] = useState("");
  const requestNumber = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    if (!shopId || !paymentId) {
      setError("Payment record unavailable.");
      return;
    }
    try {
      const [payment, shop] = await Promise.all([
        supabase.from("shop_payments").select(PAYMENT_FIELDS).eq("shopId", shopId).eq("id", paymentId).maybeSingle(),
        supabase.from("funeral_shops").select("shopName").eq("id", shopId).maybeSingle(),
      ]);
      if (request !== requestNumber.current) return;
      if (payment.error || !payment.data) {
        setError("Could not load this payment record.");
        return;
      }
      setRecord({ payment: payment.data as ShopPayment, shopId, shopName: shop.data?.shopName || "Funeral shop" });
      setError("");
    } catch {
      if (request === requestNumber.current) setError("Could not load this payment record.");
    }
  }, [paymentId, shopId]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestNumber.current += 1; };
  }, [load]));
  useRealtimeRefresh(shopId && paymentId ? [{ table: "shop_payments", filter: `id=eq.${paymentId}` }] : [], load, Boolean(shopId && paymentId));

  const data = record?.shopId === shopId && record?.payment.id === paymentId ? record : null;
  const payment = data?.payment;
  const paid = payment?.status === "verified";
  return (
    <SafeAreaView style={styles.screen}>
      <PaymentHeader title={paid ? "Payment receipt" : "Payment details"} onBack={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("LifeCyclePayments")} />
      {!data || !payment ? (
        error ? <PaymentLoadError message={error} retry={() => void load()} /> : <LoadingStatus label="Loading payment details" />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <View style={styles.summaryTop}>
              <Text style={styles.receiptAmount}>{formatPhilippinePeso(Number(payment.amount))}</Text>
              <PaymentStatus status={payment.status} />
            </View>
            <DetailLine label="Shop" value={data.shopName} />
            {paid ? <DetailLine label="Receipt no." value={`#LC-${payment.id.replace(/-/g, "").slice(0, 10).toUpperCase()}`} /> : null}
            <DetailLine label="Payment method" value={paymentMethod(payment)} />
            <DetailLine label="Reference" value={payment.referenceNumber || "—"} />
            <DetailLine label="Date" value={formatDate(payment.verifiedAt || payment.createdAt, true)} />
            {paid && payment.expiresAt ? <DetailLine label="Valid through" value={formatDate(payment.expiresAt)} /> : null}
            {payment.rejectionReason ? <Text style={styles.failedText}>{payment.rejectionReason}</Text> : null}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { alignItems: "center", flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { flex: 1, color: colors.textStrong, fontWeight: "700", fontSize: 19 },
  content: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 16, paddingBottom: 24 },
  card: { padding: 16, gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 10 },
  summaryTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  sectionTitle: { color: colors.textStrong, fontSize: 17, fontWeight: "700" },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  detailLine: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  detailValue: { flexShrink: 1, color: colors.textStrong, fontSize: 13, fontWeight: "600", textAlign: "right" },
  historyHeading: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "baseline", paddingTop: 22, paddingBottom: 10 },
  historyRow: { minHeight: 72, flexDirection: "row", gap: 9, alignItems: "center", padding: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, marginBottom: 8 },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  amount: { color: colors.textStrong, fontWeight: "700", fontSize: 15 },
  receiptAmount: { flexShrink: 1, color: colors.textStrong, fontWeight: "700", fontSize: 25 },
  reference: { color: colors.textMuted, fontSize: 12 },
  badge: { paddingVertical: 4, paddingHorizontal: 7, borderRadius: 10 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  paidBadge: { backgroundColor: "#e7f5ec" },
  paidText: { color: "#166534", fontWeight: "600" },
  pendingBadge: { backgroundColor: "#fff4d7" },
  pendingText: { color: "#765323", fontWeight: "600" },
  failedBadge: { backgroundColor: "#fee2e2" },
  failedText: { color: "#991b1b" },
  empty: { color: colors.textMuted, backgroundColor: colors.surface, borderRadius: 8, textAlign: "center", padding: 20 },
  primaryButton: { minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: 6, backgroundColor: colors.primary },
  primaryText: { fontSize: 14, color: "#fff", fontWeight: "700" },
  disabledButton: { opacity: 0.55 },
  secondaryButton: { minHeight: 44, justifyContent: "center", alignItems: "center", borderColor: colors.border, borderWidth: 1, borderRadius: 6 },
  actionText: { fontSize: 14, color: colors.primary, fontWeight: "700" },
  loadError: { padding: 16, alignItems: "center", gap: 8 },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
});
