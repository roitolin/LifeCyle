import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  View,
  SectionList,
  Alert,
  ActivityIndicator,
  Modal,
  StyleSheet,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../context/AuthContext";
import { useResponsive } from "../../utils/responsive";
import {
  deleteNotificationsByIds,
  fetchNotificationsForUser,
  markNotificationRead,
  markNotificationsRead,
  markNotificationsUnread,
  isChatNotificationType,
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
  "funeral_refund_requested",
  "funeral_refund_updated",
  "death_certificate_requested",
  "death_certificate_ready",
];

const isChatNotification = (type: string) =>
  isChatNotificationType(type);

type NotificationFilter = "all" | "requests" | "payments" | "updates";

const getNotificationCategory = (type: string): Exclude<NotificationFilter, "all"> => {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("payment") || normalized.includes("refund")) return "payments";
  if (normalized.includes("request") || normalized.includes("booking") || normalized.includes("order")) return "requests";
  return "updates";
};

const getNotificationVisual = (type: string) => {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("payment_rejected") || normalized.includes("refund")) {
    return { icon: "return-down-back-outline" as const, color: "#9a5148", background: "#fbefed" };
  }
  if (normalized.includes("payment")) {
    return { icon: "wallet-outline" as const, color: "#85632e", background: "#f8f1e5" };
  }
  if (normalized.includes("completed") || normalized.includes("verified")) {
    return { icon: "checkmark-done-outline" as const, color: "#2f6b55", background: "#eaf4ef" };
  }
  if (normalized.includes("request") || normalized.includes("booking") || normalized.includes("order")) {
    return { icon: "document-text-outline" as const, color: "#5d5b82", background: "#f0eff7" };
  }
  if (normalized.includes("chat") || normalized.includes("message") || normalized.includes("support")) {
    return { icon: "chatbubble-ellipses-outline" as const, color: "#3f6d84", background: "#eaf2f6" };
  }
  if (normalized.includes("product")) {
    return { icon: "cube-outline" as const, color: "#765b3d", background: "#f6efe6" };
  }
  if (normalized.includes("shop_approved")) {
    return { icon: "shield-checkmark-outline" as const, color: "#2f6b55", background: "#eaf4ef" };
  }
  if (normalized.includes("shop_rejected")) {
    return { icon: "close-circle-outline" as const, color: "#9a5148", background: "#fbefed" };
  }
  if (normalized.includes("announcement")) {
    return { icon: "megaphone-outline" as const, color: "#7b5c31", background: "#f8f0df" };
  }
  if (normalized.includes("schedule") || normalized.includes("reminder")) {
    return { icon: "calendar-outline" as const, color: "#2f6b55", background: "#eaf4ef" };
  }
  return { icon: "notifications-outline" as const, color: "#52635d", background: "#eef1ef" };
};

const notificationDate = (timestamp: any) => {
  if (!timestamp) return null;
  const date = typeof timestamp?.toDate === "function" ? timestamp.toDate() : new Date(String(timestamp));
  return Number.isNaN(date.getTime()) ? null : date;
};

const isDateToday = (date: Date | null) => {
  if (!date) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
};

