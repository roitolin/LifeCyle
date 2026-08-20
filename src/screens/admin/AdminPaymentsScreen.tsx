import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Button, Card, SegmentedButtons, Text } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { uploadCertificate } from "@/services";
import { createNotification } from "@/utils/supabaseNotifications";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { useResponsive } from "@/utils/responsive";

type PaymentStatus = "pending" | "verified" | "rejected";

type PaymentSubmission = {
  id: string;
  shopId: string;
  payerName: string;
  gcashName: string;
  gcashNumber: string;
  referenceNumber: string;
  amount: number;
  proofImageUrl: string;
  status: PaymentStatus;
  createdAt: string;
  verifiedAt: string | null;
  expiresAt: string | null;
  rejectionReason: string | null;
  shopName: string;
  ownerName: string;
  ownerEmail: string;
};

const PAYMENT_SETTING_KEY = "payment_qr_code";

function formatDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString([], {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function addMonth(value: Date) {
  const next = new Date(value);
  next.setMonth(next.getMonth() + 1);
  return next;
}

function statusMeta(status: PaymentStatus) {
  if (status === "verified") return { label: "Verified", background: "#dcfce7", color: "#166534" };
  if (status === "rejected") return { label: "Rejected", background: "#fee2e2", color: "#991b1b" };
  return { label: "Pending", background: "#fef3c7", color: "#92400e" };
}

export default function AdminPaymentsScreen() {
  const { isDesktop } = useResponsive();
  const [tab, setTab] = useState<"submissions" | "setup">("submissions");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState("");
  const [payments, setPayments] = useState<PaymentSubmission[]>([]);
  const [selected, setSelected] = useState<PaymentSubmission | null>(null);
  const [rejecting, setRejecting] = useState<PaymentSubmission | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrDraftUri, setQrDraftUri] = useState<string | null>(null);
  const [feeAmount, setFeeAmount] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [settingResult, paymentsResult] = await Promise.all([
        supabase.from("settings").select('value, "updatedAt"').eq("key", PAYMENT_SETTING_KEY).maybeSingle(),
        supabase
          .from("shop_payments")
          .select(`
            *,
            users!shop_payments_shopId_fkey (
              email, "fullName",
              funeral_shops!funeral_shops_id_fkey ( shopName )
            )
          `)
          .order("createdAt", { ascending: false }),
      ]);
      if (settingResult.error) throw settingResult.error;
      if (paymentsResult.error) throw paymentsResult.error;

      const setting = (settingResult.data?.value || {}) as { imageUrl?: string; feeAmount?: number };
      setQrUrl(setting.imageUrl?.trim() || null);
      setQrDraftUri(null);
      setFeeAmount(Number(setting.feeAmount) > 0 ? String(setting.feeAmount) : "");
      setUpdatedAt(settingResult.data?.updatedAt || null);

      setPayments((paymentsResult.data || []).map((row: any) => {
        const owner = Array.isArray(row.users) ? row.users[0] : row.users;
        const shop = Array.isArray(owner?.funeral_shops) ? owner.funeral_shops[0] : owner?.funeral_shops;
        return {
          id: row.id,
          shopId: row.shopId || "",
          payerName: row.payerName || "",
          gcashName: row.gcashName || "",
          gcashNumber: row.gcashNumber || "",
          referenceNumber: row.referenceNumber || "",
          amount: Number(row.amount) || 0,
          proofImageUrl: row.proofImageUrl || "",
          status: (row.status || "pending") as PaymentStatus,
          createdAt: row.createdAt || "",
          verifiedAt: row.verifiedAt || null,
          expiresAt: row.expiresAt || null,
          rejectionReason: row.rejectionReason || null,
          shopName: shop?.shopName || "Unnamed shop",
          ownerName: owner?.fullName || "",
          ownerEmail: owner?.email || "",
        };
      }));
    } catch (error: any) {
      Alert.alert("Unable to Load Payments", error?.message || "Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const channel = supabase
      .channel("admin-shop-payments-mobile")
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_payments" }, () => void loadData())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadData]);

  const pendingCount = useMemo(() => payments.filter((item) => item.status === "pending").length, [payments]);
  const shownPayments = useMemo(
    () => [...payments].sort((a, b) => (a.status === "pending" ? -1 : b.status === "pending" ? 1 : 0)),
    [payments]
  );

  const chooseQr = async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.85 });
    if (!picker.canceled && picker.assets[0]) setQrDraftUri(picker.assets[0].uri);
  };

  const saveSettings = async () => {
    const parsedFee = Number(String(feeAmount).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(parsedFee) || parsedFee <= 0) {
      Alert.alert("Invalid Amount", "Enter a registration fee greater than zero.");
      return;
    }
    if (!qrDraftUri && !qrUrl) {
      Alert.alert("QR Code Required", "Attach the admin payment QR code before saving.");
      return;
    }
    setSaving(true);
    try {
      const finalQrUrl = qrDraftUri ? await uploadCertificate(qrDraftUri) : qrUrl;
      const now = new Date().toISOString();
      const { error } = await supabase.from("settings").upsert(
        { key: PAYMENT_SETTING_KEY, value: { imageUrl: finalQrUrl, feeAmount: parsedFee }, updatedAt: now },
        { onConflict: "key" }
      );
      if (error) throw error;
      setQrUrl(finalQrUrl);
      setQrDraftUri(null);
      setUpdatedAt(now);
      Alert.alert("Payment Settings Saved", "Verified shops can now use this QR code to submit payments.");
    } catch (error: any) {
      Alert.alert("Save Failed", error?.message || "Unable to save payment settings.");
    } finally {
      setSaving(false);
    }
  };

  const verifyPayment = (payment: PaymentSubmission) => {
    Alert.alert(
      "Verify Payment?",
      `Confirm ${formatPhilippinePeso(String(payment.amount))} from ${payment.shopName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Verify",
          onPress: async () => {
            setSelected(null);
            setReviewingId(payment.id);
            try {
              const now = new Date();
              const { data, error } = await supabase
                .from("shop_payments")
                .update({
                  status: "verified",
                  verifiedAt: now.toISOString(),
                  expiresAt: addMonth(now).toISOString(),
                  rejectionReason: null,
                })
                .eq("id", payment.id)
                .eq("status", "pending")
                .select("id")
                .maybeSingle();
              if (error) throw error;
              if (!data) throw new Error("This payment was already reviewed.");
              try {
                await createNotification({
                  userId: payment.shopId,
                  type: "shop_payment_verified",
                  title: "Registration Payment Verified",
                  body: "Your payment was verified. You can now make your shop live.",
                  data: { paymentId: payment.id },
                });
              } catch (notificationError) {
                console.warn("Payment verified, but the shop notification could not be created:", notificationError);
              }
              await loadData();
              Alert.alert("Payment Verified", "The shop can now go live.");
            } catch (error: any) {
              Alert.alert("Review Failed", error?.message || "Unable to verify this payment.");
            } finally {
              setReviewingId("");
            }
          },
        },
      ]
    );
  };

  const rejectPayment = async () => {
    if (!rejecting || reviewingId) return;
    const reason = rejectReason.trim();
    if (!reason) {
      Alert.alert("Reason Required", "Explain why the payment proof could not be verified.");
      return;
    }
    const payment = rejecting;
    setReviewingId(payment.id);
    try {
      const { data, error } = await supabase
        .from("shop_payments")
        .update({ status: "rejected", rejectionReason: reason, verifiedAt: null, expiresAt: null })
        .eq("id", payment.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("This payment was already reviewed.");
      try {
        await createNotification({
          userId: payment.shopId,
          type: "shop_payment_rejected",
          title: "Registration Payment Needs Review",
          body: `The admin could not verify your payment: ${reason}`,
          data: { paymentId: payment.id, rejectionReason: reason },
        });
      } catch (notificationError) {
        console.warn("Payment rejected, but the shop notification could not be created:", notificationError);
      }
      setRejecting(null);
      setSelected(null);
      setRejectReason("");
      await loadData();
      Alert.alert("Payment Rejected", "The shop was notified and can submit corrected details.");
    } catch (error: any) {
      Alert.alert("Review Failed", error?.message || "Unable to reject this payment.");
    } finally {
      setReviewingId("");
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color="#b91c1c" />
        <Text style={styles.muted}>Loading shop payments...</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void loadData(); }}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <Card style={styles.hero} mode="elevated">
          <Card.Content>
            <View style={styles.heroRow}>
              <View style={styles.heroIcon}><Ionicons name="wallet-outline" size={24} color="#991b1b" /></View>
              <View style={styles.flex}>
                <Text variant="titleLarge" style={styles.title}>Shop Payments</Text>
                <Text style={styles.muted}>Manage the QR code and review registration payments from funeral shops.</Text>
              </View>
              <View style={styles.countBadge}><Text style={styles.countText}>{pendingCount}</Text></View>
            </View>
          </Card.Content>
        </Card>

        <SegmentedButtons
          value={tab}
          onValueChange={(value) => setTab(value as "submissions" | "setup")}
          buttons={[
            { value: "submissions", label: `Submissions (${pendingCount})`, icon: "receipt" },
            { value: "setup", label: "Payment Setup", icon: "qrcode" },
          ]}
        />

        {tab === "setup" ? (
          <Card style={styles.card} mode="elevated">
            <Card.Title title="Admin Payment Details" subtitle={`Last updated: ${formatDate(updatedAt)}`} />
            <Card.Content>
              <Text style={styles.label}>Registration fee (₱)</Text>
              <TextInput
                style={styles.input}
                value={feeAmount}
                onChangeText={setFeeAmount}
                keyboardType="decimal-pad"
                placeholder="Enter amount"
                placeholderTextColor="#9ca3af"
              />
              <Text style={styles.label}>Payment QR code</Text>
              <TouchableOpacity style={styles.qrPicker} onPress={chooseQr} disabled={saving}>
                {qrDraftUri || qrUrl ? (
                  <Image source={{ uri: qrDraftUri || qrUrl || "" }} style={styles.qrImage} resizeMode="contain" />
                ) : (
                  <View style={styles.qrEmpty}>
                    <Ionicons name="qr-code-outline" size={46} color="#9ca3af" />
                    <Text style={styles.muted}>Tap to attach a QR code</Text>
                  </View>
                )}
              </TouchableOpacity>
              <Button mode="outlined" icon="image" onPress={chooseQr} disabled={saving} style={styles.actionButton}>
                {qrDraftUri || qrUrl ? "Replace QR Code" : "Choose QR Code"}
              </Button>
              <Button mode="contained" icon="content-save" onPress={saveSettings} loading={saving} disabled={saving} buttonColor="#b91c1c">
                Save Payment Settings
              </Button>
            </Card.Content>
          </Card>
        ) : shownPayments.length === 0 ? (
          <Card style={styles.card} mode="elevated">
            <Card.Content style={styles.emptyState}>
              <Ionicons name="receipt-outline" size={40} color="#9ca3af" />
              <Text variant="titleMedium">No payment submissions yet</Text>
              <Text style={styles.muted}>Shop payment proofs will appear here for review.</Text>
            </Card.Content>
          </Card>
        ) : (
          shownPayments.map((payment) => {
            const meta = statusMeta(payment.status);
            return (
              <TouchableOpacity key={payment.id} activeOpacity={0.85} onPress={() => setSelected(payment)}>
                <Card style={styles.card} mode="elevated">
                  <Card.Content>
                    <View style={styles.rowBetween}>
                      <View style={styles.flex}>
                        <Text variant="titleMedium" style={styles.shopName}>{payment.shopName}</Text>
                        <Text style={styles.muted}>{payment.ownerName || payment.ownerEmail || payment.payerName}</Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: meta.background }]}>
                        <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                    </View>
                    <View style={styles.paymentSummary}>
                      <Text style={styles.amount}>{formatPhilippinePeso(String(payment.amount))}</Text>
                      <Text style={styles.muted}>{formatDate(payment.createdAt)}</Text>
                    </View>
                    {payment.rejectionReason ? <Text style={styles.rejectionText}>Reason: {payment.rejectionReason}</Text> : null}
                    <Button mode="text" onPress={() => setSelected(payment)}>View payment details</Button>
                  </Card.Content>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <Modal visible={Boolean(selected)} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.rowBetween}>
                <Text variant="titleLarge" style={styles.title}>Payment Details</Text>
                <TouchableOpacity onPress={() => setSelected(null)} style={styles.closeButton}>
                  <Ionicons name="close" size={22} color="#374151" />
                </TouchableOpacity>
              </View>
              {selected ? (
                <>
                  <Text style={styles.detailLabel}>Shop</Text><Text style={styles.detailValue}>{selected.shopName}</Text>
                  <Text style={styles.detailLabel}>Sender name</Text><Text style={styles.detailValue}>{selected.payerName || "—"}</Text>
                  <Text style={styles.detailLabel}>GCash account name</Text><Text style={styles.detailValue}>{selected.gcashName || "—"}</Text>
                  <Text style={styles.detailLabel}>GCash number</Text><Text style={styles.detailValue}>{selected.gcashNumber || "—"}</Text>
                  <Text style={styles.detailLabel}>Reference number</Text><Text style={styles.detailValue}>{selected.referenceNumber || "—"}</Text>
                  <Text style={styles.detailLabel}>Amount</Text><Text style={styles.detailValue}>{formatPhilippinePeso(String(selected.amount))}</Text>
                  <Text style={styles.detailLabel}>Submitted</Text><Text style={styles.detailValue}>{formatDate(selected.createdAt)}</Text>
                  {selected.rejectionReason ? <Text style={styles.rejectionText}>Reason: {selected.rejectionReason}</Text> : null}
                  <Text style={styles.detailLabel}>Proof of payment</Text>
                  {selected.proofImageUrl ? (
                    <Image source={{ uri: selected.proofImageUrl }} style={styles.proofImage} resizeMode="contain" />
                  ) : <Text style={styles.muted}>No proof image attached.</Text>}
                  {selected.status === "pending" ? (
                    <View style={styles.reviewActions}>
                      <Button
                        mode="outlined"
                        textColor="#991b1b"
                        onPress={() => {
                          const payment = selected;
                          setSelected(null);
                          setRejectReason("");
                          setRejecting(payment);
                        }}
                        disabled={Boolean(reviewingId)}
                      >
                        Reject
                      </Button>
                      <Button
                        mode="contained"
                        buttonColor="#15803d"
                        onPress={() => verifyPayment(selected)}
                        loading={reviewingId === selected.id}
                        disabled={Boolean(reviewingId)}
                      >
                        Verify Payment
                      </Button>
                    </View>
                  ) : null}
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(rejecting)} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.rejectCard}>
            <Text variant="titleLarge" style={styles.title}>Reject Payment</Text>
            <Text style={styles.muted}>Tell the shop exactly what needs to be corrected.</Text>
            <TextInput
              style={[styles.input, styles.reasonInput]}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Example: The reference number is not visible in the screenshot."
              placeholderTextColor="#9ca3af"
              multiline
              autoFocus
            />
            <View style={styles.reviewActions}>
              <Button mode="text" onPress={() => setRejecting(null)} disabled={Boolean(reviewingId)}>Cancel</Button>
              <Button
                mode="contained"
                buttonColor="#b91c1c"
                onPress={() => void rejectPayment()}
                loading={Boolean(reviewingId)}
                disabled={!rejectReason.trim() || Boolean(reviewingId)}
              >
                Reject & Notify Shop
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  contentDesktop: { width: "100%", maxWidth: 980, alignSelf: "center" },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f5f5f5" },
  hero: { borderRadius: 16, backgroundColor: "#fff7f7" },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#fee2e2" },
  title: { color: "#7f1d1d", fontWeight: "900" },
  muted: { color: "#6b7280", lineHeight: 19 },
  flex: { flex: 1 },
  countBadge: { minWidth: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#b91c1c" },
  countText: { color: "#fff", fontWeight: "900" },
  card: { borderRadius: 14, backgroundColor: "#fff" },
  label: { marginTop: 8, marginBottom: 6, color: "#374151", fontWeight: "800" },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, color: "#111827", backgroundColor: "#fff", marginBottom: 12 },
  qrPicker: { minHeight: 220, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#d1d5db", borderRadius: 16, backgroundColor: "#fafafa", overflow: "hidden", marginBottom: 10 },
  qrImage: { width: "100%", height: 240, backgroundColor: "#fff" },
  qrEmpty: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: 10 },
  actionButton: { marginBottom: 10 },
  emptyState: { alignItems: "center", gap: 8, paddingVertical: 28 },
  rowBetween: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  shopName: { color: "#1f2937", fontWeight: "900" },
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  paymentSummary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  amount: { color: "#111827", fontSize: 18, fontWeight: "900" },
  rejectionText: { marginTop: 10, color: "#991b1b", fontWeight: "700", lineHeight: 19 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(17,24,39,0.58)", alignItems: "center", justifyContent: "center", padding: 18 },
  modalCard: { width: "100%", maxWidth: 620, maxHeight: "90%", borderRadius: 20, backgroundColor: "#fff", overflow: "hidden" },
  modalContent: { padding: 20 },
  rejectCard: { width: "100%", maxWidth: 520, borderRadius: 20, backgroundColor: "#fff", padding: 20 },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#f3f4f6" },
  detailLabel: { marginTop: 13, color: "#9a6767", fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  detailValue: { marginTop: 3, color: "#1f2937", fontSize: 15, fontWeight: "700" },
  proofImage: { width: "100%", height: 300, marginTop: 8, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 14, backgroundColor: "#fafafa" },
  reviewActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 18, flexWrap: "wrap" },
  reasonInput: { minHeight: 110, marginTop: 14, textAlignVertical: "top" },
});
