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
import { verifyShopPayout } from "@/services/xenditAdmin";
import { useResponsive } from "@/utils/responsive";
import { logAdminAction } from "@/utils/adminAuditLog";

type ShopStatus = "pending" | "verified" | "rejected" | "live" | "offline";
type FilterType = "all" | "pending" | "verified" | "rejected" | "live" | "offline";

const PAYOUT_CHANNELS = [
  { code: "PH_GCASH", label: "GCash" },
  { code: "PH_MAYA", label: "Maya" },
  { code: "PH_BDO", label: "BDO" },
  { code: "PH_BPI", label: "BPI" },
  { code: "PH_UBP", label: "UnionBank" },
  { code: "PH_METROBANK", label: "Metrobank" },
  { code: "PH_LANDBANK", label: "Landbank" },
  { code: "PH_PNB", label: "PNB" },
  { code: "PH_RCBC", label: "RCBC" },
  { code: "PH_CHINABANK", label: "Chinabank" },
  { code: "PH_SECURITYBANK", label: "Security Bank" },
  { code: "PH_EASTWESTBANK", label: "EastWest Bank" },
];

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
  // Payout account details
  payoutChannelCode?: string | null;
  payoutAccountName?: string | null;
  payoutAccountNumber?: string | null;
  payoutVerifiedByAdmin?: boolean;
  payoutVerifiedAt?: string | null;
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

