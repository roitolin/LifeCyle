import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton } from "@/components";
import LoadingBird from "@/components/LoadingBird";
import { auth } from "@/services";
import { supabase } from "@/services/supabaseClient";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { colors, radii, spacing } from "@/theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type PaymentFilter = "all" | "review" | "verified";
type PaymentRequest = {
  id: string;
  requesterId: string;
  shopId: string;
  productName?: string;
  deceasedFullName?: string;
  familyCoordinatorName?: string;
  status: string;
  paymentAmount?: number | string | null;
  paymentPayerName?: string | null;
  paymentReferenceNumber?: string | null;
  paymentProofImageUrl?: string | null;
  paymentSubmittedAt?: string | null;
  paymentVerifiedAt?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
};

function getPaymentStatus(request: PaymentRequest) {
  const status = String(request.status || "").toLowerCase();
  if (status === "payment_submitted") {
    return { label: "Needs review", icon: "time-outline" as IoniconName, background: "#fff0dc", color: "#934b16" };
  }
  if (request.paymentVerifiedAt || ["payment_verified", "awaiting_customer_confirmation", "completed"].includes(status)) {
    return { label: "Verified", icon: "checkmark-circle-outline" as IoniconName, background: "#e3f3e8", color: "#236441" };
  }
  return { label: "Submitted", icon: "receipt-outline" as IoniconName, background: "#e8eef5", color: "#3f5f7d" };
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Recently submitted";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recently submitted";
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function FuneralShopPaymentsScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPayments = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      let userId = auth.currentUser?.uid || null;
      if (!userId) {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        userId = sessionData.session?.user?.id || null;
      }
      if (!userId) {
        setRequests([]);
        return;
      }
      const { data, error } = await supabase
        .from("funeral_service_requests")
        .select("*")
        .eq("shopId", userId)
        .order("paymentSubmittedAt", { ascending: false, nullsFirst: false });
      if (error) throw error;
      setRequests(((data || []) as PaymentRequest[]).filter((item) => {
        const status = String(item.status || "").toLowerCase();
        return Boolean(item.paymentProofImageUrl || item.paymentSubmittedAt) ||
          ["payment_submitted", "payment_verified", "awaiting_customer_confirmation", "completed"].includes(status);
      }));
    } catch (error: any) {
      setLoadError(error?.message || "Payments could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadPayments(); }, [loadPayments]));

  const reviewCount = useMemo(
    () => requests.filter((item) => String(item.status || "").toLowerCase() === "payment_submitted").length,
    [requests]
  );
  const verifiedCount = useMemo(() => requests.filter((item) => getPaymentStatus(item).label === "Verified").length, [requests]);
  const visibleRequests = useMemo(() => {
    if (filter === "review") return requests.filter((item) => String(item.status || "").toLowerCase() === "payment_submitted");
    if (filter === "verified") return requests.filter((item) => getPaymentStatus(item).label === "Verified");
    return requests;
  }, [filter, requests]);

  const handleBack = () => {
    if (navigation.canGoBack?.()) navigation.goBack();
    else navigation.navigate("ShopCenter");
  };

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.headerSafeArea}>
        <View style={styles.headerBar}>
          <AppBackButton onPress={handleBack} />
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Family Payments</Text>
          </View>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.body}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPayments(true)} tintColor="#22312d" />}
        >
          <View style={styles.summaryCard}>
            <View style={styles.summaryIcon}><Ionicons name="wallet-outline" size={24} color="#ffffff" /></View>
            <Text style={styles.summaryTitle}>Review family receipts</Text>
            <Text style={styles.summaryText}>Check the sender, account, reference number, and proof before verifying a payment.</Text>
            <View style={styles.summaryStats}>
              {[
                { value: reviewCount, label: "Need review" },
                { value: verifiedCount, label: "Verified" },
                { value: requests.length, label: "Total" },
              ].map((stat, index) => (
                <View key={stat.label} style={styles.summaryStatWrap}>
                  {index > 0 ? <View style={styles.summaryDivider} /> : null}
                  <View style={styles.summaryStat}>
                    <Text style={styles.summaryStatValue}>{stat.value}</Text>
                    <Text style={styles.summaryStatLabel}>{stat.label}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {([
              { key: "all", label: `All (${requests.length})` },
              { key: "review", label: `Needs review (${reviewCount})` },
              { key: "verified", label: `Verified (${verifiedCount})` },
            ] as { key: PaymentFilter; label: string }[]).map((item) => (
              <TouchableOpacity key={item.key} style={[styles.filterChip, filter === item.key ? styles.filterChipActive : null]} onPress={() => setFilter(item.key)}>
                <Text style={[styles.filterChipText, filter === item.key ? styles.filterChipTextActive : null]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loading ? (
            <View style={styles.loadingWrap}><LoadingBird /></View>
          ) : loadError ? (
            <View style={styles.emptyCard}>
              <Ionicons name="cloud-offline-outline" size={28} color="#9b403b" />
              <Text style={styles.emptyTitle}>Payments unavailable</Text>
              <Text style={styles.emptyText}>{loadError}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void loadPayments()}><Text style={styles.retryButtonText}>Try Again</Text></TouchableOpacity>
            </View>
          ) : visibleRequests.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="receipt-outline" size={28} color="#8b938c" />
              <Text style={styles.emptyTitle}>{filter === "all" ? "No family payments yet" : "Nothing in this filter"}</Text>
              <Text style={styles.emptyText}>Submitted payment receipts will appear here for review.</Text>
            </View>
          ) : visibleRequests.map((item) => {
            const statusMeta = getPaymentStatus(item);
            const needsReview = String(item.status || "").toLowerCase() === "payment_submitted";
            return (
              <TouchableOpacity
                key={item.id}
                activeOpacity={0.9}
                style={[styles.paymentCard, needsReview ? styles.paymentCardReview : null]}
                onPress={() => navigation.navigate("ShopPaymentReceipt", { request: item })}
              >
                <View style={styles.paymentTopRow}>
                  <View style={styles.paymentTitleBlock}>
                    <Text style={styles.paymentProduct} numberOfLines={1}>{item.productName || "Funeral service"}</Text>
                    <Text style={styles.paymentFor} numberOfLines={1}>For {item.deceasedFullName || "family service"}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
                    <Ionicons name={statusMeta.icon} size={13} color={statusMeta.color} />
                    <Text style={[styles.statusBadgeText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
                  </View>
                </View>
                <Text style={styles.paymentAmount}>{Number(item.paymentAmount) > 0 ? formatPhilippinePeso(String(item.paymentAmount)) : "Amount not provided"}</Text>
                <View style={styles.paymentMetaCard}>
                  <View style={styles.paymentMetaLine}><Ionicons name="person-outline" size={15} color="#71807a" /><Text style={styles.paymentMetaText}>{item.paymentPayerName || item.familyCoordinatorName || "Unknown sender"}</Text></View>
                  <View style={styles.paymentMetaLine}><Ionicons name="time-outline" size={15} color="#71807a" /><Text style={styles.paymentMetaText}>{formatTimestamp(item.paymentSubmittedAt || item.createdAt)}</Text></View>
                  {item.paymentReferenceNumber ? <View style={styles.paymentMetaLine}><Ionicons name="key-outline" size={15} color="#71807a" /><Text style={styles.paymentMetaText}>Reference {item.paymentReferenceNumber}</Text></View> : null}
                </View>
                <View style={styles.paymentFooter}>
                  <View style={styles.proofIndicator}>
                    <Ionicons name={item.paymentProofImageUrl ? "image-outline" : "alert-circle-outline"} size={15} color={item.paymentProofImageUrl ? "#2f6b55" : "#9b403b"} />
                    <Text style={[styles.proofIndicatorText, !item.paymentProofImageUrl ? styles.proofIndicatorMissing : null]}>{item.paymentProofImageUrl ? "Receipt available" : "Receipt missing"}</Text>
                  </View>
                  <View style={styles.openPaymentButton}><Text style={styles.openPaymentButtonText}>View Receipt</Text><Ionicons name="chevron-forward" size={16} color="#ffffff" /></View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceMuted },
  body: { flex: 1 },
  headerSafeArea: { backgroundColor: "#f8f6f2" },
  headerBar: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#d9d6cd" },
  headerCopy: { flex: 1 },
  headerTitle: { color: "#22312d", fontSize: 20, fontWeight: "900" },
  content: { padding: spacing.lg, paddingBottom: 36, gap: spacing.md },
  summaryCard: { borderRadius: 26, backgroundColor: "#22312d", padding: 18 },
  summaryIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.13)" },
  summaryTitle: { color: "#ffffff", fontSize: 23, lineHeight: 29, fontWeight: "900", marginTop: 16 },
  summaryText: { color: "#d3ddd9", fontSize: 13, lineHeight: 19, marginTop: 7 },
  summaryStats: { flexDirection: "row", borderRadius: 17, backgroundColor: "rgba(255,255,255,0.09)", marginTop: 17, paddingVertical: 12 },
  summaryStatWrap: { flex: 1, flexDirection: "row", alignItems: "center" },
  summaryStat: { flex: 1, alignItems: "center" },
  summaryDivider: { width: 1, height: 32, backgroundColor: "rgba(255,255,255,0.14)" },
  summaryStatValue: { color: "#ffffff", fontSize: 20, fontWeight: "900" },
  summaryStatLabel: { color: "#c6d1cd", fontSize: 10, fontWeight: "700", marginTop: 2 },
  filterRow: { gap: 8, paddingRight: 4 },
  filterChip: { minHeight: 38, borderRadius: 999, borderWidth: 1, borderColor: "#d6d2c9", backgroundColor: "#ffffff", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  filterChipActive: { backgroundColor: "#516961", borderColor: "#516961" },
  filterChipText: { color: "#62706b", fontSize: 12, fontWeight: "900" },
  filterChipTextActive: { color: "#ffffff" },
  loadingWrap: { minHeight: 220, alignItems: "center", justifyContent: "center" },
  emptyCard: { minHeight: 220, borderRadius: 24, borderWidth: 1, borderColor: "#d9d6cd", backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", padding: 24 },
  emptyTitle: { color: "#22312d", fontSize: 18, fontWeight: "900", marginTop: 11 },
  emptyText: { color: "#687570", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 5 },
  retryButton: { minHeight: 40, borderRadius: 13, backgroundColor: "#22312d", justifyContent: "center", paddingHorizontal: 16, marginTop: 15 },
  retryButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  paymentCard: { borderRadius: radii.xl, borderWidth: 1, borderColor: colors.borderWarm, backgroundColor: colors.surface, padding: spacing.lg },
  paymentCardReview: { borderColor: "#e3b88f", backgroundColor: "#fffdf9" },
  paymentTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  paymentTitleBlock: { flex: 1, minWidth: 0 },
  paymentProduct: { color: "#22312d", fontSize: 16, fontWeight: "900" },
  paymentFor: { color: "#77817c", fontSize: 12, fontWeight: "700", marginTop: 3 },
  statusBadge: { maxWidth: 112, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 6 },
  statusBadgeText: { fontSize: 10, fontWeight: "900" },
  paymentAmount: { color: "#2d6752", fontSize: 23, fontWeight: "900", marginTop: 14 },
  paymentMetaCard: { borderRadius: 15, backgroundColor: "#f4f2ed", padding: 11, gap: 7, marginTop: 12 },
  paymentMetaLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  paymentMetaText: { flex: 1, color: "#5e6b66", fontSize: 11, fontWeight: "700" },
  paymentFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderTopWidth: 1, borderTopColor: "#ebe7df", paddingTop: 12, marginTop: 13 },
  proofIndicator: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  proofIndicatorText: { color: "#2f6b55", fontSize: 11, fontWeight: "800" },
  proofIndicatorMissing: { color: "#9b403b" },
  openPaymentButton: { minHeight: 36, borderRadius: 12, backgroundColor: "#22312d", flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 12 },
  openPaymentButtonText: { color: "#ffffff", fontSize: 11, fontWeight: "900" },
});
