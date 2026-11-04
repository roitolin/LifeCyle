import { useCallback, useMemo, useState } from "react";
import LoadingBird from "@/components/LoadingBird";
import {
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Searchbar } from "react-native-paper";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/services/supabaseClient";
import { useResponsive } from "@/utils/responsive";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { formatServiceDate, formatServiceTime } from "@/utils/serviceRequestSchedule";

type FilterType = "all" | "waiting" | "accepted" | "completed" | "declined" | "cancelled";

type ServiceRequest = {
  id: string;
  requesterId: string;
  shopId: string;
  shopName?: string | null;
  shopContactNumber?: string | null;
  shopAddress?: string | null;
  productId?: string;
  productName?: string | null;
  productPrice?: string | null;
  productFullPrice?: number | string | null;
  downpaymentAmountSnapshot?: number | string | null;
  downpaymentPercentageSnapshot?: number | string | null;
  paymentOption?: "full" | "downpayment" | null;
  paymentProvider?: string | null;
  providerPaymentMethod?: string | null;
  providerPaymentId?: string | null;
  providerPaymentCompletedAt?: string | null;
  productImageUrl?: string | null;
  variationName?: string | null;
  packageItems?: string[] | null;
  requestType?: string;
  customDesignNotes?: string | null;
  memorialPhotoUrl?: string | null;
  referencePhotoUrl?: string | null;
  deceasedFullName?: string | null;
  deceasedDateOfBirth?: string | null;
  deceasedDateOfPassing?: string | null;
  deceasedAge?: number | null;
  tributeMessage?: string | null;
  familyCoordinatorName?: string | null;
  wakeAddress?: string | null;
  churchName?: string | null;
  cemeteryName?: string | null;
  wakeStartDate?: string | null;
  wakeEndDate?: string | null;
  burialTime?: string | null;
  pickupAddress?: string | null;
  contactNumber?: string | null;
  status: string;
  paymentAmount?: number | string | null;
  paymentPayerName?: string | null;
  paymentGcashName?: string | null;
  paymentGcashNumber?: string | null;
  paymentReferenceNumber?: string | null;
  paymentProofImageUrl?: string | null;
  paymentRejectionReason?: string | null;
  paymentSubmittedAt?: any;
  paymentVerifiedAt?: any;
  payoutStatus?: string | null;
  payoutAmount?: number | string | null;
  payoutCompletedAt?: any;
  payoutFailureCode?: string | null;
  completedAt?: any;
  completionProofImageUrl?: string | null;
  shopMarkedCompletedAt?: any;
  createdAt?: any;
  acceptedAt?: any;
  declinedAt?: any;
  cancelledAt?: any;
  shopRespondedAt?: any;
  requesterName?: string;
  requesterEmail?: string;
};

const PAYMENT_LOGOS: Record<string, any> = {
  PH_GCASH: require("../../../assets/Payment Logos/Gcash_Logo.png"),
  PH_MAYA: require("../../../assets/Payment Logos/PayMaya_Logo.png"),
  PH_BDO: require("../../../assets/Payment Logos/BDO_Logo.png"),
  PH_BPI: require("../../../assets/Payment Logos/BPI_Logo.png"),
  PH_METROBANK: require("../../../assets/Payment Logos/MetroBank_Logo.png"),
  PH_LANDBANK: require("../../../assets/Payment Logos/Landbank_logo.png"),
  PH_CHINABANK: require("../../../assets/Payment Logos/Chinabank_Logo.png"),
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "waiting", label: "Waiting" },
  { value: "accepted", label: "Accepted" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
];

