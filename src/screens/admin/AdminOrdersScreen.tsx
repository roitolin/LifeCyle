import { useCallback, useEffect, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Searchbar, SegmentedButtons } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { useResponsive } from "@/utils/responsive";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { formatServiceDate, formatServiceTime } from "@/utils/serviceRequestSchedule";

type FilterType = "all" | "waiting" | "accepted" | "declined" | "cancelled";

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
  requestType?: string;
  customDesignNotes?: string | null;
  memorialPhotoUrl?: string | null;
  referencePhotoUrl?: string | null;
  deceasedFullName?: string | null;
  deceasedDateOfBirth?: string | null;
  deceasedAge?: number | null;
  tributeMessage?: string | null;
  familyCoordinatorName?: string | null;
  wakeAddress?: string | null;
  wakeStartDate?: string | null;
  wakeEndDate?: string | null;
  burialTime?: string | null;
  pickupAddress?: string | null;
  contactNumber?: string | null;
  status: string;
  paymentQrUrl?: string | null;
  paymentAmount?: number | string | null;
  paymentPayerName?: string | null;
  paymentGcashNumber?: string | null;
  paymentReferenceNumber?: string | null;
  paymentProofImageUrl?: string | null;
  paymentRejectionReason?: string | null;
  paymentSubmittedAt?: any;
  paymentVerifiedAt?: any;
  completedAt?: any;
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
  if (normalized === "payment_verified") {
    return { label: "Payment Confirmed", background: "#e7f5ec", text: "#166534" };
  }
  if (normalized === "completed") {
    return { label: "Completed", background: "#14532d", text: "#ffffff" };
  }
  if (normalized === "declined_by_shop") {
    return { label: "Declined", background: "#fde8e8", text: "#991b1b" };
  }
  if (normalized === "cancelled_by_requester") {
    return { label: "Cancelled", background: "#eef1ec", text: "#4c5b57" };
  }
  return { label: "Waiting", background: "#fef3c7", text: "#86654a" };
};

const matchesFilter = (status: string, filter: FilterType) => {
  if (filter === "all") return true;
  const normalized = String(status || "").toLowerCase();
  if (filter === "waiting") return normalized === "pending_shop_acceptance";
  if (filter === "accepted") return ["accepted_by_shop", "awaiting_payment", "payment_submitted", "payment_verified", "completed"].includes(normalized);
  if (filter === "declined") return normalized === "declined_by_shop";
  if (filter === "cancelled") return normalized === "cancelled_by_requester";
  return true;
};

const formatTimestamp = (value: any) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, { hour12: true });
};

