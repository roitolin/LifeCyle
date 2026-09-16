import { useCallback, useEffect, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Button, Searchbar, SegmentedButtons } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { auth } from "@/services";
import { provisionXenditShop } from "@/services/xenditAdmin";
import { useResponsive } from "@/utils/responsive";
import { logAdminAction } from "@/utils/adminAuditLog";

type ShopStatus = "pending" | "verified" | "rejected" | "live" | "offline";
type FilterType = "all" | "pending" | "verified" | "rejected" | "live" | "offline";

type ShopApplicant = {
  id: string;
  shopName: string;
  shopAddress: string;
  shopPhoneNumber: string;
  shopImageUrl?: string | null;
  individualRegisteredName: string;
  businessName: string;
  generalLocation: string;
  registeredAddress: string;
  zipCode: string;
  tin: string;
  vatRegistrationStatus: boolean;
  birCertificateUrl?: string | null;
  status: ShopStatus;
  rejectionReason?: string | null;
  xenditAccountId?: string | null;
  xenditProvisioningStatus?: string | null;
  xenditProvisioningError?: string | null;
  xenditProvisionedAt?: string | null;
  // Owner info from joined users table
  ownerEmail?: string;
  ownerFullName?: string;
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "verified", label: "Verified" },
  { value: "live", label: "Live" },
  { value: "offline", label: "Offline" },
  { value: "rejected", label: "Rejected" },
];

