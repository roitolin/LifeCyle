import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import LoadingBird from '@/components/LoadingBird';
import { AppHeaderBackButton } from "@/components";
import {
  ActivityIndicator,
  Animated,
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  PanResponder,
  Pressable,
} from "react-native";
import { Card, Text, Avatar, IconButton } from "react-native-paper";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/services/supabaseClient";
import { auth } from "../../services/supabaseAuth";
import { markChatMessagesSeen } from "../../utils/chatHelpers";
import { useResponsive } from "../../utils/responsive";
import { getDefaultProfileImage } from "../../utils/defaultProfileImage";
import {
  saveConversationPreference,
  type ConversationPreference,
} from "../../utils/conversationPreferences";
import { useFocusEffect } from "@react-navigation/native";

interface Conversation {
  id: string;
  participants: string[];
  hiddenFor?: string[];
  pinnedFor?: string[];
  archivedFor?: string[];
  unreadFor?: string[];
  lastMessage?: {
    text: string;
    senderId: string;
    timestamp: string;
    readBy?: string[];
  };
  updatedAt: string;
}

type UserInfoMap = Record<
  string,
  {
    fullName?: string;
    email?: string;
    photoURL?: string;
    gender?: "male" | "female" | "other";
    role?: string;
    shopName?: string;
    shopImageUrl?: string;
    isShop?: boolean;
  }
>;

const appLogo = require("../../../assets/Icon/AppICONTransparents.png");

type ConversationPreferenceField = "pinnedFor" | "archivedFor" | "unreadFor";

const preferenceFields: Record<ConversationPreference, ConversationPreferenceField> = {
  pinned: "pinnedFor",
  archived: "archivedFor",
  unread: "unreadFor",
};

function isConversationUnread(conversation: Conversation, userId?: string) {
  if (!userId) return false;
  if (conversation.unreadFor?.includes(userId)) return true;
  return !!(
    conversation.lastMessage &&
    conversation.lastMessage.senderId !== userId &&
    (!conversation.lastMessage.readBy || !conversation.lastMessage.readBy.includes(userId))
  );
}

function sortConversationsForUser(conversations: Conversation[], userId: string) {
  return [...conversations].sort((a, b) => {
    const pinDifference = Number(!!b.pinnedFor?.includes(userId)) - Number(!!a.pinnedFor?.includes(userId));
    if (pinDifference !== 0) return pinDifference;
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
}

function formatConversationTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const elapsedMs = Math.max(0, now.getTime() - date.getTime());
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return "Now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  if (elapsedMinutes < 24 * 60 && date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : String(count);
}

function ConversationActionRow({
  icon,
  label,
  onPress,
  busy,
  disabled,
  danger = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
  danger?: boolean;
}) {
  const color = danger ? "#ff5364" : "#f5f5f5";
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.72}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionSheetRow, disabled && styles.actionSheetRowDisabled]}
    >
      <Ionicons name={icon} size={23} color={color} />
      <Text style={[styles.actionSheetLabel, danger && styles.actionSheetDanger]}>{label}</Text>
      {busy ? <ActivityIndicator size="small" color={color} /> : null}
    </TouchableOpacity>
  );
}

