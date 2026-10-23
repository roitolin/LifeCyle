import { useCallback, useMemo, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
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
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from "@/services/supabaseClient";
import { useResponsive } from "@/utils/responsive";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { formatServiceDate, formatServiceTime } from "@/utils/serviceRequestSchedule";
import { colors, radii, spacing } from "@/theme";

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
    return { label: "Payment Confirmed", background: "#e7f5ec", text: "#166534" };
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
    return (
      <TouchableOpacity
        accessibilityLabel={`View service request for ${item.deceasedFullName || "unnamed person"}`}
        accessibilityRole="button"
        style={styles.itemCard}
        activeOpacity={0.88}
        onPress={() => setSelectedItem(item)}
      >
        <View style={styles.itemTopRow}>
          <View style={styles.requestIcon}>
            <Ionicons name="mail-open-outline" size={19} color={colors.primary} />
          </View>
          <View style={styles.itemTextBlock}>
            <Text style={styles.itemTitle}>{item.deceasedFullName || "Unnamed deceased"}</Text>
            <Text style={styles.itemProduct}>{item.productName || "Custom request"}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
            <Text style={[styles.statusBadgeText, { color: statusMeta.text }]}>{statusMeta.label}</Text>
          </View>
        </View>

        <View style={styles.requestInfoList}>
          <View style={styles.requestInfoRow}>
            <Ionicons name="storefront-outline" size={15} color={colors.textMuted} />
            <Text style={styles.itemMeta} numberOfLines={1}>Shop: {item.shopName || "Unknown"}</Text>
          </View>
          <View style={styles.requestInfoRow}>
            <Ionicons name="person-outline" size={15} color={colors.textMuted} />
            <Text style={styles.itemMeta} numberOfLines={1}>
              Requester: {item.requesterName || item.requesterEmail || item.requesterId}
            </Text>
          </View>
          <View style={styles.requestInfoRow}>
            <Ionicons name="call-outline" size={15} color={colors.textMuted} />
            <Text style={styles.itemMeta} numberOfLines={1}>
              Contact: {item.contactNumber || "Not provided"}
            </Text>
          </View>
          {item.churchName ? (
            <View style={styles.requestInfoRow}>
              <Ionicons name="location-outline" size={15} color={colors.textMuted} />
              <Text style={styles.itemMeta} numberOfLines={1}>Church / Chapel: {item.churchName}</Text>
            </View>
          ) : null}
          {item.cemeteryName ? (
            <View style={styles.requestInfoRow}>
              <Ionicons name="navigate-outline" size={15} color={colors.textMuted} />
              <Text style={styles.itemMeta} numberOfLines={1}>Cemetery: {item.cemeteryName}</Text>
            </View>
          ) : null}
          {item.packageItems?.length ? (
            <View style={styles.requestInfoRow}>
              <Ionicons name="list-outline" size={15} color={colors.textMuted} />
              <Text style={styles.itemMeta} numberOfLines={1}>Packages: {item.packageItems.join(", ")}</Text>
            </View>
          ) : null}
          <View style={styles.requestInfoRow}>
            <Ionicons name="calendar-outline" size={15} color={colors.textMuted} />
            <Text style={styles.itemMeta}>{getScheduleLabel(item)}</Text>
          </View>
          {item.wakeEndDate && item.burialTime ? (
            <View style={styles.requestInfoRow}>
              <Ionicons name="time-outline" size={15} color={colors.textMuted} />
              <Text style={styles.itemMeta}>Burial: {formatServiceDate(item.wakeEndDate)} at {formatServiceTime(item.burialTime)}</Text>
            </View>
          ) : null}
          <View style={styles.requestInfoRow}>
            <Ionicons name="time-outline" size={15} color={colors.textMuted} />
            <Text style={styles.itemMeta}>Sent: {formatTimestamp(item.createdAt)}</Text>
          </View>
        </View>

        <View style={styles.viewDetailsRow}>
          <Text style={styles.viewDetailsText}>View request details</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
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
          <Text style={styles.title}>Service requests</Text>
          <Text style={styles.subtitle}>Review family requests across every shop.</Text>
        </View>
        <View style={styles.pendingPill}>
          <Text style={styles.pendingPillLabel}>Waiting</Text>
          <Text style={styles.pendingPillValue}>{statusCounts.waiting}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.refreshButton} onPress={() => void refreshOrders()}>
        <Ionicons name="refresh-outline" size={16} color={colors.primaryDark} />
        <Text style={styles.refreshButtonText}>Refresh requests</Text>
      </TouchableOpacity>

      <Searchbar
        placeholder="Search by deceased, item, shop, or coordinator"
        value={searchQuery}
        onChangeText={setSearchQuery}
        style={styles.searchbar}
      />

      <View style={styles.filterHeading}>
        <Text style={styles.filterHeadingTitle}>Filter requests</Text>
        <Text style={styles.filterHeadingCount}>{filteredItems.length} showing</Text>
      </View>
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
              <Text style={[styles.filterCount, active && styles.filterCountActive]}>{count}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loadError ? (
        <View style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={22} color={colors.danger} />
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
        ListEmptyComponent={loadError ? null : <Text style={styles.emptyText}>No service requests found.</Text>}
      />

      <Modal
        visible={Boolean(selectedItem)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {selectedItem ? (
                <>
                  <View style={styles.modalHeader}>
                    <View style={styles.modalHeaderCopy}>
                      <Text style={styles.modalTitle}>{selectedItem.deceasedFullName || "Unnamed deceased"}</Text>
                      <Text style={styles.modalSubtitle}>
                        {selectedItem.requestType === "custom_casket" ? "Custom casket request" : "Catalog product request"}
                      </Text>
                    </View>
                    <TouchableOpacity
                      accessibilityLabel="Close request details"
                      accessibilityRole="button"
                      onPress={() => setSelectedItem(null)}
                      style={styles.modalCloseButton}
                    >
                      <Ionicons name="close" size={21} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                  {selectedItem.productImageUrl ? (
                    <Image source={{ uri: selectedItem.productImageUrl }} style={styles.modalMainImage} resizeMode="cover" />
                  ) : null}
                  {selectedItem.memorialPhotoUrl ? (
                    <Image source={{ uri: selectedItem.memorialPhotoUrl }} style={styles.modalMainImage} resizeMode="cover" />
                  ) : null}
                  {selectedItem.referencePhotoUrl ? (
                    <Image source={{ uri: selectedItem.referencePhotoUrl }} style={styles.modalMainImage} resizeMode="cover" />
                  ) : null}

                  <Text style={styles.detailLabel}>Status</Text>
                  <View style={[styles.modalStatusBadge, { backgroundColor: getStatusMeta(selectedItem.status).background }]}>
                    <Text style={[styles.statusBadgeText, { color: getStatusMeta(selectedItem.status).text }]}>
                      {getStatusMeta(selectedItem.status).label}
                    </Text>
                  </View>

                  <Text style={styles.detailLabel}>Requested Item</Text>
                  <Text style={styles.detailValue}>
                    {selectedItem.productName || "Custom casket design"}
                    {selectedItem.variationName ? ` (${selectedItem.variationName})` : ""}
                  </Text>

                  <Text style={styles.detailLabel}>Package Inclusions</Text>
                  <Text style={styles.detailValue}>
                    {selectedItem.packageItems?.length ? selectedItem.packageItems.join(", ") : "None included"}
                  </Text>

                  <Text style={styles.detailLabel}>Price</Text>
                  <Text style={styles.detailValue}>
                    {selectedItem.productPrice != null ? formatPhilippinePeso(selectedItem.productPrice) : "Custom pricing"}
                  </Text>

                  {["awaiting_payment", "payment_submitted", "paid_waiting_for_split", "commission_failed", "payment_verified", "completed"].includes(
                    String(selectedItem.status || "").toLowerCase()
                  ) ? (
                    <>
                      <Text style={styles.detailLabel}>Shop Payment Amount</Text>
                      <Text style={styles.detailValue}>
                        {Number(selectedItem.paymentAmount) > 0
                          ? formatPhilippinePeso(String(selectedItem.paymentAmount))
                          : "Not configured"}
                      </Text>

                      {selectedItem.paymentPayerName || selectedItem.paymentGcashName ? (
                        <>
                          <Text style={styles.detailLabel}>Payer</Text>
                          <Text style={styles.detailValue}>{selectedItem.paymentPayerName || selectedItem.paymentGcashName}</Text>
                          <Text style={styles.detailLabel}>GCash Number</Text>
                          <Text style={styles.detailValue}>{selectedItem.paymentGcashNumber || "-"}</Text>
                          <Text style={styles.detailLabel}>Reference Number</Text>
                          <Text style={styles.detailValue}>{selectedItem.paymentReferenceNumber || "-"}</Text>
                        </>
                      ) : null}

                      {selectedItem.paymentProofImageUrl ? (
                        <>
                          <Text style={styles.detailLabel}>Payment Proof</Text>
                          <Image source={{ uri: selectedItem.paymentProofImageUrl }} style={styles.modalMainImage} resizeMode="contain" />
                        </>
                      ) : null}

                      {selectedItem.paymentRejectionReason ? (
                        <>
                          <Text style={styles.detailLabel}>Payment Rejection Reason</Text>
                          <Text style={styles.detailValue}>{selectedItem.paymentRejectionReason}</Text>
                        </>
                      ) : null}

                      {selectedItem.payoutStatus || selectedItem.payoutAmount ? (
                        <>
                          <Text style={styles.detailLabel}>Shop Payout (70%)</Text>
                          <Text style={styles.detailValue}>
                            {selectedItem.payoutAmount ? formatPhilippinePeso(String(selectedItem.payoutAmount)) : "-"}
                            {` (${selectedItem.payoutStatus || "pending"}${selectedItem.payoutFailureCode ? `: ${selectedItem.payoutFailureCode}` : ""})`}
                          </Text>
                          <Text style={styles.detailLabel}>Admin Commission (30%)</Text>
                          <Text style={styles.detailValue}>
                            {formatPhilippinePeso(String(Math.round(Number(selectedItem.paymentAmount || selectedItem.productPrice || 0) * 0.3)))}
                          </Text>
                        </>
                      ) : null}
                    </>
                  ) : null}

                  <Text style={styles.detailLabel}>Shop</Text>
                  <Text style={styles.detailValue}>{selectedItem.shopName || selectedItem.shopId || "-"}</Text>

                  <Text style={styles.detailLabel}>Shop Contact</Text>
                  <Text style={styles.detailValue}>{selectedItem.shopContactNumber || "Not provided"}</Text>

                  <Text style={styles.detailLabel}>Shop Address</Text>
                  <Text style={styles.detailValue}>{selectedItem.shopAddress || "Not provided"}</Text>

                  <Text style={styles.detailLabel}>Requester</Text>
                  <Text style={styles.detailValue}>
                    {selectedItem.requesterName || selectedItem.requesterEmail || selectedItem.requesterId}
                  </Text>

                  {selectedItem.customDesignNotes ? (
                    <>
                      <Text style={styles.detailLabel}>Custom Design Notes</Text>
                      <Text style={styles.detailValue}>{selectedItem.customDesignNotes}</Text>
                    </>
                  ) : null}

                  <Text style={styles.detailLabel}>Family Coordinator</Text>
                  <Text style={styles.detailValue}>{selectedItem.familyCoordinatorName || "-"}</Text>

                  <Text style={styles.detailLabel}>Contact Number</Text>
                  <Text style={styles.detailValue}>{selectedItem.contactNumber || "-"}</Text>

                  <Text style={styles.detailLabel}>Deceased Date of Birth</Text>
                  <Text style={styles.detailValue}>{selectedItem.deceasedDateOfBirth || "Not provided"}</Text>

                  <Text style={styles.detailLabel}>Date of Passing</Text>
                  <Text style={styles.detailValue}>{selectedItem.deceasedDateOfPassing || "Not provided"}</Text>

                  <Text style={styles.detailLabel}>Deceased Age</Text>
                  <Text style={styles.detailValue}>{selectedItem.deceasedAge != null ? selectedItem.deceasedAge : "Not provided"}</Text>

                  <Text style={styles.detailLabel}>Wake Venue</Text>
                  <Text style={styles.detailValue}>{selectedItem.wakeAddress || "-"}</Text>

                  <Text style={styles.detailLabel}>Church / Chapel</Text>
                  <Text style={styles.detailValue}>{selectedItem.churchName || "Not provided"}</Text>

                  <Text style={styles.detailLabel}>Cemetery</Text>
                  <Text style={styles.detailValue}>{selectedItem.cemeteryName || "Not provided"}</Text>

                  <Text style={styles.detailLabel}>Wake From</Text>
                  <Text style={styles.detailValue}>{formatServiceDate(selectedItem.wakeStartDate)}</Text>

                  <Text style={styles.detailLabel}>Wake To</Text>
                  <Text style={styles.detailValue}>{formatServiceDate(selectedItem.wakeEndDate)}</Text>

                  <Text style={styles.detailLabel}>Burial</Text>
                  <Text style={styles.detailValue}>
                    {selectedItem.wakeEndDate && selectedItem.burialTime
                      ? `${formatServiceDate(selectedItem.wakeEndDate)} at ${formatServiceTime(selectedItem.burialTime)}`
                      : "Not provided"}
                  </Text>

                  <Text style={styles.detailLabel}>Pickup Address</Text>
                  <Text style={styles.detailValue}>{selectedItem.pickupAddress || "-"}</Text>

                  {selectedItem.tributeMessage ? (
                    <>
                      <Text style={styles.detailLabel}>Tribute Message</Text>
                      <Text style={styles.detailValue}>{selectedItem.tributeMessage}</Text>
                    </>
                  ) : null}

                  <Text style={styles.detailLabel}>Request ID</Text>
                  <Text style={styles.detailValue}>{selectedItem.id}</Text>

                  <Text style={styles.detailLabel}>Created</Text>
                  <Text style={styles.detailValue}>{formatTimestamp(selectedItem.createdAt)}</Text>

                  {selectedItem.acceptedAt ? (
                    <>
                      <Text style={styles.detailLabel}>Accepted At</Text>
                      <Text style={styles.detailValue}>{formatTimestamp(selectedItem.acceptedAt)}</Text>
                    </>
                  ) : null}
                  {selectedItem.declinedAt ? (
                    <>
                      <Text style={styles.detailLabel}>Declined At</Text>
                      <Text style={styles.detailValue}>{formatTimestamp(selectedItem.declinedAt)}</Text>
                    </>
                  ) : null}
                  {selectedItem.cancelledAt ? (
                    <>
                      <Text style={styles.detailLabel}>Cancelled At</Text>
                      <Text style={styles.detailValue}>{formatTimestamp(selectedItem.cancelledAt)}</Text>
                    </>
                  ) : null}

                  {selectedItem.completionProofImageUrl ? (
                    <>
                      <Text style={styles.detailLabel}>Completion Proof</Text>
                      <Image source={{ uri: selectedItem.completionProofImageUrl }} style={styles.modalMainImage} resizeMode="contain" />
                    </>
                  ) : null}

                  <TouchableOpacity style={styles.closeButton} onPress={() => setSelectedItem(null)}>
                    <Text style={styles.closeButtonText}>Close</Text>
                  </TouchableOpacity>
                </>
              ) : null}
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
    padding: spacing.md,
    backgroundColor: colors.surfaceMuted,
    gap: spacing.sm,
  },
  containerDesktop: {
    maxWidth: 920,
    width: "100%",
    alignSelf: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: colors.primaryDark,
  },
  subtitle: {
    marginTop: 4,
    color: colors.textMuted,
    lineHeight: 20,
  },
  headerCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    backgroundColor: colors.surfaceWarm,
    padding: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerCopy: {
    flex: 1,
  },
  pendingPill: {
    minWidth: 78,
    borderRadius: 20,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  pendingPillLabel: {
    color: "#d2d7d1",
    fontSize: 11,
    fontWeight: "700",
  },
  pendingPillValue: {
    color: colors.surface,
    fontSize: 25,
    fontWeight: "900",
  },
  refreshButton: {
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  refreshButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
  },
  searchbar: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  filterHeadingTitle: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
  },
  filterHeadingCount: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  filterRow: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  filterChip: {
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  filterChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  filterChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  filterChipTextActive: {
    color: colors.surface,
  },
  filterCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
    paddingTop: 2,
  },
  filterCountActive: {
    backgroundColor: "rgba(255,255,255,0.2)",
    color: colors.surface,
  },
  errorCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: "#e8c8c5",
    backgroundColor: "#fff8f7",
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  errorCopy: {
    flex: 1,
  },
  errorTitle: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "900",
  },
  errorText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  retryButton: {
    minHeight: 34,
    borderRadius: 9,
    backgroundColor: colors.primary,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  retryButtonText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900",
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: 24,
    gap: spacing.sm,
  },
  itemCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    padding: spacing.md,
  },
  itemTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  requestIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  itemTextBlock: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.primaryDark,
  },
  itemProduct: {
    fontSize: 13,
    fontWeight: "800",
    color: "#8b7255",
    marginTop: 3,
  },
  requestInfoList: {
    marginTop: spacing.sm,
    gap: 4,
  },
  requestInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  itemMeta: {
    flex: 1,
    color: colors.textMuted,
    lineHeight: 19,
    fontSize: 13,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "900",
  },
  viewDetailsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },
  viewDetailsText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  emptyText: {
    textAlign: "center",
    color: colors.textMuted,
    marginTop: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "88%",
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  modalHeaderCopy: {
    flex: 1,
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: colors.primaryDark,
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
    marginBottom: 12,
  },
  modalMainImage: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    marginBottom: 12,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 10,
    marginBottom: 4,
  },
  detailValue: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  modalStatusBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  closeButtonText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
  },
});
