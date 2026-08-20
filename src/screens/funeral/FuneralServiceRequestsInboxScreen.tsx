import { useCallback, useMemo, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/services/supabaseClient";
import { auth } from "@/services";
import { formatServiceDate, formatServiceTime } from "@/utils/serviceRequestSchedule";

type FuneralServiceRequest = {
  id: string;
  requesterId: string;
  shopId: string;
  shopName: string;
  productId: string;
  productName: string;
  productPrice?: string;
  productImageUrl?: string | null;
  variationName?: string | null;
  requestType?: string;
  customDesignNotes?: string | null;
  memorialPhotoUrl?: string | null;
  referencePhotoUrl?: string | null;
  deceasedFullName: string;
  deceasedDateOfBirth?: string;
  deceasedDateOfPassing?: any;
  deceasedAge?: number | null;
  tributeMessage: string;
  familyCoordinatorName: string;
  wakeAddress: string;
  wakeStartDate?: string | null;
  wakeEndDate?: string | null;
  burialTime?: string | null;
  pickupAddress: string;
  contactNumber: string;
  shopContactNumber?: string | null;
  shopAddress?: string | null;
  status: string;
  paymentQrUrl?: string | null;
  paymentAmount?: number | string | null;
  paymentPayerName?: string | null;
  paymentGcashNumber?: string | null;
  paymentReferenceNumber?: string | null;
  paymentProofImageUrl?: string | null;
  paymentSubmittedAt?: any;
  paymentVerifiedAt?: any;
  paymentRejectionReason?: string | null;
  completedAt?: any;
  createdAt?: any;
  acceptedAt?: any;
  declinedAt?: any;
};

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
  if (normalized === "awaiting_customer_confirmation") {
    return { label: "Awaiting Customer Confirmation", background: "#fef3c7", text: "#86654a" };
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

const formatTimestamp = (value: any) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString(undefined, { hour12: true });
};

export default function FuneralServiceRequestsInboxScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<FuneralServiceRequest[]>([]);

  const loadRequests = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;

    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from("funeral_service_requests")
        .select("*")
        .eq("shopId", user.uid)
        .order("createdAt", { ascending: false });

      const nextRequests = (rows || []) as FuneralServiceRequest[];
      setRequests(nextRequests);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to load service requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadRequests();
    }, [loadRequests])
  );

  const pendingCount = useMemo(
    () => requests.filter((item: any) => String(item.status || "").toLowerCase() === "pending_shop_acceptance").length,
    [requests]
  );

  const openDetails = useCallback(
    (item: FuneralServiceRequest) => {
      navigation.navigate("ServiceRequestDetails", { request: item });
    },
    [navigation]
  );

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <View>
            <Text style={styles.headerEyebrow}>Service Request Inbox</Text>
            <Text style={styles.headerTitle}>Family Requests</Text>
            <Text style={styles.headerSubtitle}>Review incoming requests and respond so families know your next step.</Text>
          </View>
          <View style={styles.pendingPill}>
            <Text style={styles.pendingPillLabel}>Waiting</Text>
            <Text style={styles.pendingPillValue}>{pendingCount}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.refreshButton} onPress={() => void loadRequests()}>
          <Ionicons name="refresh-outline" size={16} color="#22312d" />
          <Text style={styles.refreshButtonText}>Refresh Requests</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.loadingWrap}>
            <LoadingBird />
          </View>
        ) : requests.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="mail-open-outline" size={28} color="#8b938c" />
            <Text style={styles.emptyTitle}>No service requests yet</Text>
            <Text style={styles.emptyText}>When a family sends a request, it will appear here for review.</Text>
          </View>
        ) : (
          requests.map((item: any) => {
            const statusMeta = getStatusMeta(item.status);

            return (
              <TouchableOpacity key={item.id} style={styles.requestCard} activeOpacity={0.92} onPress={() => openDetails(item)}>
                <View style={styles.requestTopRow}>
                  <View style={styles.requestTextBlock}>
                    <Text style={styles.requestName}>{item.deceasedFullName}</Text>
                    <Text style={styles.requestProduct}>{item.productName}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
                    <Text style={[styles.statusBadgeText, { color: statusMeta.text }]}>{statusMeta.label}</Text>
                  </View>
                </View>

                <Text style={styles.requestMeta}>Coordinator: {item.familyCoordinatorName}</Text>
                <Text style={styles.requestMeta}>Contact: {item.contactNumber}</Text>
                {item.wakeStartDate && item.wakeEndDate ? (
                  <Text style={styles.requestMeta}>
                    Wake: {formatServiceDate(item.wakeStartDate)} to {formatServiceDate(item.wakeEndDate)}
                  </Text>
                ) : null}
                {item.wakeEndDate && item.burialTime ? (
                  <Text style={styles.requestMeta}>Burial: {formatServiceDate(item.wakeEndDate)} at {formatServiceTime(item.burialTime)}</Text>
                ) : null}
                <Text style={styles.requestMeta}>Sent: {formatTimestamp(item.createdAt)}</Text>

                <View style={styles.viewDetailsRow}>
                  <Text style={styles.viewDetailsText}>View Details</Text>
                  <Ionicons name="chevron-forward" size={16} color="#8b7255" />
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef1ec",
  },
  content: {
    padding: 18,
    paddingBottom: 32,
    gap: 14,
  },
  headerCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#f8f6f2",
    padding: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  headerEyebrow: {
    color: "#8b7255",
    fontSize: 12,
    fontWeight: "800",
  },
  headerTitle: {
    color: "#22312d",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 4,
  },
  headerSubtitle: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: 240,
  },
  pendingPill: {
    minWidth: 82,
    borderRadius: 20,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pendingPillLabel: {
    color: "#d2d7d1",
    fontSize: 11,
    fontWeight: "700",
  },
  pendingPillValue: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
  },
  refreshButton: {
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  refreshButtonText: {
    color: "#22312d",
    fontSize: 13,
    fontWeight: "900",
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 42,
  },
  loadingText: {
    color: "#62706b",
    fontSize: 13,
    marginTop: 10,
  },
  emptyCard: {
    borderRadius: 24,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 30,
  },
  emptyTitle: {
    color: "#22312d",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 12,
  },
  emptyText: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 6,
  },
  requestCard: {
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 16,
  },
  requestTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  requestTextBlock: {
    flex: 1,
  },
  requestName: {
    color: "#22312d",
    fontSize: 17,
    fontWeight: "900",
  },
  requestProduct: {
    color: "#8b7255",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  requestMeta: {
    color: "#62706b",
    fontSize: 13,
    marginTop: 8,
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
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#eef1ec",
  },
  viewDetailsText: {
    color: "#8b7255",
    fontSize: 13,
    fontWeight: "900",
  },
});