export default function NotificationsScreen({ navigation, route }: any) {
  const [allNotifications, setAllNotifications] = useState<Notification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<NotificationFilter>("all");
  const [manageVisible, setManageVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionBusy, setSelectionBusy] = useState(false);
  const { role, user } = useAuth();
  const currentUserId = user?.id;
  const { isDesktop } = useResponsive();
  const insets = useSafeAreaInsets();
  const notifications = useMemo(
    () => filterNotificationsByPreferences(
      allNotifications.filter((item) => !isChatNotification(item.type)),
      preferences
    ),
    [allNotifications, preferences]
  );
  const unreadCount = notifications.filter((n) => !n.read).length;
  const filteredNotifications = useMemo(
    () => selectedFilter === "all"
      ? notifications
      : notifications.filter((item) => getNotificationCategory(item.type) === selectedFilter),
    [notifications, selectedFilter]
  );
  const notificationSections = useMemo(() => {
    const today: Notification[] = [];
    const earlier: Notification[] = [];
    filteredNotifications.forEach((item) => {
      (isDateToday(notificationDate(item.createdAt)) ? today : earlier).push(item);
    });
    return [
      { title: "Today", data: today },
      { title: "Earlier", data: earlier },
    ].filter((section) => section.data.length > 0);
  }, [filteredNotifications]);
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

    if (notification.type === 'shop_payment_account_registered') {
      navigation.navigate('AdminTabs', { screen: 'Payments' });
      return;
    }

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

    if (notification.type === 'account_deletion_requested') {
      navigation.navigate('AdminTabs', { screen: 'Deletions' });
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
    navigation.navigate("NotificationServiceRequestDetails", {
      request: requestData,
      requesterView,
      origin: "Notifications",
    });
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

    if (notification.type === 'announcement_new') {
      navigation.navigate('Announcements', {
        announcementId: data.announcementId,
      });
      return;
    }

    if (notification.type === 'account_deletion_updated') {
      navigation.navigate('FuneralTabs', {
        screen: 'Profile',
        params: { screen: 'PrivacyData' },
      });
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

  const openedFromPushRef = useRef<string | null>(null);
  const openNotificationRef = useRef(openNotification);
  openNotificationRef.current = openNotification;
  useEffect(() => {
    const notificationId = String(route?.params?.openNotificationId || '').trim();
    if (
      loading ||
      !notificationId ||
      openedFromPushRef.current === notificationId
    ) {
      return;
    }

    const notification = allNotifications.find((item) => item.id === notificationId);
    if (!notification) return;

    openedFromPushRef.current = notificationId;
    void openNotificationRef.current(notification);
  }, [allNotifications, loading, route?.params?.openNotificationId]);

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

  const leaveSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const startSelectionMode = (notificationId?: string) => {
    setManageVisible(false);
    setSelectionMode(true);
    setSelectedIds(notificationId ? new Set([notificationId]) : new Set());
  };

  const toggleSelectedNotification = (notificationId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(notificationId)) next.delete(notificationId);
      else next.add(notificationId);
      return next;
    });
  };

  const selectAllVisibleNotifications = () => {
    const visibleIds = filteredNotifications.map((item) => item.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleIds.forEach((id) => {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const updateSelectedReadState = async (read: boolean) => {
    const ids = Array.from(selectedIds);
    if (!ids.length || selectionBusy) return;
    setSelectionBusy(true);
    try {
      if (read) await markNotificationsRead(ids);
      else await markNotificationsUnread(ids);
      const selectedIdSet = new Set(ids);
      setAllNotifications((current) =>
        current.map((item) => selectedIdSet.has(item.id) ? { ...item, read } : item)
      );
      leaveSelectionMode();
    } catch (error: any) {
      Alert.alert("Notifications not updated", error?.message || "Please try again.");
    } finally {
      setSelectionBusy(false);
    }
  };

  const deleteSelectedNotifications = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || selectionBusy) return;
    setSelectionBusy(true);
    try {
      await deleteNotificationsByIds(ids);
      const selectedIdSet = new Set(ids);
      setAllNotifications((current) => current.filter((item) => !selectedIdSet.has(item.id)));
      leaveSelectionMode();
    } catch (error: any) {
      Alert.alert("Notifications not deleted", error?.message || "Please try again.");
    } finally {
      setSelectionBusy(false);
    }
  };

  const confirmDeleteSelected = () => {
    if (!selectedIds.size) return;
    Alert.alert(
      "Delete selected notifications?",
      selectedIds.size + (selectedIds.size === 1 ? " notification will" : " notifications will") + " be permanently removed.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void deleteSelectedNotifications() },
      ]
    );
  };

  const confirmDeleteRead = () => {
    const readCount = notifications.filter((item) => item.read).length;
    if (!readCount) return;
    Alert.alert(
      "Delete all read notifications?",
      readCount + (readCount === 1 ? " read notification will" : " read notifications will") + " be permanently removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setManageVisible(false);
            void deleteRead();
          },
        },
      ]
    );
  };

  const formatNotificationTime = (timestamp: any) => {
    const date = notificationDate(timestamp);
    if (!date) return "";
    if (isDateToday(date)) {
      return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
  };

  const renderItem = ({ item }: { item: Notification }) => {
    const visual = getNotificationVisual(item.type);
    const selected = selectedIds.has(item.id);
    return (
      <TouchableOpacity
        style={[
          styles.notificationRow,
          !item.read ? styles.notificationRowUnread : null,
          selected ? styles.notificationRowSelected : null,
        ]}
        onPress={() => selectionMode ? toggleSelectedNotification(item.id) : void openNotification(item)}
        onLongPress={() => startSelectionMode(item.id)}
        delayLongPress={450}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel={(item.read ? "" : "Unread. ") + item.title + ". " + item.body}
        accessibilityState={{ selected }}
        accessibilityHint={selectionMode ? "Selects or deselects this notification." : "Opens this update. Press and hold to select it."}
      >
        <View style={[styles.notificationIcon, { backgroundColor: visual.background }]}>
          <Ionicons name={visual.icon} size={20} color={visual.color} />
        </View>
        <View style={styles.notificationCopy}>
          <View style={styles.notificationTitleRow}>
            {!item.read ? <View style={styles.unreadIndicator} /> : null}
            <Text style={[styles.notificationTitle, !item.read ? styles.notificationTitleUnread : null]} numberOfLines={2}>
              {item.title}
            </Text>
            <View style={styles.notificationMeta}>
              <Text style={styles.notificationTime}>{formatNotificationTime(item.createdAt)}</Text>
            </View>
          </View>
          <Text style={styles.notificationBody} numberOfLines={3}>{item.body}</Text>
        </View>
        {selectionMode ? (
          <View style={[styles.selectionCheck, selected ? styles.selectionCheckSelected : null]}>
            {selected ? <Ionicons name="checkmark" size={15} color="#ffffff" /> : null}
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  if (loading && !refreshing) {
    return <LoadingBird fullScreen />;
  }

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <SectionList
        sections={notificationSections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.listContent, selectionMode ? styles.listContentSelecting : null]}
        ListHeaderComponent={
          <View>
            {selectionMode ? (
              <View style={styles.selectionHeader}>
                <TouchableOpacity style={styles.selectionClose} onPress={leaveSelectionMode} accessibilityLabel="Cancel selection">
                  <Ionicons name="close" size={20} color="#4f5f59" />
                </TouchableOpacity>
                <View style={styles.selectionHeaderCopy}>
                  <Text style={styles.selectionHeaderTitle}>{selectedIds.size} selected</Text>
                  <Text style={styles.selectionHeaderSubtitle}>Choose notifications, then use an action below.</Text>
                </View>
                <TouchableOpacity style={styles.selectAllButton} onPress={selectAllVisibleNotifications}>
                  <Text style={styles.selectAllButtonText}>
                    {filteredNotifications.length > 0 && filteredNotifications.every((item) => selectedIds.has(item.id)) ? "Clear" : "Select all"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.inboxSummary}>
                <View style={styles.summaryIcon}>
                  <Ionicons name="storefront-outline" size={21} color="#2f6b55" />
                </View>
                <View style={styles.summaryCopy}>
                  <Text style={styles.summaryTitle}>
                    {unreadCount > 0
                      ? unreadCount + (unreadCount === 1 ? " new update" : " new updates")
                      : "You're all caught up"}
                  </Text>
                  <Text style={styles.summarySubtitle}>
                    {isAdminRole
                      ? "Orders and platform activity"
                      : "Service requests, payments, and shop activity"}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.manageButton}
                  onPress={() => setManageVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Manage notifications"
                >
                  <Ionicons name="options-outline" size={20} color="#53635d" />
                </TouchableOpacity>
              </View>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {([
                { key: "all", label: "All" },
                { key: "requests", label: "Requests" },
                { key: "payments", label: "Payments" },
                { key: "updates", label: isAdminRole ? "System" : "Shop updates" },
              ] as { key: NotificationFilter; label: string }[]).map((entry) => {
                const active = selectedFilter === entry.key;
                return (
                  <TouchableOpacity
                    key={entry.key}
                    style={[styles.filterChip, active ? styles.filterChipActive : null]}
                    onPress={() => setSelectedFilter(entry.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>{entry.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        }
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
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="notifications-off-outline" size={25} color="#77847f" />
            </View>
            <Text style={styles.emptyTitle}>No notifications here</Text>
            <Text style={styles.emptyText}>
              {selectedFilter === "all"
                ? "New service and shop updates will appear here."
                : "There are no notifications in this category."}
            </Text>
          </View>
        }
        ListFooterComponent={notifications.length && !selectionMode ? <Text style={styles.holdHint}>Press and hold a notification to select multiple.</Text> : null}
      />

      {selectionMode ? (
        <View style={[styles.selectionActionBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {selectionBusy ? (
            <ActivityIndicator size="small" color="#2f6b55" />
          ) : (
            <>
              <TouchableOpacity
                style={[styles.selectionAction, !selectedIds.size ? styles.selectionActionDisabled : null]}
                onPress={() => void updateSelectedReadState(true)}
                disabled={!selectedIds.size}
              >
                <Ionicons name="mail-open-outline" size={19} color={selectedIds.size ? "#2f6b55" : "#a4aca8"} />
                <Text style={[styles.selectionActionText, !selectedIds.size ? styles.selectionActionTextDisabled : null]}>Read</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.selectionAction, !selectedIds.size ? styles.selectionActionDisabled : null]}
                onPress={() => void updateSelectedReadState(false)}
                disabled={!selectedIds.size}
              >
                <Ionicons name="mail-unread-outline" size={19} color={selectedIds.size ? "#6a5278" : "#a4aca8"} />
                <Text style={[styles.selectionActionText, !selectedIds.size ? styles.selectionActionTextDisabled : null]}>Unread</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.selectionAction, styles.selectionDeleteAction, !selectedIds.size ? styles.selectionActionDisabled : null]}
                onPress={confirmDeleteSelected}
                disabled={!selectedIds.size}
              >
                <Ionicons name="trash-outline" size={19} color={selectedIds.size ? "#9a5148" : "#a4aca8"} />
                <Text style={[styles.selectionDeleteText, !selectedIds.size ? styles.selectionActionTextDisabled : null]}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : null}

      <Modal visible={manageVisible} transparent animationType="fade" onRequestClose={() => setManageVisible(false)}>
        <TouchableOpacity style={styles.manageOverlay} activeOpacity={1} onPress={() => setManageVisible(false)}>
          <TouchableOpacity style={[styles.manageSheet, { paddingBottom: Math.max(insets.bottom, 24) }]} activeOpacity={1}>
            <View style={styles.manageHeader}>
              <View style={styles.manageHeaderIcon}>
                <Ionicons name="options-outline" size={22} color="#2f6b55" />
              </View>
              <View style={styles.manageHeaderCopy}>
                <Text style={styles.manageTitle}>Manage notifications</Text>
                <Text style={styles.manageSubtitle}>Organize service and shop updates.</Text>
              </View>
              <TouchableOpacity style={styles.manageClose} onPress={() => setManageVisible(false)} accessibilityLabel="Close manage notifications">
                <Ionicons name="close" size={20} color="#57655f" />
              </TouchableOpacity>
            </View>

            <View style={styles.manageStats}>
              <View style={styles.manageStat}>
                <Text style={styles.manageStatValue}>{unreadCount}</Text>
                <Text style={styles.manageStatLabel}>Unread</Text>
              </View>
              <View style={styles.manageStatDivider} />
              <View style={styles.manageStat}>
                <Text style={styles.manageStatValue}>{notifications.length - unreadCount}</Text>
                <Text style={styles.manageStatLabel}>Read</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.manageOption, !notifications.length ? styles.manageOptionDisabled : null]}
              onPress={() => startSelectionMode()}
              disabled={!notifications.length}
            >
              <View style={[styles.manageOptionIcon, { backgroundColor: "#eaf3ee" }]}>
                <Ionicons name="checkbox-outline" size={21} color="#2f6b55" />
              </View>
              <View style={styles.manageOptionCopy}>
                <Text style={styles.manageOptionTitle}>Select notifications</Text>
                <Text style={styles.manageOptionText}>Choose multiple items to mark read, unread, or delete.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#8b9591" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.manageOption, !unreadCount ? styles.manageOptionDisabled : null]}
              onPress={() => { setManageVisible(false); void markAllAsRead(); }}
              disabled={!unreadCount}
            >
              <View style={[styles.manageOptionIcon, { backgroundColor: "#f0eff7" }]}>
                <Ionicons name="checkmark-done-outline" size={21} color="#635f86" />
              </View>
              <View style={styles.manageOptionCopy}>
                <Text style={styles.manageOptionTitle}>Mark all as read</Text>
                <Text style={styles.manageOptionText}>{unreadCount ? "Clear every NEW indicator." : "Everything is already read."}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.manageOption, styles.manageDangerOption, notifications.length === unreadCount ? styles.manageOptionDisabled : null]}
              onPress={confirmDeleteRead}
              disabled={notifications.length === unreadCount}
            >
              <View style={[styles.manageOptionIcon, { backgroundColor: "#fbefed" }]}>
                <Ionicons name="trash-outline" size={21} color="#9a5148" />
              </View>
              <View style={styles.manageOptionCopy}>
                <Text style={styles.manageDangerTitle}>Delete all read</Text>
                <Text style={styles.manageOptionText}>Keep unread updates and remove only opened ones.</Text>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fbfaf7",
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  listContentSelecting: { paddingBottom: 18 },
  inboxSummary: {
    minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11,
    borderBottomWidth: 1, borderBottomColor: "#e8e9e5", paddingVertical: 13,
  },
  summaryIcon: {
    width: 42, height: 42, borderRadius: 15, backgroundColor: "#eaf3ee",
    alignItems: "center", justifyContent: "center",
  },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: "#263731", fontSize: 14, fontWeight: "900" },
  summarySubtitle: { color: "#77827e", fontSize: 10, lineHeight: 15, marginTop: 3 },
  manageButton: {
    width: 40, height: 40, borderRadius: 14, borderWidth: 1, borderColor: "#dde1de",
    backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center",
  },
  selectionHeader: {
    minHeight: 72, flexDirection: "row", alignItems: "center", gap: 10,
    borderBottomWidth: 1, borderBottomColor: "#e0e5e2", paddingVertical: 12,
  },
  selectionClose: {
    width: 40, height: 40, borderRadius: 14, backgroundColor: "#eef1ef",
    alignItems: "center", justifyContent: "center",
  },
  selectionHeaderCopy: { flex: 1 },
  selectionHeaderTitle: { color: "#253630", fontSize: 14, fontWeight: "900" },
  selectionHeaderSubtitle: { color: "#7a8580", fontSize: 9, lineHeight: 14, marginTop: 2 },
  selectAllButton: {
    minHeight: 36, borderRadius: 12, borderWidth: 1, borderColor: "#cfdad5",
    backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", paddingHorizontal: 11,
  },
  selectAllButtonText: { color: "#35634f", fontSize: 9, fontWeight: "900" },
  filterRow: { gap: 8, paddingVertical: 13, paddingRight: 8 },
  filterChip: {
    minHeight: 36, borderRadius: 11, borderWidth: 1, borderColor: "#dfe2df",
    backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", paddingHorizontal: 13,
  },
  filterChipActive: { borderColor: "#29483e", backgroundColor: "#29483e" },
  filterChipText: { color: "#586660", fontSize: 10, fontWeight: "800" },
  filterChipTextActive: { color: "#ffffff" },
  sectionTitle: {
    color: "#374842", fontSize: 11, fontWeight: "900", paddingTop: 9, paddingBottom: 6,
  },
  notificationRow: {
    minHeight: 88, flexDirection: "row", alignItems: "flex-start", gap: 11,
    borderBottomWidth: 1, borderBottomColor: "#e9ebe8", backgroundColor: "#fbfaf7",
    paddingVertical: 12, paddingHorizontal: 3,
  },
  notificationRowUnread: {
    backgroundColor: "#f6f8f6",
  },
  notificationRowSelected: { borderRadius: 14, borderBottomColor: "#b8d1c5", backgroundColor: "#e8f2ed" },
  notificationIcon: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
  },
  notificationCopy: { flex: 1 },
  notificationTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  unreadIndicator: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#2f6b55", marginTop: 5 },
  notificationTitle: { flex: 1, color: "#46524e", fontSize: 12, lineHeight: 17, fontWeight: "600" },
  notificationTitleUnread: { color: "#22312c", fontWeight: "800" },
  notificationMeta: { alignItems: "flex-end" },
  notificationTime: { color: "#909995", fontSize: 9, fontWeight: "700", paddingTop: 1 },
  notificationBody: { color: "#68746f", fontSize: 10, lineHeight: 15, marginTop: 3 },
  selectionCheck: {
    width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: "#b9c2be",
    backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", marginTop: 10,
  },
  selectionCheckSelected: { borderColor: "#2f6b55", backgroundColor: "#2f6b55" },
  emptyState: { alignItems: "center", justifyContent: "center", paddingHorizontal: 20, paddingVertical: 54 },
  emptyIcon: {
    width: 54, height: 54, borderRadius: 19, backgroundColor: "#eef1ef", alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { color: "#35453f", fontSize: 14, fontWeight: "900", marginTop: 12 },
  emptyText: { color: "#7a8580", fontSize: 10, lineHeight: 15, textAlign: "center", marginTop: 5 },
  holdHint: { color: "#929a96", fontSize: 9, textAlign: "center", paddingTop: 18 },
  selectionActionBar: {
    minHeight: 72, flexDirection: "row", alignItems: "center", justifyContent: "space-around", gap: 8,
    borderTopWidth: 1, borderTopColor: "#dce2de", backgroundColor: "#ffffff",
    paddingHorizontal: 14, paddingTop: 9, paddingBottom: 13,
  },
  selectionAction: {
    flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: "#f1f5f2",
    alignItems: "center", justifyContent: "center", gap: 3,
  },
  selectionDeleteAction: { backgroundColor: "#fbefed" },
  selectionActionDisabled: { backgroundColor: "#f3f4f3" },
  selectionActionText: { color: "#405a50", fontSize: 9, fontWeight: "900" },
  selectionDeleteText: { color: "#934d45", fontSize: 9, fontWeight: "900" },
  selectionActionTextDisabled: { color: "#a4aca8" },
  manageOverlay: {
    flex: 1, backgroundColor: "rgba(18, 23, 21, 0.58)", justifyContent: "flex-end", paddingTop: 40,
  },
  manageSheet: {
    width: "100%", maxWidth: 560, maxHeight: "90%", alignSelf: "center",
    borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: "#d9dedb",
    backgroundColor: "#fbfaf7", padding: 18, paddingBottom: 26,
  },
  manageHeader: {
    flexDirection: "row", alignItems: "center", gap: 11,
    borderBottomWidth: 1, borderBottomColor: "#e1e5e2", paddingBottom: 14,
  },
  manageHeaderIcon: {
    width: 42, height: 42, borderRadius: 15, backgroundColor: "#e7f1ec", alignItems: "center", justifyContent: "center",
  },
  manageHeaderCopy: { flex: 1 },
  manageTitle: { color: "#24352f", fontSize: 18, fontWeight: "900" },
  manageSubtitle: { color: "#79847f", fontSize: 10, marginTop: 3 },
  manageClose: {
    width: 38, height: 38, borderRadius: 13, backgroundColor: "#eceeeb", alignItems: "center", justifyContent: "center",
  },
  manageStats: {
    minHeight: 66, borderRadius: 17, backgroundColor: "#edf3ef", flexDirection: "row",
    alignItems: "center", marginTop: 14, paddingVertical: 9,
  },
  manageStat: { flex: 1, alignItems: "center" },
  manageStatValue: { color: "#2a463c", fontSize: 18, fontWeight: "900" },
  manageStatLabel: { color: "#71807a", fontSize: 9, fontWeight: "800", marginTop: 2 },
  manageStatDivider: { width: 1, height: 32, backgroundColor: "#cfd9d4" },
  manageOption: {
    minHeight: 72, borderRadius: 17, borderWidth: 1, borderColor: "#e0e4e1", backgroundColor: "#ffffff",
    flexDirection: "row", alignItems: "center", gap: 11, padding: 11, marginTop: 10,
  },
  manageDangerOption: { borderColor: "#efd9d5" },
  manageOptionDisabled: { opacity: 0.48 },
  manageOptionIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  manageOptionCopy: { flex: 1 },
  manageOptionTitle: { color: "#33443e", fontSize: 12, fontWeight: "900" },
  manageDangerTitle: { color: "#8d4a43", fontSize: 12, fontWeight: "900" },
  manageOptionText: { color: "#7a8580", fontSize: 9, lineHeight: 14, marginTop: 3 },
  containerDesktop: {
    maxWidth: 760,
    width: "100%",
    alignSelf: "center",
  },
});