const getStatusMeta = (status: string) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "accepted_by_shop") {
    return { label: "Accepted", background: "#e7f5ec", text: "#166534" };
  }
  if (normalized === "awaiting_payment") {
    return { label: "Awaiting Payment", background: "#e0eefa", text: "#1c4f7e" };
  }
  if (normalized === "payment_submitted") {
    return { label: "Payment Submitted", background: "#e0eefa", text: "#1c4f7e" };
  }
  if (normalized === "paid_waiting_for_split") {
    return { label: "Processing Payout", background: "#fef3c7", text: "#86654a" };
  }
  if (normalized === "commission_failed") {
    return { label: "Payout Review", background: "#fde8e8", text: "#991b1b" };
  }
  if (normalized === "payment_verified") {
    return { label: "In Service", background: "#e7f5ec", text: "#166534" };
  }
  if (normalized === "completed") {
    return { label: "Completed", background: "#14532d", text: "#ffffff" };
  }
  if (normalized === "declined_by_shop") {
    return { label: "Declined", background: "#fde8e8", text: "#991b1b" };
  }
  if (normalized === "cancelled" || normalized === "cancelled_by_requester") {
    return { label: "Cancelled", background: "#eef1ec", text: "#4c5b57" };
  }
  if (normalized === "awaiting_customer_confirmation") {
    return { label: "Awaiting Confirmation", background: "#fef3c7", text: "#86654a" };
  }
  return { label: "Waiting", background: "#fef3c7", text: "#86654a" };
};

function getDownpaymentBadge(item: ServiceRequest) {
  const status = String(item.status || "").toLowerCase();
  const isDownpayment = String(item.paymentOption || "").toLowerCase() === "downpayment";
  if (item.paymentVerifiedAt || ["payment_verified", "awaiting_customer_confirmation", "completed"].includes(status)) {
    return {
      label: isDownpayment ? "Downpayment Confirmed" : "Payment Confirmed",
      background: "#e8f5ec",
      color: "#166534",
      border: "#bbf7d0",
    };
  }
  if (status === "payment_submitted") {
    return {
      label: isDownpayment ? "Downpayment Submitted" : "Payment Submitted",
      background: "#fef3c7",
      color: "#92400e",
      border: "#fde68a",
    };
  }
  return null;
}

function getPaymentChannelInfo(item: ServiceRequest) {
  const isDownpayment = item.paymentOption === "downpayment";
  const base = isDownpayment ? "Downpayment" : "Full payment";
  const raw = String(item.providerPaymentMethod || "").trim().toUpperCase();
  const logo = (raw && PAYMENT_LOGOS[raw]) || (item.paymentGcashNumber ? PAYMENT_LOGOS.PH_GCASH : null);

  let label = base;
  if (raw === "PH_GCASH") label = `${base} • GCash`;
  else if (raw === "PH_MAYA") label = `${base} • Maya`;
  else if (raw === "PH_BDO") label = `${base} • BDO`;
  else if (raw === "PH_BPI") label = `${base} • BPI`;
  else if (raw === "PH_METROBANK") label = `${base} • Metrobank`;
  else if (raw === "PH_LANDBANK") label = `${base} • LandBank`;
  else if (raw === "PH_CHINABANK") label = `${base} • Chinabank`;
  else if (raw) label = `${base} • ${raw.replace(/^PH_/i, "").replace(/_/g, " ")}`;
  else if (item.paymentGcashNumber) label = `${base} • GCash`;
  else if (item.paymentProvider === "xendit" || item.providerPaymentId) label = `${base} • Online payment`;

  return { label, logo };
}

const matchesFilter = (status: string, filter: FilterType) => {
  if (filter === "all") return true;
  const normalized = String(status || "").toLowerCase();
  if (filter === "waiting") return normalized === "pending_shop_acceptance";
  if (filter === "accepted") return ["accepted_by_shop", "awaiting_payment", "payment_submitted", "paid_waiting_for_split", "commission_failed", "payment_verified", "awaiting_customer_confirmation"].includes(normalized);
  if (filter === "completed") return normalized === "completed";
  if (filter === "declined") return normalized === "declined_by_shop";
  if (filter === "cancelled") return ["cancelled", "cancelled_by_requester"].includes(normalized);
  return true;
};