export default function AdminOrdersScreen() {
  const { isDesktop } = useResponsive();
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [filteredItems, setFilteredItems] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  const applyFilters = useCallback((allItems: ServiceRequest[], search: string, filter: FilterType) => {
    let result = [...allItems];

    result = result.filter((item) => matchesFilter(item.status, filter));

    if (search.trim()) {
      const lower = search.trim().toLowerCase();
      result = result.filter((item) =>
        [
          item.deceasedFullName,
          item.productName,
          item.shopName,
          item.familyCoordinatorName,
          item.contactNumber,
          item.requesterName,
          item.requesterEmail,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(lower))
      );
    }

    setFilteredItems(result);
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("funeral_service_requests")
        .select("*")
        .order("createdAt", { ascending: false });

      if (error) throw error;

      const rows = (data || []) as ServiceRequest[];
      const withNames = await attachRequesterNames(rows);
      setItems(withNames);
      applyFilters(withNames, searchQuery, filterType);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load service requests.");
    }
  }, [applyFilters, attachRequesterNames, filterType, searchQuery]);

  useEffect(() => {
    setLoading(true);
    void loadOrders().finally(() => setLoading(false));
  }, [loadOrders]);

  const refreshOrders = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadOrders();
    } finally {
      setRefreshing(false);
    }
  }, [loadOrders]);

  const renderItem = ({ item }: { item: ServiceRequest }) => {
    const statusMeta = getStatusMeta(item.status);
    return (
      <TouchableOpacity style={styles.itemCard} activeOpacity={0.85} onPress={() => setSelectedItem(item)}>
        <View style={styles.itemTopRow}>
          <View style={styles.itemTextBlock}>
            <Text style={styles.itemTitle}>{item.deceasedFullName || "Unnamed deceased"}</Text>
            <Text style={styles.itemProduct}>{item.productName || "Custom request"}</Text>
            <Text style={styles.itemMeta}>Shop: {item.shopName || "Unknown"}</Text>
            <Text style={styles.itemMeta}>
              Requester: {item.requesterName || item.requesterEmail || item.requesterId}
            </Text>
            <Text style={styles.itemMeta}>Sent: {formatTimestamp(item.createdAt)}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
            <Text style={[styles.statusBadgeText, { color: statusMeta.text }]}>{statusMeta.label}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <LoadingBird fullScreen />;
  }

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <Text style={styles.title}>All Service Requests</Text>
      <Text style={styles.subtitle}>Across every funeral shop.</Text>

      <Searchbar
        placeholder="Search by deceased, item, shop, or coordinator"
        value={searchQuery}
        onChangeText={(value) => {
          setSearchQuery(value);
          applyFilters(items, value, filterType);
        }}
        style={styles.searchbar}
      />

      <SegmentedButtons
        value={filterType}
        onValueChange={(value) => {
          const nextFilter = value as FilterType;
          setFilterType(nextFilter);
          applyFilters(items, searchQuery, nextFilter);
        }}
        buttons={FILTER_OPTIONS}
      />

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={refreshOrders}
        ListEmptyComponent={<Text style={styles.emptyText}>No service requests found.</Text>}
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
                  <Text style={styles.modalTitle}>{selectedItem.deceasedFullName || "Unnamed deceased"}</Text>
                  <Text style={styles.modalSubtitle}>
                    {selectedItem.requestType === "custom_casket" ? "Custom Casket Request" : "Catalog Product Request"}
                  </Text>
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

                  <Text style={styles.detailLabel}>Price</Text>
                  <Text style={styles.detailValue}>
                    {selectedItem.productPrice != null ? formatPhilippinePeso(selectedItem.productPrice) : "Custom pricing"}
                  </Text>

                  {["awaiting_payment", "payment_submitted", "payment_verified", "completed"].includes(
                    String(selectedItem.status || "").toLowerCase()
                  ) ? (
                    <>
                      <Text style={styles.detailLabel}>Shop Payment Amount</Text>
                      <Text style={styles.detailValue}>
                        {Number(selectedItem.paymentAmount) > 0
                          ? formatPhilippinePeso(String(selectedItem.paymentAmount))
                          : "Not configured"}
                      </Text>

                      {selectedItem.paymentQrUrl ? (
                        <>
                          <Text style={styles.detailLabel}>Shop Payment QR</Text>
                          <Image source={{ uri: selectedItem.paymentQrUrl }} style={styles.modalMainImage} resizeMode="contain" />
                        </>
                      ) : null}

                      {selectedItem.paymentPayerName ? (
                        <>
                          <Text style={styles.detailLabel}>Payer</Text>
                          <Text style={styles.detailValue}>{selectedItem.paymentPayerName}</Text>
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
                    </>
                  ) : null}

                  <Text style={styles.detailLabel}>Shop</Text>
                  <Text style={styles.detailValue}>{selectedItem.shopName || selectedItem.shopId || "-"}</Text>

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

                  <Text style={styles.detailLabel}>Deceased Age</Text>
                  <Text style={styles.detailValue}>{selectedItem.deceasedAge != null ? selectedItem.deceasedAge : "Not provided"}</Text>

                  <Text style={styles.detailLabel}>Wake Venue</Text>
                  <Text style={styles.detailValue}>{selectedItem.wakeAddress || "-"}</Text>

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
    padding: 16,
    backgroundColor: "#f5f5f5",
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
    fontSize: 26,
    fontWeight: "800",
    color: "#334155",
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
    color: "#4b5563",
    lineHeight: 20,
  },
  searchbar: {
    marginBottom: 10,
  },
  listContent: {
    paddingTop: 10,
    paddingBottom: 24,
    gap: 10,
  },
  itemCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 14,
  },
  itemTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  itemTextBlock: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
  },
  itemProduct: {
    fontSize: 13,
    fontWeight: "700",
    color: "#b91c1c",
    marginTop: 3,
  },
  itemMeta: {
    color: "#475569",
    lineHeight: 19,
    fontSize: 13,
    marginTop: 3,
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
  emptyText: {
    textAlign: "center",
    color: "#64748b",
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
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 18,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
  },
  modalSubtitle: {
    color: "#64748b",
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
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 10,
    marginBottom: 4,
  },
  detailValue: {
    color: "#334155",
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
    backgroundColor: "#eef1ec",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  closeButtonText: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "900",
  },
});
