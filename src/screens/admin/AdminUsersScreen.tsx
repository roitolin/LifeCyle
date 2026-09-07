import { useEffect, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  View,
  FlatList,
  Alert,
  StyleSheet,
  Modal,
  TextInput as NativeTextInput,
  TouchableOpacity,
} from "react-native";
import {
  Card,
  Text,
  Searchbar,
  Button,
  IconButton,
  Avatar,
} from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { auth } from "../../services/supabaseAuth";
import { useResponsive } from "../../utils/responsive";
import { logAdminAction } from "../../utils/adminAuditLog";

type User = {
  id: string;
  email: string;
  fullName?: string;
  role?: string;
  disabled?: boolean;
  banReason?: string | null;
  bannedUntil?: string | null;
  bannedAt?: string | null;
  bannedBy?: string | null;
  createdAt?: string;
  photoURL?: string;
};

export default function AdminUsersScreen({ navigation }: any) {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [banModalVisible, setBanModalVisible] = useState(false);
  const [banTargetUser, setBanTargetUser] = useState<User | null>(null);
  const [banReasonInput, setBanReasonInput] = useState("");
  const [banDaysInput, setBanDaysInput] = useState("7");
  const { isDesktop } = useResponsive();

  const resolveDate = (value: any): Date | null => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const isUserBanned = (user: User) => {
    const bannedUntil = resolveDate(user.bannedUntil);
    if (bannedUntil) {
      return bannedUntil.getTime() > Date.now();
    }
    return Boolean(user.disabled);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .order("createdAt", { ascending: false });

      if (error) throw error;
      
      setUsers(data as User[]);
      setFilteredUsers(data as User[]);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      setFilteredUsers(users);
      return;
    }

    const filtered = users.filter((item: any) => {
      return [item.id, item.email, item.fullName]
        .map((entry) => String(entry || "").toLowerCase())
        .some((entry) => entry.includes(normalized));
    });
    setFilteredUsers(filtered);
  };

  const openBanModal = (user: User) => {
    setBanTargetUser(user);
    setBanReasonInput(user.banReason || "");
    setBanDaysInput("7");
    setBanModalVisible(true);
  };

  const closeBanModal = () => {
    setBanModalVisible(false);
    setBanTargetUser(null);
    setBanReasonInput("");
    setBanDaysInput("7");
  };

  const applyBan = async () => {
    if (!banTargetUser) return;
    const trimmedReason = banReasonInput.trim();
    const days = Number(banDaysInput);

    if (!trimmedReason) {
      Alert.alert("Required", "Please provide a ban reason.");
      return;
    }
    if (!Number.isFinite(days) || days <= 0) {
      Alert.alert("Invalid Duration", "Please enter a valid number of days.");
      return;
    }

    const now = Date.now();
    const bannedUntilDate = new Date(now + days * 24 * 60 * 60 * 1000);
    Alert.alert(
      "Confirm Ban",
      `Ban ${banTargetUser.email} for ${days} day(s)?\n\nReason: ${trimmedReason}\nBan ends: ${bannedUntilDate.toLocaleString(undefined, { hour12: true })}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm Ban",
          style: "destructive",
          onPress: async () => {
            setUpdatingId(banTargetUser.id);
            try {
              const patch = {
                disabled: true,
                banReason: trimmedReason,
                bannedBy: auth.currentUser?.uid || null,
                bannedAt: new Date().toISOString(),
                bannedUntil: bannedUntilDate.toISOString(),
              };

              const { error } = await supabase
                .from("users")
                .update(patch)
                .eq("id", banTargetUser.id);
                
              if (error) throw error;

              setUsers((prev) => prev.map((item: any) => (item.id === banTargetUser.id ? { ...item, ...patch } : item)));
              setFilteredUsers((prev) => prev.map((item: any) => (item.id === banTargetUser.id ? { ...item, ...patch } : item)));

              await logAdminAction({
                adminId: auth.currentUser?.uid,
                action: "user_banned",
                targetType: "user",
                targetId: banTargetUser.id,
                summary: `Banned user ${banTargetUser.email} until ${bannedUntilDate.toLocaleString(undefined, { hour12: true })}`,
                metadata: { reason: trimmedReason, bannedUntil: bannedUntilDate.toISOString() },
              });

              closeBanModal();
              Alert.alert("Success", `User banned until ${bannedUntilDate.toLocaleString(undefined, { hour12: true })}.`);
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to ban user.");
            } finally {
              setUpdatingId(null);
            }
          },
        },
      ]
    );
  };

  const unbanUser = async (user: User) => {
    Alert.alert("Unban User", `Remove ban for ${user.email}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unban",
        onPress: async () => {
          setUpdatingId(user.id);
          try {
            const patch = {
              disabled: false,
              banReason: null,
              bannedBy: null,
              bannedAt: null,
              bannedUntil: null,
              unbannedAt: new Date().toISOString(),
              unbannedBy: auth.currentUser?.uid || null,
            };

            const { error } = await supabase
              .from("users")
              .update(patch)
              .eq("id", user.id);
              
            if (error) throw error;

            setUsers((prev) => prev.map((item: any) => (item.id === user.id ? { ...item, ...patch } : item)));
            setFilteredUsers((prev) => prev.map((item: any) => (item.id === user.id ? { ...item, ...patch } : item)));

            await logAdminAction({
              adminId: auth.currentUser?.uid,
              action: "user_unbanned",
              targetType: "user",
              targetId: user.id,
              summary: `Unbanned user ${user.email}`,
            });
            Alert.alert("Success", "User has been unbanned.");
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Failed to unban user.");
          } finally {
            setUpdatingId(null);
          }
        },
      },
    ]);
  };

  const deleteUser = async (user: User) => {
    Alert.alert(
      "Confirm Delete",
      `Are you sure you want to delete user ${user.email}? This removes only their profile data.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setUpdatingId(user.id);
            try {
              const { error } = await supabase.from("users").delete().eq("id", user.id);
              if (error) throw error;
              
              setUsers((prev) => prev.filter((item: any) => item.id !== user.id));
              setFilteredUsers((prev) => prev.filter((item: any) => item.id !== user.id));
              await logAdminAction({
                adminId: auth.currentUser?.uid,
                action: "user_deleted",
                targetType: "user",
                targetId: user.id,
                summary: `Deleted user document for ${user.email}`,
              });
              Alert.alert("Success", "User profile removed.");
            } catch (error: any) {
              Alert.alert("Error", error.message);
            } finally {
              setUpdatingId(null);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: User }) => {
    const bannedUntil = resolveDate(item.bannedUntil);
    const banned = isUserBanned(item);
    const banStatusLabel = banned
      ? `Banned${bannedUntil ? ` until ${bannedUntil.toLocaleString(undefined, { hour12: true })}` : ""}`
      : "Active";

    return (
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <View style={styles.topRow}>
            <View style={styles.avatarContainer}>
              {item.photoURL ? (
                <Avatar.Image size={50} source={{ uri: item.photoURL }} />
              ) : (
                <Avatar.Icon size={50} icon="account" />
              )}
            </View>
            <View style={styles.info}>
              <Text variant="titleMedium" numberOfLines={2} style={styles.nameText}>
                {item.fullName || "No name"}
              </Text>
              <Text variant="bodyMedium" numberOfLines={2} style={styles.emailText}>
                {item.email}
              </Text>
              <Text variant="bodySmall" style={styles.uidText}>
                UID: {item.id}
              </Text>
              <Text variant="bodySmall" style={styles.metaText}>
                Role: {item.role || "user"} | Created: {resolveDate(item.createdAt)?.toLocaleDateString() || "N/A"}
              </Text>
              <Text variant="bodySmall" style={[styles.metaText, banned ? styles.bannedText : styles.activeText]}>
                Status: {banStatusLabel}
              </Text>
              {item.banReason ? (
                <Text variant="bodySmall" style={styles.banReasonText} numberOfLines={2}>
                  Reason: {item.banReason}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.actionsRow}>
            <View style={styles.switchContainer}>
              <Button
                mode={banned ? "contained-tonal" : "outlined"}
                icon={banned ? "shield-check" : "gavel"}
                onPress={() => (banned ? unbanUser(item) : openBanModal(item))}
                disabled={updatingId === item.id}
                compact
              >
                {banned ? "Unban" : "Ban"}
              </Button>
            </View>
            <View style={styles.iconActions}>
              <IconButton icon="eye" size={24} onPress={() => navigation.navigate("AdminUserDetail", { userId: item.id })} />
              <IconButton
                icon="delete"
                size={24}
                onPress={() => deleteUser(item)}
                disabled={updatingId === item.id}
                iconColor="red"
              />
            </View>
          </View>
        </Card.Content>
      </Card>
    );
  };

  if (loading) {
    return <LoadingBird fullScreen />;
  }

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <Searchbar
        placeholder="Search by name, email, or UID"
        onChangeText={handleSearch}
        value={searchQuery}
        style={styles.searchbar}
      />

      <Modal visible={banModalVisible} transparent animationType="fade" onRequestClose={closeBanModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ban Account</Text>
            <Text style={styles.modalSubtitle}>{banTargetUser?.email || "Selected user"}</Text>

            <Text style={styles.modalLabel}>Reason *</Text>
            <NativeTextInput
              value={banReasonInput}
              onChangeText={setBanReasonInput}
              placeholder="Explain why this account is being banned"
              style={[styles.modalInput, styles.modalTextArea]}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <Text style={styles.modalLabel}>Ban duration (days) *</Text>
            <NativeTextInput
              value={banDaysInput}
              onChangeText={setBanDaysInput}
              placeholder="7"
              keyboardType="number-pad"
              style={styles.modalInput}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={closeBanModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBanBtn} onPress={applyBan} disabled={updatingId === banTargetUser?.id}>
                <Text style={styles.modalBanText}>Confirm Ban</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <FlatList
        data={filteredUsers}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshing={loading}
        onRefresh={fetchUsers}
        ListEmptyComponent={<Text style={styles.empty}>No users found.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#f5f5f5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  searchbar: { marginBottom: 15 },
  card: { marginBottom: 10 },
  topRow: { flexDirection: "row", alignItems: "flex-start" },
  avatarContainer: { marginRight: 12, paddingTop: 2 },
  info: { flex: 1, minWidth: 0 },
  nameText: { fontWeight: "800", color: "#111827" },
  emailText: { color: "#374151", marginTop: 2 },
  uidText: { color: "#4f46e5", fontWeight: "700", marginTop: 2 },
  metaText: { color: "#666", marginTop: 2 },
  activeText: { color: "#15803d", fontWeight: "700" },
  bannedText: { color: "#b91c1c", fontWeight: "700" },
  banReasonText: { color: "#991b1b", marginTop: 2, fontWeight: "600" },
  actionsRow: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  switchContainer: { alignItems: "center", marginLeft: 2, flexDirection: "row", gap: 4 },
  iconActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  empty: { textAlign: "center", marginTop: 50, fontSize: 16 },
  containerDesktop: { maxWidth: 800, alignSelf: "center", width: "100%" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#b91c1c",
  },
  modalSubtitle: {
    color: "#6b7280",
    marginBottom: 10,
    marginTop: 2,
  },
  modalLabel: {
    marginTop: 6,
    marginBottom: 4,
    fontWeight: "700",
    color: "#111827",
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  modalTextArea: {
    minHeight: 90,
  },
  modalActions: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  modalCancelBtn: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#f9fafb",
  },
  modalCancelText: {
    color: "#374151",
    fontWeight: "700",
  },
  modalBanBtn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#dc2626",
  },
  modalBanText: {
    color: "#fff",
    fontWeight: "800",
  },
});
