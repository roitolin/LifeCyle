import { useCallback, useState } from "react";
import LoadingBird from "@/components/LoadingBird";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/services/supabaseClient";
import { auth } from "@/services";
import { verifyShopPayout } from "@/services/xenditAdmin";
import { logAdminAction } from "@/utils/adminAuditLog";

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

function getChannelLabel(code?: string | null) {
  if (!code) return "Not set";
  return PAYOUT_CHANNELS.find((ch) => ch.code === code)?.label || code;
}

type ShopPayout = {
  id: string;
  shopName: string | null;
  payoutChannelCode: string | null;
  payoutAccountName: string | null;
  payoutAccountNumber: string | null;
  payoutVerifiedByAdmin: boolean;
  payoutVerifiedAt: string | null;
  status: string;
  ownerEmail?: string;
};

type FilterMode = "all" | "pending" | "verified" | "missing";

export default function AdminPayoutAccountsScreen() {
  const [shops, setShops] = useState<ShopPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("pending");
  const [selected, setSelected] = useState<ShopPayout | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [channelPickerVisible, setChannelPickerVisible] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [overrideChannel, setOverrideChannel] = useState("");
  const [overrideName, setOverrideName] = useState("");
  const [overrideNumber, setOverrideNumber] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("funeral_shops")
        .select(`id, shopName, payoutChannelCode, payoutAccountName, payoutAccountNumber, payoutVerifiedByAdmin, payoutVerifiedAt, status, users!funeral_shops_id_fkey(email)`)
        .in("status", ["verified", "live", "offline", "pending"])
        .order("shopName", { ascending: true });
      if (error) throw error;
      const rows: ShopPayout[] = (data || []).map((r: any) => ({
        id: r.id,
        shopName: r.shopName,
        payoutChannelCode: r.payoutChannelCode,
        payoutAccountName: r.payoutAccountName,
        payoutAccountNumber: r.payoutAccountNumber,
        payoutVerifiedByAdmin: Boolean(r.payoutVerifiedByAdmin),
        payoutVerifiedAt: r.payoutVerifiedAt,
        status: r.status,
        ownerEmail: r.users?.email,
      }));
      setShops(rows);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Unable to load payout accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const filtered = shops.filter((s) => {
    if (filter === "pending") return !s.payoutVerifiedByAdmin && Boolean(s.payoutChannelCode);
    if (filter === "verified") return s.payoutVerifiedByAdmin;
    if (filter === "missing") return !s.payoutChannelCode;
    return true;
  });

  const pendingCount = shops.filter((s) => !s.payoutVerifiedByAdmin && Boolean(s.payoutChannelCode)).length;
  const verifiedCount = shops.filter((s) => s.payoutVerifiedByAdmin).length;
  const missingCount = shops.filter((s) => !s.payoutChannelCode).length;

  const openModal = (shop: ShopPayout) => {
    setSelected(shop);
    setOverrideChannel("");
    setOverrideName("");
    setOverrideNumber("");
    setModalVisible(true);
  };

  const handleVerify = async () => {
    if (!selected) return;
    const channel = overrideChannel || selected.payoutChannelCode || "";
    const name = overrideName || selected.payoutAccountName || "";
    const number = overrideNumber || selected.payoutAccountNumber || "";
    if (!channel || !name || !number) {
      Alert.alert("Missing details", "The shop must submit payout details before you can verify.");
      return;
    }
    setVerifying(true);
    try {
      await verifyShopPayout(selected.id, channel, name, number);
      void logAdminAction({
        adminId: auth.currentUser?.uid,
        action: "shop_payout_verified",
        targetType: "funeral_shop",
        targetId: selected.id,
        summary: `Verified payout account for ${selected.shopName || selected.id} (${getChannelLabel(channel)})`,
        metadata: { payoutChannel: channel, testMode: true },
      }).catch(() => {});
      Alert.alert(
        "Payout account verified",
        `${selected.shopName || "This shop"}'s ${getChannelLabel(channel)} account is now verified. 70% of each customer payment will be sent here automatically.`
      );
      setModalVisible(false);
      void load();
    } catch (e: any) {
      Alert.alert("Verification failed", e?.message || "Unable to verify. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const FILTERS: { key: FilterMode; label: string; count: number; color: string }[] = [
    { key: "pending", label: "Needs Verification", count: pendingCount, color: "#2563eb" },
    { key: "verified", label: "Verified", count: verifiedCount, color: "#059669" },
    { key: "missing", label: "Not Submitted", count: missingCount, color: "#d97706" },
    { key: "all", label: "All", count: shops.length, color: "#6b7280" },
  ];

  if (loading) return <LoadingBird fullScreen />;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Payout Accounts</Text>
        <Text style={styles.headerSub}>
          Verify shop GCash/bank accounts so they can receive 70% of each customer payment automatically.
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && { backgroundColor: f.color, borderColor: f.color }]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipText, filter === f.key && { color: "#fff" }]}>{f.label}</Text>
            <View style={[styles.filterBadge, filter === f.key ? { backgroundColor: "rgba(255,255,255,0.3)" } : { backgroundColor: f.color }]}>
              <Text style={styles.filterBadgeText}>{f.count}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="wallet-outline" size={40} color="#9ca3af" />
            <Text style={styles.emptyText}>
              {filter === "pending" ? "No shops are waiting for payout verification." :
               filter === "missing" ? "All shops have submitted payout details." :
               filter === "verified" ? "No verified payout accounts yet." : "No shops found."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => openModal(item)} activeOpacity={0.8}>
            <View style={styles.cardRow}>
              <Ionicons
                name={item.payoutVerifiedByAdmin ? "checkmark-circle" : item.payoutChannelCode ? "time" : "alert-circle"}
                size={22}
                color={item.payoutVerifiedByAdmin ? "#059669" : item.payoutChannelCode ? "#2563eb" : "#d97706"}
              />
              <View style={styles.cardBody}>
                <Text style={styles.cardName}>{item.shopName || "Unnamed Shop"}</Text>
                <Text style={styles.cardEmail}>{item.ownerEmail || item.id}</Text>
                {item.payoutChannelCode ? (
                  <Text style={styles.cardAccount}>
                    {getChannelLabel(item.payoutChannelCode)} · {item.payoutAccountName || "—"} · {item.payoutAccountNumber || "—"}
                  </Text>
                ) : (
                  <Text style={styles.cardMissing}>Shop has not submitted payout details</Text>
                )}
              </View>
              <View style={[styles.statusBadge, {
                backgroundColor: item.payoutVerifiedByAdmin ? "#dcfce7" : item.payoutChannelCode ? "#dbeafe" : "#fef3c7"
              }]}>
                <Text style={[styles.statusBadgeText, {
                  color: item.payoutVerifiedByAdmin ? "#059669" : item.payoutChannelCode ? "#1d4ed8" : "#92400e"
                }]}>
                  {item.payoutVerifiedByAdmin ? "Verified" : item.payoutChannelCode ? "Pending" : "Missing"}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Payout Account</Text>
                <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color="#6b7280" />
                </TouchableOpacity>
              </View>
              {selected ? (
                <>
                  <Text style={styles.modalShopName}>{selected.shopName || "Unnamed Shop"}</Text>
                  <Text style={styles.modalEmail}>{selected.ownerEmail || selected.id}</Text>

                  <View style={[styles.statusBox, {
                    backgroundColor: selected.payoutVerifiedByAdmin ? "#f0fdf4" : selected.payoutChannelCode ? "#eff6ff" : "#fffbeb",
                    borderColor: selected.payoutVerifiedByAdmin ? "#86efac" : selected.payoutChannelCode ? "#bfdbfe" : "#fde68a",
                  }]}>
                    <Ionicons
                      name={selected.payoutVerifiedByAdmin ? "checkmark-circle" : selected.payoutChannelCode ? "time" : "alert-circle"}
                      size={18}
                      color={selected.payoutVerifiedByAdmin ? "#059669" : selected.payoutChannelCode ? "#2563eb" : "#d97706"}
                    />
                    <Text style={[styles.statusBoxText, {
                      color: selected.payoutVerifiedByAdmin ? "#065f46" : selected.payoutChannelCode ? "#1e3a8a" : "#78350f"
                    }]}>
                      {selected.payoutVerifiedByAdmin
                        ? "Payout account verified. Shop receives 70% of each customer payment."
                        : selected.payoutChannelCode
                        ? "Shop submitted details — awaiting your verification below."
                        : "Shop has not set up their payout account yet."}
                    </Text>
                  </View>

                  {selected.payoutChannelCode ? (
                    <View style={styles.submittedBox}>
                      <Text style={styles.submittedLabel}>Shop Submitted Details</Text>
                      <Text style={styles.submittedText}>Channel: {getChannelLabel(selected.payoutChannelCode)}</Text>
                      <Text style={styles.submittedText}>Name: {selected.payoutAccountName || "—"}</Text>
                      <Text style={styles.submittedText}>Number: {selected.payoutAccountNumber || "—"}</Text>
                    </View>
                  ) : (
                    <View style={styles.missingBox}>
                      <Ionicons name="information-circle-outline" size={16} color="#92400e" />
                      <Text style={styles.missingText}>
                        The shop owner must go to Shop Settings ? Payout Account and save their GCash or bank details first.
                      </Text>
                    </View>
                  )}

                  {selected.payoutChannelCode ? (
                    <>
                      <Text style={styles.sectionLabel}>Override / Confirm (optional)</Text>
                      <Text style={styles.fieldLabel}>Payout Channel</Text>
                      <TouchableOpacity style={styles.pickerBtn} onPress={() => setChannelPickerVisible(true)}>
                        <Text style={styles.pickerBtnText}>
                          {overrideChannel ? getChannelLabel(overrideChannel) : `Keep: ${getChannelLabel(selected.payoutChannelCode)}`}
                        </Text>
                        <Ionicons name="chevron-down" size={16} color="#6b7280" />
                      </TouchableOpacity>
                      <Text style={styles.fieldLabel}>Account Holder Name</Text>
                      <TextInput
                        style={styles.input}
                        value={overrideName}
                        onChangeText={setOverrideName}
                        placeholder={selected.payoutAccountName || "Keep shop's name"}
                      />
                      <Text style={styles.fieldLabel}>Account / GCash Number</Text>
                      <TextInput
                        style={styles.input}
                        value={overrideNumber}
                        onChangeText={setOverrideNumber}
                        placeholder={selected.payoutAccountNumber || "Keep shop's number"}
                      />
                      <TouchableOpacity
                        style={[styles.verifyBtn, verifying && styles.verifyBtnDisabled]}
                        onPress={() => void handleVerify()}
                        disabled={verifying}
                      >
                        {verifying ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />}
                        <Text style={styles.verifyBtnText}>
                          {verifying ? "Verifying..." : selected.payoutVerifiedByAdmin ? "Re-Verify Payout Account" : "Verify Payout Account"}
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : null}

                  <TouchableOpacity style={styles.closeModalBtn} onPress={() => setModalVisible(false)}>
                    <Text style={styles.closeModalBtnText}>Close</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={channelPickerVisible} transparent animationType="fade" onRequestClose={() => setChannelPickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: "65%" }]}>
            <Text style={styles.modalTitle}>Select Payout Channel</Text>
            <ScrollView>
              {PAYOUT_CHANNELS.map((ch) => (
                <TouchableOpacity
                  key={ch.code}
                  style={[styles.channelOption, overrideChannel === ch.code && styles.channelOptionActive]}
                  onPress={() => { setOverrideChannel(ch.code); setChannelPickerVisible(false); }}
                >
                  <Text style={[styles.channelOptionText, overrideChannel === ch.code && { color: "#fff" }]}>{ch.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.closeModalBtn} onPress={() => setChannelPickerVisible(false)}>
              <Text style={styles.closeModalBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f3f4f6" },
  header: { backgroundColor: "#1e3a5f", padding: 18, paddingTop: 12 },
  headerTitle: { fontSize: 22, fontWeight: "900", color: "#fff", marginBottom: 4 },
  headerSub: { fontSize: 13, color: "#bfdbfe", lineHeight: 18 },
  filterScroll: { flexGrow: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  filterRow: { flexDirection: "row", gap: 8, padding: 10, paddingHorizontal: 14 },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5, borderColor: "#d1d5db", backgroundColor: "#fff",
  },
  filterChipText: { fontSize: 13, fontWeight: "700", color: "#374151" },
  filterBadge: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  filterBadgeText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  list: { padding: 14, gap: 10, paddingBottom: 32 },
  card: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "#e5e7eb", elevation: 2,
  },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cardBody: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "800", color: "#111827" },
  cardEmail: { fontSize: 12, color: "#6b7280", marginTop: 1 },
  cardAccount: { fontSize: 12, color: "#374151", marginTop: 4, fontWeight: "600" },
  cardMissing: { fontSize: 12, color: "#d97706", marginTop: 4, fontStyle: "italic" },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 },
  statusBadgeText: { fontSize: 11, fontWeight: "800" },
  emptyWrap: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText: { color: "#6b7280", fontSize: 14, textAlign: "center", maxWidth: 260 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxHeight: "90%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: "900", color: "#111827" },
  closeBtn: { padding: 4 },
  modalShopName: { fontSize: 16, fontWeight: "800", color: "#1e3a5f", marginBottom: 2 },
  modalEmail: { fontSize: 12, color: "#6b7280", marginBottom: 14 },
  statusBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 14 },
  statusBoxText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  submittedBox: { backgroundColor: "#f0f9ff", borderRadius: 10, padding: 12, marginBottom: 14, gap: 4 },
  submittedLabel: { fontSize: 11, fontWeight: "800", color: "#0369a1", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  submittedText: { fontSize: 14, color: "#0c4a6e", fontWeight: "600" },
  missingBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#fffbeb", borderRadius: 10, padding: 12, marginBottom: 14 },
  missingText: { flex: 1, fontSize: 13, color: "#78350f", lineHeight: 18 },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 4, marginTop: 8 },
  pickerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 10, borderWidth: 1, borderColor: "#d1d5db", backgroundColor: "#f9fafb", paddingHorizontal: 12, paddingVertical: 11 },
  pickerBtnText: { fontSize: 14, color: "#374151" },
  input: { borderRadius: 10, borderWidth: 1, borderColor: "#d1d5db", backgroundColor: "#f9fafb", paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#111827" },
  verifyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 14, marginTop: 16 },
  verifyBtnDisabled: { opacity: 0.55 },
  verifyBtnText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  closeModalBtn: { alignItems: "center", paddingVertical: 12, marginTop: 10, borderRadius: 10, borderWidth: 1, borderColor: "#e5e7eb" },
  closeModalBtnText: { fontSize: 14, color: "#6b7280", fontWeight: "700" },
  channelOption: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 8, marginBottom: 4 },
  channelOptionActive: { backgroundColor: "#2563eb" },
  channelOptionText: { fontSize: 15, color: "#111827", fontWeight: "600" },
});
