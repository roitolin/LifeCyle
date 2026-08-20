import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  View,
  FlatList,
  Alert,
  StyleSheet,
  RefreshControl,
} from "react-native";
import {
  Card,
  Text,
  IconButton,
  Button,
  Badge,
} from "react-native-paper";
import { useAuth } from "../../context/AuthContext";
import { useResponsive } from "../../utils/responsive";
import {
  deleteNotificationById,
  deleteNotificationsByIds,
  fetchNotificationsForUser,
  markNotificationRead,
  markNotificationsRead,
} from "../../utils/supabaseNotifications";
import { CommonActions } from "@react-navigation/native";
import { supabase } from "../../services/supabaseClient";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  filterNotificationsByPreferences,
  getNotificationPreferences,
  subscribeNotificationPreferences,
  type NotificationPreferences,
} from "../../utils/notificationPreferences";

type Notification = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: {
    requestId?: string;
    conversationId?: string;
    otherUserId?: string;
    userId?: string;
    [key: string]: any;
  } | null;
  read: boolean;
  createdAt: any;
};

const REQUEST_NOTIFICATION_TYPES = [
  "funeral_request_pending",
  "funeral_payment_submitted",
  "funeral_payment_ready",
  "funeral_request_updated",
  "funeral_payment_verified",
  "funeral_payment_rejected",
  "funeral_request_completed",
];

const CHAT_NOTIFICATION_TYPES = new Set([
  "support_message",
  "chat_message",
]);

const isChatNotification = (type: string) =>
  CHAT_NOTIFICATION_TYPES.has(type);

