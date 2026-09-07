import { useState, type ComponentProps } from "react";
import { Image, Modal, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type PaymentRequest = {
  id: string;
  productName?: string;
  productImageUrl?: string | null;
  variationName?: string | null;
  deceasedFullName?: string;
  familyCoordinatorName?: string;
  wakeAddress?: string;
  status?: string;
  paymentAmount?: number | string | null;
  paymentPayerName?: string | null;
  paymentGcashName?: string | null;
  paymentGcashNumber?: string | null;
  paymentReferenceNumber?: string | null;
  paymentProofImageUrl?: string | null;
  paymentSubmittedAt?: string | null;
  paymentVerifiedAt?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
};

function getReceiptStatus(status?: string) {
  const normalized = String(status || "").toLowerCase();
  if (["payment_verified", "awaiting_customer_confirmation", "completed"].includes(normalized)) {
    return {
      title: normalized === "completed" ? "Payment Complete" : "Payment Verified",
      message: "This family payment was reviewed and confirmed by the shop.",
      icon: "checkmark" as IoniconName,
      badge: "#59c57d",
    };
  }
  if (normalized === "payment_submitted") {
    return {
      title: "Payment Under Review",
      message: "The family submitted a receipt. Check its information and proof before verifying it.",
      icon: "receipt-outline" as IoniconName,
      badge: "#f0b253",
    };
  }
  return {
    title: "Family Payment",
    message: "Review the available payment and receipt information for this service request.",
    icon: "wallet-outline" as IoniconName,
    badge: "#f0b253",
  };
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Not provided";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not provided";
  return parsed.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export default function FuneralShopPaymentReceiptScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const request = route.params?.request as PaymentRequest;
  const [viewerVisible, setViewerVisible] = useState(false);
  const statusMeta = getReceiptStatus(request?.status);
  const amount = Number(request?.paymentAmount) > 0
    ? formatPhilippinePeso(String(request.paymentAmount))
    : "Not provided";

  const handleClose = () => {
    if (navigation.canGoBack?.()) navigation.goBack();
    else navigation.navigate("ShopPayments");
  };

  if (!request) return null;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor="#101312" />
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
          <Text style={styles.heroMessage}>{statusMeta.message}</Text>
        </View>

        <View style={[styles.receiptBody, { paddingBottom: Math.max(30, insets.bottom + 20) }]}>
          <Text style={styles.sectionTitle}>Order Details</Text>
          <View style={styles.detailsBlock}>
            <DetailLine label="Order Date" value={formatTimestamp(request.paymentSubmittedAt || request.createdAt)} />
            <DetailLine label="Order ID" value={`#${request.id.slice(0, 10).toUpperCase()}`} />
            <DetailLine label="Service Address" value={request.wakeAddress || "Not provided"} />
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
              <Text style={styles.serviceMeta}>{request.variationName || "Service arrangement"}</Text>
              <Text style={styles.serviceMeta}>{request.deceasedFullName || "Family service"}</Text>
            </View>
            <Text style={styles.serviceAmount}>{amount}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.sectionHeadingRow}>
            <Text style={styles.sectionTitle}>Receipt Information</Text>
            <View style={styles.sectionHeadingIcon}>
              <Ionicons name="receipt-outline" size={18} color="#53615d" />
            </View>
          </View>
          <View style={styles.receiptInfoCard}>
            <DetailLine label="Payment Method" value="GCash / E-wallet" />
            <DetailLine label="Sender" value={request.paymentPayerName || request.familyCoordinatorName || "Not provided"} />
            <DetailLine label="GCash Name" value={request.paymentGcashName || "Not provided"} />
            <DetailLine label="GCash Number" value={request.paymentGcashNumber || "Not provided"} />
            <DetailLine label="Reference Number" value={request.paymentReferenceNumber || "Not provided"} />
            <DetailLine label="Amount" value={amount} />
          </View>

          <Text style={styles.receiptImageTitle}>Submitted Receipt</Text>
          {request.paymentProofImageUrl ? (
            <TouchableOpacity activeOpacity={0.9} onPress={() => setViewerVisible(true)}>
              <Image source={{ uri: request.paymentProofImageUrl }} style={styles.receiptImage} resizeMode="contain" />
              <Text style={styles.imageHint}>Tap the receipt to enlarge it.</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.missingReceipt}>
              <Ionicons name="image-outline" size={22} color="#9b403b" />
              <Text style={styles.missingReceiptTitle}>Receipt unavailable</Text>
              <Text style={styles.missingReceiptText}>No payment proof is attached to this request.</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.openRequestButton}
            activeOpacity={0.88}
            onPress={() => navigation.navigate("ServiceRequestDetails", {
              request,
              origin: "ShopPaymentReceipt",
              focusPayment: true,
            })}
          >
            <Ionicons name="document-text-outline" size={18} color="#ffffff" />
            <Text style={styles.openRequestButtonText}>Open Service Request</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={() => setViewerVisible(false)}>
        <SafeAreaView style={styles.viewer}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerVisible(false)}>
            <Ionicons name="close" size={25} color="#ffffff" />
          </TouchableOpacity>
          {request.paymentProofImageUrl ? (
            <Image source={{ uri: request.paymentProofImageUrl }} style={styles.viewerImage} resizeMode="contain" />
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  content: { flexGrow: 1, backgroundColor: "#ffffff" },
  hero: { minHeight: 255, backgroundColor: "#101312", alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingBottom: 30 },
  closeButton: { position: "absolute", right: 18, width: 44, height: 44, borderRadius: 22, backgroundColor: "#303332", alignItems: "center", justifyContent: "center" },
  statusIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  heroTitle: { color: "#ffffff", fontSize: 23, fontWeight: "900", textAlign: "center", marginTop: 22 },
  heroMessage: { color: "#b9bfbc", fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 330, marginTop: 9 },
  receiptBody: { paddingHorizontal: 22, paddingTop: 26 },
  sectionTitle: { color: "#191c1b", fontSize: 16, fontWeight: "900" },
  detailsBlock: { gap: 16, marginTop: 22 },
  detailLine: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 18 },
  detailLabel: { flex: 1, color: "#858c88", fontSize: 12 },
  detailValue: { flex: 1.35, color: "#303634", fontSize: 12, fontWeight: "900", textAlign: "right" },
  divider: { height: 1, backgroundColor: "#e5e8e6", marginVertical: 24 },
  serviceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  serviceImage: { width: 58, height: 70, borderRadius: 12, backgroundColor: "#edf0ee" },
  serviceImageFallback: { alignItems: "center", justifyContent: "center" },
  serviceCopy: { flex: 1, minWidth: 0 },
  serviceName: { color: "#282e2b", fontSize: 14, fontWeight: "900" },
  serviceMeta: { color: "#868d89", fontSize: 11, marginTop: 3 },
  serviceAmount: { color: "#222725", fontSize: 14, fontWeight: "900" },
  sectionHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  sectionHeadingIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#f1f3f2", alignItems: "center", justifyContent: "center" },
  receiptInfoCard: { borderRadius: 15, backgroundColor: "#f7f8f7", gap: 15, padding: 14, marginTop: 12 },
  receiptImageTitle: { color: "#191c1b", fontSize: 16, fontWeight: "900", marginTop: 26, marginBottom: 12 },
  receiptImage: { width: "100%", height: 330, borderRadius: 15, borderWidth: 1, borderColor: "#e0e4e2", backgroundColor: "#f7f8f7" },
  imageHint: { color: "#7d8580", fontSize: 11, textAlign: "center", marginTop: 8 },
  missingReceipt: { minHeight: 150, borderRadius: 16, borderWidth: 1, borderColor: "#efceca", backgroundColor: "#fff7f6", alignItems: "center", justifyContent: "center", padding: 18 },
  missingReceiptTitle: { color: "#91463f", fontSize: 14, fontWeight: "900", marginTop: 8 },
  missingReceiptText: { color: "#9b5d57", fontSize: 12, textAlign: "center", marginTop: 4 },
  openRequestButton: { minHeight: 52, borderRadius: 15, backgroundColor: "#22312d", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 26 },
  openRequestButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
  viewer: { flex: 1, backgroundColor: "rgba(8, 10, 9, 0.97)", alignItems: "center", justifyContent: "center" },
  viewerClose: { position: "absolute", top: 16, right: 16, zIndex: 2, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  viewerImage: { width: "94%", height: "86%" },
});