function getChannelLabel(code?: string | null) {
  if (!code) return "Not set";
  return PAYOUT_CHANNELS.find((ch) => ch.code === code)?.label || code;
}

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
  const [verifyingPayoutShopId, setVerifyingPayoutShopId] = useState<string | null>(null);
  // Payout form state
  const [payoutChannel, setPayoutChannel] = useState("");
  const [payoutName, setPayoutName] = useState("");
  const [payoutNumber, setPayoutNumber] = useState("");
  const [channelPickerVisible, setChannelPickerVisible] = useState(false);
  const [payoutSectionExpanded, setPayoutSectionExpanded] = useState(false);

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
        payoutChannelCode: row.payoutChannelCode || null,
        payoutAccountName: row.payoutAccountName || null,
        payoutAccountNumber: row.payoutAccountNumber || null,
        payoutVerifiedByAdmin: Boolean(row.payoutVerifiedByAdmin),
        payoutVerifiedAt: row.payoutVerifiedAt || null,
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
    setPayoutChannel("");
    setPayoutName("");
    setPayoutNumber("");
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

  const verifyPayoutAccount = async (
    item: ShopApplicant,
    options: { afterApproval?: boolean } = {},
  ): Promise<boolean> => {
    // Use payout details from form or existing shop data
    const channel = payoutChannel || item.payoutChannelCode || "";
    const name = payoutName || item.payoutAccountName || "";
    const number = payoutNumber || item.payoutAccountNumber || "";

    if (!channel || !name || !number) {
      Alert.alert("Missing payout details", "Enter the shop's payout channel, account name, and account number.");
      return false;
    }

    setVerifyingPayoutShopId(item.id);
    try {
      const result = await verifyShopPayout(item.id, channel, name, number);

      const updatedShop: Partial<ShopApplicant> = {
        payoutChannelCode: result.payoutChannelCode,
        payoutAccountName: result.payoutAccountName,
        payoutVerifiedByAdmin: result.payoutVerified,
        payoutVerifiedAt: new Date().toISOString(),
        xenditProvisioningStatus: "provisioned",
        xenditProvisioningError: null,
      };
      setItems((current) =>
        current.map((shop) =>
          shop.id === item.id ? { ...shop, ...updatedShop } : shop
        )
      );
      setSelectedItem((current) =>
        current?.id === item.id ? { ...current, ...updatedShop } : current
      );

      void logAdminAction({
        adminId: auth.currentUser?.uid,
        action: "shop_payout_verified",
        targetType: "funeral_shop",
        targetId: item.id,
        summary: `Verified payout account for ${item.shopName || item.ownerEmail || item.id} (${getChannelLabel(channel)})`,
        metadata: { payoutChannel: channel, testMode: true },
      }).catch((error) => console.warn("Unable to record payout verification audit log", error));

      Alert.alert(
        options.afterApproval ? "Shop approved and payout ready" : "Payout account verified",
        `The shop's ${getChannelLabel(channel)} payout account has been verified. 70% of casket payments will be sent here automatically.`,
      );
      return true;
    } catch (error: any) {
      const safeMessage =
        typeof error?.message === "string"
          ? error.message
          : "Payout account verification could not be completed.";
      Alert.alert(
        options.afterApproval ? "Shop approved — payout setup pending" : "Payout verification failed",
        `${safeMessage}\n\nThe shop remains approved. You can safely retry from the shop details.`,
      );
      return false;
    } finally {
      setVerifyingPayoutShopId(null);
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

      // If payout details are filled in, verify them as part of approval
      const hasPayoutDetails = (payoutChannel || item.payoutChannelCode) &&
        (payoutName || item.payoutAccountName) &&
        (payoutNumber || item.payoutAccountNumber);

      if (hasPayoutDetails) {
        const verified = await verifyPayoutAccount(
          { ...item, status: "verified", rejectionReason: null },
          { afterApproval: true },
        );
        await loadApplicants();
        if (verified) closeModal();
      } else {
        Alert.alert(
          "Shop approved",
          "The shop is approved. Set up payout details (GCash/bank) so they can receive customer payments.",
        );
        await loadApplicants();
      }
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

  const openModal = (item: ShopApplicant) => {
    setSelectedItem(item);
    setRejectionReason(item.rejectionReason || "");
    setPayoutChannel(item.payoutChannelCode || "");
    setPayoutName(item.payoutAccountName || "");
    setPayoutNumber(item.payoutAccountNumber || "");
    setModalVisible(true);
  };

  const renderItem = ({ item }: { item: ShopApplicant }) => (
    <TouchableOpacity style={styles.itemCard} onPress={() => openModal(item)}>
      <Text style={styles.itemTitle}>{item.shopName || "Unnamed shop"}</Text>
      <Text style={styles.itemMeta}>Owner: {item.ownerFullName || "Unknown"}</Text>
      <Text style={styles.itemMeta}>Email: {item.ownerEmail || "N/A"}</Text>
      <Text style={styles.itemMeta}>Business: {item.businessName || "N/A"}</Text>
      <Text style={styles.itemMeta}>Location: {item.generalLocation || "N/A"}</Text>
      <Text style={styles.itemMeta}>Status: {item.status || "none"}</Text>
      <Text style={item.payoutVerifiedByAdmin ? styles.payoutReadyText : styles.payoutPendingText}>
        Payout: {item.payoutVerifiedByAdmin ? `Verified (${getChannelLabel(item.payoutChannelCode)})` : "Setup needed"}
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

                  {/* Payout Account Section */}
                  <View
                    style={[
                      styles.payoutCard,
                      selectedItem.payoutVerifiedByAdmin
                        ? styles.payoutCardReady
                        : styles.payoutCardPending,
                    ]}
                  >
                    <Text style={styles.payoutTitle}>Payout Account (Test Mode)</Text>
                    <Text style={styles.payoutDetail}>
                      Status: {selectedItem.payoutVerifiedByAdmin ? "✅ Verified" : selectedItem.payoutChannelCode ? "⏳ Submitted — awaiting your verification" : "❌ Shop has not submitted payout details yet"}
                    </Text>

                    {/* Show what the shop submitted (read-only summary) */}
                    {selectedItem.payoutChannelCode ? (
                      <View style={{ marginTop: 8, marginBottom: 4, padding: 10, backgroundColor: "#f0f9ff", borderRadius: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#0369a1", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Shop Submitted Details</Text>
                        <Text style={{ color: "#0c4a6e" }}>Channel: {getChannelLabel(selectedItem.payoutChannelCode)}</Text>
                        <Text style={{ color: "#0c4a6e" }}>Name: {selectedItem.payoutAccountName || "—"}</Text>
                        <Text style={{ color: "#0c4a6e" }}>Number: {selectedItem.payoutAccountNumber || "—"}</Text>
                      </View>
                    ) : (
                      <Text style={{ color: "#92400e", fontSize: 12, marginTop: 6, fontStyle: "italic" }}>
                        The shop owner must first set up their payout account from Shop Settings → Payout Account before you can verify it.
                      </Text>
                    )}

                    {/* Admin can override / confirm the channel, name, number */}
                    <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Override Payout Channel (optional)</Text>
                    <TouchableOpacity
                      style={styles.channelPicker}
                      onPress={() => setChannelPickerVisible(true)}
                    >
                      <Text style={styles.channelPickerText}>
                        {payoutChannel ? getChannelLabel(payoutChannel) : "Keep shop's channel / select to override..."}
                      </Text>
                    </TouchableOpacity>

                    <Text style={styles.fieldLabel}>Override Account Holder Name (optional)</Text>
                    <TextInput
                      style={styles.payoutInput}
                      value={payoutName}
                      onChangeText={setPayoutName}
                      placeholder={selectedItem.payoutAccountName || "Keep shop's name / enter to override"}
                    />

                    <Text style={styles.fieldLabel}>Override Account Number (optional)</Text>
                    <TextInput
                      style={styles.payoutInput}
                      value={payoutNumber}
                      onChangeText={setPayoutNumber}
                      placeholder={selectedItem.payoutAccountNumber || "Keep shop's number / enter to override"}
                      keyboardType="default"
                    />
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
                      disabled={actionLoading || verifyingPayoutShopId === selectedItem.id}
                    >
                      Approve
                    </Button>
                    <Button
                      mode="contained"
                      buttonColor="#b91c1c"
                      onPress={() => void rejectShop(selectedItem)}
                      loading={actionLoading}
                      disabled={actionLoading || verifyingPayoutShopId === selectedItem.id}
                    >
                      Reject
                    </Button>
                    {["verified", "live", "offline"].includes(selectedItem.status) &&
                    (selectedItem.payoutChannelCode || payoutChannel) ? (
                      <Button
                        mode="contained-tonal"
                        buttonColor={selectedItem.payoutVerifiedByAdmin ? "#059669" : "#2563eb"}
                        textColor="#ffffff"
                        onPress={async () => {
                          await verifyPayoutAccount(selectedItem);
                          await loadApplicants();
                        }}
                        loading={verifyingPayoutShopId === selectedItem.id}
                        disabled={actionLoading || verifyingPayoutShopId === selectedItem.id}
                      >
                        {selectedItem.payoutVerifiedByAdmin ? "Re-Verify Payout" : "✓ Verify Payout Account"}
                      </Button>
                    ) : null}
                    <Button
                      mode="outlined"
                      onPress={closeModal}
                      disabled={actionLoading || verifyingPayoutShopId === selectedItem.id}
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

      {/* Channel picker modal */}
      <Modal visible={channelPickerVisible} transparent animationType="fade" onRequestClose={() => setChannelPickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: "70%" }]}>
            <Text style={styles.modalTitle}>Select Payout Channel</Text>
            <ScrollView>
              {PAYOUT_CHANNELS.map((ch) => (
                <TouchableOpacity
                  key={ch.code}
                  style={[styles.channelOption, payoutChannel === ch.code && styles.channelOptionSelected]}
                  onPress={() => {
                    setPayoutChannel(ch.code);
                    setChannelPickerVisible(false);
                  }}
                >
                  <Text style={[styles.channelOptionText, payoutChannel === ch.code && styles.channelOptionTextSelected]}>
                    {ch.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Button mode="outlined" onPress={() => setChannelPickerVisible(false)} style={{ marginTop: 10 }}>
              Cancel
            </Button>
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
  payoutReadyText: {
    color: "#047857",
    fontWeight: "700",
    lineHeight: 20,
  },
  payoutPendingText: {
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
  payoutCard: {
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 10,
    marginBottom: 2,
    padding: 12,
  },
  payoutCardReady: {
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0",
  },
  payoutCardPending: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
  },
  payoutTitle: {
    color: "#0f172a",
    fontWeight: "800",
    marginBottom: 4,
  },
  payoutDetail: {
    color: "#334155",
    lineHeight: 20,
    marginBottom: 8,
  },
  fieldLabel: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 4,
  },
  payoutInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    color: "#111827",
    fontSize: 15,
  },
  channelPicker: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
  },
  channelPickerText: {
    color: "#334155",
    fontSize: 15,
  },
  channelOption: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  channelOptionSelected: {
    backgroundColor: "#ecfdf5",
  },
  channelOptionText: {
    color: "#334155",
    fontSize: 16,
  },
  channelOptionTextSelected: {
    color: "#047857",
    fontWeight: "700",
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