export default function AdminFuneralShopVerificationsScreen() {
  const { isDesktop } = useResponsive();
  const [items, setItems] = useState<ShopApplicant[]>([]);
  const [filteredItems, setFilteredItems] = useState<ShopApplicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("pending");
  const [selectedItem, setSelectedItem] = useState<ShopApplicant | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [provisioningShopId, setProvisioningShopId] = useState<string | null>(null);

  const applyFilters = useCallback((allItems: ShopApplicant[], search: string, filter: FilterType) => {
    let result = [...allItems];

    if (filter !== "all") result = result.filter((item) => item.status === filter);

    if (search.trim()) {
      const lower = search.trim().toLowerCase();
      result = result.filter((item) =>
        [
          item.ownerFullName,
          item.ownerEmail,
          item.shopName,
          item.businessName,
          item.generalLocation,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(lower))
      );
    }

    setFilteredItems(result);
  }, []);

  const loadApplicants = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("funeral_shops")
        .select(`
          *,
          users!funeral_shops_id_fkey ( email, "fullName" )
        `)
        .in("status", ["pending", "verified", "rejected", "live", "offline"])
        .order("submittedAt", { ascending: false });

      if (error) throw error;

      const nextItems: ShopApplicant[] = (data || []).map((row: any) => ({
        id: row.id,
        shopName: row.shopName || "",
        shopAddress: row.shopAddress || "",
        shopPhoneNumber: row.shopPhoneNumber || "",
        shopImageUrl: row.shopImageUrl || null,
        individualRegisteredName: row.individualRegisteredName || "",
        businessName: row.businessName || "",
        generalLocation: row.generalLocation || "",
        registeredAddress: row.registeredAddress || "",
        zipCode: row.zipCode || "",
        tin: row.tin || "",
        vatRegistrationStatus: Boolean(row.vatRegistrationStatus),
        birCertificateUrl: row.birCertificateUrl || null,
        status: row.status,
        rejectionReason: row.rejectionReason || null,
        xenditAccountId: row.xenditAccountId || null,
        xenditProvisioningStatus: row.xenditProvisioningStatus || "not_started",
        xenditProvisioningError: row.xenditProvisioningError || null,
        xenditProvisionedAt: row.xenditProvisionedAt || null,
        ownerEmail: row.users?.email || "",
        ownerFullName: row.users?.fullName || "",
      }));

      setItems(nextItems);
      setSelectedItem((current) =>
        current ? nextItems.find((item) => item.id === current.id) || current : null
      );
      applyFilters(nextItems, searchQuery, filterType);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load funeral shop verifications.");
    } finally {
      setLoading(false);
    }
  }, [applyFilters, filterType, searchQuery]);

  useEffect(() => {
    // Async screen loading intentionally begins when the filter-backed loader changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadApplicants();
  }, [loadApplicants]);

  const closeModal = () => {
    setModalVisible(false);
    setSelectedItem(null);
    setRejectionReason("");
  };

  const notifyUser = async (userId: string, type: string, title: string, body: string) => {
    await supabase.from("notifications").insert({
      userId,
      type,
      title,
      body,
      read: false,
      createdAt: new Date().toISOString(),
    });
  };

  const provisionShopAccount = async (
    item: ShopApplicant,
    options: { afterApproval?: boolean } = {},
  ): Promise<boolean> => {
    setProvisioningShopId(item.id);
    try {
      const result = await provisionXenditShop(item.id);

      const provisionedShop: Partial<ShopApplicant> = {
        xenditAccountId: result.xenditAccountId,
        xenditProvisioningStatus: result.provisioningStatus || "provisioned",
        xenditProvisioningError: null,
        xenditProvisionedAt: new Date().toISOString(),
      };
      setItems((current) =>
        current.map((shop) =>
          shop.id === item.id ? { ...shop, ...provisionedShop } : shop
        )
      );
      setSelectedItem((current) =>
        current?.id === item.id ? { ...current, ...provisionedShop } : current
      );

      void logAdminAction({
        adminId: auth.currentUser?.uid,
        action: "xendit_shop_account_provisioned",
        targetType: "funeral_shop",
        targetId: item.id,
        summary: `${result.reused ? "Confirmed" : "Created"} Xendit test account for ${item.shopName || item.ownerEmail || item.id}`,
        metadata: { reused: Boolean(result.reused), testMode: true },
      }).catch((error) => console.warn("Unable to record Xendit provisioning audit log", error));

      Alert.alert(
        options.afterApproval ? "Shop approved and payment-ready" : "Xendit setup complete",
        result.reused
          ? "The shop's existing Xendit Test Mode account is ready."
          : "A Xendit Test Mode sub-account was created for this shop.",
      );
      return true;
    } catch (error: any) {
      const safeMessage =
        typeof error?.message === "string"
          ? error.message
          : "Xendit test account setup could not be completed.";
      Alert.alert(
        options.afterApproval ? "Shop approved — Xendit setup pending" : "Xendit setup failed",
        `${safeMessage}\n\nThe shop remains approved. You can safely retry this setup from the shop details.`,
      );
      return false;
    } finally {
      setProvisioningShopId(null);
    }
  };

  const approveShop = async (item: ShopApplicant) => {
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from("funeral_shops")
        .update({
          status: "verified",
          rejectionReason: null,
          verifiedAt: new Date().toISOString(),
        })
        .eq("id", item.id);

      if (error) throw error;

      setSelectedItem((current) =>
        current?.id === item.id
          ? { ...current, status: "verified", rejectionReason: null }
          : current
      );

      const followUpResults = await Promise.allSettled([
        notifyUser(
          item.id,
          "funeral_shop_approved",
          "Funeral Shop Registration Approved",
          "Your funeral shop registration has been approved."
        ),
        logAdminAction({
          adminId: auth.currentUser?.uid,
          action: "funeral_shop_approved",
          targetType: "user",
          targetId: item.id,
          summary: `Approved funeral shop registration for ${item.shopName || item.ownerEmail || item.id}`,
        }),
      ]);
      followUpResults.forEach((result) => {
        if (result.status === "rejected") {
          console.warn("A non-blocking shop approval follow-up failed", result.reason);
        }
      });

      const provisioned = await provisionShopAccount(
        { ...item, status: "verified", rejectionReason: null },
        { afterApproval: true },
      );
      await loadApplicants();
      if (provisioned) closeModal();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to approve funeral shop.");
    } finally {
      setActionLoading(false);
    }
  };

  const rejectShop = async (item: ShopApplicant) => {
    if (!rejectionReason.trim()) {
      Alert.alert("Error", "Please provide a rejection reason.");
      return;
    }

    setActionLoading(true);
    try {
      const { error } = await supabase
        .from("funeral_shops")
        .update({
          status: "rejected",
          rejectionReason: rejectionReason.trim(),
        })
        .eq("id", item.id);

      if (error) throw error;

      await notifyUser(
        item.id,
        "funeral_shop_rejected",
        "Funeral Shop Registration Rejected",
        `Your funeral shop registration was rejected. Reason: ${rejectionReason.trim()}`
      );
      await logAdminAction({
        adminId: auth.currentUser?.uid,
        action: "funeral_shop_rejected",
        targetType: "user",
        targetId: item.id,
        summary: `Rejected funeral shop registration for ${item.shopName || item.ownerEmail || item.id}`,
        metadata: { reason: rejectionReason.trim() },
      });
      Alert.alert("Success", "Funeral shop rejected.");
      closeModal();
      await loadApplicants();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to reject funeral shop.");
    } finally {
      setActionLoading(false);
    }
  };

  const openExternalLink = async (url?: string | null) => {
    if (!url) {
      Alert.alert("Unavailable", "No file was uploaded for this record.");
      return;
    }
    await Linking.openURL(url);
  };

  const renderItem = ({ item }: { item: ShopApplicant }) => (
    <TouchableOpacity
      style={styles.itemCard}
      onPress={() => {
        setSelectedItem(item);
        setRejectionReason(item.rejectionReason || "");
        setModalVisible(true);
      }}
    >
      <Text style={styles.itemTitle}>{item.shopName || "Unnamed shop"}</Text>
      <Text style={styles.itemMeta}>Owner: {item.ownerFullName || "Unknown"}</Text>
      <Text style={styles.itemMeta}>Email: {item.ownerEmail || "N/A"}</Text>
      <Text style={styles.itemMeta}>Business: {item.businessName || "N/A"}</Text>
      <Text style={styles.itemMeta}>Location: {item.generalLocation || "N/A"}</Text>
      <Text style={styles.itemMeta}>Status: {item.status || "none"}</Text>
      <Text style={item.xenditAccountId ? styles.xenditReadyText : styles.xenditPendingText}>
        Xendit: {item.xenditAccountId ? "Ready (Test Mode)" : "Setup needed"}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return <LoadingBird fullScreen />;
  }

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <Text style={styles.title}>Funeral Shop Verifications</Text>
      <Text style={styles.subtitle}>Review submitted funeral shop records and approve or reject them.</Text>

      <Searchbar
        placeholder="Search by shop, owner, email, or business"
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
        ListEmptyComponent={<Text style={styles.emptyText}>No funeral shop records found.</Text>}
      />

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Review Funeral Shop</Text>
              {selectedItem ? (
                <>
                  <Text style={styles.detailText}>Shop: {selectedItem.shopName || "-"}</Text>
                  <Text style={styles.detailText}>Owner: {selectedItem.ownerFullName || "-"}</Text>
                  <Text style={styles.detailText}>Email: {selectedItem.ownerEmail || "-"}</Text>
                  <Text style={styles.detailText}>Phone: {selectedItem.shopPhoneNumber || "-"}</Text>
                  <Text style={styles.detailText}>Shop Address: {selectedItem.shopAddress || "-"}</Text>
                  <Text style={styles.detailText}>Business Name: {selectedItem.businessName || "-"}</Text>
                  <Text style={styles.detailText}>Registered Name: {selectedItem.individualRegisteredName || "-"}</Text>
                  <Text style={styles.detailText}>General Location: {selectedItem.generalLocation || "-"}</Text>
                  <Text style={styles.detailText}>Registered Address: {selectedItem.registeredAddress || "-"}</Text>
                  <Text style={styles.detailText}>ZIP Code: {selectedItem.zipCode || "-"}</Text>
                  <Text style={styles.detailText}>TIN: {selectedItem.tin || "-"}</Text>
                  <Text style={styles.detailText}>VAT Status: {selectedItem.vatRegistrationStatus ? "Registered" : "Not Registered"}</Text>

                  <View
                    style={[
                      styles.xenditCard,
                      selectedItem.xenditAccountId
                        ? styles.xenditCardReady
                        : styles.xenditCardPending,
                    ]}
                  >
                    <Text style={styles.xenditTitle}>Xendit Test Mode</Text>
                    <Text style={styles.xenditDetail}>
                      Payment account: {selectedItem.xenditAccountId ? "Ready" : "Setup needed"}
                    </Text>
                    {selectedItem.xenditAccountId ? (
                      <Text style={styles.xenditAccountId} selectable>
                        Account ID: {selectedItem.xenditAccountId}
                      </Text>
                    ) : null}
                    {selectedItem.xenditProvisioningStatus ? (
                      <Text style={styles.xenditDetail}>
                        Setup status: {selectedItem.xenditProvisioningStatus.replace(/_/g, " ")}
                      </Text>
                    ) : null}
                    {selectedItem.xenditProvisioningError && !selectedItem.xenditAccountId ? (
                      <Text style={styles.xenditError}>
                        Last setup attempt failed. Check the server configuration and retry.
                      </Text>
                    ) : null}
                  </View>

                  <Button mode="outlined" onPress={() => void openExternalLink(selectedItem.birCertificateUrl)} style={styles.linkButton}>
                    View BIR Certificate
                  </Button>

                  <TextInput
                    placeholder="Rejection reason"
                    value={rejectionReason}
                    onChangeText={setRejectionReason}
                    style={styles.reasonInput}
                    multiline
                  />

                  <View style={styles.modalActions}>
                    <Button
                      mode="contained"
                      onPress={() => void approveShop(selectedItem)}
                      loading={actionLoading}
                      disabled={actionLoading || provisioningShopId === selectedItem.id}
                    >
                      Approve
                    </Button>
                    <Button
                      mode="contained"
                      buttonColor="#b91c1c"
                      onPress={() => void rejectShop(selectedItem)}
                      loading={actionLoading}
                      disabled={actionLoading || provisioningShopId === selectedItem.id}
                    >
                      Reject
                    </Button>
                    {!selectedItem.xenditAccountId &&
                    ["verified", "live", "offline"].includes(selectedItem.status) ? (
                      <Button
                        mode="contained-tonal"
                        onPress={async () => {
                          await provisionShopAccount(selectedItem);
                          await loadApplicants();
                        }}
                        loading={provisioningShopId === selectedItem.id}
                        disabled={actionLoading || provisioningShopId === selectedItem.id}
                      >
                        {selectedItem.xenditProvisioningStatus === "failed"
                          ? "Retry Xendit Setup"
                          : "Set Up Xendit"}
                      </Button>
                    ) : null}
                    <Button
                      mode="outlined"
                      onPress={closeModal}
                      disabled={actionLoading || provisioningShopId === selectedItem.id}
                    >
                      Close
                    </Button>
                  </View>
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
  itemTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 6,
  },
  itemMeta: {
    color: "#475569",
    lineHeight: 20,
  },
  xenditReadyText: {
    color: "#047857",
    fontWeight: "700",
    lineHeight: 20,
  },
  xenditPendingText: {
    color: "#b45309",
    fontWeight: "700",
    lineHeight: 20,
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
    marginBottom: 12,
  },
  detailText: {
    color: "#334155",
    lineHeight: 21,
    marginBottom: 6,
  },
  xenditCard: {
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 10,
    marginBottom: 2,
    padding: 12,
  },
  xenditCardReady: {
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0",
  },
  xenditCardPending: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
  },
  xenditTitle: {
    color: "#0f172a",
    fontWeight: "800",
    marginBottom: 4,
  },
  xenditDetail: {
    color: "#334155",
    lineHeight: 20,
  },
  xenditAccountId: {
    color: "#334155",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 19,
  },
  xenditError: {
    color: "#b91c1c",
    lineHeight: 20,
    marginTop: 4,
  },
  linkButton: {
    marginTop: 10,
  },
  reasonInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    padding: 10,
    minHeight: 90,
    textAlignVertical: "top",
    color: "#111827",
  },
  modalActions: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
});
