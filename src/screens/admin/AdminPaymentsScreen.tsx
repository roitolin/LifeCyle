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
import { Button, Card, SegmentedButtons, Text } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { createNotification } from "@/utils/supabaseNotifications";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { useResponsive } from "@/utils/responsive";
import AdminSettlementCard from "./AdminSettlementCard";

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
  paymentProvider: "manual" | "legacy" | "xendit";
  providerPaymentId: string | null;
  providerPaymentMethod: string | null;
};

const PAYMENT_SETTING_KEY = "shop_payment_settings";

const PAYMENT_LOGOS: Record<string, any> = {
  PH_GCASH: require("../../../assets/Payment Logos/Gcash_Logo.png"),
  PH_MAYA: require("../../../assets/Payment Logos/PayMaya_Logo.png"),
  PH_BDO: require("../../../assets/Payment Logos/BDO_Logo.png"),
  PH_BPI: require("../../../assets/Payment Logos/BPI_Logo.png"),
  PH_METROBANK: require("../../../assets/Payment Logos/MetroBank_Logo.png"),
  PH_LANDBANK: require("../../../assets/Payment Logos/Landbank_logo.png"),
  PH_CHINABANK: require("../../../assets/Payment Logos/Chinabank_Logo.png"),
};

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
  if (status === "verified") return { label: "Payment Confirmed", background: "#e8f5ec", color: "#166534", border: "#bbf7d0" };
  if (status === "rejected") return { label: "Needs correction", background: "#fee2e2", color: "#991b1b", border: "#fecaca" };
  return { label: "Needs review", background: "#fef3c7", color: "#92400e", border: "#fde68a" };
}

