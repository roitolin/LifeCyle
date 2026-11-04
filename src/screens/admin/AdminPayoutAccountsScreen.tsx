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

type PayoutReceiver = {
  id: string;
  shopId: string;
  channelCode: string;
  accountName: string;
  accountNumber: string;
  active: boolean;
  verifiedByAdmin: boolean;
};

type FilterMode = "all" | "attention" | "ready" | "disabled" | "missing";
type PayoutRow = { shop: ShopPayout; receiver: PayoutReceiver | null };

function receiverStatus(receiver: PayoutReceiver | null): Exclude<FilterMode, "all"> {
  if (!receiver) return "missing";
  if (!receiver.verifiedByAdmin) return "attention";
  return receiver.active ? "ready" : "disabled";
}

export default function AdminPayoutAccountsScreen() {
  const [shops, setShops] = useState<ShopPayout[]>([]);
  const [receivers, setReceivers] = useState<PayoutReceiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ShopPayout | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [selectedReceiverId, setSelectedReceiverId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("funeral_shops")
        .select(`id, shopName, payoutChannelCode, payoutAccountName, payoutAccountNumber, payoutVerifiedByAdmin, payoutVerifiedAt, status, users!funeral_shops_id_fkey(email)`)
        .order("shopName", { ascending: true });
      if (error) throw error;
      const { data: receiverData, error: receiverError } = await supabase.functions.invoke("provision-xendit-shop", {
        body: { action: "list-all" },
      });
      if (receiverError) throw receiverError;
      setReceivers((receiverData?.accounts || []) as PayoutReceiver[]);
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

  const rows: PayoutRow[] = shops.flatMap<PayoutRow>((shop) => {
    const accounts = receivers.filter((account) => account.shopId === shop.id);
    return accounts.length ? accounts.map((receiver) => ({ shop, receiver })) : [{ shop, receiver: null }];
  });
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(({ shop, receiver }) => {
    if (filter !== "all" && receiverStatus(receiver) !== filter) return false;
    if (channelFilter !== "all" && receiver?.channelCode !== channelFilter) return false;
    if (!query) return true;
    return [shop.shopName, shop.ownerEmail, receiver?.accountName, receiver?.accountNumber, getChannelLabel(receiver?.channelCode)]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });

  const pendingCount = rows.filter(({ receiver }) => receiverStatus(receiver) === "attention").length;
  const verifiedCount = rows.filter(({ receiver }) => receiverStatus(receiver) === "ready").length;
  const disabledCount = rows.filter(({ receiver }) => receiverStatus(receiver) === "disabled").length;
  const missingCount = rows.filter(({ receiver }) => receiverStatus(receiver) === "missing").length;
  const selectedReceiver = receivers.find((account) => account.id === selectedReceiverId);

  const openModal = (shop: ShopPayout, account: PayoutReceiver | null) => {
    setSelected(shop);
    setSelectedReceiverId(account?.id || null);
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!selected || !selectedReceiver || selectedReceiver.verifiedByAdmin) return;
    setVerifying(true);
    try {
      await verifyShopPayout(selected.id, selectedReceiver.id);
      void logAdminAction({
        adminId: auth.currentUser?.uid,
        action: "shop_payout_updated",
        targetType: "funeral_shop",
        targetId: selected.id,
        summary: `Approved payout receiver for ${selected.shopName || selected.id} (${getChannelLabel(selectedReceiver.channelCode)})`,
        metadata: { payoutChannel: selectedReceiver.channelCode, testMode: true },
      }).catch(() => {});
      Alert.alert(
        "Payout account approved",
        `${selected.shopName || "This shop"}'s ${getChannelLabel(selectedReceiver.channelCode)} account is ready for checkout.`
      );
      setModalVisible(false);
      void load();
    } catch (e: any) {
      Alert.alert("Save failed", e?.message || "Unable to save. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const FILTERS: { key: FilterMode; label: string; count: number; color: string }[] = [
    { key: "attention", label: "Needs Review", count: pendingCount, color: "#2563eb" },
    { key: "ready", label: "Ready", count: verifiedCount, color: "#059669" },
    { key: "disabled", label: "Disabled", count: disabledCount, color: "#64748b" },
    { key: "missing", label: "Not Submitted", count: missingCount, color: "#d97706" },
    { key: "all", label: "All", count: rows.length, color: "#6b7280" },
  ];

  if (loading) return <LoadingBird fullScreen />;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Shop Payout Accounts</Text>
        <Text style={styles.headerSub}>
          Review each bank and wallet account submitted by partner shops.
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

      <View style={styles.searchWrap}>
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search shop or account" accessibilityLabel="Search payout accounts" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelRow}>
          <TouchableOpacity style={[styles.channelChip, channelFilter === "all" && styles.channelChipActive]} onPress={() => setChannelFilter("all")}><Text style={styles.channelChipText}>All channels</Text></TouchableOpacity>
          {PAYOUT_CHANNELS.map((channel) => <TouchableOpacity key={channel.code} style={[styles.channelChip, channelFilter === channel.code && styles.channelChipActive]} onPress={() => setChannelFilter(channel.code)}><Text style={styles.channelChipText}>{channel.label}</Text></TouchableOpacity>)}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.receiver?.id || `missing-${item.shop.id}`}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="wallet-outline" size={40} color="#9ca3af" />
            <Text style={styles.emptyText}>
              No accounts match these filters.
            </Text>
          </View>
        }
        renderItem={({ item: { shop, receiver } }) => {
          const status = receiverStatus(receiver);
          return (
            <TouchableOpacity style={styles.card} onPress={() => openModal(shop, receiver)} activeOpacity={0.8}>
              <View style={styles.cardRow}>
                <Ionicons
                  name={status === "attention" ? "time" : status === "ready" ? "checkmark-circle" : "alert-circle"}
                  size={22}
                  color={status === "attention" ? "#2563eb" : status === "ready" ? "#059669" : "#d97706"}
                />
                <View style={styles.cardBody}>
                  <Text style={styles.cardName}>{shop.shopName || "Unnamed Shop"}</Text>
                  <Text style={styles.cardEmail}>{shop.ownerEmail || shop.id}</Text>
                  {receiver ? (
                    <Text style={styles.cardAccount}>
                      {getChannelLabel(receiver.channelCode)} · {receiver.accountName} · {receiver.accountNumber}
                    </Text>
                  ) : (
                    <Text style={styles.cardMissing}>Shop has not submitted payout details</Text>
                  )}
                </View>
                <View style={[styles.statusBadge, {
                  backgroundColor: status === "attention" ? "#dbeafe" : status === "ready" ? "#dcfce7" : "#fef3c7"
                }]}>
                  <Text style={[styles.statusBadgeText, {
                    color: status === "attention" ? "#1d4ed8" : status === "ready" ? "#059669" : "#92400e"
                  }]}>
                    {status === "attention" ? "Review" : status === "ready" ? "Ready" : status === "disabled" ? "Disabled" : "Missing"}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Payout Account Review</Text>
                <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color="#6b7280" />
                </TouchableOpacity>
              </View>
              {selected ? (
                <>
                  <Text style={styles.modalShopName}>{selected.shopName || "Unnamed Shop"}</Text>
                  <Text style={styles.modalEmail}>{selected.ownerEmail || selected.id}</Text>
                  {selectedReceiver ? (
                    <View style={styles.submittedBox}>
                      <Text style={styles.submittedLabel}>{getChannelLabel(selectedReceiver.channelCode)} · {receiverStatus(selectedReceiver) === "attention" ? "Needs review" : receiverStatus(selectedReceiver) === "ready" ? "Ready" : "Disabled"}</Text>
                      <Text style={styles.submittedText}>Name: {selectedReceiver.accountName}</Text>
                      <Text style={styles.submittedText}>Number: {selectedReceiver.accountNumber}</Text>
                    </View>
                  ) : (
                    <View style={styles.missingBox}>
                      <Ionicons name="information-circle-outline" size={16} color="#92400e" />
                      <Text style={styles.missingText}>The owner has not submitted a payout account.</Text>
                    </View>
                  )}
                  {selectedReceiver && !selectedReceiver.verifiedByAdmin && (
                    <>
                      <Text style={styles.missingText}>Ask the owner to correct any details that do not match their registered account.</Text>
                      <TouchableOpacity
                        style={[styles.verifyBtn, verifying && styles.verifyBtnDisabled]}
                        onPress={() => void handleSave()}
                        disabled={verifying}
                      >
                        {verifying ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />}
                        <Text style={styles.verifyBtnText}>{verifying ? "Approving..." : "Approve Account"}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity style={styles.closeModalBtn} onPress={() => setModalVisible(false)}>
                    <Text style={styles.closeModalBtnText}>Close</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
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
  searchWrap: { backgroundColor: "#fff", paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 8 },
  searchInput: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: "#111827" },
  channelRow: { alignItems: "center", gap: 6, paddingBottom: 2 },
  channelChip: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  channelChipActive: { borderColor: "#2563eb", backgroundColor: "#dbeafe" },
  channelChipText: { fontSize: 11, fontWeight: "700", color: "#374151" },
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
  modalCard: { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: "900", color: "#111827" },
  closeBtn: { padding: 4 },
  modalShopName: { fontSize: 16, fontWeight: "800", color: "#1e3a5f", marginBottom: 2 },
  modalEmail: { fontSize: 12, color: "#6b7280", marginBottom: 14 },
  submittedBox: { backgroundColor: "#f0f9ff", borderRadius: 10, padding: 12, marginBottom: 14, gap: 4 },
  submittedLabel: { fontSize: 11, fontWeight: "800", color: "#0369a1", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  submittedText: { fontSize: 14, color: "#0c4a6e", fontWeight: "600" },
  missingBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#fffbeb", borderRadius: 10, padding: 12, marginBottom: 14 },
  missingText: { flex: 1, fontSize: 13, color: "#78350f", lineHeight: 18 },
  verifyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 14, marginTop: 16 },
  verifyBtnDisabled: { opacity: 0.55 },
  verifyBtnText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  closeModalBtn: { alignItems: "center", paddingVertical: 12, marginTop: 10, borderRadius: 10, borderWidth: 1, borderColor: "#e5e7eb" },
  closeModalBtnText: { fontSize: 14, color: "#6b7280", fontWeight: "700" },
});
