import { useEffect, useState, type ComponentProps } from "react";
import { ActivityIndicator, Image, Modal, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import {
  balanceChannelLabel,
  getBalanceReceiptUrl,
  loadBalancePayments,
  type BalancePayment,
} from "@/services/remainingBalancePayments";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type PaymentRequest = {
  id: string;
  shopId?: string;
  shopName?: string;
  productName?: string;
  productPrice?: number | string | null;
  productFullPrice?: number | string | null;
  paymentOption?: "pending" | "full" | "downpayment" | null;
  downpaymentAmountSnapshot?: number | string | null;
  remainingBalance?: number | string | null;
  productImageUrl?: string | null;
  variationName?: string | null;
  deceasedFullName?: string;
  familyCoordinatorName?: string;
  wakeAddress?: string;
  status?: string;
  paymentAmount?: number | string | null;
  paymentProvider?: string | null;
  providerCheckoutId?: string | null;
  providerPaymentMethod?: string | null;
  paymentPayerName?: string | null;
  paymentGcashName?: string | null;
  paymentGcashNumber?: string | null;
  paymentReferenceNumber?: string | null;
  paymentProofImageUrl?: string | null;
  paymentSubmittedAt?: string | null;
  paymentVerifiedAt?: string | null;
  payoutAmount?: number | string | null;
  payoutStatus?: string | null;
  payoutCompletedAt?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
};

function formatChannelName(raw?: string | null, gcashNumber?: string | null, gcashName?: string | null, provider?: string | null) {
  const code = String(raw || "").trim().toUpperCase();
  const map: Record<string, string> = {
    PH_GCASH: "GCash",
    GCASH: "GCash",
    PH_MAYA: "Maya",
    PAYMAYA: "Maya",
    MAYA: "Maya",
    PH_BDO: "BDO",
    BDO: "BDO",
    PH_BPI: "BPI",
    BPI: "BPI",
    PH_METROBANK: "Metrobank",
    METROBANK: "Metrobank",
    PH_LANDBANK: "Landbank",
    LANDBANK: "Landbank",
    PH_CHINABANK: "Chinabank",
    CHINABANK: "Chinabank",
    PH_UBP: "UnionBank",
    UBP: "UnionBank",
    PH_RCBC: "RCBC",
    RCBC: "RCBC",
    PH_PNB: "PNB",
    PNB: "PNB",
    CARDS: "Cards (Visa, Mastercard, JCB)",
    CARD: "Cards (Visa, Mastercard, JCB)",
    CREDIT_CARD: "Cards (Visa, Mastercard, JCB)",
  };
  if (code) return map[code] || code.replace(/^PH_/, "").replace(/_/g, " ");
  if (gcashNumber || gcashName) return "GCash";
  if (provider === "xendit") return "Online";
  return "Online";
}

function formatBalanceMethod(payment: BalancePayment) {
  if (payment.method === "cash") return "Cash";
  if (payment.provider_reference_id) {
    return `Online · ${balanceChannelLabel(payment.provider_payment_method || payment.receiver_channel || "")}`;
  }
  const base = payment.method === "wallet" ? "Online · E-wallet" : "Online · Bank transfer";
  return payment.receiver_channel ? `${base} (${balanceChannelLabel(payment.receiver_channel)})` : base;
}

function getReceiptStatus(status?: string, isDownpayment?: boolean, balanceVerified?: boolean) {
  const normalized = String(status || "").toLowerCase();
  if (["payment_verified", "awaiting_customer_confirmation", "completed"].includes(normalized)) {
    if (isDownpayment && !balanceVerified) {
      return {
        title: "Downpayment Verified",
        message: "The downpayment is confirmed. Remaining balance is shown below.",
        icon: "checkmark" as IoniconName,
        badge: "#59c57d",
      };
    }
    return {
      title: "Payment Complete",
      message: "All payments for this service request have been confirmed.",
      icon: "checkmark" as IoniconName,
      badge: "#59c57d",
    };
  }
  if (normalized === "payment_submitted") {
    return {
      title: "Payment Under Review",
      message: "Payment details were submitted and are awaiting verification.",
      icon: "receipt-outline" as IoniconName,
      badge: "#f0b253",
    };
  }
  return {
    title: "Payment Receipt",
    message: "Summary of payments for this service request.",
    icon: "wallet-outline" as IoniconName,
    badge: "#f0b253",
  };
}

function formatTimestamp(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DetailLine({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, highlight && styles.detailValueHighlight]}>{value}</Text>
    </View>
  );
}

export default function FuneralShopPaymentReceiptScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const request = route.params?.request as PaymentRequest;
  const initialBalancePayment = route.params?.balancePayment as BalancePayment | undefined;
  const [balancePayment, setBalancePayment] = useState<BalancePayment | undefined>(initialBalancePayment);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [viewerUrl, setViewerUrl] = useState("");
  const [openingProof, setOpeningProof] = useState(false);

  useEffect(() => {
    if (!request?.id || !request?.shopId) return;
    let active = true;
    setLoadingBalance(true);
    void loadBalancePayments({ id: request.id, shopId: String(request.shopId) })
      .then((res) => {
        if (!active) return;
        const activePayment = res.payments.find((p) => p.status !== "rejected") || res.payments[0];
        if (activePayment) setBalancePayment(activePayment);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingBalance(false);
      });
    return () => {
      active = false;
    };
  }, [request?.id, request?.shopId]);

  const handleClose = () => {
    if (navigation.canGoBack?.()) navigation.goBack();
    else navigation.navigate("ShopPayments");
  };

  if (!request) return null;

  const isDownpayment = request.paymentOption === "downpayment";
  const balanceVerified = balancePayment?.status === "verified";
  const statusMeta = getReceiptStatus(request.status, isDownpayment, balanceVerified);

  const initialPaidAmount = Number(request.downpaymentAmountSnapshot ?? request.paymentAmount) || 0;
  const remainingBalanceAmount = Number(request.remainingBalance) || 0;
  const totalOrderAmount =
    Number(request.productFullPrice ?? request.productPrice) ||
    (isDownpayment ? initialPaidAmount + remainingBalanceAmount : initialPaidAmount);
  const totalReceivedAmount =
    initialPaidAmount + (balanceVerified ? Number(balancePayment?.amount || remainingBalanceAmount) : 0);

  const channelLabel = formatChannelName(
    request.providerPaymentMethod,
    request.paymentGcashNumber,
    request.paymentGcashName,
    request.paymentProvider
  );
  const paymentTypeLabel = `${isDownpayment ? "Downpayment" : "Full payment"} · ${channelLabel}`;
  const referenceValue =
    request.paymentReferenceNumber ||
    (request.providerCheckoutId ? String(request.providerCheckoutId) : "") ||
    `#${request.id.slice(0, 8).toUpperCase()}`;

  const openBalanceProof = async (path: string) => {
    if (openingProof) return;
    setOpeningProof(true);
    try {
      setViewerUrl(await getBalanceReceiptUrl(path));
    } catch {
      // ignore
    } finally {
      setOpeningProof(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={[styles.hero, { paddingTop: Math.max(38, insets.top + 18) }]}>
          <TouchableOpacity
            activeOpacity={0.84}
            style={[styles.closeButton, { top: Math.max(14, insets.top + 6) }]}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close payment receipt"
          >
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
          <View style={[styles.statusIcon, { backgroundColor: statusMeta.badge }]}>
            <Ionicons name={statusMeta.icon} size={29} color="#18201d" />
          </View>
          <Text style={styles.heroTitle}>{statusMeta.title}</Text>
          <Text style={styles.heroAmount}>{formatPhilippinePeso(totalReceivedAmount)}</Text>
          <Text style={styles.heroMessage}>
            {isDownpayment
              ? `Total received of ${formatPhilippinePeso(totalOrderAmount)}`
              : statusMeta.message}
          </Text>
        </View>

        <View style={[styles.receiptBody, { paddingBottom: Math.max(30, insets.bottom + 20) }]}>
          <Text style={styles.sectionTitle}>Order Details</Text>
          <View style={styles.detailsBlock}>
            <DetailLine label="Receipt No." value={`#RCP-${request.id.slice(0, 8).toUpperCase()}`} />
            <DetailLine label="Order Date" value={formatTimestamp(request.paymentSubmittedAt || request.createdAt)} />
            {request.shopName ? <DetailLine label="Shop" value={request.shopName} /> : null}
            <DetailLine label="Customer" value={request.familyCoordinatorName || request.paymentPayerName || "—"} />
            <DetailLine label="Service Address" value={request.wakeAddress || "—"} />
          </View>

          <View style={styles.divider} />

          <View style={styles.serviceRow}>
            {request.productImageUrl ? (
              <Image source={{ uri: request.productImageUrl }} style={styles.serviceImage} resizeMode="cover" />
            ) : (
              <View style={[styles.serviceImage, styles.serviceImageFallback]}>
                <Ionicons name="cube-outline" size={24} color="#7d8782" />
              </View>
            )}
            <View style={styles.serviceCopy}>
              <Text style={styles.serviceName} numberOfLines={2}>{request.productName || "Funeral service"}</Text>
              <Text style={styles.serviceMeta}>{request.variationName || "Standard arrangement"}</Text>
              {request.deceasedFullName ? <Text style={styles.serviceMeta}>{request.deceasedFullName}</Text> : null}
            </View>
            <Text style={styles.serviceAmount}>{formatPhilippinePeso(totalOrderAmount)}</Text>
          </View>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>
            {isDownpayment ? "Downpayment Receipt" : "Payment Receipt"}
          </Text>
          <View style={styles.detailsBlock}>
            <DetailLine label="Payment Type" value={paymentTypeLabel} />
            <DetailLine
              label={isDownpayment ? "Downpayment Received" : "Amount Received"}
              value={formatPhilippinePeso(initialPaidAmount)}
              highlight
            />
            {request.paymentPayerName ? <DetailLine label="Sender" value={request.paymentPayerName} /> : null}
            {request.paymentGcashName ? <DetailLine label="Account Name" value={request.paymentGcashName} /> : null}
            {request.paymentGcashNumber ? <DetailLine label="Account Number" value={request.paymentGcashNumber} /> : null}
            <DetailLine label="Reference" value={referenceValue} />
            {request.paymentVerifiedAt ? (
              <DetailLine label="Verified On" value={formatTimestamp(request.paymentVerifiedAt)} />
            ) : null}
            {request.paymentProofImageUrl ? (
              <TouchableOpacity
                style={styles.proofButton}
                onPress={() => setViewerUrl(String(request.paymentProofImageUrl))}
              >
                <Ionicons name="image-outline" size={16} color="#22312d" />
                <Text style={styles.proofButtonText}>View payment screenshot</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {isDownpayment && remainingBalanceAmount > 0 ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionTitle}>Remaining Balance Receipt</Text>
              {loadingBalance && !balancePayment ? (
                <ActivityIndicator color="#22312d" style={{ marginTop: 12 }} />
              ) : balancePayment ? (
                <View style={styles.detailsBlock}>
                  <DetailLine
                    label="Status"
                    value={
                      balancePayment.status === "verified"
                        ? "Paid"
                        : balancePayment.status === "submitted"
                          ? "Awaiting confirmation"
                          : "Rejected"
                    }
                    highlight={balancePayment.status === "verified"}
                  />
                  <DetailLine label="Payment Type" value={formatBalanceMethod(balancePayment)} />
                  <DetailLine
                    label={balancePayment.status === "verified" ? "Amount Received" : "Amount Submitted"}
                    value={formatPhilippinePeso(Number(balancePayment.amount))}
                    highlight={balancePayment.status === "verified"}
                  />
                  {balancePayment.payer_name ? (
                    <DetailLine label="Sender" value={balancePayment.payer_name} />
                  ) : null}
                  {balancePayment.reference_number ? (
                    <DetailLine label="Reference" value={balancePayment.reference_number} />
                  ) : (
                    <DetailLine
                      label="Receipt Reference"
                      value={`#CASH-${balancePayment.id.slice(0, 8).toUpperCase()}`}
                    />
                  )}
                  <DetailLine label="Submitted On" value={formatTimestamp(balancePayment.submitted_at)} />
                  {balancePayment.reviewed_at ? (
                    <DetailLine label="Approved On" value={formatTimestamp(balancePayment.reviewed_at)} />
                  ) : null}
                  {balancePayment.proof_image_path ? (
                    <TouchableOpacity
                      style={styles.proofButton}
                      disabled={openingProof}
                      onPress={() => void openBalanceProof(balancePayment.proof_image_path || "")}
                    >
                      <Ionicons name="image-outline" size={16} color="#22312d" />
                      <Text style={styles.proofButtonText}>
                        {openingProof ? "Opening…" : "View transfer screenshot"}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <View style={styles.detailsBlock}>
                  <DetailLine label="Status" value="Unpaid" />
                  <DetailLine label="Remaining Balance" value={formatPhilippinePeso(remainingBalanceAmount)} />
                </View>
              )}
            </>
          ) : null}

          <View style={styles.divider} />

          <View style={styles.detailsBlock}>
            <DetailLine label="Total Service Price" value={formatPhilippinePeso(totalOrderAmount)} />
            <DetailLine
              label="Total Received by Shop"
              value={formatPhilippinePeso(totalReceivedAmount)}
              highlight
            />
            {isDownpayment ? (
              <DetailLine
                label="Outstanding Balance"
                value={formatPhilippinePeso(balanceVerified ? 0 : remainingBalanceAmount)}
              />
            ) : null}
          </View>

          <TouchableOpacity
            style={styles.openRequestButton}
            activeOpacity={0.88}
            onPress={handleClose}
          >
            <Text style={styles.openRequestButtonText}>Back to Service Request</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={Boolean(viewerUrl)} transparent animationType="fade" onRequestClose={() => setViewerUrl("")}>
        <View style={styles.viewer}>
          {viewerUrl ? <Image source={{ uri: viewerUrl }} style={styles.viewerImage} resizeMode="contain" /> : null}
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerUrl("")}>
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  content: { flexGrow: 1, backgroundColor: "#ffffff" },
  hero: { minHeight: 240, backgroundColor: "#101312", alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingBottom: 28 },
  closeButton: { position: "absolute", right: 18, width: 42, height: 42, borderRadius: 21, backgroundColor: "#303332", alignItems: "center", justifyContent: "center" },
  statusIcon: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  heroTitle: { color: "#ffffff", fontSize: 21, fontWeight: "900", textAlign: "center", marginTop: 16 },
  heroAmount: { color: "#59c57d", fontSize: 26, fontWeight: "900", textAlign: "center", marginTop: 6 },
  heroMessage: { color: "#b9bfbc", fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 330, marginTop: 6 },
  receiptBody: { paddingHorizontal: 22, paddingTop: 24 },
  sectionTitle: { color: "#191c1b", fontSize: 15, fontWeight: "900" },
  detailsBlock: { gap: 12, marginTop: 14 },
  detailLine: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  detailLabel: { flex: 1, color: "#7a8580", fontSize: 12 },
  detailValue: { flex: 1.35, color: "#22312d", fontSize: 13, fontWeight: "700", textAlign: "right" },
  detailValueHighlight: { color: "#1f6f4a", fontWeight: "900" },
  divider: { height: 1, backgroundColor: "#e5e8e6", marginVertical: 20 },
  serviceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  serviceImage: { width: 54, height: 64, borderRadius: 10, backgroundColor: "#edf0ee" },
  serviceImageFallback: { alignItems: "center", justifyContent: "center" },
  serviceCopy: { flex: 1, minWidth: 0 },
  serviceName: { color: "#22312d", fontSize: 14, fontWeight: "900" },
  serviceMeta: { color: "#7a8580", fontSize: 12, marginTop: 2 },
  serviceAmount: { color: "#22312d", fontSize: 14, fontWeight: "900" },
  proofButton: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d6e2dc",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
  },
  proofButtonText: {
    color: "#22312d",
    fontSize: 12,
    fontWeight: "800",
  },
  openRequestButton: { minHeight: 48, borderRadius: 14, backgroundColor: "#22312d", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 24 },
  openRequestButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "800" },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center" },
  viewerImage: { width: "100%", height: "85%" },
  viewerClose: { position: "absolute", top: 48, right: 18, backgroundColor: "#22312d", borderRadius: 20, padding: 8 },
});