export default function NotificationsScreen({ navigation, route }: any) {
  const [allNotifications, setAllNotifications] = useState<Notification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { role, user } = useAuth();
  const currentUserId = user?.id;
  const { isDesktop } = useResponsive();
  const notifications = useMemo(
    () => filterNotificationsByPreferences(allNotifications, preferences),
    [allNotifications, preferences]
  );
  const unreadCount = notifications.filter((n) => !n.read).length;
  const lastRefreshTokenRef = useRef<number | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!currentUserId) return;
    setLoading(true);
    try {
      const list = await fetchNotificationsForUser(currentUserId);
      setAllNotifications(list);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load notifications.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    let active = true;
    let preferenceVersion = 0;
    if (!currentUserId) {
      setPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES });
      return undefined;
    }

    const unsubscribe = subscribeNotificationPreferences(
      currentUserId,
      (next) => {
        preferenceVersion += 1;
        if (active) setPreferences(next);
      }
    );

    void getNotificationPreferences(currentUserId).then((stored) => {
      if (active && preferenceVersion === 0) setPreferences(stored);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentUserId]);

  useEffect(() => {
    const refreshToken = route?.params?.refreshToken;
    if (!refreshToken || refreshToken === lastRefreshTokenRef.current) return;
    lastRefreshTokenRef.current = refreshToken;
    setRefreshing(true);
    void fetchNotifications();
  }, [fetchNotifications, route?.params?.refreshToken]);

  const markAsRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      setAllNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      Alert.alert("Error", "Failed to mark as read.");
    }
  };

  const navigateAdminNotification = (notification: Notification) => {
    const data = notification.data || {};

    if (isChatNotification(notification.type)) {
      if (data.conversationId && data.otherUserId) {
        navigation.navigate("Chat", {
          conversationId: data.conversationId,
          otherUserId: data.otherUserId,
        });
        return;
      }
      navigation.navigate("AdminTabs", { screen: "Support" });
      return;
    }

    if (
      notification.type === "request_pending" ||
      notification.type === "request_accepted" ||
      notification.type === "request_completed" ||
      notification.type === "funeral_request_pending" ||
      notification.type === "funeral_payment_submitted"
    ) {
      navigation.navigate("AdminTabs", { screen: "Orders" });
      return;
    }

    if (notification.type === "abuse_report") {
      navigation.navigate("AdminTabs", {
        screen: "Moderation",
      });
      return;
    }

    if (
      notification.type === "feedback_new" ||
      notification.type === "rating_update"
    ) {
      navigation.navigate("AdminTabs", { screen: "Feedback" });
      return;
    }

    if (notification.type === "signup") {
      navigation.navigate("AdminTabs", { screen: "Users" });
      return;
    }

    if (notification.type === "announcement_new") {
      navigation.navigate("AdminTabs");
      return;
    }

    navigation.navigate("AdminTabs");
  };

  const goToProfileList = (
    screenName: "MyServiceRequests" | "ServiceRequestsInbox"
  ) => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{
          name: "FuneralTabs",
          state: {
            routes: [
              { name: "Home" },
              { name: "Shops" },
              { name: "Carts" },
              {
                name: "Profile",
                state: {
                  routes: [{ name: "ProfileMain" }, { name: screenName }],
                  index: 1,
                },
              },
            ],
            index: 3,
          },
        }],
      })
    );
  };

  const openRequestDetail = (requestData: any, requesterView: boolean) => {
    const listScreen = requesterView
      ? "MyServiceRequests"
      : "ServiceRequestsInbox";
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{
          name: "FuneralTabs",
          state: {
            routes: [
              { name: "Home" },
              { name: "Shops" },
              { name: "Carts" },
              {
                name: "Profile",
                state: {
                  routes: [
                    { name: "ProfileMain" },
                    { name: listScreen },
                    {
                      name: "ServiceRequestDetails",
                      params: { request: requestData, requesterView },
                    },
                  ],
                  index: 2,
                },
              },
            ],
            index: 3,
          },
        }],
      })
    );
  };

  const openRequestNotification = async (notification: Notification) => {
    const data = notification.data || {};
    const requestId = data.requestId;
    if (!requestId) {
      goToProfileList("MyServiceRequests");
      return;
    }

    setLoading(true);
    try {
      const { data: requestData, error } = await supabase
        .from("funeral_service_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();

      if (error || !requestData) {
        goToProfileList("MyServiceRequests");
        return;
      }

      const isRequester =
        String(requestData.requesterId) === String(currentUserId);
      const isShopOwner = String(requestData.shopId) === String(currentUserId);

      if (isShopOwner && !isRequester) {
        openRequestDetail(requestData, false);
      } else {
        openRequestDetail(requestData, true);
      }
    } catch (err) {
      console.warn("Failed to fetch request for notification:", err);
      goToProfileList("MyServiceRequests");
    } finally {
      setLoading(false);
    }
  };

  const openProductNotification = async (data: any) => {
    if (!data.productId) {
      navigation.navigate("ShopProducts", {
        shopId: data.shopId,
        shopName: data.shopName || "Funeral Shop",
      });
      return;
    }

    try {
      const { data: productRow, error } = await supabase
        .from("funeral_products")
        .select(`
          *,
          funeral_product_variations ( name, imageUrl ),
          funeral_product_images ( imageUrl, displayOrder )
        `)
        .eq("id", data.productId)
        .maybeSingle();

      if (!error && productRow) {
        navigation.navigate("ProductView", {
          product: {
            id: String(productRow.id),
            name: String(productRow.name || "Untitled Product"),
            description: String(productRow.description || ""),
            price: String(productRow.price || 0),
            stock: Number(productRow.stock) || 0,
            imageUrl: productRow.imageUrl || null,
            galleryImageUrls: (productRow.funeral_product_images || [])
              .sort(
                (a: any, b: any) =>
                  (a.displayOrder || 0) - (b.displayOrder || 0)
              )
              .map((image: any) => image.imageUrl)
              .filter(Boolean),
            shopId: productRow.shopId,
            shopName: data.shopName || "Funeral Shop",
            hasVariations:
              Boolean(productRow.hasVariations) ||
              (productRow.funeral_product_variations || []).length > 0,
            variations: (productRow.funeral_product_variations || []).map(
              (variation: any) => ({
                name: String(variation.name || "Standard"),
                imageUrl: variation.imageUrl || null,
              })
            ),
          },
        });
        return;
      }
    } catch (err) {
      console.warn("Failed to fetch product for notification:", err);
    }

    navigation.navigate("ShopProducts", {
      shopId: data.shopId,
      shopName: data.shopName || "Funeral Shop",
    });
  };

  const navigateUserNotification = async (notification: Notification) => {
    const data = notification.data || {};

    if (REQUEST_NOTIFICATION_TYPES.includes(notification.type)) {
      await openRequestNotification(notification);
      return;
    }

    if (notification.type === "funeral_new_product") {
      await openProductNotification(data);
      return;
    }

    if (
      isChatNotification(notification.type) &&
      data.conversationId &&
      data.otherUserId
    ) {
      navigation.navigate("Chat", {
        conversationId: data.conversationId,
        otherUserId: data.otherUserId,
      });
      return;
    }

    if (
      notification.type === "funeral_shop_approved" ||
      notification.type === "funeral_shop_rejected"
    ) {
      navigation.navigate("FuneralTabs", { screen: "Profile" });
      return;
    }

    if (notification.type === "announcement_new") {
      navigation.navigate("FuneralTabs", { screen: "Home" });
      return;
    }

    navigation.navigate("FuneralTabs", { screen: "Home" });
  };

  const isAdminRole =
    role === "admin" || role === "super_admin" || role === "funeral_admin";

  const openNotification = async (notification: Notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }

    if (isAdminRole) {
      navigateAdminNotification(notification);
      return;
    }

    await navigateUserNotification(notification);
  };

  const deleteNotification = async (id: string) => {
    try {
      await deleteNotificationById(id);
      setAllNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (error: any) {
      console.error("deleteNotification error:", error);
      Alert.alert("Error", error?.message || "Failed to delete notification.");
    }
  };

  const markAllAsRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    try {
      await markNotificationsRead(unread.map((item: any) => item.id));
      const unreadIds = new Set(unread.map((item) => item.id));
      setAllNotifications((prev) =>
        prev.map((n) => (unreadIds.has(n.id) ? { ...n, read: true } : n))
      );
      Alert.alert("Success", "All notifications marked as read.");
    } catch {
      Alert.alert("Error", "Failed to mark all as read.");
    }
  };

  const deleteRead = async () => {
    const read = notifications.filter((n) => n.read);
    if (read.length === 0) return;
    try {
      await deleteNotificationsByIds(read.map((item: any) => item.id));
      setAllNotifications((prev) =>
        prev.filter((n) => !read.some((item) => item.id === n.id))
      );
      Alert.alert("Success", "Read notifications deleted.");
    } catch (error: any) {
      console.error("deleteRead error:", error);
      Alert.alert("Error", error?.message || "Failed to delete read notifications.");
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "";
    const date = typeof timestamp?.toDate === "function" ? timestamp.toDate() : new Date(String(timestamp));
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, { hour12: true });
  };

  const renderItem = ({ item }: { item: Notification }) => (
    <Card
      style={[styles.card, !item.read && styles.unreadCard]}
      onPress={() => openNotification(item)}
    >
      <Card.Content>
        <View style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
            <View style={styles.metaRow}>
              <Badge
                style={[
                  styles.statusBadge,
                  item.read ? styles.readBadge : styles.unreadBadge,
                ]}
              >
                {item.read ? "READ" : "UNREAD"}
              </Badge>
              <Text style={styles.time}>{formatDate(item.createdAt)}</Text>
            </View>
          </View>
          <View style={styles.actions}>
            {!item.read && (
              <IconButton
                icon="check"
                size={20}
                onPress={() => markAsRead(item.id)}
                iconColor="green"
              />
            )}
            <IconButton
              icon="delete"
              size={20}
              onPress={() => deleteNotification(item.id)}
              iconColor="red"
            />
          </View>
        </View>
      </Card.Content>
    </Card>
  );

  if (loading && !refreshing) {
    return <LoadingBird fullScreen />;
  }

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Notifications</Text>
        <Text style={styles.pageSubtitle}>Read updates from services, announcements, and support messages.</Text>
        <View style={styles.headerMetaRow}>
          <Badge style={styles.unreadCountBadge}>{unreadCount}</Badge>
          <Text style={styles.headerMetaText}>Unread notifications</Text>
        </View>
      </View>
      <View style={styles.header}>
        <Button mode="text" onPress={markAllAsRead}>
          Mark all as read
        </Button>
        <Button mode="text" onPress={deleteRead}>
          Delete read
        </Button>
      </View>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchNotifications();
            }}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No notifications for your enabled preferences</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  pageHeader: {
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 14,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#b91c1c",
  },
  pageSubtitle: {
    marginTop: 4,
    color: "#4b5563",
    fontSize: 14,
  },
  headerMetaRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  unreadCountBadge: {
    backgroundColor: "#d32f2f",
  },
  headerMetaText: {
    color: "#6b7280",
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
    marginBottom: 4,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eceff3",
  },
  unreadCard: {
    backgroundColor: "#fff9e6",
    borderLeftWidth: 4,
    borderLeftColor: "#d32f2f",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 4,
    color: "#111827",
  },
  body: {
    fontSize: 14,
    color: "#4b5563",
    marginBottom: 4,
    lineHeight: 20,
  },
  time: {
    fontSize: 12,
    color: "#999",
    marginLeft: 8,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  statusBadge: {
    alignSelf: "flex-start",
  },
  readBadge: {
    backgroundColor: "#2e7d32",
    color: "#fff",
  },
  unreadBadge: {
    backgroundColor: "#d32f2f",
    color: "#fff",
  },
  empty: {
    textAlign: "center",
    marginTop: 50,
    fontSize: 16,
    color: "#666",
  },
  containerDesktop: {
    maxWidth: 1000,
    width: "100%",
    alignSelf: "center",
  },
});