function getPaymentMethodInfo(payment: PaymentSubmission) {
  const rawMethod = payment.providerPaymentMethod?.trim().toUpperCase() || "";
  const logo = (rawMethod && PAYMENT_LOGOS[rawMethod])
    || (payment.gcashNumber || payment.gcashName ? PAYMENT_LOGOS.PH_GCASH : null);

  let label = "Online payment";
  if (rawMethod === "PH_GCASH") label = "GCash";
  else if (rawMethod === "PH_MAYA") label = "Maya";
  else if (rawMethod === "PH_BDO") label = "BDO";
  else if (rawMethod === "PH_BPI") label = "BPI";
  else if (rawMethod === "PH_METROBANK") label = "Metrobank";
  else if (rawMethod === "PH_LANDBANK") label = "LandBank";
  else if (rawMethod === "PH_CHINABANK") label = "Chinabank";
  else if (rawMethod) label = rawMethod.replace(/^PH_/i, "").replace(/_/g, " ");
  else if (payment.gcashNumber || payment.gcashName) label = "GCash";
  else if (payment.paymentProvider === "manual") label = "Manual transfer";

  return { label, logo };
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
  const [feeAmount, setFeeAmount] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [proofZoom, setProofZoom] = useState(false);

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

      const setting = (settingResult.data?.value || {}) as { feeAmount?: number };
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
          paymentProvider: row.paymentProvider === "xendit"
            ? "xendit"
            : row.paymentProvider === "manual"
              ? "manual"
              : "legacy",
          providerPaymentId: row.providerPaymentId || null,
          providerPaymentMethod: row.providerPaymentMethod || null,
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

  const pendingCount = useMemo(() => payments.filter((item) => item.status === "pending" && item.paymentProvider === "manual").length, [payments]);
  const verifiedCount = useMemo(() => payments.filter((item) => item.status === "verified").length, [payments]);
  const verifiedTotal = useMemo(() => payments.filter((item) => item.status === "verified").reduce((sum, p) => sum + p.amount, 0), [payments]);

  const shownPayments = useMemo(
    () => [...payments].sort((a, b) => (a.status === "pending" ? -1 : b.status === "pending" ? 1 : 0)),
    [payments]
  );

  const saveSettings = async () => {
    const parsedFee = Number(String(feeAmount).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(parsedFee) || parsedFee <= 0) {
      Alert.alert("Invalid Amount", "Enter a registration fee greater than zero.");
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from("settings").upsert(
        { key: PAYMENT_SETTING_KEY, value: { feeAmount: parsedFee }, updatedAt: now },
        { onConflict: "key" }
      );
      if (error) throw error;
      setUpdatedAt(now);
      Alert.alert("Payment Settings Saved", "Verified shops can now pay this fee securely through online checkout.");
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
        <ActivityIndicator size="large" color="#22312d" />
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
        <View style={styles.heroBanner}>
          <View style={styles.heroRow}>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroKicker}>LifeCycle Platform</Text>
              <Text style={styles.title}>Shop Payments</Text>
              <Text style={styles.subtitle}>Review seller registration fees and manage online billing.</Text>
            </View>
            <View style={styles.statusPill}>
              <View style={[styles.statusDot, { backgroundColor: Number(feeAmount) > 0 ? "#16a34a" : "#94a3b8" }]} />
              <Text style={styles.statusPillText}>{Number(feeAmount) > 0 ? "Active" : "Fee Required"}</Text>
            </View>
          </View>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Needs review</Text>
              <Text style={styles.summaryValue}>{pendingCount}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Verified</Text>
              <Text style={styles.summaryValue}>{verifiedCount}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Verified total</Text>
              <Text style={styles.summaryValue}>{verifiedTotal > 0 ? formatPhilippinePeso(String(verifiedTotal)) : "—"}</Text>
            </View>
          </View>
        </View>

        <SegmentedButtons
          value={tab}
          onValueChange={(value) => setTab(value as "submissions" | "setup")}
          buttons={[
            { value: "submissions", label: `Submissions (${pendingCount})`, icon: "receipt" },
            { value: "setup", label: "Payment Setup", icon: "shield-checkmark" },
          ]}
          style={styles.segmentedButtons}
        />

        {tab === "setup" ? (
          <>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Registration Fee</Text>
              <Text style={styles.cardSubtitle}>Last updated: {formatDate(updatedAt)}</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.label}>Registration Fee (₱) *</Text>
              <TextInput
                style={styles.input}
                value={feeAmount}
                onChangeText={setFeeAmount}
                keyboardType="decimal-pad"
                placeholder="e.g. 500"
                placeholderTextColor="#9ca3af"
              />
              <Text style={styles.fieldHint}>Partners pay this exact amount through secure online checkout.</Text>

              <View style={styles.gatewayCard}>
                <Ionicons name="shield-checkmark-outline" size={26} color="#0f766e" />
                <View style={styles.gatewayCopy}>
                  <Text style={styles.gatewayTitle}>Automated Checkout Active</Text>
                  <Text style={styles.gatewayDesc}>Partners pay registration and renewal fees through secure online checkout. Terms are verified automatically.</Text>
                </View>
              </View>

              <Button
                mode="contained"
                icon="content-save"
                onPress={saveSettings}
                loading={saving}
                disabled={saving}
                buttonColor="#22312d"
                style={styles.saveButton}
              >
                Save Payment Settings
              </Button>
            </View>
          </View>
          <AdminSettlementCard />
          </>
        ) : shownPayments.length === 0 ? (
          <View style={[styles.card, styles.emptyCard]}>
            <Ionicons name="receipt-outline" size={38} color="#9ca3af" />
            <Text style={styles.emptyTitle}>No payment submissions yet</Text>
            <Text style={styles.muted}>Online checkout transactions and payment records will appear here.</Text>
          </View>
        ) : (
          shownPayments.map((payment) => {
            const meta = statusMeta(payment.status);
            const method = getPaymentMethodInfo(payment);
            return (
              <TouchableOpacity key={payment.id} activeOpacity={0.88} onPress={() => setSelected(payment)} style={styles.submissionCard}>
                <View style={styles.submissionTop}>
                  <View style={styles.flex}>
                    <Text style={styles.submissionShop}>{payment.shopName}</Text>
                    <Text style={styles.submissionOwner}>{payment.ownerName || payment.ownerEmail || payment.payerName}</Text>
                  </View>
                  <View style={[styles.badgePill, { backgroundColor: meta.background, borderColor: meta.border }]}>
                    <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>

                <View style={styles.submissionMiddle}>
                  <View style={styles.methodRow}>
                    {method.logo ? (
                      <Image source={method.logo} style={styles.unboxedLogo} resizeMode="contain" />
                    ) : (
                      <Ionicons name="card-outline" size={16} color="#475569" />
                    )}
                    <Text style={styles.methodLabel}>{method.label}</Text>
                    {payment.referenceNumber ? (
                      <Text style={styles.refNumber} numberOfLines={1}>• Ref #{payment.referenceNumber}</Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.submissionFooter}>
                  <View>
                    <Text style={styles.submissionAmount}>{formatPhilippinePeso(String(payment.amount))}</Text>
                    <Text style={styles.submissionDate}>{formatDate(payment.createdAt)}</Text>
                  </View>
                  <View style={styles.viewReceiptPill}>
                    <Text style={styles.viewReceiptText}>View Receipt</Text>
                    <Ionicons name="chevron-forward" size={14} color="#22312d" />
                  </View>
                </View>
                {payment.rejectionReason ? (
                  <Text style={styles.rejectionText}>Correction note: {payment.rejectionReason}</Text>
                ) : null}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Payment Receipt Modal */}
      <Modal visible={Boolean(selected)} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.receiptModal}>
            <ScrollView contentContainerStyle={styles.receiptContent} showsVerticalScrollIndicator={false}>
              {selected ? (() => {
                const meta = statusMeta(selected.status);
                const method = getPaymentMethodInfo(selected);
                const hosted = selected.paymentProvider === "xendit" || selected.paymentProvider === "legacy";
                return (
                  <>
                    <View style={styles.receiptHero}>
                      <TouchableOpacity onPress={() => setSelected(null)} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close payment receipt">
                        <Ionicons name="close" size={22} color="#ffffff" />
                      </TouchableOpacity>
                      <View style={[styles.receiptStatusIcon, { backgroundColor: selected.status === "verified" ? "#16a34a" : selected.status === "rejected" ? "#dc2626" : "#d97706" }]}>
                        <Ionicons
                          name={selected.status === "verified" ? "checkmark" : selected.status === "rejected" ? "alert" : "receipt-outline"}
                          size={24}
                          color="#18201d"
                        />
                      </View>
                      <Text style={styles.receiptHeroTitle}>{selected.status === "verified" ? "Payment Verified" : selected.status === "rejected" ? "Payment Not Completed" : hosted ? "Checkout Pending" : "Payment Under Review"}</Text>
                      <Text style={styles.receiptHeroSub}>
                        {selected.status === "verified"
                          ? "This shop registration payment has been confirmed."
                          : selected.status === "rejected"
                            ? "This payment submission needs correction."
                            : hosted ? "The payment will be confirmed automatically once checkout is completed." : "Review the submitted proof before confirming this payment."}
                      </Text>
                      <Text style={styles.receiptHeroAmountLabel}>{selected.status === "verified" ? "AMOUNT PAID" : "AMOUNT"}</Text>
                      <Text style={styles.receiptHeroAmount}>{formatPhilippinePeso(String(selected.amount))}</Text>
                    </View>

                    <View style={styles.receiptSection}>
                      <Text style={styles.receiptSectionHeader}>Payment Details</Text>
                      <View style={styles.detailRow}><Text style={styles.detailLabel}>{selected.status === "verified" ? "Payment Date" : "Submitted"}</Text><Text style={styles.detailValue}>{formatDate(selected.verifiedAt || selected.createdAt)}</Text></View>
                      <View style={styles.detailRow}><Text style={styles.detailLabel}>Receipt No.</Text><Text style={styles.detailValue}>LC-{selected.id.replace(/-/g, "").slice(0, 12).toUpperCase()}</Text></View>
                      <View style={styles.detailRow}><Text style={styles.detailLabel}>Funeral Shop</Text><Text style={styles.detailValue}>{selected.shopName}</Text></View>
                      {selected.status === "verified" && selected.expiresAt ? <View style={styles.detailRow}><Text style={styles.detailLabel}>Access Valid Until</Text><Text style={styles.detailValue}>{formatDate(selected.expiresAt)}</Text></View> : null}
                    </View>

                    <View style={styles.receiptDivider} />
                    <View style={styles.receiptService}>
                      <View style={styles.receiptServiceLogo}><Text style={styles.receiptServiceLogoText}>LC</Text></View>
                      <View style={styles.receiptServiceCopy}><Text style={styles.receiptServiceTitle}>LifeCycle registration</Text><Text style={styles.receiptServiceMeta}>Funeral shop subscription payment</Text><Text style={styles.receiptServiceMeta}>{selected.ownerName || selected.ownerEmail || "Shop account"}</Text></View>
                      <Text style={styles.receiptServiceAmount}>{formatPhilippinePeso(String(selected.amount))}</Text>
                    </View>
                    <View style={styles.receiptDivider} />

                    <View style={styles.receiptSection}>
                      <Text style={styles.receiptSectionHeader}>Receipt Information</Text>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Payment Method</Text>
                        <View style={styles.methodValueWrap}>
                          {method.logo ? (
                            <Image source={method.logo} style={styles.unboxedLogo} resizeMode="contain" />
                          ) : null}
                          <Text style={styles.detailValue}>{method.label}</Text>
                        </View>
                      </View>
                      <View style={styles.detailRow}><Text style={styles.detailLabel}>Payer / Seller</Text><Text style={styles.detailValue}>{selected.payerName || selected.ownerName || "—"}</Text></View>
                      {selected.gcashName ? <View style={styles.detailRow}><Text style={styles.detailLabel}>Account Name</Text><Text style={styles.detailValue}>{selected.gcashName}</Text></View> : null}
                      {selected.gcashNumber ? <View style={styles.detailRow}><Text style={styles.detailLabel}>Account Number</Text><Text style={styles.detailValue}>{selected.gcashNumber}</Text></View> : null}
                      <View style={styles.detailRow}><Text style={styles.detailLabel}>Reference No.</Text><Text style={styles.detailValue}>{selected.referenceNumber || selected.providerPaymentId || `#PAY-${selected.id.slice(0, 8).toUpperCase()}`}</Text></View>
                      <View style={styles.detailRow}><Text style={styles.detailLabel}>Seller Email</Text><Text style={styles.detailValue}>{selected.ownerEmail || "—"}</Text></View>
                      {selected.verifiedAt ? <View style={styles.detailRow}><Text style={styles.detailLabel}>Verified</Text><Text style={styles.detailValue}>{formatDate(selected.verifiedAt)}</Text></View> : null}
                      <View style={styles.detailRow}><Text style={styles.detailLabel}>Status</Text><Text style={styles.detailValue}>{meta.label}</Text></View>
                      <View style={styles.detailRow}><Text style={styles.detailLabel}>Amount</Text><Text style={styles.detailValue}>{formatPhilippinePeso(String(selected.amount))}</Text></View>
                    </View>

                    {hosted && selected.status !== "rejected" ? <View style={[styles.receiptProviderNote, selected.status === "verified" && styles.receiptProviderVerified]}><Text style={styles.receiptProviderTitle}>{selected.status === "verified" ? "Payment verified" : "Confirmation pending"}</Text><Text style={styles.receiptProviderText}>{selected.status === "verified" ? "Confirmed automatically after checkout." : "This receipt updates after the payment is confirmed."}</Text></View> : null}

                    {selected.rejectionReason ? (
                      <View style={styles.rejectionBox}>
                        <Text style={styles.rejectionBoxTitle}>Review Note</Text>
                        <Text style={styles.rejectionBoxText}>{selected.rejectionReason}</Text>
                      </View>
                    ) : null}

                    {selected.proofImageUrl ? (
                      <View style={styles.receiptSection}>
                        <Text style={styles.receiptSectionHeader}>Submitted Proof</Text>
                        <TouchableOpacity onPress={() => setProofZoom(true)} style={styles.proofThumbButton}>
                          <Image source={{ uri: selected.proofImageUrl }} style={styles.proofThumb} resizeMode="cover" />
                          <View style={styles.proofOverlayNotice}>
                            <Ionicons name="expand-outline" size={16} color="#fff" />
                            <Text style={styles.proofNoticeText}>Tap to view full</Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    <View style={styles.receiptActions}>
                      <TouchableOpacity style={styles.receiptCloseAction} onPress={() => setSelected(null)}>
                        <Text style={styles.receiptCloseActionText}>Close</Text>
                      </TouchableOpacity>
                      {selected.status === "pending" && selected.paymentProvider === "manual" ? (
                        <>
                          <TouchableOpacity
                            style={styles.receiptRejectAction}
                            onPress={() => {
                              const p = selected;
                              setSelected(null);
                              setRejectReason("");
                              setRejecting(p);
                            }}
                            disabled={Boolean(reviewingId)}
                          >
                            <Text style={styles.receiptRejectActionText}>Reject</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.receiptVerifyAction}
                            onPress={() => verifyPayment(selected)}
                            disabled={Boolean(reviewingId)}
                          >
                            <Text style={styles.receiptVerifyActionText}>{reviewingId === selected.id ? "Verifying…" : "Verify Payment"}</Text>
                          </TouchableOpacity>
                        </>
                      ) : null}
                    </View>
                  </>
                );
              })() : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Proof Lightbox Modal */}
      {proofZoom && selected?.proofImageUrl ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setProofZoom(false)}>
          <View style={styles.lightboxOverlay}>
            <TouchableOpacity style={styles.lightboxClose} onPress={() => setProofZoom(false)}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Image source={{ uri: selected.proofImageUrl }} style={styles.lightboxImage} resizeMode="contain" />
          </View>
        </Modal>
      ) : null}

      {/* Reject Modal */}
      <Modal visible={Boolean(rejecting)} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>Reject Payment</Text>
            <Text style={styles.rejectSubtitle}>Explain what {rejecting?.shopName || "the shop"} needs to correct.</Text>
            <TextInput
              style={styles.rejectInput}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Example: The reference number is not visible in the screenshot."
              placeholderTextColor="#9ca3af"
              multiline
              autoFocus
            />
            <View style={styles.rejectActions}>
              <Button mode="text" onPress={() => setRejecting(null)} disabled={Boolean(reviewingId)} textColor="#475569">
                Cancel
              </Button>
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
  page: { flex: 1, backgroundColor: "#fcfbf9" },
  content: { padding: 16, gap: 12, paddingBottom: 36 },
  contentDesktop: { width: "100%", maxWidth: 900, alignSelf: "center" },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#fcfbf9" },
  muted: { color: "#64748b", fontSize: 13, lineHeight: 18 },
  heroBanner: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    gap: 12,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  heroTextWrap: { flex: 1 },
  heroKicker: { fontSize: 11, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 },
  title: { color: "#1f2937", fontSize: 21, fontWeight: "800", marginTop: 2 },
  subtitle: { color: "#64748b", fontSize: 13, lineHeight: 18, marginTop: 2 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusPillText: { fontSize: 11, fontWeight: "700", color: "#334155" },
  summaryGrid: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 12,
    gap: 10,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  summaryLabel: { fontSize: 10, fontWeight: "700", color: "#64748b", textTransform: "uppercase" },
  summaryValue: { fontSize: 16, fontWeight: "800", color: "#1f2937", marginTop: 2 },
  segmentedButtons: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    overflow: "hidden",
  },
  cardHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#1f2937" },
  cardSubtitle: { fontSize: 12, color: "#64748b", marginTop: 2 },
  cardBody: { padding: 16 },
  label: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0f172a",
    backgroundColor: "#ffffff",
  },
  fieldHint: { fontSize: 11, color: "#64748b", marginTop: 5, marginBottom: 14 },
  gatewayCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#f0fdfa",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ccfbf1",
    padding: 14,
    marginBottom: 16,
  },
  gatewayCopy: { flex: 1 },
  gatewayTitle: { fontSize: 13, fontWeight: "800", color: "#115e59" },
  gatewayDesc: { fontSize: 12, color: "#0f766e", lineHeight: 17, marginTop: 2 },
  saveButton: { borderRadius: 10 },
  emptyCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 36,
    paddingHorizontal: 16,
    gap: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: "#334155" },
  submissionCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 14,
    gap: 10,
  },
  submissionTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  submissionShop: { fontSize: 15, fontWeight: "800", color: "#1f2937" },
  submissionOwner: { fontSize: 12, color: "#64748b", marginTop: 1 },
  badgePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  submissionMiddle: {
    paddingVertical: 4,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#f8fafc",
  },
  methodRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  unboxedLogo: {
    width: 38,
    height: 18,
  },
  methodLabel: { fontSize: 13, fontWeight: "700", color: "#334155" },
  refNumber: { fontSize: 12, color: "#64748b", flex: 1 },
  submissionFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  submissionAmount: { fontSize: 16, fontWeight: "800", color: "#111827" },
  submissionDate: { fontSize: 11, color: "#94a3b8", marginTop: 1 },
  viewReceiptPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  viewReceiptText: { fontSize: 12, fontWeight: "700", color: "#22312d" },
  rejectionText: { fontSize: 12, color: "#991b1b", fontWeight: "600", marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.6)",
    justifyContent: "flex-end",
  },
  receiptModal: {
    width: "100%",
    maxHeight: "92%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  receiptContent: { paddingBottom: 32 },
  closeButton: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#303332",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptHero: {
    minHeight: 245,
    backgroundColor: "#101312",
    paddingHorizontal: 24,
    paddingTop: 35,
    paddingBottom: 28,
    alignItems: "center",
  },
  receiptStatusIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  receiptHeroTitle: { fontSize: 21, fontWeight: "900", color: "#ffffff", textAlign: "center", marginTop: 17 },
  receiptHeroSub: { fontSize: 12, color: "#b9bfbc", lineHeight: 18, textAlign: "center", maxWidth: 340, marginTop: 8 },
  receiptHeroAmountLabel: { color: "#aeb6b2", fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: 18 },
  receiptHeroAmount: { fontSize: 26, fontWeight: "900", color: "#ffffff", marginTop: 3 },
  receiptSection: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 22,
    paddingTop: 24,
    gap: 15,
  },
  receiptSectionHeader: {
    fontSize: 15,
    fontWeight: "900",
    color: "#191c1b",
    marginBottom: 2,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  detailLabel: { flex: 1, fontSize: 12, color: "#858c88" },
  detailValue: { flex: 1.35, fontSize: 12, fontWeight: "700", color: "#303634", textAlign: "right" },
  receiptDivider: { height: 1, backgroundColor: "#e5e8e6", marginHorizontal: 22, marginTop: 24 },
  receiptService: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 22, paddingTop: 22 },
  receiptServiceLogo: { width: 54, height: 64, borderRadius: 10, backgroundColor: "#edf0ee", alignItems: "center", justifyContent: "center" },
  receiptServiceLogoText: { color: "#7d8782", fontSize: 16, fontWeight: "800" },
  receiptServiceCopy: { flex: 1, minWidth: 0 },
  receiptServiceTitle: { color: "#282e2b", fontSize: 13, fontWeight: "800" },
  receiptServiceMeta: { color: "#868d89", fontSize: 11, marginTop: 3 },
  receiptServiceAmount: { color: "#222725", fontSize: 13, fontWeight: "800" },
  receiptProviderNote: { marginHorizontal: 22, marginTop: 18, padding: 14, borderRadius: 13, backgroundColor: "#fffbeb" },
  receiptProviderVerified: { backgroundColor: "#ecfdf5" },
  receiptProviderTitle: { color: "#225a3d", fontSize: 12, fontWeight: "800" },
  receiptProviderText: { color: "#567565", fontSize: 11, marginTop: 3 },
  methodValueWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  rejectionBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
    padding: 12,
    gap: 2,
    marginHorizontal: 22,
    marginTop: 18,
  },
  rejectionBoxTitle: { fontSize: 12, fontWeight: "800", color: "#991b1b" },
  rejectionBoxText: { fontSize: 12, color: "#b91c1c", lineHeight: 17 },
  proofThumbButton: {
    position: "relative",
    borderRadius: 10,
    overflow: "hidden",
    height: 160,
    backgroundColor: "#e2e8f0",
  },
  proofThumb: { width: "100%", height: "100%" },
  proofOverlayNotice: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.65)",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  proofNoticeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  receiptActions: {
    flexDirection: "column-reverse",
    alignItems: "stretch",
    gap: 10,
    marginTop: 22,
    marginHorizontal: 22,
  },
  receiptCloseAction: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptCloseActionText: { fontSize: 13, fontWeight: "700", color: "#374151" },
  receiptRejectAction: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fca5a5",
    backgroundColor: "#fef2f2",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptRejectActionText: { fontSize: 13, fontWeight: "700", color: "#b91c1c" },
  receiptVerifyAction: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptVerifyActionText: { fontSize: 13, fontWeight: "700", color: "#ffffff" },
  lightboxOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  lightboxClose: {
    position: "absolute",
    top: 48,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxImage: { width: "100%", height: "80%" },
  rejectCard: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 8,
  },
  rejectTitle: { fontSize: 17, fontWeight: "800", color: "#1f2937" },
  rejectSubtitle: { fontSize: 13, color: "#64748b" },
  rejectInput: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    padding: 12,
    minHeight: 100,
    textAlignVertical: "top",
    color: "#0f172a",
    fontSize: 14,
    marginTop: 8,
  },
  rejectActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 8,
  },
  flex: { flex: 1 },
});
