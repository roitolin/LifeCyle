import { useState, useEffect, useCallback } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  View,
  FlatList,
  Alert,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { Card, Text, Avatar, IconButton } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { auth } from "../../services/supabaseAuth";
import { markChatMessagesSeen } from "../../utils/chatHelpers";
import { saveConversationPreference } from "../../utils/conversationPreferences";
import { useResponsive } from "../../utils/responsive";
import { getDefaultProfileImage } from "../../utils/defaultProfileImage";

type Conversation = {
  id: string;
  participants: string[];
  hiddenFor?: string[];
  unreadFor?: string[];
  lastMessage?: {
    text: string;
    timestamp: string;
    senderId: string;
    readBy?: string[];
  };
  updatedAt: string;
};

type UserInfoMap = Record<
  string,
  { fullName?: string; email?: string; photoURL?: string; gender?: "male" | "female" | "other" }
>;

type UnreadCounts = Record<string, number>;

export default function AdminSupportMessages({ navigation }: any) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>({});
  const [userInfoMap, setUserInfoMap] = useState<UserInfoMap>({});
  const { isDesktop } = useResponsive();
  const currentUserId = auth.currentUser?.uid;

  const loadConversationMeta = useCallback(
    async (visibleConversations: Conversation[]) => {
      if (!currentUserId) return;

      try {
        const otherUserIds = Array.from(
          new Set(
            visibleConversations
              .map((conversation) =>
                conversation.participants.find((participantId) => participantId !== currentUserId)
              )
              .filter(Boolean) as string[]
          )
        );

        const nextUserInfo: UserInfoMap = {};
        if (otherUserIds.length > 0) {
          const { data: usersData, error } = await supabase
            .from("users")
            .select("id, fullName, email, photoURL, gender")
            .in("id", otherUserIds);

          if (!error && usersData) {
            usersData.forEach((user: any) => {
              nextUserInfo[user.id] = {
                fullName: user.fullName,
                email: user.email,
                photoURL: user.photoURL,
                gender: user.gender,
              };
            });
          }
        }
        setUserInfoMap(nextUserInfo);

        const unreadMap: UnreadCounts = {};
        await Promise.all(
          visibleConversations.map(async (conversation) => {
            const otherUserId = conversation.participants.find(
              (participantId) => participantId !== currentUserId
            );
            if (!otherUserId) {
              unreadMap[conversation.id] = 0;
              return;
            }

            const { data, error } = await supabase
              .from("messages")
              .select("readBy")
              .eq("conversationId", conversation.id)
              .eq("senderId", otherUserId);

            if (!error && data) {
              let unreadCount = conversation.unreadFor?.includes(currentUserId) ? 1 : 0;
              data.forEach((message: any) => {
                if (!message.readBy || !message.readBy.includes(currentUserId)) {
                  unreadCount += 1;
                }
              });
              unreadMap[conversation.id] = unreadCount;
            } else {
              unreadMap[conversation.id] = 0;
            }
          })
        );

        setUnreadCounts(unreadMap);
      } catch (error) {
        console.error("Error loading support conversation metadata:", error);
        Alert.alert("Error", "Failed to load support conversations.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [currentUserId]
  );

  const fetchConversations = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .contains("participants", [currentUserId]);

      if (error) throw error;

      const allConversations = (data || []) as Conversation[];
      const visibleConversations = allConversations
        .filter((conversation) => !conversation.hiddenFor?.includes(currentUserId))
        .sort((a, b) => {
          const aTime = new Date(a.updatedAt || 0).getTime();
          const bTime = new Date(b.updatedAt || 0).getTime();
          return bTime - aTime;
        });

      setConversations(visibleConversations);
      await loadConversationMeta(visibleConversations);
    } catch (error) {
      console.error("Support inbox load error:", error);
      Alert.alert("Error", "Failed to load support conversations.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId, loadConversationMeta]);

  useEffect(() => {
    if (!currentUserId) {
      setConversations([]);
      setUnreadCounts({});
      setUserInfoMap({});
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setLoading(true);
    fetchConversations();

    const channel = supabase
      .channel('admin_support_conversations')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => {
          fetchConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, fetchConversations]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchConversations();
  };

  const setConversationReadState = async (
    conversationId: string,
    shouldRead: boolean
  ) => {
    if (!currentUserId) return;

    try {
      if (!shouldRead) {
        await saveConversationPreference(conversationId, "unread", true);
        setConversations((current) => current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                unreadFor: Array.from(new Set([...(conversation.unreadFor || []), currentUserId])),
              }
            : conversation
        ));
        setUnreadCounts((current) => ({
          ...current,
          [conversationId]: Math.max(1, current[conversationId] || 0),
        }));
        return;
      }

      await markChatMessagesSeen(conversationId, currentUserId, null);

      // Update conversation lastMessage
      const conv = conversations.find(c => c.id === conversationId);
      if (conv && conv.lastMessage) {
        let currentReadBy = conv.lastMessage.readBy || [];
        if (!currentReadBy.includes(currentUserId)) {
          currentReadBy = [...currentReadBy, currentUserId];
        }
        await supabase
          .from("conversations")
          .update({ lastMessage: { ...conv.lastMessage, readBy: currentReadBy } })
          .eq("id", conversationId)
          .eq("updatedAt", conv.updatedAt);
      }
      await saveConversationPreference(conversationId, "unread", false);
      setConversations((current) => current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              unreadFor: (conversation.unreadFor || []).filter((id) => id !== currentUserId),
            }
          : conversation
      ));
      setUnreadCounts((current) => ({ ...current, [conversationId]: 0 }));
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to update read state.");
    }
  };

  const removeConversation = async (conversationId: string) => {
    if (!currentUserId) return;

    Alert.alert("Remove conversation", "Remove this conversation from your support list? New messages will make it visible again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            // Fetch current conversation
            const { data: conv, error: fetchError } = await supabase
              .from("conversations")
              .select("hiddenFor")
              .eq("id", conversationId)
              .single();
              
            if (fetchError) throw fetchError;
            
            const currentHiddenFor = conv?.hiddenFor || [];
            if (!currentHiddenFor.includes(currentUserId)) {
              const { error: hideError } = await supabase
                .from("conversations")
                .update({ hiddenFor: [...currentHiddenFor, currentUserId] })
                .eq("id", conversationId);
              if (hideError) throw hideError;
            }

            setConversations((prev) =>
              prev.filter((conversation) => conversation.id !== conversationId)
            );

          } catch (error: any) {
            Alert.alert("Error", error?.message || "Failed to remove conversation.");
          }
        },
      },
    ]);
  };

  if (loading && !refreshing) {
    return <LoadingBird fullScreen />;
  }

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const otherUserId = item.participants.find(
            (participantId) => participantId !== currentUserId
          );
          if (!otherUserId) return null;

          const otherUser = userInfoMap[otherUserId];
          const displayName =
            otherUser?.fullName || otherUser?.email || `User ${otherUserId.slice(0, 6)}`;
          const isUnread = (unreadCounts[item.id] || 0) > 0;
          const subtitlePrefix = item.lastMessage?.senderId === currentUserId ? "You: " : "";

          return (
            <Card style={[styles.card, isUnread && styles.unreadCard]} mode="outlined">
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("Chat", {
                    conversationId: item.id,
                    otherUserId,
                  })
                }
                activeOpacity={0.7}
              >
                <Card.Title
                  title={displayName}
                  subtitle={`${subtitlePrefix}${item.lastMessage?.text || "No messages yet"}`}
                  left={(props) =>
                    otherUser?.photoURL ? (
                      <Avatar.Image {...props} source={{ uri: otherUser.photoURL }} />
                    ) : (
                      <Avatar.Image
                        {...props}
                        source={getDefaultProfileImage(otherUser?.gender)}
                      />
                    )
                  }
                  right={(props) =>
                    item.lastMessage?.timestamp ? (
                      <Text {...props} style={styles.time}>
                        {new Date(item.lastMessage.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </Text>
                    ) : null
                  }
                />
              </TouchableOpacity>

              <View style={styles.profileActionRow}>
                <TouchableOpacity onPress={() => navigation.navigate("AdminUserDetail", { userId: otherUserId })}>
                  <Text style={styles.viewProfileText}>View Profile</Text>
                </TouchableOpacity>
              </View>

              <Card.Actions style={styles.actions}>
                <IconButton
                  icon="check-circle-outline"
                  size={20}
                  iconColor={isUnread ? "rgba(211,47,47,0.45)" : "#2e7d32"}
                  onPress={() => setConversationReadState(item.id, true)}
                />
                <Text
                  style={[
                    styles.actionLabel,
                    { color: isUnread ? "rgba(211,47,47,0.45)" : "#2e7d32" },
                  ]}
                >
                  Read
                </Text>

                <IconButton
                  icon="email-mark-as-unread"
                  size={20}
                  iconColor="#d32f2f"
                  onPress={() => setConversationReadState(item.id, false)}
                />
                <Text style={[styles.actionLabel, { color: "#d32f2f" }]}>Unread</Text>

                <IconButton
                  icon="delete-outline"
                  size={20}
                  iconColor="#d32f2f"
                  onPress={() => removeConversation(item.id)}
                />
                <Text style={[styles.actionLabel, { color: "#d32f2f" }]}>Remove</Text>
              </Card.Actions>
            </Card>
          );
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No support conversations yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 20,
  },
  containerDesktop: {
    maxWidth: 800,
    alignSelf: "center",
    width: "100%",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  card: { marginBottom: 10 },
  unreadCard: {
    borderWidth: 1,
    borderColor: "#d8e0e8",
    backgroundColor: "#f5f8fb",
  },
  time: {
    fontSize: 12,
    color: "#888",
    alignSelf: "center",
    marginRight: 10,
  },
  actions: {
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 2,
    paddingLeft: 8,
    paddingBottom: 8,
  },
  profileActionRow: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 4,
  },
  viewProfileText: {
    color: "#b91c1c",
    fontWeight: "700",
    fontSize: 13,
  },
  actionLabel: {
    fontSize: 12,
    color: "#555",
    marginRight: 8,
  },
  empty: {
    textAlign: "center",
    marginTop: 50,
    fontSize: 16,
    color: "#666",
  },
});