const filterRequests = (allItems: ServiceRequest[], search: string, filter: FilterType) => {
  const normalizedSearch = search.trim().toLowerCase();
  return allItems.filter((item) => {
    if (!matchesFilter(item.status, filter)) return false;
    if (!normalizedSearch) return true;

    return [
      item.deceasedFullName,
      item.productName,
      item.shopName,
      item.familyCoordinatorName,
      item.contactNumber,
      item.churchName,
      item.cemeteryName,
      item.requesterName,
      item.requesterEmail,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
  });
};

const getScheduleLabel = (item: ServiceRequest) => {
  if (item.wakeStartDate && item.wakeEndDate) {
    return `Wake: ${formatServiceDate(item.wakeStartDate)} - ${formatServiceDate(item.wakeEndDate)}`;
  }
  if (item.wakeStartDate) return `Wake starts: ${formatServiceDate(item.wakeStartDate)}`;
  return "Schedule not provided";
};

const formatTimestamp = (value: any) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, { hour12: true });
};

export default function AdminOrdersScreen() {
  const { isDesktop } = useResponsive();
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [selectedItem, setSelectedItem] = useState<ServiceRequest | null>(null);

  const attachRequesterNames = useCallback(async (rows: ServiceRequest[]) => {
    const requesterIds = Array.from(new Set(rows.map((row) => row.requesterId).filter(Boolean)));
    const nameMap: Record<string, { name: string; email: string }> = {};

    if (requesterIds.length > 0) {
      const { data, error } = await supabase
        .from("users")
        .select("id, email, fullName")
        .in("id", requesterIds);

      if (!error) {
        (data || []).forEach((user: any) => {
          nameMap[user.id] = { name: user.fullName || "", email: user.email || "" };
        });
      }
    }

    return rows.map((row) => ({
      ...row,
      requesterName: nameMap[row.requesterId]?.name || "",
      requesterEmail: nameMap[row.requesterId]?.email || "",
    }));
  }, []);

  const loadOrders = useCallback(async () => {
    setLoadError("");
    try {
      const { data, error } = await supabase
        .from("funeral_service_requests")
        .select("*")
        .order("createdAt", { ascending: false });

      if (error) throw error;

      const rows = (data || []) as ServiceRequest[];
      const withNames = await attachRequesterNames(rows);
      setItems(withNames);
    } catch (error) {
      console.error(error);
      setLoadError("Unable to load service requests right now.");
    }
  }, [attachRequesterNames]);

  useFocusEffect(
    useCallback(() => {
      const task = setTimeout(() => {
        setLoading(true);
        void loadOrders().finally(() => setLoading(false));
      }, 0);
      return () => clearTimeout(task);
    }, [loadOrders])
  );

  const refreshOrders = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadOrders();
    } finally {
      setRefreshing(false);
    }
  }, [loadOrders]);

  const filteredItems = useMemo(
    () => filterRequests(items, searchQuery, filterType),
    [filterType, items, searchQuery]
  );

  const statusCounts = useMemo(
    () => ({
      all: items.length,
      waiting: items.filter((item) => matchesFilter(item.status, "waiting")).length,
      accepted: items.filter((item) => matchesFilter(item.status, "accepted")).length,
      completed: items.filter((item) => matchesFilter(item.status, "completed")).length,
      declined: items.filter((item) => matchesFilter(item.status, "declined")).length,
      cancelled: items.filter((item) => matchesFilter(item.status, "cancelled")).length,
    }),
    [items]
  );

  const renderItem = ({ item }: { item: ServiceRequest }) => {
    const statusMeta = getStatusMeta(item.status);
    const downpaymentBadge = getDownpaymentBadge(item);
    const totalPrice = item.productFullPrice ?? item.productPrice ?? item.paymentAmount;
    const initialAmount = item.downpaymentAmountSnapshot ?? item.paymentAmount;

    return (
      <TouchableOpacity
        accessibilityLabel={`View service request for ${item.deceasedFullName || "unnamed person"}`}
        accessibilityRole="button"
        style={styles.itemCard}
        activeOpacity={0.88}
        onPress={() => setSelectedItem(item)}
      >
        <View style={styles.itemTopRow}>
          <View style={styles.itemTextBlock}>
            <Text style={styles.itemTitle}>{item.deceasedFullName || "Unnamed deceased"}</Text>
            <Text style={styles.itemProduct}>{item.productName || "Custom request"}</Text>
          </View>
          <View style={styles.badgeColumn}>
            <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
              <Text style={[styles.statusBadgeText, { color: statusMeta.text }]}>{statusMeta.label}</Text>
            </View>
            {downpaymentBadge ? (
              <View style={[styles.statusBadge, { backgroundColor: downpaymentBadge.background, borderColor: downpaymentBadge.border, borderWidth: 1 }]}>
                <Text style={[styles.statusBadgeText, { color: downpaymentBadge.color, fontSize: 10 }]}>{downpaymentBadge.label}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.requestInfoList}>
          <View style={styles.requestInfoRow}>
            <Ionicons name="storefront-outline" size={14} color="#64748b" />
            <Text style={styles.itemMeta} numberOfLines={1}>Shop: {item.shopName || "Unknown"}</Text>
          </View>
          <View style={styles.requestInfoRow}>
            <Ionicons name="person-outline" size={14} color="#64748b" />
            <Text style={styles.itemMeta} numberOfLines={1}>
              Requester: {item.requesterName || item.requesterEmail || item.requesterId}
            </Text>
          </View>
          <View style={styles.requestInfoRow}>
            <Ionicons name="calendar-outline" size={14} color="#64748b" />
            <Text style={styles.itemMeta} numberOfLines={1}>{getScheduleLabel(item)}</Text>
          </View>
          <View style={styles.requestInfoRow}>
            <Ionicons name="cash-outline" size={14} color="#64748b" />
            <Text style={styles.itemMetaPrice}>
              Price: {totalPrice ? formatPhilippinePeso(String(totalPrice)) : "Custom pricing"}
              {item.paymentOption === "downpayment" && initialAmount
                ? ` (${formatPhilippinePeso(String(initialAmount))} downpayment)`
                : ""}
            </Text>
          </View>
        </View>

        <View style={styles.viewDetailsRow}>
          <Text style={styles.viewDetailsText}>View case record</Text>
          <Ionicons name="chevron-forward" size={14} color="#22312d" />
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <LoadingBird fullScreen />;
  }

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <View style={styles.headerCard}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>LifeCycle Funeral Services</Text>
          <Text style={styles.title}>All Service Requests</Text>
          <Text style={styles.subtitle}>Review arrangement cases and family payment records.</Text>
        </View>
        <View style={styles.pendingPill}>
          <Text style={styles.pendingPillLabel}>Waiting</Text>
          <Text style={styles.pendingPillValue}>{statusCounts.waiting}</Text>
        </View>
      </View>

      <Searchbar
        placeholder="Search deceased, item, shop, church..."
        value={searchQuery}
        onChangeText={setSearchQuery}
        style={styles.searchbar}
        inputStyle={styles.searchInput}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTER_OPTIONS.map((option) => {
          const count = statusCounts[option.value as keyof typeof statusCounts];
          const active = filterType === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilterType(option.value as FilterType)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{option.label}</Text>
              <View style={[styles.filterCountWrap, active && styles.filterCountWrapActive]}>
                <Text style={[styles.filterCount, active && styles.filterCountActive]}>{count}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loadError ? (
        <View style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={20} color="#b91c1c" />
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>Service requests are unavailable</Text>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={() => void refreshOrders()} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={refreshOrders}
        ListEmptyComponent={loadError ? undefined : <Text style={styles.emptyText}>No service requests found.</Text>}
      />

      {/* Request Details Modal */}
      <Modal
        visible={Boolean(selectedItem)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScroll}>
              {selectedItem ? (() => {
                const statusMeta = getStatusMeta(selectedItem.status);
                const downBadge = getDownpaymentBadge(selectedItem);
                const channelInfo = getPaymentChannelInfo(selectedItem);
                const totalServicePrice = selectedItem.productFullPrice ?? selectedItem.productPrice ?? selectedItem.paymentAmount;
                const initialReceivedAmount = selectedItem.downpaymentAmountSnapshot ?? selectedItem.paymentAmount;
                const isDownpayment = selectedItem.paymentOption === "downpayment";
                const hasPayment = Boolean(
                  selectedItem.paymentAmount
                    || selectedItem.downpaymentAmountSnapshot
                    || selectedItem.paymentPayerName
                    || selectedItem.paymentReferenceNumber
                    || selectedItem.paymentProofImageUrl
                    || selectedItem.paymentSubmittedAt
                );

                return (
                  <>
                    <View style={styles.modalHeader}>
                      <View style={styles.modalHeaderCopy}>
                        <Text style={styles.modalKicker}>Arrangement Case #{selectedItem.id.slice(0, 8).toUpperCase()}</Text>
                        <Text style={styles.modalTitle}>{selectedItem.deceasedFullName || "Unnamed deceased"}</Text>
                        <Text style={styles.modalSubtitle}>Filed {formatTimestamp(selectedItem.createdAt)}</Text>
                      </View>
                      <TouchableOpacity
                        accessibilityLabel="Close request details"
                        accessibilityRole="button"
                        onPress={() => setSelectedItem(null)}
                        style={styles.modalCloseButton}
                      >
                        <Ionicons name="close" size={20} color="#374151" />
                      </TouchableOpacity>
                    </View>

                    {/* Status Banner */}
                    <View style={styles.statusBannerRow}>
                      <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
                        <Text style={[styles.statusBadgeText, { color: statusMeta.text }]}>{statusMeta.label}</Text>
                      </View>
                      {downBadge ? (
                        <View style={[styles.statusBadge, { backgroundColor: downBadge.background, borderColor: downBadge.border, borderWidth: 1 }]}>
                          <Text style={[styles.statusBadgeText, { color: downBadge.color }]}>{downBadge.label}</Text>
                        </View>
                      ) : null}
                    </View>

                    {selectedItem.productImageUrl || selectedItem.memorialPhotoUrl ? (
                      <View style={styles.imageGallery}>
                        {selectedItem.memorialPhotoUrl ? (
                          <View style={styles.imageCard}>
                            <Image source={{ uri: selectedItem.memorialPhotoUrl }} style={styles.galleryImage} resizeMode="cover" />
                            <Text style={styles.imageCaption}>Deceased memorial photo</Text>
                          </View>
                        ) : null}
                        {selectedItem.productImageUrl ? (
                          <View style={styles.imageCard}>
                            <Image source={{ uri: selectedItem.productImageUrl }} style={styles.galleryImage} resizeMode="cover" />
                            <Text style={styles.imageCaption}>Requested casket / service</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {/* Service Info Section */}
                    <View style={styles.modalSection}>
                      <Text style={styles.sectionHeading}>Requested Service</Text>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Item</Text><Text style={styles.infoValue}>{selectedItem.productName || "Custom casket design"}</Text></View>
                      {selectedItem.variationName ? <View style={styles.infoRow}><Text style={styles.infoLabel}>Variation</Text><Text style={styles.infoValue}>{selectedItem.variationName}</Text></View> : null}
                      {selectedItem.packageItems?.length ? <View style={styles.infoRow}><Text style={styles.infoLabel}>Package</Text><Text style={styles.infoValue}>{selectedItem.packageItems.join(", ")}</Text></View> : null}
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Total Price</Text><Text style={styles.infoValueBold}>{totalServicePrice ? formatPhilippinePeso(String(totalServicePrice)) : "Custom pricing"}</Text></View>
                      {selectedItem.customDesignNotes ? (
                        <View style={styles.notesBlock}>
                          <Text style={styles.notesLabel}>Custom Design Notes</Text>
                          <Text style={styles.notesText}>{selectedItem.customDesignNotes}</Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Family Payment Section */}
                    {hasPayment ? (
                      <View style={styles.modalSection}>
                        <View style={styles.paymentSectionHeader}>
                          <Text style={styles.sectionHeading}>Family Payment</Text>
                          {downBadge ? (
                            <View style={[styles.statusBadge, { backgroundColor: downBadge.background, borderColor: downBadge.border, borderWidth: 1 }]}>
                              <Text style={[styles.statusBadgeText, { color: downBadge.color, fontSize: 10 }]}>{downBadge.label}</Text>
                            </View>
                          ) : null}
                        </View>

                        <View style={styles.infoRow}><Text style={styles.infoLabel}>Total Service Price</Text><Text style={styles.infoValueBold}>{formatPhilippinePeso(String(totalServicePrice))}</Text></View>
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Payment Type</Text>
                          <View style={styles.channelRow}>
                            {channelInfo.logo ? (
                              <Image source={channelInfo.logo} style={styles.unboxedChannelLogo} resizeMode="contain" />
                            ) : null}
                            <Text style={styles.infoValue}>{channelInfo.label}</Text>
                          </View>
                        </View>
                        <View style={styles.infoRow}><Text style={styles.infoLabel}>{isDownpayment ? "Downpayment Received" : "Amount Received"}</Text><Text style={styles.infoValueBold}>{formatPhilippinePeso(String(initialReceivedAmount))}</Text></View>
                        <View style={styles.infoRow}><Text style={styles.infoLabel}>Payer / Sender</Text><Text style={styles.infoValue}>{selectedItem.paymentPayerName || selectedItem.familyCoordinatorName || "—"}</Text></View>
                        {selectedItem.paymentGcashNumber ? <View style={styles.infoRow}><Text style={styles.infoLabel}>Account Number</Text><Text style={styles.infoValue}>{selectedItem.paymentGcashNumber}</Text></View> : null}
                        <View style={styles.infoRow}><Text style={styles.infoLabel}>Reference Number</Text><Text style={styles.infoValue}>{selectedItem.paymentReferenceNumber || selectedItem.providerPaymentId || `#PAY-${selectedItem.id.slice(0, 8).toUpperCase()}`}</Text></View>
                        <View style={styles.infoRow}><Text style={styles.infoLabel}>{selectedItem.paymentVerifiedAt ? "Confirmed" : "Submitted"}</Text><Text style={styles.infoValue}>{formatTimestamp(selectedItem.paymentVerifiedAt || selectedItem.paymentSubmittedAt)}</Text></View>

                        {/* Payment activity timeline */}
                        {(selectedItem.paymentSubmittedAt || selectedItem.paymentVerifiedAt) ? (
                          <View style={styles.paymentActivityBox}>
                            <Text style={styles.activityHeader}>Payment Activity</Text>
                            {selectedItem.paymentSubmittedAt ? (
                              <View style={styles.activityItem}>
                                <Text style={styles.activityTitle}>{isDownpayment ? "Downpayment submitted" : "Payment submitted"} • {channelInfo.label}</Text>
                                <Text style={styles.activitySub}>Amount: {formatPhilippinePeso(String(initialReceivedAmount))} • {formatTimestamp(selectedItem.paymentSubmittedAt)}</Text>
                              </View>
                            ) : null}
                            {selectedItem.paymentVerifiedAt ? (
                              <View style={styles.activityItem}>
                                <Text style={styles.activityTitle}>{isDownpayment ? "Downpayment confirmed" : "Payment confirmed"} • {channelInfo.label}</Text>
                                <Text style={styles.activitySub}>Shop received {formatPhilippinePeso(String(initialReceivedAmount))} • Total received: {formatPhilippinePeso(String(initialReceivedAmount))} of {formatPhilippinePeso(String(totalServicePrice))} • {formatTimestamp(selectedItem.paymentVerifiedAt)}</Text>
                              </View>
                            ) : null}
                          </View>
                        ) : null}

                        {selectedItem.paymentProofImageUrl ? (
                          <View style={styles.proofBox}>
                            <Text style={styles.proofTitle}>Submitted Receipt Proof</Text>
                            <Image source={{ uri: selectedItem.paymentProofImageUrl }} style={styles.proofImage} resizeMode="contain" />
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {/* Family Contact */}
                    <View style={styles.modalSection}>
                      <Text style={styles.sectionHeading}>Family Contact</Text>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Requester</Text><Text style={styles.infoValue}>{selectedItem.familyCoordinatorName || selectedItem.requesterName || "Not provided"}</Text></View>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Email</Text><Text style={styles.infoValue}>{selectedItem.requesterEmail || "Not provided"}</Text></View>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Contact Number</Text><Text style={styles.infoValue}>{selectedItem.contactNumber || "Not provided"}</Text></View>
                    </View>

                    {/* Schedule & Logistics */}
                    <View style={styles.modalSection}>
                      <Text style={styles.sectionHeading}>Schedule and Logistics</Text>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Wake Venue</Text><Text style={styles.infoValue}>{selectedItem.wakeAddress || "Not provided"}</Text></View>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Church / Chapel</Text><Text style={styles.infoValue}>{selectedItem.churchName || "Not provided"}</Text></View>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Cemetery</Text><Text style={styles.infoValue}>{selectedItem.cemeteryName || "Not provided"}</Text></View>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Wake Schedule</Text><Text style={styles.infoValue}>{selectedItem.wakeStartDate ? `${formatServiceDate(selectedItem.wakeStartDate)} to ${formatServiceDate(selectedItem.wakeEndDate)}` : "Not provided"}</Text></View>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Burial Time</Text><Text style={styles.infoValue}>{formatServiceTime(selectedItem.burialTime)}</Text></View>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Pickup Address</Text><Text style={styles.infoValue}>{selectedItem.pickupAddress || "Not provided"}</Text></View>
                    </View>

                    {/* Assigned Shop */}
                    <View style={styles.modalSection}>
                      <Text style={styles.sectionHeading}>Funeral Shop</Text>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Shop Name</Text><Text style={styles.infoValue}>{selectedItem.shopName || selectedItem.shopId || "Not provided"}</Text></View>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Phone</Text><Text style={styles.infoValue}>{selectedItem.shopContactNumber || "Not provided"}</Text></View>
                      <View style={styles.infoRow}><Text style={styles.infoLabel}>Address</Text><Text style={styles.infoValue}>{selectedItem.shopAddress || "Not provided"}</Text></View>
                    </View>

                    <TouchableOpacity style={styles.modalCloseActionButton} onPress={() => setSelectedItem(null)}>
                      <Text style={styles.modalCloseActionText}>Close</Text>
                    </TouchableOpacity>
                  </>
                );
              })() : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#fcfbf9",
    gap: 12,
  },
  containerDesktop: {
    maxWidth: 880,
    width: "100%",
    alignSelf: "center",
  },
  headerCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  headerCopy: {
    flex: 1,
  },
  kicker: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  title: {
    fontSize: 21,
    fontWeight: "800",
    color: "#1f2937",
    marginTop: 2,
  },
  subtitle: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 18,
    marginTop: 2,
  },
  pendingPill: {
    minWidth: 70,
    borderRadius: 14,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pendingPillLabel: {
    color: "#cbd5e1",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  pendingPillValue: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "800",
  },
  searchbar: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    height: 44,
  },
  searchInput: {
    minHeight: 44,
    fontSize: 13,
  },
  filterRow: {
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  filterChipActive: {
    borderColor: "#22312d",
    backgroundColor: "#22312d",
  },
  filterChipText: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: "#ffffff",
  },
  filterCountWrap: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterCountWrapActive: {
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  filterCount: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "800",
  },
  filterCountActive: {
    color: "#ffffff",
  },
  errorCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorCopy: { flex: 1 },
  errorTitle: { color: "#b91c1c", fontSize: 13, fontWeight: "800" },
  errorText: { color: "#64748b", fontSize: 12, marginTop: 1 },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#b91c1c",
  },
  retryButtonText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  listContent: {
    paddingTop: 4,
    paddingBottom: 36,
    gap: 10,
  },
  itemCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 14,
    gap: 8,
  },
  itemTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  itemTextBlock: { flex: 1 },
  itemTitle: { fontSize: 15, fontWeight: "800", color: "#1f2937" },
  itemProduct: { fontSize: 13, color: "#8b7255", fontWeight: "700", marginTop: 2 },
  badgeColumn: {
    alignItems: "flex-end",
    gap: 4,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  requestInfoList: {
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: "#f8fafc",
    paddingTop: 6,
  },
  requestInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  itemMeta: {
    color: "#64748b",
    fontSize: 12,
    flex: 1,
  },
  itemMetaPrice: {
    color: "#1f2937",
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },
  viewDetailsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#f8fafc",
  },
  viewDetailsText: {
    color: "#22312d",
    fontSize: 12,
    fontWeight: "700",
  },
  emptyText: {
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 36,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.6)",
    justifyContent: "flex-end",
  },
  modalCard: {
    width: "100%",
    maxHeight: "92%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  modalScroll: {
    padding: 18,
    paddingBottom: 36,
    gap: 14,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  modalHeaderCopy: { flex: 1 },
  modalKicker: { fontSize: 11, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase" },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#1f2937", marginTop: 2 },
  modalSubtitle: { fontSize: 12, color: "#64748b", marginTop: 2 },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  statusBannerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  imageGallery: {
    gap: 10,
  },
  imageCard: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
  },
  galleryImage: {
    width: "100%",
    height: 180,
  },
  imageCaption: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748b",
    padding: 8,
    textAlign: "center",
  },
  modalSection: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    gap: 8,
  },
  paymentSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: "800",
    color: "#1e293b",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  infoLabel: { fontSize: 12, color: "#64748b" },
  infoValue: { fontSize: 13, color: "#1f2937", fontWeight: "600", textAlign: "right", flex: 1 },
  infoValueBold: { fontSize: 14, color: "#1f2937", fontWeight: "800", textAlign: "right" },
  channelRow: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "flex-end" },
  unboxedChannelLogo: { width: 34, height: 16 },
  notesBlock: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginTop: 4,
  },
  notesLabel: { fontSize: 11, fontWeight: "700", color: "#64748b" },
  notesText: { fontSize: 12, color: "#334155", marginTop: 2, lineHeight: 17 },
  paymentActivityBox: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 10,
    marginTop: 4,
    gap: 6,
  },
  activityHeader: { fontSize: 11, fontWeight: "800", color: "#475569", textTransform: "uppercase" },
  activityItem: { gap: 2 },
  activityTitle: { fontSize: 12, fontWeight: "700", color: "#1e293b" },
  activitySub: { fontSize: 11, color: "#64748b", lineHeight: 15 },
  proofBox: {
    marginTop: 6,
    gap: 6,
  },
  proofTitle: { fontSize: 11, fontWeight: "700", color: "#64748b", textTransform: "uppercase" },
  proofImage: { width: "100%", height: 180, borderRadius: 10, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#e2e8f0" },
  modalCloseActionButton: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  modalCloseActionText: { fontSize: 13, fontWeight: "700", color: "#374151" },
});
