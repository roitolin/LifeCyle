import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppHeaderBackButton } from "@/components";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  FlatList,
  Image,
  Keyboard,
  Linking,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type ImageSourcePropType,
} from "react-native";
import { Avatar, IconButton, Text } from "react-native-paper";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView, KeyboardEvents } from "react-native-keyboard-controller";
import { createAudioPlayer, preload, type AudioPlayer } from "expo-audio";
import * as Clipboard from "expo-clipboard";
import { captureScreen, releaseCapture } from "react-native-view-shot";
import { supabase } from "@/services/supabaseClient";
import { useAuth } from "../../context/AuthContext";
import { useAppDialog } from "../../hooks/useAppDialog";
import { ensureConversationForUsers, markChatMessagesSeen } from "../../utils/chatHelpers";
import { saveConversationPreference } from "../../utils/conversationPreferences";
import { getDefaultProfileImage } from "../../utils/defaultProfileImage";
import { blockUser, getBlockStateBetweenUsers, unblockUser } from "../../utils/userModeration";
import { consumeRateLimit, isRateLimitError } from "../../utils/rateLimiter";
import { sanitizeMultilinePlainText } from "../../utils/inputSecurity";
import { registerActiveChat } from "../../utils/notificationSound";
import { ensureAppAudioReady, playSoundFromStart } from "../../utils/soundPlayback";

const CHAT_SENT_SOUND = require("../../../sound/ChatSents.mp3");
const CHAT_RECEIVE_SOUND = require("../../../sound/ChatRecieves.mp3");
const chatSoundsReady = Promise.all([
  preload(CHAT_SENT_SOUND),
  preload(CHAT_RECEIVE_SOUND),
]).catch((error) => {
  console.warn("Unable to preload chat sounds:", error);
});

type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  timestamp?: string | null;
  readBy?: string[] | null;
  deliveredTo?: string[] | null;
  reactions?: Record<string, MessageReaction> | null;
  replyToId?: string | null;
  editedAt?: string | null;
  clientStatus?: "sending";
  showDate?: boolean;
};

type MessageReaction = "heart" | "like" | "dislike" | "laugh" | "emphasis" | "question";

type MessageActionAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ChatProfile = {
  name: string;
  shopName: string | null;
  photoUrl: string | null;
  gender: "male" | "female" | "other";
  role: string;
  phone: string | null;
  isShop: boolean;
};

const APP_LOGO = require("../../../assets/Icon/AppICONTransparents.png");
const MESSAGE_LIMIT = 200;
const ADMIN_ROLES = new Set(["admin", "super_admin", "funeral_admin"]);
const MESSAGE_COLUMNS = "id, conversationId, senderId, text, timestamp, readBy";
const MESSAGE_COLUMNS_WITH_DELIVERY = `${MESSAGE_COLUMNS}, deliveredTo`;
const MESSAGE_COLUMNS_WITH_ACTIONS = `${MESSAGE_COLUMNS_WITH_DELIVERY}, reactions, replyToId, editedAt`;
const MESSAGE_REACTIONS: { key: MessageReaction; emoji: string; label: string }[] = [
  { key: "heart", emoji: "\uD83D\uDC97", label: "Love" },
  { key: "laugh", emoji: "\uD83D\uDE06", label: "Haha" },
  { key: "question", emoji: "\uD83D\uDE2E", label: "Wow" },
  { key: "emphasis", emoji: "\uD83D\uDE22", label: "Sad" },
  { key: "dislike", emoji: "\uD83D\uDE21", label: "Angry" },
  { key: "like", emoji: "\uD83D\uDC4D", label: "Like" },
];

function isLegacyChatProfileSchemaError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42703" &&
    /column p\.photoURL does not exist/i.test(error.message || "")
  );
}

function isMissingDeliveryColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42703"
    || /deliveredTo/i.test(error.message || "");
}

function isMissingMessageActionsSchema(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42703"
    && /(?:reactions|replyToId|editedAt)/i.test(error.message || "");
}

function reactionsMatch(
  left?: Record<string, MessageReaction> | null,
  right?: Record<string, MessageReaction> | null
) {
  const leftEntries = Object.entries(left || {});
  const rightReactions = right || {};
  return leftEntries.length === Object.keys(rightReactions).length
    && leftEntries.every(([id, reaction]) => rightReactions[id] === reaction);
}

function getDateLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (messageDay.getTime() === today.getTime()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (messageDay.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function getTimeLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

function prepareMessages(items: ChatMessage[]) {
  const chronological = [...items]
    .sort((left, right) => new Date(left.timestamp || 0).getTime() - new Date(right.timestamp || 0).getTime())
    .slice(-MESSAGE_LIMIT);

  return chronological.map((message, index) => {
    const showDate = index === 0
      || getDateLabel(chronological[index - 1]?.timestamp) !== getDateLabel(message.timestamp);
    return message.showDate === showDate ? message : { ...message, showDate };
  });
}

function messagesMatch(left: ChatMessage, right: ChatMessage) {
  const leftReadBy = left.readBy || [];
  const rightReadBy = right.readBy || [];
  const leftDeliveredTo = left.deliveredTo || [];
  const rightDeliveredTo = right.deliveredTo || [];
  return left.id === right.id
    && left.conversationId === right.conversationId
    && left.senderId === right.senderId
    && left.text === right.text
    && left.timestamp === right.timestamp
    && left.replyToId === right.replyToId
    && left.editedAt === right.editedAt
    && reactionsMatch(left.reactions, right.reactions)
    && leftReadBy.length === rightReadBy.length
    && leftReadBy.every((id) => rightReadBy.includes(id))
    && leftDeliveredTo.length === rightDeliveredTo.length
    && leftDeliveredTo.every((id) => rightDeliveredTo.includes(id));
}

function mergeReceiptIds(
  left?: string[] | null,
  right?: string[] | null
) {
  return Array.from(new Set([...(left || []), ...(right || [])]));
}

type ChatMessageRowProps = {
  item: ChatMessage;
  mine: boolean;
  showDate: boolean;
  replyPreview: ChatMessage | null;
  replyContextLabel: string;
  deliveryLabel: "Sending" | "Sent" | "Delivered" | null;
  showSeenAvatar: boolean;
  avatarSource: ImageSourcePropType;
  onLongPress: (message: ChatMessage, anchor: MessageActionAnchor) => void;
};

const ChatMessageRow = memo(function ChatMessageRow({
  item,
  mine,
  showDate,
  replyPreview,
  replyContextLabel,
  deliveryLabel,
  showSeenAvatar,
  avatarSource,
  onLongPress,
}: ChatMessageRowProps) {
  const bubbleRef = useRef<View>(null);
  const reactionCounts = MESSAGE_REACTIONS.map((reaction) => ({
    ...reaction,
    count: Object.values(item.reactions || {}).filter((value) => value === reaction.key).length,
  })).filter((reaction) => reaction.count > 0);

  const handleLongPress = (event: GestureResponderEvent) => {
    const fallbackWidth = Math.min(280, Math.max(92, item.text.length * 7 + 28));
    const fallback: MessageActionAnchor = {
      x: mine ? Math.max(16, event.nativeEvent.pageX - fallbackWidth + 24) : Math.max(16, event.nativeEvent.pageX - 24),
      y: Math.max(16, event.nativeEvent.pageY - 24),
      width: fallbackWidth,
      height: 52,
    };
    if (!bubbleRef.current) {
      onLongPress(item, fallback);
      return;
    }
    bubbleRef.current.measureInWindow((x, y, width, height) => {
      onLongPress(item, width > 0 && height > 0 ? { x, y, width, height } : fallback);
    });
  };

  return (
    <View>
      {showDate ? (
        <View style={styles.dateRow}>
          <View style={styles.dateLine} />
          <Text style={styles.dateText}>{getDateLabel(item.timestamp)}</Text>
          <View style={styles.dateLine} />
        </View>
      ) : null}
      <View style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowOther]}>
        {!mine ? (
          <Avatar.Image
            size={28}
            style={styles.messageAvatar}
            source={avatarSource}
          />
        ) : null}
        <View style={[styles.messageCluster, mine ? styles.messageClusterMine : styles.messageClusterOther]}>
          {item.replyToId ? (
            <View style={[styles.replyContext, mine ? styles.replyContextMine : styles.replyContextOther]}>
              <View style={styles.replyContextHeader}>
                <Ionicons name="return-up-back" size={12} color="#78827e" />
                <Text numberOfLines={1} style={styles.replyContextLabel}>{replyContextLabel}</Text>
              </View>
              <View style={styles.replyQuote}>
                <Text
                  numberOfLines={3}
                  style={[styles.replyQuoteText, !replyPreview && styles.replyQuoteUnavailable]}
                >
                  {replyPreview?.text || "Message is no longer available"}
                </Text>
              </View>
            </View>
          ) : null}
          <Pressable
            ref={bubbleRef}
            accessibilityRole="button"
            accessibilityHint="Long press for message actions"
            delayLongPress={350}
            onLongPress={handleLongPress}
            style={({ pressed }) => [
              styles.bubble,
              mine ? styles.bubbleMine : styles.bubbleOther,
              pressed && styles.bubblePressed,
            ]}
          >
            <Text style={[styles.messageText, mine ? styles.messageTextMine : null]}>{item.text}</Text>
            <View style={styles.messageMeta}>
              {item.editedAt ? <Text style={[styles.editedText, mine ? styles.messageMetaMine : null]}>Edited</Text> : null}
              <Text style={[styles.timeText, mine ? styles.messageMetaMine : null]}>{getTimeLabel(item.timestamp)}</Text>
            </View>
          </Pressable>
        </View>
      </View>
      {reactionCounts.length > 0 ? (
        <View style={[styles.reactionSummary, mine ? styles.reactionSummaryMine : styles.reactionSummaryOther]}>
          {reactionCounts.map((reaction) => (
            <Text key={reaction.key} style={styles.reactionSummaryText}>
              {reaction.emoji}{reaction.count > 1 ? ` ${reaction.count}` : ""}
            </Text>
          ))}
        </View>
      ) : null}
      {mine && (deliveryLabel || showSeenAvatar) ? (
        <View style={styles.deliveryStatusRow}>
          {showSeenAvatar ? (
            <Avatar.Image
              accessibilityLabel="Seen"
              size={17}
              source={avatarSource}
              style={styles.seenAvatar}
            />
          ) : (
            <Text style={styles.deliveryStatusText}>{deliveryLabel}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
});

export default function ChatScreen({ route, navigation }: any) {
  const {
    conversationId: initialConversationId,
    otherUserId,
    otherUserName,
    requestId,
  } = route.params || {};
  const { role, user } = useAuth();
  const userId = user?.uid;
  const { dialog } = useAppDialog();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const isFocused = useIsFocused();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const isNearBottomRef = useRef(true);
  const shouldScrollToBottomRef = useRef(true);
  const loadGenerationRef = useRef(0);
  const conversationSessionRef = useRef(0);
  const sendingRef = useRef(false);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const composerFocusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusComposerOnMenuDismissRef = useRef(false);
  const nextScrollAnimatedRef = useRef(false);
  const keyboardTransitionRef = useRef(false);
  const pinDuringKeyboardRef = useRef(false);
  const deliveryReceiptsAvailableRef = useRef<boolean | null>(null);
  const messageActionsAvailableRef = useRef<boolean | null>(null);
  const composerInputRef = useRef<TextInput>(null);
  const messageBackdropUriRef = useRef<string | null>(null);
  const messageBackdropCaptureRef = useRef(0);
  const messageActionAnimationRef = useRef(new Animated.Value(0));
  const messageActionClosingRef = useRef(false);
  const messageActionAfterCloseRef = useRef<(() => void) | null>(null);
  const editPreviousDraftRef = useRef("");
  const sentSoundRef = useRef<AudioPlayer | null>(null);
  const receiveSoundRef = useRef<AudioPlayer | null>(null);

  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [conversationReady, setConversationReady] = useState(false);
  const [readyForUserId, setReadyForUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [messageActionBusy, setMessageActionBusy] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
  const [messageActionAnchor, setMessageActionAnchor] = useState<MessageActionAnchor | null>(null);
  const [messageBackdropUri, setMessageBackdropUri] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [safetyVisible, setSafetyVisible] = useState(false);
  const [blockState, setBlockState] = useState({ blockedByMe: false, blockedMe: false, blockedEitherWay: false });
  const [blockStateError, setBlockStateError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ChatProfile>({
    name: String(otherUserName || "User"),
    shopName: null,
    photoUrl: null,
    gender: "other",
    role: "user",
    phone: null,
    isShop: false,
  });

  const currentUserIsAdmin = ADMIN_ROLES.has(String(role || "").toLowerCase());
  const chatIsActive = isFocused && appState === "active";

  const cancelPendingScroll = useCallback(() => {
    if (pendingScrollFrameRef.current !== null) {
      cancelAnimationFrame(pendingScrollFrameRef.current);
      pendingScrollFrameRef.current = null;
    }
  }, []);

  const scrollToBottom = useCallback((animated = true) => {
    cancelPendingScroll();
    pendingScrollFrameRef.current = requestAnimationFrame(() => {
      // The chat list is inverted, so offset zero is always the latest
      // message. This is constant-time and does not require measuring rows.
      listRef.current?.scrollToOffset({ offset: 0, animated });
      shouldScrollToBottomRef.current = false;
      nextScrollAnimatedRef.current = false;
      pendingScrollFrameRef.current = null;
    });
  }, [cancelPendingScroll]);

  useEffect(() => () => {
    cancelPendingScroll();
    if (composerFocusTimeoutRef.current) clearTimeout(composerFocusTimeoutRef.current);
    messageActionAnimationRef.current.stopAnimation();
    messageActionAfterCloseRef.current = null;
    messageBackdropCaptureRef.current += 1;
    if (messageBackdropUriRef.current) {
      releaseCapture(messageBackdropUriRef.current);
      messageBackdropUriRef.current = null;
    }
  }, [cancelPendingScroll]);

  // Create local chat sound players once and unload them on unmount.
  useEffect(() => {
    let cancelled = false;
    const prepareSounds = async () => {
      try {
        await chatSoundsReady;
        await ensureAppAudioReady();
        if (cancelled) return;
        const sent = createAudioPlayer(CHAT_SENT_SOUND, { keepAudioSessionActive: true });
        const receive = createAudioPlayer(CHAT_RECEIVE_SOUND, { keepAudioSessionActive: true });
        sent.volume = 1;
        receive.volume = 1;
        if (cancelled) {
          sent.remove();
          receive.remove();
          return;
        }
        sentSoundRef.current = sent;
        receiveSoundRef.current = receive;
      } catch (error) {
        console.warn("Unable to prepare chat sounds:", error);
      }
    };
    void prepareSounds();
    return () => {
      cancelled = true;
      sentSoundRef.current?.remove();
      receiveSoundRef.current?.remove();
      sentSoundRef.current = null;
      receiveSoundRef.current = null;
    };
  }, []);

  const playSentSound = useCallback(async () => {
    try {
      const sound = sentSoundRef.current;
      if (!sound) return;
      await playSoundFromStart(sound);
    } catch (error) {
      console.warn("Unable to play sent sound:", error);
    }
  }, []);

  const playReceiveSound = useCallback(async () => {
    try {
      const sound = receiveSoundRef.current;
      if (!sound) return;
      await playSoundFromStart(sound);
    } catch (error) {
      console.warn("Unable to play receive sound:", error);
    }
  }, []);

  const queueScrollToBottom = useCallback((animated = true) => {
    shouldScrollToBottomRef.current = true;
    nextScrollAnimatedRef.current = animated;
    scrollToBottom(animated);
  }, [scrollToBottom]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (chatIsActive && conversationId) registerActiveChat(conversationId);
    else registerActiveChat(null);
    return () => registerActiveChat(null);
  }, [chatIsActive, conversationId]);

  useEffect(() => {
    if (!isFocused) return undefined;
    const beginKeyboardShow = () => {
      keyboardTransitionRef.current = true;
      pinDuringKeyboardRef.current = isNearBottomRef.current;
      cancelPendingScroll();
      if (pinDuringKeyboardRef.current) {
        shouldScrollToBottomRef.current = true;
        requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }));
      }
    };
    const finishKeyboardShow = () => {
      keyboardTransitionRef.current = false;
      if (pinDuringKeyboardRef.current || shouldScrollToBottomRef.current) {
        requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }));
        shouldScrollToBottomRef.current = false;
        nextScrollAnimatedRef.current = false;
      }
      pinDuringKeyboardRef.current = false;
    };
    const beginKeyboardHide = () => {
      keyboardTransitionRef.current = true;
      pinDuringKeyboardRef.current = false;
      cancelPendingScroll();
    };
    const finishKeyboardHide = () => {
      keyboardTransitionRef.current = false;
      pinDuringKeyboardRef.current = false;
    };
    const subscriptions = [
      KeyboardEvents.addListener("keyboardWillShow", beginKeyboardShow),
      KeyboardEvents.addListener("keyboardWillHide", beginKeyboardHide),
      KeyboardEvents.addListener("keyboardDidShow", finishKeyboardShow),
      KeyboardEvents.addListener("keyboardDidHide", finishKeyboardHide),
    ];
    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      keyboardTransitionRef.current = false;
      pinDuringKeyboardRef.current = false;
    };
  }, [cancelPendingScroll, isFocused]);

  useFocusEffect(
    useCallback(() => {
      const navigators = [navigation, navigation.getParent?.(), navigation.getParent?.()?.getParent?.()].filter(Boolean);
      const tabNavigator = navigators.find((item: any) => item?.getState?.()?.type === "tab");
      if (!tabNavigator) return undefined;
      tabNavigator.setOptions?.({ tabBarStyle: { display: "none" } });
      return () => tabNavigator.setOptions?.({ tabBarStyle: undefined });
    }, [navigation])
  );

  const refreshBlockState = useCallback(async () => {
    if (!userId || !otherUserId) return;
    try {
      setBlockState(await getBlockStateBetweenUsers(userId, otherUserId));
      setBlockStateError(null);
    } catch (error) {
      console.warn("Unable to load chat safety state:", error);
      setBlockState({ blockedByMe: false, blockedMe: false, blockedEitherWay: true });
      setBlockStateError("Messaging is paused because safety settings could not be verified.");
    }
  }, [otherUserId, userId]);

  useEffect(() => {
    void refreshBlockState();
  }, [refreshBlockState]);

  useEffect(() => {
    let active = true;
    setProfile({
      name: String(otherUserName || "User"),
      shopName: null,
      photoUrl: null,
      gender: "other",
      role: "user",
      phone: null,
      isShop: false,
    });
    const loadProfile = async () => {
      if (!otherUserId) return;
      const [{ data: userData, error: userError }, { data: shopData, error: shopError }] = await Promise.all([
        supabase.rpc("get_chat_partner_profiles", { target_ids: [otherUserId] }).maybeSingle<{
          fullName?: string | null;
          email?: string | null;
          photoURL?: string | null;
          gender?: string | null;
        }>(),
        supabase.from("funeral_shops").select("id, shopName, shopImageUrl, shopPhoneNumber").eq("id", otherUserId).maybeSingle(),
      ]);
      if (userError && !isLegacyChatProfileSchemaError(userError)) {
        console.warn("Unable to load chat profile:", userError.message);
      }
      if (shopError) console.warn("Unable to load chat shop:", shopError.message);
      if (!active) return;
      setProfile({
        name: String(userData?.fullName || userData?.email || shopData?.shopName || otherUserName || "User"),
        shopName: shopData?.shopName || null,
        photoUrl: userData?.photoURL || shopData?.shopImageUrl || null,
        gender: (userData?.gender as "female" | "male" | "other") || "other",
        role: "user",
        phone: shopData?.shopPhoneNumber || null,
        isShop: !!shopData,
      });
    };
    void loadProfile();
    return () => {
      active = false;
    };
  }, [otherUserId, otherUserName]);

  const openProfile = useCallback(() => {
    const isAdmin = ADMIN_ROLES.has(profile.role.toLowerCase());
    if (!currentUserIsAdmin && isAdmin) return;
    if (profile.isShop) {
      navigation.navigate("ShopProducts", {
        shopId: otherUserId,
        shopName: profile.shopName || profile.name,
      });
    } else if (currentUserIsAdmin) {
      navigation.navigate("AdminUserDetail", { userId: otherUserId, fromChatConversation: true });
    } else if (navigation.getState?.()?.routeNames?.includes("FuneralTabs")) {
      navigation.navigate("FuneralTabs", { screen: "Profile" });
    }
  }, [currentUserIsAdmin, navigation, otherUserId, profile]);

  const openPhone = useCallback(async () => {
    if (!profile.phone) {
      Alert.alert("Unavailable", "This account has no contact number.");
      return;
    }
    try {
      await Linking.openURL(`tel:${profile.phone.replace(/\s+/g, "")}`);
    } catch {
      Alert.alert("Unavailable", "Calling is unavailable on this device.");
    }
  }, [profile.phone]);

  const openSafety = useCallback(() => {
    Keyboard.dismiss();
    setSafetyVisible(true);
  }, []);

  useLayoutEffect(() => {
    const adminProfile = ADMIN_ROLES.has(profile.role.toLowerCase());
    navigation.setOptions({
      headerTitle: "",
      headerShadowVisible: false,
      headerStyle: { backgroundColor: "#ffffff" },
      headerLeft: () => (
        <View style={styles.headerLeft}>
          <AppHeaderBackButton onPress={() => navigation.goBack()} />
          <TouchableOpacity style={styles.headerIdentity} onPress={openProfile} disabled={!currentUserIsAdmin && adminProfile}>
            <Avatar.Image
              size={38}
              source={adminProfile ? APP_LOGO : profile.photoUrl ? { uri: profile.photoUrl } : getDefaultProfileImage(profile.gender)}
            />
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} style={styles.headerName}>{profile.name}</Text>
              <Text style={styles.headerStatus}>{profile.isShop ? "Funeral shop" : adminProfile ? "LifeCycle support" : "Conversation"}</Text>
            </View>
          </TouchableOpacity>
        </View>
      ),
      headerRight: () => currentUserIsAdmin ? null : (
        <View style={styles.headerActions}>
          <IconButton icon="phone-outline" size={19} iconColor="#35584c" style={styles.headerActionButton} onPress={() => void openPhone()} />
          <IconButton icon="shield-outline" size={19} iconColor="#35584c" style={styles.headerActionButton} onPress={openSafety} />
        </View>
      ),
    });
  }, [currentUserIsAdmin, navigation, openPhone, openProfile, openSafety, profile]);

  useEffect(() => {
    let active = true;
    conversationSessionRef.current += 1;
    setConversationReady(false);
    setReadyForUserId(null);
    setConversationId(initialConversationId);
    setMessages([]);
    setInputText("");
    setSelectedMessage(null);
    setMessageActionAnchor(null);
    messageActionAnimationRef.current.stopAnimation();
    messageActionAnimationRef.current.setValue(0);
    messageActionClosingRef.current = false;
    messageActionAfterCloseRef.current = null;
    messageBackdropCaptureRef.current += 1;
    if (messageBackdropUriRef.current) {
      releaseCapture(messageBackdropUriRef.current);
      messageBackdropUriRef.current = null;
    }
    setMessageBackdropUri(null);
    setReplyingTo(null);
    setEditingMessage(null);
    messageActionsAvailableRef.current = null;
    deliveryReceiptsAvailableRef.current = null;
    setLoadError(null);
    setLoading(true);
    loadGenerationRef.current += 1;
    isNearBottomRef.current = true;
    shouldScrollToBottomRef.current = true;

    const prepareConversation = async () => {
      if (!userId || !otherUserId) {
        setLoadError("This chat link is incomplete. Go back and open the conversation again.");
        setLoading(false);
        return;
      }
      if (userId === otherUserId) {
        setLoadError("You cannot start a conversation with your own account.");
        setLoading(false);
        return;
      }
      try {
        const id = await ensureConversationForUsers(null, userId, otherUserId, initialConversationId);
        if (!active) return;
        setConversationId(id);
        setReadyForUserId(otherUserId);
        setConversationReady(true);
      } catch (error: any) {
        if (!active) return;
        setLoadError(error?.message || "This conversation could not be opened.");
        setLoading(false);
      }
    };
    void prepareConversation();
    return () => {
      active = false;
    };
  }, [initialConversationId, otherUserId, userId]);

  const loadMessages = useCallback(async (showLoader = false) => {
    if (!conversationId || !conversationReady) return;
    const generation = ++loadGenerationRef.current;
    if (showLoader) setLoading(true);
    setLoadError(null);
    const fetchMessages = (columns: string) => supabase
      .from("messages")
      .select(columns)
      .eq("conversationId", conversationId)
      .order("timestamp", { ascending: false })
      .limit(MESSAGE_LIMIT);
    const requestedActions = messageActionsAvailableRef.current !== false;
    let { data, error } = await fetchMessages(requestedActions
      ? MESSAGE_COLUMNS_WITH_ACTIONS
      : deliveryReceiptsAvailableRef.current === false
        ? MESSAGE_COLUMNS
        : MESSAGE_COLUMNS_WITH_DELIVERY
    );
    if (error && requestedActions && isMissingMessageActionsSchema(error)) {
      messageActionsAvailableRef.current = false;
      ({ data, error } = await fetchMessages(
        deliveryReceiptsAvailableRef.current === false ? MESSAGE_COLUMNS : MESSAGE_COLUMNS_WITH_DELIVERY
      ));
    } else if (!error && requestedActions) {
      messageActionsAvailableRef.current = true;
      deliveryReceiptsAvailableRef.current = true;
    }
    if (error && deliveryReceiptsAvailableRef.current !== false && isMissingDeliveryColumn(error)) {
      deliveryReceiptsAvailableRef.current = false;
      ({ data, error } = await fetchMessages(MESSAGE_COLUMNS));
    } else if (!error && deliveryReceiptsAvailableRef.current === null) {
      deliveryReceiptsAvailableRef.current = true;
    }
    if (generation !== loadGenerationRef.current) return;
    if (error) {
      setLoadError(error.message || "Messages could not be loaded.");
    } else {
      const latestMessages = prepareMessages((data || []) as unknown as ChatMessage[]);
      setMessages((current) => {
        const currentById = new Map(current.map((message) => [message.id, message]));
        const mergedLoaded = latestMessages.map((message) => {
          const newerReceipt = currentById.get(message.id);
          if (!newerReceipt) return message;
          return {
            ...message,
            readBy: mergeReceiptIds(message.readBy, newerReceipt.readBy),
            deliveredTo: mergeReceiptIds(message.deliveredTo, newerReceipt.deliveredTo),
            reactions: newerReceipt.reactions ?? message.reactions,
            editedAt: newerReceipt.editedAt ?? message.editedAt,
            text: newerReceipt.editedAt ? newerReceipt.text : message.text,
          };
        });
        const loadedIds = new Set(mergedLoaded.map((message) => message.id));
        const realtimeOnly = current.filter((message) =>
          message.conversationId === conversationId && !loadedIds.has(message.id)
        );
        return prepareMessages([...mergedLoaded, ...realtimeOnly]);
      });
      shouldScrollToBottomRef.current = false;
      nextScrollAnimatedRef.current = false;
    }
    setLoading(false);
  }, [conversationId, conversationReady]);

  useEffect(() => {
    if (!chatIsActive || !conversationId || !conversationReady) return undefined;
    void loadMessages(true);
    const channel = supabase
      .channel(`mobile-chat-${conversationId}-${Date.now()}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "messages",
        filter: `conversationId=eq.${conversationId}`,
      }, (payload: any) => {
        const eventType = String(payload.eventType || "");
        if (eventType === "DELETE") {
          const deletedId = String(payload.old?.id || "");
          if (deletedId) {
            setMessages((current) => prepareMessages(current.filter((message) => message.id !== deletedId)));
            setSelectedMessage((current) => current?.id === deletedId ? null : current);
            setReplyingTo((current) => current?.id === deletedId ? null : current);
            setEditingMessage((current) => current?.id === deletedId ? null : current);
          }
          return;
        }

        const nextMessage = payload.new as ChatMessage | undefined;
        if (!nextMessage?.id || nextMessage.conversationId !== conversationId) return;
        if (eventType === "INSERT" && (nextMessage.senderId === userId || isNearBottomRef.current)) {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        }
        // Play receive sound for incoming messages from the other user
        if (eventType === "INSERT" && nextMessage.senderId !== userId) {
          void playReceiveSound();
        }
        setMessages((current) => {
          const optimisticEcho = eventType === "INSERT" && nextMessage.senderId === userId
            ? current.find((message) =>
                message.clientStatus === "sending"
                && message.senderId === nextMessage.senderId
                && message.text === nextMessage.text
              )
            : undefined;
          const existing = current.find((message) => message.id === nextMessage.id);
          if (existing && messagesMatch(existing, nextMessage) && !optimisticEcho) return current;
          const withoutCurrent = current.filter((message) =>
            message.id !== nextMessage.id && message.id !== optimisticEcho?.id
          );
          return prepareMessages([...withoutCurrent, nextMessage]);
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadMessages(false);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`Chat realtime subscription ${status.toLowerCase()}.`);
        }
      });
    return () => {
      loadGenerationRef.current += 1;
      void supabase.removeChannel(channel);
    };
  }, [chatIsActive, conversationId, conversationReady, loadMessages, playReceiveSound, userId]);

  useEffect(() => {
    if (!chatIsActive || !conversationId || !userId || messages.length === 0) return undefined;
    let cancelled = false;
    const markRead = async () => {
      const unread = messages.filter((message) => message.senderId !== userId && !message.readBy?.includes(userId));
      if (unread.length === 0) return;

      const unreadIds = new Set(unread.map((message) => message.id));
      setMessages((current) => current.map((message) => unreadIds.has(message.id)
        ? { ...message, readBy: Array.from(new Set([...(message.readBy || []), userId])) }
        : message));

      try {
        await markChatMessagesSeen(
          conversationId,
          userId,
          unread.map((message) => message.id)
        );
      } catch (error: any) {
        console.warn("Unable to update message read receipts:", error?.message || error);
      }
      if (cancelled) return;

      const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("lastMessage, updatedAt")
        .eq("id", conversationId)
        .maybeSingle();
      if (conversationError) {
        console.warn("Unable to update the conversation read receipt:", conversationError.message);
        return;
      }
      const lastMessage = conversation?.lastMessage;
      const displayedLastMessage = unread.some((message) =>
        lastMessage?.id
          ? message.id === lastMessage.id
          : message.senderId === lastMessage?.senderId &&
            message.timestamp === lastMessage?.timestamp &&
            message.text === lastMessage?.text
      );
      if (conversation && displayedLastMessage && lastMessage.senderId !== userId && !lastMessage.readBy?.includes(userId)) {
        const { error } = await supabase.from("conversations").update({
          lastMessage: { ...lastMessage, readBy: [...(lastMessage.readBy || []), userId] },
        }).eq("id", conversationId).eq("updatedAt", conversation.updatedAt);
        if (error) console.warn("Unable to update the conversation preview receipt:", error.message);
      }
    };
    const timeout = setTimeout(() => void markRead(), 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [chatIsActive, conversationId, messages, userId]);

  useEffect(() => {
    if (!chatIsActive || !conversationId || !userId) return;
    // Opening a conversation clears a manual "mark as unread" flag even when
    // the conversation has no messages yet. Read receipts are handled below.
    void saveConversationPreference(conversationId, "unread", false).catch(() => {
      // The conversation remains usable while an older database migration is
      // being upgraded; the list screen will surface action errors directly.
    });
  }, [chatIsActive, conversationId, userId]);

  useEffect(() => {
    if (!chatIsActive || !conversationId || !userId) return;
    const syncNotifications = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, data, read")
        .eq("userId", userId)
        .in("type", ["support_message", "chat_message"]);
      if (error) {
        console.warn("Unable to synchronize chat notifications:", error.message);
        return;
      }
      const ids = (data || []).filter((item: any) => !item.read && item.data?.conversationId === conversationId).map((item: any) => item.id);
      if (ids.length === 0) return;
      const { error: updateError } = await supabase.from("notifications").update({ read: true }).in("id", ids);
      if (updateError) console.warn("Unable to mark chat notifications as read:", updateError.message);
    };
    void syncNotifications();
  }, [chatIsActive, conversationId, userId]);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, []);

  const requireMessageActions = useCallback(() => {
    if (messageActionsAvailableRef.current !== false) return true;
    Alert.alert(
      "Chat update required",
      "Apply the latest chat database migration, then reopen this conversation."
    );
    return false;
  }, []);

  const closeMessageActions = useCallback(() => {
    if (messageActionClosingRef.current) return;
    messageActionClosingRef.current = true;
    messageActionAnimationRef.current.stopAnimation();
    Animated.timing(messageActionAnimationRef.current, {
      toValue: 0,
      duration: 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setSelectedMessage(null);
      setMessageActionAnchor(null);
      messageActionClosingRef.current = false;
      const afterClose = messageActionAfterCloseRef.current;
      messageActionAfterCloseRef.current = null;
      afterClose?.();
    });
  }, []);

  const focusComposerAfterMenuDismiss = useCallback(() => {
    focusComposerOnMenuDismissRef.current = true;
    closeMessageActions();
    if (Platform.OS !== "ios") {
      if (composerFocusTimeoutRef.current) clearTimeout(composerFocusTimeoutRef.current);
      composerFocusTimeoutRef.current = setTimeout(() => {
        composerFocusTimeoutRef.current = null;
        if (!focusComposerOnMenuDismissRef.current) return;
        focusComposerOnMenuDismissRef.current = false;
        focusComposer();
      }, 180);
    }
  }, [closeMessageActions, focusComposer]);

  const handleMessageActionsDismissed = useCallback(() => {
    if (messageBackdropUriRef.current) {
      releaseCapture(messageBackdropUriRef.current);
      messageBackdropUriRef.current = null;
      setMessageBackdropUri(null);
    }
    if (!focusComposerOnMenuDismissRef.current) return;
    focusComposerOnMenuDismissRef.current = false;
    if (composerFocusTimeoutRef.current) {
      clearTimeout(composerFocusTimeoutRef.current);
      composerFocusTimeoutRef.current = null;
    }
    focusComposer();
  }, [focusComposer]);

  const openMessageActions = useCallback((message: ChatMessage, anchor: MessageActionAnchor) => {
    const captureId = ++messageBackdropCaptureRef.current;
    const captureBackdrop = async () => {
      if (Keyboard.isVisible()) {
        await new Promise<void>((resolve) => {
          let finished = false;
          let timeout: ReturnType<typeof setTimeout> | null = null;
          const finish = () => {
            if (finished) return;
            finished = true;
            subscription.remove();
            if (timeout) clearTimeout(timeout);
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          };
          const subscription = Keyboard.addListener("keyboardDidHide", finish);
          timeout = setTimeout(finish, 400);
          Keyboard.dismiss();
        });
      }

      let uri: string | null = null;
      try {
        uri = await captureScreen({ format: "jpg", quality: 0.68, result: "tmpfile" });
      } catch (error) {
        console.warn("Unable to capture the chat backdrop:", error);
      }

      if (captureId !== messageBackdropCaptureRef.current) {
        if (uri) releaseCapture(uri);
        return;
      }
      if (messageBackdropUriRef.current) releaseCapture(messageBackdropUriRef.current);
      messageActionAnimationRef.current.stopAnimation();
      messageActionAnimationRef.current.setValue(0);
      messageActionClosingRef.current = false;
      messageActionAfterCloseRef.current = null;
      messageBackdropUriRef.current = uri;
      setMessageBackdropUri(uri);
      setMessageActionAnchor(anchor);
      setSelectedMessage(message);
      requestAnimationFrame(() => {
        Animated.spring(messageActionAnimationRef.current, {
          toValue: 1,
          damping: 20,
          stiffness: 220,
          mass: 0.78,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.001,
          useNativeDriver: true,
        }).start();
      });
    };
    void captureBackdrop();
  }, []);

  const startReply = useCallback(() => {
    if (!selectedMessage || selectedMessage.clientStatus === "sending" || !requireMessageActions()) return;
    setReplyingTo(selectedMessage);
    setEditingMessage(null);
    focusComposerAfterMenuDismiss();
  }, [focusComposerAfterMenuDismiss, requireMessageActions, selectedMessage]);

  const startEdit = useCallback(() => {
    if (!selectedMessage || selectedMessage.senderId !== userId || selectedMessage.clientStatus === "sending" || !requireMessageActions()) return;
    editPreviousDraftRef.current = inputText;
    setReplyingTo(null);
    setEditingMessage(selectedMessage);
    setInputText(selectedMessage.text);
    focusComposerAfterMenuDismiss();
  }, [focusComposerAfterMenuDismiss, inputText, requireMessageActions, selectedMessage, userId]);

  const cancelComposerAction = useCallback(() => {
    if (editingMessage) setInputText(editPreviousDraftRef.current);
    setEditingMessage(null);
    setReplyingTo(null);
  }, [editingMessage]);

  const copySelectedMessage = useCallback(async () => {
    if (!selectedMessage) return;
    await Clipboard.setStringAsync(selectedMessage.text);
    closeMessageActions();
  }, [closeMessageActions, selectedMessage]);

  const reactToSelectedMessage = useCallback(async (reaction: MessageReaction) => {
    if (!selectedMessage || !userId || selectedMessage.clientStatus === "sending" || !requireMessageActions()) return;
    const targetId = selectedMessage.id;
    const previousReactions = selectedMessage.reactions || {};
    const nextReaction = previousReactions[userId] === reaction ? null : reaction;
    const optimisticReactions = { ...previousReactions };
    if (nextReaction) optimisticReactions[userId] = nextReaction;
    else delete optimisticReactions[userId];
    closeMessageActions();
    setMessages((current) => current.map((message) => message.id === targetId
      ? { ...message, reactions: optimisticReactions }
      : message));
    setMessageActionBusy(true);
    const { data, error } = await supabase.rpc("react_to_chat_message", {
      target_message_id: targetId,
      reaction: nextReaction,
    });
    setMessageActionBusy(false);
    if (error) {
      setMessages((current) => current.map((message) => message.id === targetId
        ? { ...message, reactions: previousReactions }
        : message));
      Alert.alert("Reaction not saved", error.message || "Please try again.");
      return;
    }
    setMessages((current) => current.map((message) => message.id === targetId
      ? { ...message, reactions: (data || {}) as Record<string, MessageReaction> }
      : message));
  }, [closeMessageActions, requireMessageActions, selectedMessage, userId]);

  const saveEditedMessage = useCallback(async () => {
    if (!editingMessage || !requireMessageActions()) return;
    const text = sanitizeMultilinePlainText(inputText, 1500);
    if (!text || messageActionBusy) return;
    if (text === editingMessage.text) {
      setInputText(editPreviousDraftRef.current);
      setEditingMessage(null);
      return;
    }
    setMessageActionBusy(true);
    const { data, error } = await supabase.rpc("edit_chat_message", {
      target_message_id: editingMessage.id,
      new_text: text,
    });
    setMessageActionBusy(false);
    if (error) {
      Alert.alert("Message not edited", error.message || "Please try again.");
      return;
    }
    const editedAt = typeof data === "string" ? data : new Date().toISOString();
    setMessages((current) => current.map((message) => message.id === editingMessage.id
      ? { ...message, text, editedAt }
      : message));
    setInputText(editPreviousDraftRef.current);
    setEditingMessage(null);
  }, [editingMessage, inputText, messageActionBusy, requireMessageActions]);

  const confirmUnsend = useCallback(() => {
    if (!selectedMessage || selectedMessage.senderId !== userId || selectedMessage.clientStatus === "sending" || !requireMessageActions()) return;
    const target = selectedMessage;
    messageActionAfterCloseRef.current = () => {
      Alert.alert("Undo Send?", "This message will be removed for everyone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Undo Send",
          style: "destructive",
          onPress: () => {
            setMessages((current) => prepareMessages(current.filter((message) => message.id !== target.id)));
            if (replyingTo?.id === target.id) setReplyingTo(null);
            if (editingMessage?.id === target.id) {
              setEditingMessage(null);
              setInputText(editPreviousDraftRef.current);
            }
            setMessageActionBusy(true);
            void supabase.rpc("unsend_chat_message", { target_message_id: target.id }).then(({ error }) => {
              setMessageActionBusy(false);
              if (!error) return;
              Alert.alert("Message not removed", error.message || "Please try again.");
              void loadMessages(false);
            });
          },
        },
      ]);
    };
    closeMessageActions();
  }, [closeMessageActions, editingMessage, loadMessages, replyingTo, requireMessageActions, selectedMessage, userId]);

  const sendMessage = useCallback(async () => {
    if (editingMessage) {
      await saveEditedMessage();
      return;
    }
    const conversationSession = conversationSessionRef.current;
    const draft = inputText;
    const replyTarget = replyingTo;
    const text = sanitizeMultilinePlainText(draft, 1500);
    let optimisticMessageId: string | null = null;
    if (!text || sendingRef.current) return;
    if (!userId || !otherUserId || !conversationId || !conversationReady || readyForUserId !== otherUserId) {
      Alert.alert("Chat unavailable", "The conversation is not ready yet.");
      return;
    }
    if (blockState.blockedEitherWay) {
      Alert.alert("Messaging unavailable", blockState.blockedByMe ? "Unblock this account before sending a message." : "You cannot message this account right now.");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      const latestBlockState = await getBlockStateBetweenUsers(userId, otherUserId);
      if (conversationSession !== conversationSessionRef.current) return;
      setBlockState(latestBlockState);
      setBlockStateError(null);
      if (latestBlockState.blockedEitherWay) {
        Alert.alert("Messaging unavailable", latestBlockState.blockedByMe
          ? "Unblock this account before sending a message."
          : "You cannot message this account right now.");
        return;
      }

      await consumeRateLimit(supabase as any, userId, "chat_message", conversationId);
      optimisticMessageId = `local-${conversationId}-${Date.now()}`;
      const optimisticMessage: ChatMessage = {
        id: optimisticMessageId,
        conversationId,
        senderId: userId,
        text,
        timestamp: new Date().toISOString(),
        readBy: [userId],
        deliveredTo: [],
        replyToId: replyTarget?.id || null,
        clientStatus: "sending",
      };
      if (conversationSession === conversationSessionRef.current) {
        shouldScrollToBottomRef.current = true;
        nextScrollAnimatedRef.current = true;
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMessages((current) => prepareMessages([...current, optimisticMessage]));
        setInputText((current) => current === draft ? "" : current);
        setReplyingTo(null);
        queueScrollToBottom();
      }

      const message = {
        conversationId,
        senderId: userId,
        text,
        readBy: [userId],
        ...(replyTarget ? { replyToId: replyTarget.id } : {}),
      };
      const { data: insertedMessage, error } = await supabase
        .from("messages")
        .insert(message)
        .select(messageActionsAvailableRef.current === true
          ? MESSAGE_COLUMNS_WITH_ACTIONS
          : deliveryReceiptsAvailableRef.current === true
            ? MESSAGE_COLUMNS_WITH_DELIVERY
            : MESSAGE_COLUMNS)
        .single();
      if (error) throw error;

      const sentMessage = insertedMessage as unknown as ChatMessage;
      const stillViewingConversation = conversationSession === conversationSessionRef.current;
      if (stillViewingConversation) {
        void playSentSound();
        setMessages((current) => {
          // Realtime can deliver the confirmed row (and even a delivery/read
          // update) before the insert promise resolves. Keep that newer server
          // row so the UI never regresses from Seen/Delivered back to Sent.
          const realtimeMessage = current.find((item) => item.id === sentMessage.id);
          if (realtimeMessage) {
            return prepareMessages(current.filter((item) => item.id !== optimisticMessageId));
          }
          const withoutCurrent = current.filter((item) =>
            item.id !== sentMessage.id && item.id !== optimisticMessageId
          );
          return prepareMessages([...withoutCurrent, sentMessage]);
        });
      }

      const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("hiddenFor, updatedAt")
        .eq("id", conversationId)
        .maybeSingle();
      if (conversationError) {
        console.warn("Message sent but the conversation preview could not be loaded:", conversationError.message);
      }
      const hiddenFor = Array.isArray(conversation?.hiddenFor)
        ? conversation.hiddenFor.filter((id: string) => id !== userId && id !== otherUserId)
        : [];
      if (!conversationError) {
        const previewTimestamp = sentMessage.timestamp || new Date().toISOString();
        const { error: previewError } = await supabase.from("conversations").update({
          lastMessage: { id: sentMessage.id, text, senderId: userId, timestamp: previewTimestamp, readBy: [userId] },
          hiddenFor,
          updatedAt: previewTimestamp,
        }).eq("id", conversationId).lte("updatedAt", previewTimestamp);
        if (previewError) console.warn("Message sent but conversation preview was not updated:", previewError.message);
      }

    } catch (error: any) {
      if (optimisticMessageId && conversationSession === conversationSessionRef.current) {
        setMessages((current) => prepareMessages(
          current.filter((message) => message.id !== optimisticMessageId)
        ));
        setInputText((current) => current ? current : draft);
        setReplyingTo((current) => current || replyTarget);
      }
      if (isRateLimitError(error)) {
        Alert.alert("Slow down", `Try again in ${error.retryAfterSeconds} seconds.`);
      } else {
        Alert.alert("Message not sent", error?.message || "Please try again.");
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [blockState, conversationId, conversationReady, editingMessage, inputText, otherUserId, playSentSound, queueScrollToBottom, readyForUserId, replyingTo, saveEditedMessage, userId]);

  const toggleBlock = useCallback(async () => {
    if (!userId || !otherUserId) return;
    try {
      if (blockState.blockedByMe) await unblockUser(userId, otherUserId);
      else await blockUser(userId, otherUserId);
      await refreshBlockState();
      setSafetyVisible(false);
    } catch (error: any) {
      Alert.alert("Safety setting not changed", error?.message || "Please try again.");
    }
  }, [blockState.blockedByMe, otherUserId, refreshBlockState, userId]);

  const reportUser = useCallback(() => {
    setSafetyVisible(false);
    if (navigation.getState?.()?.routeNames?.includes("ReportCenter")) {
      navigation.navigate("ReportCenter", {
        targetUserId: otherUserId,
        conversationId,
        requestId: requestId || null,
        source: "chat",
      });
    } else {
      Alert.alert("Report account", "Open Profile → Contact Support to submit a report for this conversation.");
    }
  }, [conversationId, navigation, otherUserId, requestId]);

  const messageAvatarSource = useMemo(
    () => ADMIN_ROLES.has(profile.role.toLowerCase())
      ? APP_LOGO
      : profile.photoUrl
        ? { uri: profile.photoUrl }
        : getDefaultProfileImage(profile.gender),
    [profile.gender, profile.photoUrl, profile.role]
  );

  const latestOutgoingMessageId = useMemo(
    () => [...messages].reverse().find((message) => message.senderId === userId)?.id || null,
    [messages, userId]
  );
  const latestSeenOutgoingMessageId = useMemo(
    () => [...messages].reverse().find((message) =>
      message.senderId === userId
      && !!otherUserId
      && message.readBy?.includes(otherUserId)
    )?.id || null,
    [messages, otherUserId, userId]
  );
  const listMessages = useMemo(() => [...messages].reverse(), [messages]);
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages]
  );

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const mine = item.senderId === userId;
    const replyPreview = item.replyToId ? messageById.get(item.replyToId) || null : null;
    const replyContextLabel = mine
      ? replyPreview?.senderId === userId
        ? "You replied to your message"
        : replyPreview
          ? `You replied to ${profile.name}`
          : "You replied"
      : replyPreview?.senderId === userId
        ? `${profile.name} replied to you`
        : replyPreview
          ? `${profile.name} replied to their message`
          : `${profile.name} replied`;
    const showSeenAvatar = mine && item.id === latestSeenOutgoingMessageId;
    let deliveryLabel: ChatMessageRowProps["deliveryLabel"] = null;
    if (mine && item.id === latestOutgoingMessageId && !showSeenAvatar) {
      if (item.clientStatus === "sending") deliveryLabel = "Sending";
      else if (otherUserId && item.deliveredTo?.includes(otherUserId)) deliveryLabel = "Delivered";
      else deliveryLabel = "Sent";
    }
    return (
      <ChatMessageRow
        item={item}
        mine={mine}
        showDate={!!item.showDate}
        replyPreview={replyPreview}
        replyContextLabel={replyContextLabel}
        deliveryLabel={deliveryLabel}
        showSeenAvatar={showSeenAvatar}
        avatarSource={messageAvatarSource}
        onLongPress={openMessageActions}
      />
    );
  }, [latestOutgoingMessageId, latestSeenOutgoingMessageId, messageAvatarSource, messageById, openMessageActions, otherUserId, profile.name, userId]);

  const inputDisabled = blockState.blockedEitherWay || !conversationReady || readyForUserId !== otherUserId;
  const sendDisabled = inputDisabled || sending || messageActionBusy || !inputText.trim();
  const selectedMessageMine = selectedMessage?.senderId === userId;
  const selectedReaction = selectedMessage && userId ? selectedMessage.reactions?.[userId] : null;
  const selectedReplyPreview = selectedMessage?.replyToId
    ? messageById.get(selectedMessage.replyToId) || null
    : null;
  const activeAnchor = messageActionAnchor || {
    x: selectedMessageMine ? viewportWidth - 180 : 20,
    y: viewportHeight * 0.4,
    width: 160,
    height: 52,
  };
  const contextHorizontalInset = 14;
  const reactionBarWidth = Math.min(356, viewportWidth - contextHorizontalInset * 2);
  const previewWidth = Math.min(
    Math.max(activeAnchor.width, 92),
    viewportWidth - contextHorizontalInset * 2
  );
  const previewHeight = Math.min(Math.max(activeAnchor.height, 44), 170);
  const menuWidth = Math.min(232, viewportWidth - contextHorizontalInset * 2);
  const actionRowCount = selectedMessage?.clientStatus === "sending" ? 1 : selectedMessageMine ? 4 : 2;
  const actionMenuHeight = actionRowCount * 52;
  const contextClusterHeight = 58 + 10 + previewHeight + 10 + actionMenuHeight;
  const minimumContextTop = Math.max(insets.top + 8, 12);
  const maximumContextTop = Math.max(
    minimumContextTop,
    viewportHeight - Math.max(insets.bottom, 14) - contextClusterHeight - 8
  );
  const contextTop = Math.min(
    Math.max(activeAnchor.y - 68, minimumContextTop),
    maximumContextTop
  );
  const reactionBarLeft = (viewportWidth - reactionBarWidth) / 2;
  const previewLeft = selectedMessageMine
    ? viewportWidth - contextHorizontalInset - previewWidth
    : Math.min(
        Math.max(activeAnchor.x, contextHorizontalInset + 34),
        viewportWidth - contextHorizontalInset - previewWidth
      );
  const actionMenuLeft = selectedMessageMine
    ? viewportWidth - contextHorizontalInset - menuWidth
    : Math.min(
        Math.max(activeAnchor.x, contextHorizontalInset),
        viewportWidth - contextHorizontalInset - menuWidth
      );
  const previewTop = contextTop + 68;
  const actionMenuTop = previewTop + previewHeight + 10;
  const messageActionProgress = messageActionAnimationRef.current;
  const backdropOpacity = messageActionProgress.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [0, 1, 1],
    extrapolate: "clamp",
  });
  const reactionOpacity = messageActionProgress.interpolate({
    inputRange: [0, 0.16, 1],
    outputRange: [0, 0, 1],
    extrapolate: "clamp",
  });
  const reactionScale = messageActionProgress.interpolate({
    inputRange: [0, 0.72, 1],
    outputRange: [0.88, 1.025, 1],
    extrapolate: "clamp",
  });
  const reactionTranslateY = messageActionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-12, 0],
    extrapolate: "clamp",
  });
  const selectedBubbleOpacity = messageActionProgress.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 0, 1],
    extrapolate: "clamp",
  });
  const selectedBubbleScale = messageActionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
    extrapolate: "clamp",
  });
  const actionCardOpacity = messageActionProgress.interpolate({
    inputRange: [0, 0.28, 1],
    outputRange: [0, 0, 1],
    extrapolate: "clamp",
  });
  const actionCardTranslateY = messageActionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
    extrapolate: "clamp",
  });
  const actionCardScale = messageActionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.97, 1],
    extrapolate: "clamp",
  });

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior="translate-with-padding"
        enabled={isFocused}
        keyboardVerticalOffset={headerHeight}
        style={styles.avoidingView}
      >
        <View style={styles.screen}>
          {blockState.blockedEitherWay ? (
            <View style={styles.blockBanner}>
              <Ionicons name="ban-outline" size={17} color="#a33d4a" />
              <Text style={styles.blockBannerText}>{blockStateError || (blockState.blockedByMe ? "You blocked this account." : "Messaging is unavailable for this conversation.")}</Text>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="small" color="#315f50" />
              <Text style={styles.centerStateText}>Loading messages...</Text>
            </View>
          ) : loadError ? (
            <View style={styles.centerState}>
              <Ionicons name="alert-circle-outline" size={28} color="#b44755" />
              <Text style={styles.loadErrorText}>{loadError}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => conversationReady ? void loadMessages(true) : navigation.goBack()}
                style={styles.retryButton}
              >
                <Text style={styles.retryButtonText}>{conversationReady ? "Try again" : "Go back"}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={listMessages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              inverted
              maintainVisibleContentPosition={{
                minIndexForVisible: 0,
                autoscrollToTopThreshold: 80,
              }}
              initialNumToRender={16}
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={40}
              windowSize={7}
              removeClippedSubviews={Platform.OS === "android"}
              style={styles.messageList}
              contentContainerStyle={[styles.messageContent, messages.length === 0 && styles.emptyMessageContent]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              showsVerticalScrollIndicator={false}
              onScrollBeginDrag={() => {
                Keyboard.dismiss();
                shouldScrollToBottomRef.current = false;
                nextScrollAnimatedRef.current = false;
                cancelPendingScroll();
              }}
              onScroll={({ nativeEvent }) => {
                isNearBottomRef.current = Math.max(0, nativeEvent.contentOffset.y) < 80;
              }}
              scrollEventThrottle={16}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <View style={styles.emptyIcon}><Ionicons name="chatbubble-ellipses-outline" size={28} color="#c56a57" /></View>
                  <Text style={styles.emptyTitle}>Start the conversation</Text>
                  <Text style={styles.emptySubtitle}>Send a message to begin the conversation.</Text>
                </View>
              }
            />
          )}

          {!loading && !loadError ? <View style={styles.composerSafeArea}>
            {replyingTo || editingMessage ? (
              <View style={styles.composerContext}>
                <View style={styles.composerContextIcon}>
                  <Ionicons name={editingMessage ? "create-outline" : "arrow-undo-outline"} size={16} color="#3d6656" />
                </View>
                <View style={styles.composerContextCopy}>
                  <Text style={styles.composerContextTitle}>
                    {editingMessage
                      ? "Editing message"
                      : `Reply to ${replyingTo?.senderId === userId ? "your message" : profile.name}`}
                  </Text>
                  <Text numberOfLines={1} style={styles.composerContextText}>
                    {(editingMessage || replyingTo)?.text}
                  </Text>
                </View>
                <IconButton
                  accessibilityLabel={editingMessage ? "Cancel editing" : "Cancel reply"}
                  icon="close"
                  size={18}
                  onPress={cancelComposerAction}
                  style={styles.composerContextClose}
                />
              </View>
            ) : null}
            <View style={styles.composer}>
              <View style={styles.inputWrap}>
                <TextInput
                  ref={composerInputRef}
                  value={inputText}
                  onChangeText={setInputText}
                  accessibilityLabel="Message"
                  placeholder={blockState.blockedEitherWay ? "Messaging unavailable" : editingMessage ? "Edit message..." : `Message ${profile.name}`}
                  placeholderTextColor="#8a948f"
                  style={styles.input}
                  multiline
                  maxLength={1500}
                  editable={!inputDisabled}
                  textAlignVertical="center"
                />
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Send message"
                disabled={sendDisabled}
                onPress={() => void sendMessage()}
                style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled]}
              >
                {sending || (editingMessage && messageActionBusy)
                  ? <ActivityIndicator size="small" color="#ffffff" />
                  : <Ionicons name={editingMessage ? "checkmark" : "send"} size={19} color="#ffffff" />}
              </TouchableOpacity>
            </View>
          </View> : null}
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={!!selectedMessage}
        transparent
        animationType="none"
        hardwareAccelerated
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onDismiss={handleMessageActionsDismissed}
        onRequestClose={closeMessageActions}
      >
        <View style={styles.messageActionOverlay} accessibilityViewIsModal>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { opacity: backdropOpacity }]}>
            {messageBackdropUri ? (
              <Image
                source={{ uri: messageBackdropUri }}
                resizeMode="cover"
                blurRadius={30}
                fadeDuration={0}
                style={StyleSheet.absoluteFillObject}
              />
            ) : (
              <View style={styles.messageActionFallback} />
            )}
            <View style={styles.messageActionScrim} />
          </Animated.View>
          <Pressable
            accessibilityLabel="Close message actions"
            style={StyleSheet.absoluteFillObject}
            onPress={closeMessageActions}
          />

          <Animated.View
            style={[
              styles.reactionBar,
              { left: reactionBarLeft, top: contextTop, width: reactionBarWidth },
              {
                opacity: reactionOpacity,
                transform: [{ translateY: reactionTranslateY }, { scale: reactionScale }],
              },
            ]}
          >
            {MESSAGE_REACTIONS.map((reaction) => {
              const active = selectedReaction === reaction.key;
              return (
                <Pressable
                  key={reaction.key}
                  accessibilityRole="button"
                  accessibilityLabel={reaction.label}
                  accessibilityState={{ selected: active, disabled: messageActionBusy || selectedMessage?.clientStatus === "sending" }}
                  disabled={messageActionBusy || selectedMessage?.clientStatus === "sending"}
                  onPress={() => void reactToSelectedMessage(reaction.key)}
                  style={[styles.reactionButton, active && styles.reactionButtonActive]}
                >
                  <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                </Pressable>
              );
            })}
          </Animated.View>

          {!selectedMessageMine ? (
            <Animated.View
              style={[
                styles.selectedMessageAvatarWrap,
                { left: Math.max(5, previewLeft - 34), top: previewTop + previewHeight - 28 },
                { opacity: selectedBubbleOpacity, transform: [{ scale: selectedBubbleScale }] },
              ]}
            >
              <Avatar.Image size={28} source={messageAvatarSource} style={styles.selectedMessageAvatar} />
            </Animated.View>
          ) : null}

          <Animated.View
            style={[
              styles.selectedMessagePreview,
              selectedMessageMine ? styles.selectedMessagePreviewMine : styles.selectedMessagePreviewOther,
              { left: previewLeft, top: previewTop, width: previewWidth, height: previewHeight },
              { opacity: selectedBubbleOpacity, transform: [{ scale: selectedBubbleScale }] },
            ]}
          >
            {selectedMessage?.replyToId ? (
              <View style={styles.selectedReplyPreview}>
                <Text numberOfLines={1} style={styles.selectedReplySender}>
                  {selectedReplyPreview
                    ? selectedReplyPreview.senderId === userId ? "You" : profile.name
                    : "Original message unavailable"}
                </Text>
                {selectedReplyPreview ? (
                  <Text numberOfLines={1} style={styles.selectedReplyText}>{selectedReplyPreview.text}</Text>
                ) : null}
              </View>
            ) : null}
            <Text numberOfLines={5} style={styles.selectedMessagePreviewText}>{selectedMessage?.text}</Text>
            <View style={styles.selectedMessageMeta}>
              {selectedMessage?.editedAt ? <Text style={styles.selectedMessageMetaText}>Edited</Text> : null}
              <Text style={styles.selectedMessageMetaText}>{getTimeLabel(selectedMessage?.timestamp)}</Text>
            </View>
          </Animated.View>

          <Animated.View
            style={[
              styles.messageActionShadow,
              { left: actionMenuLeft, top: actionMenuTop, width: menuWidth },
              {
                opacity: actionCardOpacity,
                transform: [{ translateY: actionCardTranslateY }, { scale: actionCardScale }],
              },
            ]}
          >
            <View style={styles.messageActionCard}>
              {selectedMessage?.clientStatus !== "sending" ? (
                <TouchableOpacity accessibilityRole="button" style={styles.messageActionRow} onPress={startReply}>
                  <Text style={styles.messageActionLabel}>Reply</Text>
                  <Ionicons name="arrow-undo" size={19} color="#f2f2f3" />
                </TouchableOpacity>
              ) : null}
              {selectedMessageMine && selectedMessage?.clientStatus !== "sending" ? (
                <>
                  <TouchableOpacity accessibilityRole="button" style={styles.messageActionRow} onPress={confirmUnsend}>
                    <Text style={[styles.messageActionLabel, styles.messageDestructiveText]}>Undo Send</Text>
                    <Ionicons name="trash-outline" size={19} color="#ff6b78" />
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" style={styles.messageActionRow} onPress={startEdit}>
                    <Text style={styles.messageActionLabel}>Edit</Text>
                    <Ionicons name="create-outline" size={19} color="#f2f2f3" />
                  </TouchableOpacity>
                </>
              ) : null}
              <TouchableOpacity accessibilityRole="button" style={[styles.messageActionRow, styles.messageActionRowLast]} onPress={() => void copySelectedMessage()}>
                <Text style={styles.messageActionLabel}>Copy</Text>
                <Ionicons name="copy-outline" size={19} color="#f2f2f3" />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>

      <Modal visible={safetyVisible} transparent animationType="fade" onRequestClose={() => setSafetyVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSafetyVisible(false)}>
          <Pressable
            style={[styles.actionSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Conversation safety</Text>
            <Text style={styles.sheetSubtitle}>Report suspicious activity or control who can message you.</Text>
            <TouchableOpacity style={styles.sheetAction} onPress={reportUser}>
              <Ionicons name="flag-outline" size={21} color="#b44755" />
              <Text style={[styles.sheetActionText, styles.destructiveText]}>Report account</Text>
            </TouchableOpacity>
            {!ADMIN_ROLES.has(profile.role.toLowerCase()) ? (
              <TouchableOpacity style={styles.sheetAction} onPress={() => void toggleBlock()}>
                <Ionicons name={blockState.blockedByMe ? "lock-open-outline" : "ban-outline"} size={21} color="#34433e" />
                <Text style={styles.sheetActionText}>{blockState.blockedByMe ? "Unblock account" : "Block account"}</Text>
              </TouchableOpacity>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#ffffff" },
  avoidingView: { flex: 1 },
  screen: { flex: 1, backgroundColor: "#ffffff" },
  headerLeft: { flexDirection: "row", alignItems: "center", maxWidth: 270 },
  headerIdentity: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
  headerCopy: { marginLeft: 9, flexShrink: 1 },
  headerName: { color: "#26332e", fontSize: 15, fontWeight: "900" },
  headerStatus: { color: "#78837e", fontSize: 10, marginTop: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 2, marginRight: -5 },
  headerActionButton: { width: 36, height: 36, margin: 0, borderRadius: 18, borderWidth: 1, borderColor: "#d9e1dd", backgroundColor: "#f8faf9" },
  blockBanner: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#fff0f2", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#efc4ca", flexDirection: "row", alignItems: "center", gap: 8 },
  blockBannerText: { flex: 1, color: "#8f3440", fontSize: 12, fontWeight: "700" },
  messageList: { flex: 1, minHeight: 0 },
  messageContent: { flexGrow: 1, justifyContent: "flex-start", paddingHorizontal: 14, paddingTop: 20, paddingBottom: 10 },
  emptyMessageContent: { justifyContent: "center" },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  centerStateText: { color: "#7a8580", fontSize: 12 },
  loadErrorText: { maxWidth: 280, color: "#8f3440", fontSize: 13, lineHeight: 19, textAlign: "center" },
  retryButton: { minHeight: 40, borderRadius: 20, backgroundColor: "#29483e", paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  retryButtonText: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
  emptyState: { alignItems: "center", paddingHorizontal: 34 },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#dfece5" },
  emptyTitle: { marginTop: 13, color: "#34413d", fontSize: 16, fontWeight: "800" },
  emptySubtitle: { marginTop: 6, color: "#7d8783", fontSize: 12, lineHeight: 18, textAlign: "center" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 14 },
  dateLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: "#d7ddda" },
  dateText: { color: "#7b8580", fontSize: 9, fontWeight: "700" },
  messageRow: { flexDirection: "row", marginVertical: 4, alignItems: "flex-end" },
  messageRowMine: { justifyContent: "flex-end" },
  messageRowOther: { justifyContent: "flex-start" },
  messageAvatar: { marginRight: 7, marginBottom: 2 },
  messageCluster: { maxWidth: "80%" },
  messageClusterMine: { alignItems: "flex-end" },
  messageClusterOther: { alignItems: "flex-start" },
  bubble: { maxWidth: "100%", minWidth: 72, borderRadius: 18, paddingHorizontal: 13, paddingTop: 10, paddingBottom: 8 },
  bubbleMine: { backgroundColor: "#315f50", borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: "#f2f4f3", borderBottomLeftRadius: 6 },
  bubblePressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  replyContext: { maxWidth: "100%", marginBottom: 4 },
  replyContextMine: { alignItems: "flex-end" },
  replyContextOther: { alignItems: "flex-start" },
  replyContextHeader: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, marginBottom: 4 },
  replyContextLabel: { flexShrink: 1, color: "#78827e", fontSize: 10, fontWeight: "600" },
  replyQuote: { maxWidth: "100%", minWidth: 132, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#e7eae8" },
  replyQuoteText: { color: "#5f6965", fontSize: 12, lineHeight: 17 },
  replyQuoteUnavailable: { color: "#89918e", fontStyle: "italic" },
  messageText: { color: "#283630", fontSize: 14, lineHeight: 20 },
  messageTextMine: { color: "#ffffff" },
  messageMeta: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 3, marginTop: 4 },
  timeText: { color: "#7d8984", fontSize: 9 },
  editedText: { color: "#7d8984", fontSize: 9, marginRight: 3 },
  messageMetaMine: { color: "rgba(255,255,255,0.68)" },
  reactionSummary: { minHeight: 23, flexDirection: "row", alignItems: "center", gap: 3, marginTop: -8, marginBottom: 1 },
  reactionSummaryMine: { alignSelf: "flex-end", marginRight: 8 },
  reactionSummaryOther: { alignSelf: "flex-start", marginLeft: 34 },
  reactionSummaryText: { overflow: "hidden", color: "#52605a", backgroundColor: "#ffffff", borderWidth: StyleSheet.hairlineWidth, borderColor: "#dedfdb", borderRadius: 12, paddingHorizontal: 5, paddingVertical: 2, fontSize: 11 },
  deliveryStatusRow: { minHeight: 19, alignItems: "flex-end", justifyContent: "center", paddingRight: 2, marginTop: -1, marginBottom: 2 },
  deliveryStatusText: { color: "#78847f", fontSize: 10, fontWeight: "600" },
  seenAvatar: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#ffffff" },
  composerSafeArea: { flexShrink: 0, backgroundColor: "#ffffff", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e8e6" },
  composerContext: { minHeight: 54, flexDirection: "row", alignItems: "center", marginHorizontal: 12, marginTop: 9, paddingLeft: 9, paddingRight: 3, paddingVertical: 7, borderRadius: 12, backgroundColor: "#eef3f0" },
  composerContextIcon: { width: 34, height: 34, borderRadius: 10, marginRight: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#dce8e2" },
  composerContextCopy: { flex: 1, minWidth: 0 },
  composerContextTitle: { color: "#2f6b55", fontSize: 11, fontWeight: "800" },
  composerContextText: { color: "#6f7b76", fontSize: 11, marginTop: 2 },
  composerContextClose: { margin: 0 },
  composer: { minHeight: 68, flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  inputWrap: { flex: 1, minHeight: 46, maxHeight: 116, borderWidth: 1, borderColor: "#d4dcd7", borderRadius: 23, backgroundColor: "#ffffff", justifyContent: "center" },
  input: { minHeight: 42, maxHeight: 114, color: "#283630", paddingHorizontal: 15, paddingTop: 10, paddingBottom: 10, fontSize: 14 },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#29483e", alignItems: "center", justifyContent: "center", marginBottom: 1 },
  sendButtonDisabled: { backgroundColor: "#c8ceca" },
  messageActionOverlay: { flex: 1 },
  messageActionFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: "#25262c" },
  messageActionScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,9,16,0.48)" },
  reactionBar: { position: "absolute", height: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-around", backgroundColor: "rgba(39,39,42,0.96)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.1)", borderRadius: 29, paddingHorizontal: 7, shadowColor: "#000000", shadowOpacity: 0.34, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  reactionButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  reactionButtonActive: { backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", transform: [{ scale: 1.1 }] },
  reactionEmoji: { fontSize: 26, lineHeight: 32 },
  selectedMessageAvatarWrap: { position: "absolute", width: 28, height: 28, zIndex: 4 },
  selectedMessageAvatar: { backgroundColor: "#303034", borderWidth: 1, borderColor: "rgba(255,255,255,0.7)" },
  selectedMessagePreview: { position: "absolute", overflow: "hidden", borderRadius: 17, paddingHorizontal: 13, paddingTop: 9, paddingBottom: 7, justifyContent: "center", shadowColor: "#000000", shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  selectedMessagePreviewMine: { backgroundColor: "#2f6655", borderBottomRightRadius: 5 },
  selectedMessagePreviewOther: { backgroundColor: "#38383d", borderBottomLeftRadius: 5 },
  selectedReplyPreview: { borderLeftWidth: 3, borderLeftColor: "rgba(255,255,255,0.7)", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4, marginBottom: 6 },
  selectedReplySender: { color: "#ffffff", fontSize: 10, fontWeight: "800" },
  selectedReplyText: { color: "rgba(255,255,255,0.7)", fontSize: 10, marginTop: 1 },
  selectedMessagePreviewText: { flexShrink: 1, color: "#ffffff", fontSize: 14, lineHeight: 19 },
  selectedMessageMeta: { minHeight: 12, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, marginTop: 3 },
  selectedMessageMetaText: { color: "rgba(255,255,255,0.66)", fontSize: 9 },
  messageActionShadow: { position: "absolute", borderRadius: 14, shadowColor: "#000000", shadowOpacity: 0.38, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  messageActionCard: { overflow: "hidden", backgroundColor: "rgba(36,36,39,0.97)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.1)", borderRadius: 14 },
  messageActionRow: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.18)" },
  messageActionRowLast: { borderBottomWidth: 0 },
  messageActionLabel: { color: "#f5f5f6", fontSize: 15, fontWeight: "500" },
  messageDestructiveText: { color: "#ff7b87" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(24,31,28,0.42)", justifyContent: "flex-end", padding: 12 },
  actionSheet: { backgroundColor: "#ffffff", borderRadius: 22, paddingHorizontal: 16, paddingTop: 9, paddingBottom: 18 },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: "#d5d8d5", alignSelf: "center", marginBottom: 12 },
  sheetTitle: { color: "#293630", fontSize: 17, fontWeight: "900" },
  sheetSubtitle: { color: "#75807b", fontSize: 12, lineHeight: 17, marginTop: 5, marginBottom: 8 },
  sheetAction: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#ecece9" },
  sheetActionText: { color: "#34433e", fontSize: 14, fontWeight: "700" },
  destructiveText: { color: "#b44755" },
});