export default function ConversationsList({ navigation }: any) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [dbError, setdbError] = useState<string | null>(null);
  const [userInfoMap, setUserInfoMap] = useState<UserInfoMap>({});
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<"all" | "active" | "archived">("all");
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [actionBusy, setActionBusy] = useState<ConversationPreference | "delete" | null>(null);
  const userId = auth.currentUser?.uid;
  const { isDesktop } = useResponsive();
  const insets = useSafeAreaInsets();
  const shopLookupLoadedRef = useRef(new Set<string>());
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetTranslateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!selectedConversation) return;
    sheetTranslateY.setValue(420);
    Animated.spring(sheetTranslateY, {
      toValue: 0,
      damping: 24,
      stiffness: 260,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
    return () => sheetTranslateY.stopAnimation();
  }, [selectedConversation, sheetTranslateY]);

  const dismissActionSheet = useCallback(() => {
    if (actionBusy !== null) return;
    Animated.timing(sheetTranslateY, {
      toValue: 520,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setSelectedConversation(null);
      sheetTranslateY.setValue(0);
    });
  }, [actionBusy, sheetTranslateY]);

  const actionSheetPanResponder = useMemo(() => {
    const snapBack = () => {
      Animated.spring(sheetTranslateY, {
        toValue: 0,
        damping: 22,
        stiffness: 260,
        useNativeDriver: true,
      }).start();
    };

    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        actionBusy === null && gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        actionBusy === null && gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => sheetTranslateY.stopAnimation(),
      onPanResponderMove: (_event, gesture) => {
        sheetTranslateY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > 105 || gesture.vy > 0.85) dismissActionSheet();
        else snapBack();
      },
      onPanResponderTerminate: snapBack,
    });
  }, [actionBusy, dismissActionSheet, sheetTranslateY]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Chats",
      headerBackVisible: false,
      headerLeft: () => (
        <AppHeaderBackButton onPress={() => navigation.goBack()} accessibilityLabel="Back" />
      ),
      headerStyle: { backgroundColor: "#ffffff" },
      headerTintColor: "#26332e",
    });
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      const parentNavigator = navigation.getParent?.();
      const grandParentNavigator = parentNavigator?.getParent?.();
      const navigators = [navigation, parentNavigator, grandParentNavigator].filter(Boolean);
      const tabNavigator = navigators.find((nav: any) => nav?.getState?.()?.type === "tab");
      if (!tabNavigator) return undefined;
      tabNavigator.setOptions?.({ tabBarStyle: { display: "none" } });
      return () => tabNavigator.setOptions?.({ tabBarStyle: undefined });
    }, [navigation])
  );

  const loadUnreadCounts = useCallback(async (items: Conversation[]) => {
    if (!userId || items.length === 0) {
      setUnreadCounts({});
      return;
    }

    const conversationIds = items.map((conversation) => conversation.id);
    const { data, error } = await supabase
      .from("messages")
      .select("conversationId")
      .in("conversationId", conversationIds)
      .neq("senderId", userId)
      .not("readBy", "cs", `{${userId}}`);

    const counts: Record<string, number> = {};
    if (error) {
      console.warn("Unable to load unread message counts:", error.message);
    } else {
      (data || []).forEach((message: { conversationId: string }) => {
        counts[message.conversationId] = (counts[message.conversationId] || 0) + 1;
      });
    }

    // A manually marked-unread conversation should still show a badge even
    // when every stored message already has a read receipt.
    items.forEach((conversation) => {
      if (conversation.unreadFor?.includes(userId) && !counts[conversation.id]) {
        counts[conversation.id] = 1;
      } else if (error && isConversationUnread(conversation, userId)) {
        counts[conversation.id] = 1;
      }
    });
    setUnreadCounts(counts);
  }, [userId]);

  const loadConversations = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .contains("participants", [userId]);

      if (error) throw error;

      const list = (data || []) as Conversation[];

      const visibleList = list.filter((conversation) => {
        if (conversation.hiddenFor?.includes(userId)) return false;
        const otherParticipant = conversation.participants.find((participantId) => participantId !== userId);
        if (otherParticipant && blockedUserIds.has(otherParticipant)) return false;
        return true;
      });

      setConversations(sortConversationsForUser(visibleList, userId));
      await loadUnreadCounts(visibleList);
      setdbError(null);
    } catch (error: any) {
      console.error("Conversations load error:", error);
      setdbError(error?.message || "Failed to load conversations.");
    } finally {
      setLoading(false);
    }
  }, [userId, blockedUserIds, loadUnreadCounts]);

  // Keep the realtime listener stable while still using the latest blocked
  // user list and conversation loader when a change arrives.
  const loadConversationsRef = useRef(loadConversations);
  useEffect(() => {
    loadConversationsRef.current = loadConversations;
  }, [loadConversations]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    void loadConversationsRef.current();

    const scheduleReload = () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        void loadConversationsRef.current();
      }, 120);
    };

    const channel = supabase
      // A unique channel name prevents a previous Strict Mode/reload channel
      // from being reused while it is still unsubscribing.
      .channel(`public:conversations_list:${userId}:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        scheduleReload
      )
      .subscribe();

    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    let blockerSide = new Set<string>();
    let blockedSide = new Set<string>();

    const applySets = () => {
      const merged = new Set<string>([...blockerSide, ...blockedSide]);
      setBlockedUserIds(merged);
    };

    const loadBlocks = async () => {
      try {
        const [blockerRes, blockedRes] = await Promise.all([
          supabase.from("user_blocks").select("*").eq("blockerId", userId),
          supabase.from("user_blocks").select("*").eq("blockedId", userId)
        ]);

        if (blockerRes.error) throw blockerRes.error;
        if (blockedRes.error) throw blockedRes.error;

        if (blockerRes.data) {
          blockerRes.data.forEach(item => {
            if (item.active !== false) blockerSide.add(item.blockedId);
          });
        }
        if (blockedRes.data) {
          blockedRes.data.forEach(item => {
            if (item.active !== false) blockedSide.add(item.blockerId);
          });
        }
        applySets();
      } catch (e) {
        console.warn("Failed to load block state", e);
      }
    };

    loadBlocks();
  }, [userId]);

  useEffect(() => {
    const loadUserNames = async () => {
      if (!userId || conversations.length === 0) return;

      const otherUserIds = Array.from(
        new Set(
          conversations
            .map((conversation) =>
              conversation.participants.find((participantId) => participantId !== userId)
            )
            .filter(Boolean) as string[]
        )
      );

      const missingIds = otherUserIds.filter((id) => !userInfoMap[id]);
      const shopIdsToLoad = otherUserIds.filter((id) => !shopLookupLoadedRef.current.has(id));
      if (missingIds.length === 0 && shopIdsToLoad.length === 0) return;

      const updates: UserInfoMap = {};
      try {
        const [userResult, shopResult] = await Promise.all([
          missingIds.length > 0
            ? supabase.rpc("get_chat_partner_profiles", { target_ids: missingIds })
            : Promise.resolve({ data: [], error: null }),
          shopIdsToLoad.length > 0
            ? supabase
                .from("funeral_shops")
                .select("id, shopName, shopImageUrl")
                .in("id", shopIdsToLoad)
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (!userResult.error && userResult.data) {
          userResult.data.forEach((user: any) => {
            updates[user.id] = {
              fullName: user.fullName,
              email: user.email,
              photoURL: user.photoURL,
              gender: user.gender,
              role: user.role || "user",
            };
          });
        }
        // Keep storefront information available without replacing the account
        // owner's personal chat identity.
        if (!shopResult.error && shopResult.data) {
          shopIdsToLoad.forEach((id) => shopLookupLoadedRef.current.add(id));
          shopResult.data.forEach((shop: any) => {
            updates[shop.id] = {
              ...(updates[shop.id] || userInfoMap[shop.id] || {}),
              shopName: shop.shopName,
              shopImageUrl: shop.shopImageUrl,
              isShop: true,
            };
          });
        }
      } catch (error) {
        console.error("Failed loading user info:", error);
      }

      setUserInfoMap((prev) => ({ ...prev, ...updates }));
    };

    loadUserNames();
  }, [conversations, userId, userInfoMap]);

  const getOtherParticipant = (conversation: Conversation) => {
    return conversation.participants.find((participantId) => participantId !== userId) || "";
  };

  const updatePreferenceLocally = (
    conversationId: string,
    preference: ConversationPreference,
    enabled: boolean
  ) => {
    if (!userId) return;
    const field = preferenceFields[preference];
    if (preference === "unread") {
      setUnreadCounts((current) => ({
        ...current,
        [conversationId]: enabled ? Math.max(current[conversationId] || 0, 1) : 0,
      }));
    }
    setConversations((current) => sortConversationsForUser(current.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const existing = conversation[field] || [];
      const next = enabled
        ? Array.from(new Set([...existing, userId]))
        : existing.filter((id) => id !== userId);
      return { ...conversation, [field]: next };
    }), userId));
  };

  const setPreference = async (
    conversation: Conversation,
    preference: ConversationPreference,
    enabled: boolean
  ) => {
    setActionBusy(preference);
    try {
      await saveConversationPreference(conversation.id, preference, enabled);
      updatePreferenceLocally(conversation.id, preference, enabled);
      setSelectedConversation(null);
    } catch (error: any) {
      Alert.alert("Could not update conversation", error?.message || "Please try again.");
    } finally {
      setActionBusy(null);
    }
  };

  const setConversationReadState = async (
    conversation: Conversation,
    shouldRead: boolean
  ) => {
    if (!userId) return false;

    try {
      if (!shouldRead) {
        await saveConversationPreference(conversation.id, "unread", true);
        updatePreferenceLocally(conversation.id, "unread", true);
        return true;
      }

      await markChatMessagesSeen(conversation.id, userId, null);

      const conv = conversations.find(c => c.id === conversation.id);
      if (conv && conv.lastMessage) {
        let currentReadBy = conv.lastMessage.readBy || [];
        if (shouldRead && !currentReadBy.includes(userId)) {
          currentReadBy = [...currentReadBy, userId];
        } else if (!shouldRead && currentReadBy.includes(userId)) {
          currentReadBy = currentReadBy.filter((id: string) => id !== userId);
        }
        const { error } = await supabase
          .from("conversations")
          .update({ lastMessage: { ...conv.lastMessage, readBy: currentReadBy } })
          .eq("id", conversation.id)
          .eq("updatedAt", conv.updatedAt);
        if (error) throw error;
      }

      await saveConversationPreference(conversation.id, "unread", false);
      updatePreferenceLocally(conversation.id, "unread", false);
      return true;
    } catch (error: any) {
      console.error("setConversationReadState error:", error);
      Alert.alert("Error", error?.message || "Failed to update read status.");
      return false;
    }
  };

  const handleReadAction = async (conversation: Conversation) => {
    setActionBusy("unread");
    try {
      const shouldRead = isConversationUnread(conversation, userId);
      const updated = await setConversationReadState(
        conversation,
        shouldRead
      );
      if (updated) setSelectedConversation(null);
    } finally {
      setActionBusy(null);
    }
  };

  const removeConversation = async (conversationId: string) => {
    if (!userId) return;
    Alert.alert("Delete conversation", "Delete this conversation from your chat list? New messages will make it visible again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const { data: conv, error: fetchError } = await supabase
              .from("conversations")
              .select("hiddenFor")
              .eq("id", conversationId)
              .single();
              
            if (fetchError) throw fetchError;

            const currentHiddenFor = conv?.hiddenFor || [];
            if (!currentHiddenFor.includes(userId)) {
              const { error: hideError } = await supabase
                .from("conversations")
                .update({ hiddenFor: [...currentHiddenFor, userId] })
                .eq("id", conversationId);
              if (hideError) throw hideError;
            }

            setConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
          } catch (error: any) {
            console.warn("removeConversation warning:", error?.message || error);
            Alert.alert("Error", error?.message || "Failed to remove conversation.");
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: Conversation }) => {
    const otherUserId = getOtherParticipant(item);
    const otherUser = userInfoMap[otherUserId];
    const displayName =
      otherUser?.fullName ||
      otherUser?.shopName ||
      otherUser?.email ||
      "User";

    const subtitlePrefix = item.lastMessage?.senderId === userId ? "You: " : "";
    const unread =
      isConversationUnread(item, userId);
    const unreadCount = unreadCounts[item.id] || (unread ? 1 : 0);
    const pinned = !!userId && !!item.pinnedFor?.includes(userId);

    const fallbackSource = getDefaultProfileImage(otherUser?.gender);
    const avatarSource =
      String(otherUser?.role || "").toLowerCase() === "admin"
        ? appLogo
        : otherUser?.photoURL
        ? { uri: otherUser.photoURL }
        : otherUser?.shopImageUrl
        ? { uri: otherUser.shopImageUrl }
        : fallbackSource;

    return (
      <Card style={[styles.card, unread && styles.unreadCard]} mode="elevated">
        <TouchableOpacity
          onPress={() => navigation.navigate("Chat", { conversationId: item.id, otherUserId })}
          onLongPress={() => {
            if (!isDesktop) setSelectedConversation(item);
          }}
          delayLongPress={350}
          accessibilityHint="Long press for conversation actions"
          accessibilityLabel={unreadCount > 0
            ? `${displayName}, ${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}`
            : displayName}
          activeOpacity={0.7}
          style={styles.conversationRow}
        >
          <Avatar.Image size={50} source={avatarSource as any} style={styles.conversationAvatar} />
          <View style={styles.conversationCopy}>
            <Text
              numberOfLines={1}
              style={[styles.conversationName, unreadCount > 0 && styles.unreadName]}
            >
              {displayName}
            </Text>
            <Text
              numberOfLines={2}
              style={[styles.conversationPreview, unreadCount > 0 && styles.unreadPreview]}
            >
              {`${subtitlePrefix}${item.lastMessage?.text || "No messages yet"}`}
            </Text>
          </View>
          <View style={styles.conversationMeta}>
            <View style={styles.timeTopRow}>
              {pinned ? <Ionicons name="pin" size={13} color="#626c67" /> : null}
              {item.lastMessage?.timestamp ? (
                <Text style={[styles.time, unreadCount > 0 && styles.unreadTime]}>
                  {formatConversationTime(item.lastMessage.timestamp)}
                </Text>
              ) : null}
            </View>
            {unreadCount > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{formatUnreadCount(unreadCount)}</Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>

        {isDesktop ? <Card.Actions style={styles.actions}>
          <IconButton
            icon="check-circle-outline"
            size={20}
            iconColor={unread ? "rgba(211,47,47,0.45)" : "#2e7d32"}
            onPress={() => void setConversationReadState(item, true)}
          />
          <Text
            style={[
              styles.actionLabel,
              { color: unread ? "rgba(211,47,47,0.45)" : "#2e7d32" },
            ]}
          >
            Read
          </Text>

          <IconButton
            icon="email-mark-as-unread"
            size={20}
            onPress={() => void setConversationReadState(item, false)}
          />
          <Text style={styles.actionLabel}>Unread</Text>

          <IconButton
            icon="delete-outline"
            size={20}
            iconColor="#d32f2f"
            onPress={() => removeConversation(item.id)}
          />
          <Text style={[styles.actionLabel, { color: "#d32f2f" }]}>Delete</Text>
        </Card.Actions> : null}
      </Card>
    );
  };

  if (loading) {
    return <LoadingBird fullScreen />;
  }

  const filteredConversations = conversations.filter((conversation) => {
    const archived = !!userId && !!conversation.archivedFor?.includes(userId);
    if (filterMode === "archived") return archived;
    if (archived) return false;
    if (filterMode === "active") return conversation.lastMessage?.senderId !== userId;
    return true;
  });

  const selectedPinned = !!userId && !!selectedConversation?.pinnedFor?.includes(userId);
  const selectedArchived = !!userId && !!selectedConversation?.archivedFor?.includes(userId);
  const selectedUnread = !!selectedConversation && isConversationUnread(selectedConversation, userId);
  const actionsDisabled = actionBusy !== null;

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      {!!dbError && <Text style={styles.error}>{dbError}</Text>}
      <View style={styles.filterRow}>
        <TouchableOpacity style={[styles.filterPill, filterMode === "all" && styles.filterPillActive]} onPress={() => setFilterMode("all")}>
          <Text style={[styles.filterText, filterMode === "all" && styles.filterTextActive]}>All</Text>
          {filterMode === "all" ? <View style={styles.filterDot} /> : null}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterPill, filterMode === "active" && styles.filterPillActive]} onPress={() => setFilterMode("active")}>
          <Text style={[styles.filterText, filterMode === "active" && styles.filterTextActive]}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterPill, filterMode === "archived" && styles.filterPillActive]} onPress={() => setFilterMode("archived")}>
          <Text style={[styles.filterText, filterMode === "archived" && styles.filterTextActive]}>Archived</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={filteredConversations}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={<Text style={styles.empty}>{filterMode === "archived" ? "No archived conversations." : "No conversations yet."}</Text>}
      />
      <Modal
        animationType="fade"
        transparent
        statusBarTranslucent
        visible={!!selectedConversation}
        onRequestClose={() => {
          dismissActionSheet();
        }}
      >
        <View style={styles.actionSheetOverlay} accessibilityViewIsModal>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close conversation actions"
            disabled={actionsDisabled}
            onPress={dismissActionSheet}
            style={styles.actionSheetBackdrop}
          />
          <Animated.View
            {...actionSheetPanResponder.panHandlers}
            style={[
              styles.actionSheet,
              {
                paddingBottom: Math.max(insets.bottom, 14),
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            <View style={styles.actionSheetDragArea}>
              <View style={styles.actionSheetGrabber} />
            </View>
            {selectedConversation ? (
              <>
                <ConversationActionRow
                  icon={selectedPinned ? "pin-outline" : "pin"}
                  label={selectedPinned ? "Unpin" : "Pin"}
                  disabled={actionsDisabled}
                  busy={actionBusy === "pinned"}
                  onPress={() => void setPreference(selectedConversation, "pinned", !selectedPinned)}
                />
                <ConversationActionRow
                  icon={selectedArchived ? "archive" : "archive-outline"}
                  label={selectedArchived ? "Unarchive" : "Archive"}
                  disabled={actionsDisabled}
                  busy={actionBusy === "archived"}
                  onPress={() => void setPreference(selectedConversation, "archived", !selectedArchived)}
                />
                <ConversationActionRow
                  icon={selectedUnread ? "mail-open-outline" : "mail-unread-outline"}
                  label={selectedUnread ? "Mark as read" : "Mark as unread"}
                  disabled={actionsDisabled}
                  busy={actionBusy === "unread"}
                  onPress={() => void handleReadAction(selectedConversation)}
                />
                <ConversationActionRow
                  icon="trash-outline"
                  label="Delete"
                  danger
                  disabled={actionsDisabled}
                  busy={actionBusy === "delete"}
                  onPress={() => {
                    const conversationId = selectedConversation.id;
                    setSelectedConversation(null);
                    void removeConversation(conversationId);
                  }}
                />
              </>
            ) : null}
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 10, backgroundColor: "#ffffff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { textAlign: "center", marginTop: 50, fontSize: 16, color: "#7b817e" },
  error: { color: "#d32f2f", textAlign: "center", marginBottom: 12 },
  card: { marginBottom: 0, borderRadius: 0, backgroundColor: "#ffffff", borderBottomWidth: 1, borderBottomColor: "#edf0ee", elevation: 0, shadowOpacity: 0 },
  unreadCard: {
    backgroundColor: "#f4f7ff",
    borderBottomColor: "#dfe7fb",
  },
  conversationRow: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  conversationAvatar: { backgroundColor: "#edf0f4" },
  conversationCopy: { flex: 1, minWidth: 0, marginLeft: 12, paddingRight: 10 },
  conversationName: { color: "#303848", fontSize: 15, fontWeight: "600" },
  unreadName: { color: "#202a43", fontWeight: "900" },
  conversationPreview: { color: "#8a929e", fontSize: 12, lineHeight: 17, marginTop: 4 },
  unreadPreview: { color: "#4d5870", fontWeight: "700" },
  conversationMeta: {
    width: 58,
    minHeight: 54,
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  timeTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  time: { fontSize: 11, color: "#9299a4" },
  unreadTime: { color: "#4d6fd1", fontWeight: "700" },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: "#4f73e8",
    alignItems: "center",
    justifyContent: "center",
  },
  unreadBadgeText: { color: "#ffffff", fontSize: 11, fontWeight: "900" },
  actions: {
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 2,
    paddingLeft: 8,
    paddingBottom: 8,
  },
  actionLabel: {
    fontSize: 12,
    color: "#555",
    marginRight: 8,
  },
  containerDesktop: { maxWidth: 800, alignSelf: "center", width: "100%" },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 6, paddingBottom: 10 },
  filterPill: { minWidth: 58, minHeight: 34, borderRadius: 18, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4, paddingHorizontal: 12, backgroundColor: "#f4f5f4" },
  filterPillActive: { backgroundColor: "#fff3f0" },
  filterText: { color: "#777e7a", fontSize: 12, fontWeight: "700" },
  filterTextActive: { color: "#ee4f38", fontWeight: "900" },
  filterDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ee4f38" },
  actionSheetOverlay: { flex: 1, justifyContent: "flex-end" },
  actionSheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0, 0, 0, 0.56)" },
  actionSheet: {
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#252525",
    paddingHorizontal: 12,
    paddingTop: 9,
  },
  actionSheetDragArea: { minHeight: 24, alignItems: "center", justifyContent: "center" },
  actionSheetGrabber: { width: 42, height: 4, borderRadius: 2, backgroundColor: "#8b8b8b" },
  actionSheetRow: { minHeight: 56, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 16 },
  actionSheetRowDisabled: { opacity: 0.58 },
  actionSheetLabel: { flex: 1, color: "#f5f5f5", fontSize: 16, fontWeight: "600" },
  actionSheetDanger: { color: "#ff5364" },
});
