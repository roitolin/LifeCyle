import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppHeaderBackButton } from "@/components";
import Reanimated, { Easing as ReanimatedEasing, Keyframe, ReduceMotion } from "react-native-reanimated";
import ContentSkeleton, { SkeletonBlock, contentFade } from "@/components/ContentSkeleton";
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
  type PressableInstance,
  type TextInputInstance,
} from "react-native";
import { Avatar, IconButton, Text } from "react-native-paper";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView, KeyboardEvents } from "react-native-keyboard-controller";
import {
  AudioModule,
  createAudioPlayer,
  preload,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioRecorder,
} from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { captureScreen, releaseCapture } from "react-native-view-shot";
import { supabase } from "@/services/supabaseClient";
import { uploadChatMedia, type ChatMediaType } from "@/services/supabaseStorage";
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
import { generateId } from "../../utils/generateId";

const CHAT_SENT_SOUND = require("../../../sound/ChatSents.mp3");
const CHAT_RECEIVE_SOUND = require("../../../sound/ChatRecieves.mp3");
const messageEntrance = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.96 }, { translateY: 5 }] },
  100: { opacity: 1, transform: [{ scale: 1 }, { translateY: 0 }], easing: ReanimatedEasing.out(ReanimatedEasing.cubic) },
}).duration(220).reduceMotion(ReduceMotion.System);

let chatSoundsPreloadAttempted = false;
async function safelyPreloadChatSounds() {
  if (chatSoundsPreloadAttempted) return;
  chatSoundsPreloadAttempted = true;
  try {
    await Promise.race([
      Promise.all([preload(CHAT_SENT_SOUND), preload(CHAT_RECEIVE_SOUND)]),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    // createAudioPlayer will handle on demand loading
  }
}

type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  mediaUrl?: string | null;
  mediaType?: ChatMediaType | null;
  mediaDuration?: number | null;
  mediaName?: string | null;
  timestamp?: string | null;
  readBy?: string[] | null;
  deliveredTo?: string[] | null;
  reactions?: Record<string, MessageReaction> | null;
  replyToId?: string | null;
  editedAt?: string | null;
  clientKey?: string;
  clientStatus?: "sending";
  showDate?: boolean;
};

type PendingMediaAttachment = {
  uri: string;
  mediaType: ChatMediaType;
  fileName: string;
  mimeType?: string | null;
  durationSeconds?: number | null;
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

const APP_LOGO = require("../../../assets/Icon/IconTraparent.png");
const MESSAGE_LIMIT = 200;
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const MESSAGE_COLUMNS = "id, conversationId, senderId, text, timestamp, readBy";
const MESSAGE_COLUMNS_WITH_DELIVERY = `${MESSAGE_COLUMNS}, deliveredTo`;
const MESSAGE_COLUMNS_WITH_ACTIONS = `${MESSAGE_COLUMNS_WITH_DELIVERY}, reactions, replyToId, editedAt`;
const MESSAGE_COLUMNS_WITH_MEDIA = `${MESSAGE_COLUMNS_WITH_ACTIONS}, mediaUrl, mediaType, mediaDuration, mediaName`;
const MESSAGE_REACTIONS: { key: MessageReaction; emoji: string; label: string }[] = [
  { key: "heart", emoji: "\uD83D\uDC97", label: "Love" },
  { key: "laugh", emoji: "\uD83D\uDE06", label: "Haha" },
  { key: "question", emoji: "\uD83D\uDE2E", label: "Wow" },
  { key: "emphasis", emoji: "\uD83D\uDE22", label: "Sad" },
  { key: "dislike", emoji: "\uD83D\uDE21", label: "Angry" },
  { key: "like", emoji: "\uD83D\uDC4D", label: "Like" },
];
const QUICK_EMOJIS = [
  "😊", "🙏", "❤️", "👍", "🕊️", "🌹", "😢", "💐",
  "🤍", "✨", "🙌", "🤝", "🌿", "🕯️", "💬", "✅",
];
const QUICK_STICKERS = [
  { emoji: "👍", label: "Thumbs Up" },
  { emoji: "❤️", label: "Heart" },
  { emoji: "🙏", label: "Thank You" },
  { emoji: "🕊️", label: "Peace" },
  { emoji: "🌹", label: "Condolences" },
  { emoji: "🤝", label: "Agreed" },
  { emoji: "🕯️", label: "Remembrance" },
  { emoji: "✨", label: "Appreciated" },
];
const VOICE_WAVE_BARS = [0.35, 0.62, 0.48, 0.85, 0.55, 0.92, 0.42, 0.76, 0.64, 0.96, 0.5, 0.78, 0.44, 0.82, 0.58, 0.4];

function formatDuration(seconds?: number | null): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function getMessagePreviewLabel(message?: ChatMessage | null): string {
  if (!message) return "";
  if (message.text && message.text.trim()) return message.text.trim();
  if (message.mediaType === "image") return "📷 Photo";
  if (message.mediaType === "video") return "🎬 Video";
  if (message.mediaType === "audio") return "🎤 Voice message";
  if (message.mediaType === "file") return `📎 ${message.mediaName || "File"}`;
  return "";
}

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

function isMissingMediaColumnsSchema(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42703"
    && /(?:mediaUrl|mediaType|mediaDuration|mediaName)/i.test(error.message || "");
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

function mergeReceiptIds(
  left?: string[] | null,
  right?: string[] | null
) {
  return Array.from(new Set([...(left || []), ...(right || [])]));
}

const MobileVoiceMessagePlayer = memo(function MobileVoiceMessagePlayer({
  src,
  durationSeconds,
  mine,
}: {
  src: string;
  durationSeconds?: number | null;
  mine: boolean;
}) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(durationSeconds && durationSeconds > 0 ? durationSeconds : 0);

  useEffect(() => {
    let subscription: { remove?: () => void } | null = null;
    try {
      const player = createAudioPlayer(src, { updateInterval: 200 });
      playerRef.current = player;
      subscription = player.addListener("playbackStatusUpdate", (status) => {
        setPlaying(Boolean(status.playing));
        setCurrentTime(Number(status.currentTime) || 0);
        if (Number.isFinite(status.duration) && status.duration > 0) {
          setDuration(status.duration);
        }
        if (status.didJustFinish) {
          setPlaying(false);
          setCurrentTime(0);
          void player.seekTo(0).catch(() => {});
        }
      });
    } catch (error) {
      console.warn("Unable to initialize voice message player:", error);
    }
    return () => {
      try {
        subscription?.remove?.();
        playerRef.current?.pause();
        playerRef.current?.remove();
      } catch {
        // Ignore cleanup errors
      }
      playerRef.current = null;
    };
  }, [src]);

  const togglePlay = async () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      await ensureAppAudioReady();
      if (playing) {
        player.pause();
      } else {
        if (duration > 0 && currentTime >= duration - 0.15) {
          await player.seekTo(0).catch(() => {});
        }
        player.play();
      }
    } catch (error) {
      console.warn("Unable to play voice message:", error);
    }
  };

  const totalDuration = duration > 0 ? duration : (durationSeconds || 0);
  const progress = totalDuration > 0 ? Math.min(1, currentTime / totalDuration) : 0;
  const displayedTime = playing || currentTime > 0 ? currentTime : totalDuration;

  return (
    <View style={styles.voicePlayer}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause voice message" : "Play voice message"}
        onPress={() => void togglePlay()}
        style={[styles.voicePlayButton, mine ? styles.voicePlayButtonMine : styles.voicePlayButtonOther]}
      >
        <Ionicons
          name={playing ? "pause" : "play"}
          size={15}
          color={mine ? "#315f50" : "#ffffff"}
        />
      </TouchableOpacity>
      <View style={styles.voiceWaveform}>
        {VOICE_WAVE_BARS.map((barHeight, idx) => {
          const filled = idx / VOICE_WAVE_BARS.length <= progress;
          return (
            <View
              key={idx}
              style={[
                styles.voiceWaveBar,
                { height: Math.round(barHeight * 20) },
                mine
                  ? filled ? styles.voiceWaveBarMineFilled : styles.voiceWaveBarMine
                  : filled ? styles.voiceWaveBarOtherFilled : styles.voiceWaveBarOther,
              ]}
            />
          );
        })}
      </View>
      <Text style={[styles.voiceDurationText, mine ? styles.voiceDurationTextMine : null]}>
        {formatDuration(displayedTime)}
      </Text>
    </View>
  );
});

type ChatMessageRowProps = {
  item: ChatMessage;
  animate: boolean;
  onEntered: (id: string) => void;
  mine: boolean;
  showDate: boolean;
  replyPreview: ChatMessage | null;
  replyContextLabel: string;
  deliveryLabel: "Sending" | "Sent" | "Delivered" | null;
  showSeenAvatar: boolean;
  avatarSource: ImageSourcePropType;
  onLongPress: (message: ChatMessage, anchor: MessageActionAnchor) => void;
  onOpenImage: (url: string) => void;
};

const ChatMessageRow = memo(function ChatMessageRow({
  item,
  animate,
  onEntered,
  mine,
  showDate,
  replyPreview,
  replyContextLabel,
  deliveryLabel,
  showSeenAvatar,
  avatarSource,
  onLongPress,
  onOpenImage,
}: ChatMessageRowProps) {
  const bubbleRef = useRef<PressableInstance>(null);
  const animationKey = item.clientKey ?? item.id;
  useEffect(() => {
    if (animate) onEntered(animationKey);
  }, [animate, animationKey, onEntered]);
  const reactionCounts = MESSAGE_REACTIONS.map((reaction) => ({
    ...reaction,
    count: Object.values(item.reactions || {}).filter((value) => value === reaction.key).length,
  })).filter((reaction) => reaction.count > 0);

  const handleLongPress = (event: GestureResponderEvent) => {
    const labelLength = Math.max(item.text?.length || 0, item.mediaUrl ? 24 : 0);
    const fallbackWidth = Math.min(280, Math.max(92, labelLength * 7 + 28));
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
    <Reanimated.View entering={animate ? messageEntrance : undefined}>
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
                  {getMessagePreviewLabel(replyPreview) || "Message is no longer available"}
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
            {item.mediaUrl && item.mediaType === "image" ? (
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel="View full photo"
                onPress={() => onOpenImage(item.mediaUrl!)}
                onLongPress={handleLongPress}
                delayLongPress={350}
                style={styles.messageImageButton}
              >
                <Image
                  source={{ uri: item.mediaUrl }}
                  style={styles.messageMediaImage}
                  resizeMode="cover"
                />
              </Pressable>
            ) : null}
            {item.mediaUrl && item.mediaType === "video" ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Play video attachment"
                activeOpacity={0.85}
                onPress={() => void Linking.openURL(item.mediaUrl!).catch(() => {
                  Alert.alert("Unable to open video", "This video could not be opened on your device.");
                })}
                onLongPress={handleLongPress}
                delayLongPress={350}
                style={[styles.messageVideoCard, mine ? styles.messageVideoCardMine : styles.messageVideoCardOther]}
              >
                <View style={styles.messageVideoPlayBadge}>
                  <Ionicons name="play" size={18} color="#ffffff" />
                </View>
                <View style={styles.messageVideoCopy}>
                  <Text numberOfLines={1} style={[styles.messageVideoTitle, mine ? styles.messageTextMine : null]}>
                    {item.mediaName || "Video clip"}
                  </Text>
                  <Text style={[styles.messageVideoSub, mine ? styles.messageMetaMine : null]}>
                    {item.mediaDuration ? `${formatDuration(item.mediaDuration)} · Tap to play` : "Tap to play video"}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null}
            {item.mediaUrl && item.mediaType === "audio" ? (
              <MobileVoiceMessagePlayer
                src={item.mediaUrl}
                durationSeconds={item.mediaDuration}
                mine={mine}
              />
            ) : null}
            {item.mediaUrl && item.mediaType === "file" ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open file attachment"
                onPress={() => void Linking.openURL(item.mediaUrl!).catch(() => {})}
                onLongPress={handleLongPress}
                delayLongPress={350}
                style={[styles.messageFileCard, mine ? styles.messageVideoCardMine : styles.messageVideoCardOther]}
              >
                <Ionicons name="document-text-outline" size={18} color={mine ? "#ffffff" : "#315f50"} />
                <Text numberOfLines={1} style={[styles.messageFileTitle, mine ? styles.messageTextMine : null]}>
                  {item.mediaName || "Attachment"}
                </Text>
              </TouchableOpacity>
            ) : null}
            {item.text ? (
              <Text style={[styles.messageText, mine ? styles.messageTextMine : null]}>{item.text}</Text>
            ) : null}
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
    </Reanimated.View>
  );
});

export default function ChatScreen({ route, navigation }: any) {
  const {
    conversationId: initialConversationId,
    otherUserId,
    otherUserName,
    shopId: initialShopId,
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
  const loadedConversationRef = useRef<string | null>(null);
  const messageEntrancesRef = useRef(new Map<string, number>());
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
  const mediaColumnsAvailableRef = useRef<boolean | null>(null);
  const composerInputRef = useRef<TextInputInstance>(null);
  const messageBackdropUriRef = useRef<string | null>(null);
  const messageBackdropCaptureRef = useRef(0);
  const messageActionAnimationRef = useRef(new Animated.Value(0));
  const messageActionClosingRef = useRef(false);
  const messageActionAfterCloseRef = useRef<(() => void) | null>(null);
  const editPreviousDraftRef = useRef("");
  const sentSoundRef = useRef<AudioPlayer | null>(null);
  const receiveSoundRef = useRef<AudioPlayer | null>(null);
  const voiceRecorderRef = useRef<AudioRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartMsRef = useRef<number>(0);

  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [conversationShopId, setConversationShopId] = useState<string | null>(initialShopId || null);
  const [conversationReady, setConversationReady] = useState(false);
  const [readyForUserId, setReadyForUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [pendingMedia, setPendingMedia] = useState<PendingMediaAttachment | null>(null);
  const [emojiTrayOpen, setEmojiTrayOpen] = useState(false);
  const [stickerTrayOpen, setStickerTrayOpen] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);
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

  const stopRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const cleanupVoiceRecorder = useCallback(async () => {
    stopRecordingTimer();
    const activeRecorder = voiceRecorderRef.current;
    voiceRecorderRef.current = null;
    if (activeRecorder) {
      try {
        if (activeRecorder.isRecording) {
          await activeRecorder.stop();
        }
      } catch {
        // Ignore recorder stop errors
      }
    }
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {
      // Ignore audio mode reset errors
    }
    setIsRecordingVoice(false);
    setRecordingSeconds(0);
  }, [stopRecordingTimer]);

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
    void cleanupVoiceRecorder();
    if (composerFocusTimeoutRef.current) clearTimeout(composerFocusTimeoutRef.current);
    messageActionAnimationRef.current.stopAnimation();
    messageActionAfterCloseRef.current = null;
    messageBackdropCaptureRef.current += 1;
    if (messageBackdropUriRef.current) {
      releaseCapture(messageBackdropUriRef.current);
      messageBackdropUriRef.current = null;
    }
  }, [cancelPendingScroll, cleanupVoiceRecorder]);

  // Create local chat sound players once and unload them on unmount.
  useEffect(() => {
    let cancelled = false;
    const prepareSounds = async () => {
      try {
        void safelyPreloadChatSounds();
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

  const markMessageEntrance = useCallback((id: string) => {
    const now = Date.now();
    for (const [messageId, expiresAt] of messageEntrancesRef.current) {
      if (expiresAt <= now) messageEntrancesRef.current.delete(messageId);
    }
    messageEntrancesRef.current.set(id, now + 2000);
  }, []);

  const consumeMessageEntrance = useCallback((id: string) => {
    messageEntrancesRef.current.delete(id);
  }, []);

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
      const partnerIsReceivingShop = conversationShopId === otherUserId || Boolean(shopData?.shopName);
      setProfile({
        name: String(partnerIsReceivingShop
          ? shopData?.shopName || userData?.fullName || userData?.email || otherUserName || "Funeral Shop"
          : userData?.fullName || userData?.email || otherUserName || "Customer"),
        shopName: partnerIsReceivingShop ? shopData?.shopName || null : null,
        photoUrl: partnerIsReceivingShop
          ? shopData?.shopImageUrl || userData?.photoURL || null
          : userData?.photoURL || null,
        gender: (userData?.gender as "female" | "male" | "other") || "other",
        role: "user",
        phone: shopData?.shopPhoneNumber || null,
        isShop: partnerIsReceivingShop,
      });
    };
    void loadProfile();
    return () => {
      active = false;
    };
  }, [conversationShopId, otherUserId, otherUserName]);

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
    setConversationShopId(initialShopId || null);
    setMessages([]);
    setInputText("");
    setPendingMedia(null);
    setEmojiTrayOpen(false);
    setStickerTrayOpen(false);
    void cleanupVoiceRecorder();
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
    mediaColumnsAvailableRef.current = null;
    messageActionsAvailableRef.current = null;
    deliveryReceiptsAvailableRef.current = null;
    setLoadError(null);
    setLoading(true);
    loadedConversationRef.current = null;
    messageEntrancesRef.current.clear();
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
        const id = await ensureConversationForUsers(null, userId, otherUserId, initialConversationId, initialShopId || null);
        const { data: conversation, error: conversationError } = await supabase
          .from("conversations")
          .select("shopId")
          .eq("id", id)
          .maybeSingle();
        if (conversationError) throw conversationError;
        if (!active) return;
        setConversationId(id);
        setConversationShopId(conversation?.shopId || initialShopId || null);
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
  }, [cleanupVoiceRecorder, initialConversationId, initialShopId, otherUserId, userId]);

  const loadMessages = useCallback(async (showLoader = false) => {
    if (!conversationId || !conversationReady) return;
    const generation = ++loadGenerationRef.current;
    if (showLoader) {
      setLoading(true);
      setLoadError(null);
    }
    const fetchMessages = (columns: string) => supabase
      .from("chat_messages")
      .select(columns)
      .eq("conversationId", conversationId)
      .order("timestamp", { ascending: false })
      .limit(MESSAGE_LIMIT);
    const requestedMedia = mediaColumnsAvailableRef.current !== false;
    const requestedActions = messageActionsAvailableRef.current !== false;
    let { data, error } = await fetchMessages(requestedMedia && requestedActions
      ? MESSAGE_COLUMNS_WITH_MEDIA
      : requestedActions
        ? MESSAGE_COLUMNS_WITH_ACTIONS
        : deliveryReceiptsAvailableRef.current === false
          ? MESSAGE_COLUMNS
          : MESSAGE_COLUMNS_WITH_DELIVERY
    );
    if (error && requestedMedia && isMissingMediaColumnsSchema(error)) {
      mediaColumnsAvailableRef.current = false;
      ({ data, error } = await fetchMessages(
        requestedActions
          ? MESSAGE_COLUMNS_WITH_ACTIONS
          : deliveryReceiptsAvailableRef.current === false
            ? MESSAGE_COLUMNS
            : MESSAGE_COLUMNS_WITH_DELIVERY
      ));
    } else if (!error && requestedMedia && requestedActions) {
      mediaColumnsAvailableRef.current = true;
    }
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
      if (showLoader || loadedConversationRef.current !== conversationId) {
        setLoadError(error.message || "Messages could not be loaded.");
      }
    } else {
      loadedConversationRef.current = conversationId;
      setLoadError(null);
      const latestMessages = prepareMessages((data || []) as unknown as ChatMessage[]);
      setMessages((current) => {
        const currentById = new Map(current.map((message) => [message.id, message]));
        const pendingMessages = current.filter((message) =>
          message.conversationId === conversationId && message.clientStatus === "sending"
        );
        // The insert response links the new server ID to the pending bubble.
        // Realtime snapshots can arrive first, so defer unseen outgoing rows until then.
        const visibleMessages = pendingMessages.length > 0
          ? latestMessages.filter((message) => message.senderId !== userId || currentById.has(message.id))
          : latestMessages;
        const mergedLoaded = visibleMessages.map((message) => {
          const newerReceipt = currentById.get(message.id);
          if (!newerReceipt) return message;
          return {
            ...message,
            clientKey: newerReceipt.clientKey,
            readBy: mergeReceiptIds(message.readBy, newerReceipt.readBy),
            deliveredTo: mergeReceiptIds(message.deliveredTo, newerReceipt.deliveredTo),
            mediaUrl: message.mediaUrl ?? newerReceipt.mediaUrl,
            mediaType: message.mediaType ?? newerReceipt.mediaType,
            mediaDuration: message.mediaDuration ?? newerReceipt.mediaDuration,
            mediaName: message.mediaName ?? newerReceipt.mediaName,
          };
        });
        return prepareMessages([...mergedLoaded, ...pendingMessages]);
      });
      if (isNearBottomRef.current && latestMessages.some((message) =>
        message.senderId !== userId && messageEntrancesRef.current.has(message.id)
      )) queueScrollToBottom();
    }
    setLoading(false);
  }, [conversationId, conversationReady, queueScrollToBottom, userId]);

  useEffect(() => {
    if (!chatIsActive || !conversationId || !conversationReady) return undefined;
    let closed = false;
    let connected = false;
    let refreshing = false;
    let refreshRequested = false;

    const refresh = async () => {
      if (closed) return;
      refreshRequested = true;
      if (refreshing) return;
      refreshing = true;
      try {
        do {
          refreshRequested = false;
          await loadMessages(loadedConversationRef.current !== conversationId);
        } while (refreshRequested && !closed);
      } finally {
        refreshing = false;
      }
    };

    void refresh();
    const channel = supabase
      .channel(`mobile-chat-${conversationId}-${Date.now()}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "messages",
        filter: `conversationId=eq.${conversationId}`,
        select: ["id", "conversationId", "senderId"],
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
        if (eventType === "INSERT" && nextMessage.senderId !== userId) {
          if (isNearBottomRef.current) markMessageEntrance(nextMessage.id);
          void playReceiveSound();
        }
        // Realtime observes the protected base table, whose text is ciphertext.
        // Refetch through the RLS-protected decrypted view before rendering it.
        void refresh();
      })
      .subscribe((status) => {
        connected = status === "SUBSCRIBED";
        if (connected) void refresh();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`Chat realtime subscription ${status.toLowerCase()}.`);
        }
      });
    const fallback = setInterval(() => { if (!connected) void refresh(); }, 5000);
    return () => {
      closed = true;
      clearInterval(fallback);
      loadGenerationRef.current += 1;
      void supabase.removeChannel(channel);
    };
  }, [chatIsActive, conversationId, conversationReady, loadMessages, markMessageEntrance, playReceiveSound, userId]);

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

  const dispatchChatPayload = useCallback(async (params: {
    rawText: string;
    mediaAttachment?: PendingMediaAttachment | null;
    clearDraftOnSend?: boolean;
  }) => {
    const conversationSession = conversationSessionRef.current;
    const replyTarget = replyingTo;
    const text = sanitizeMultilinePlainText(params.rawText, 1500);
    const attachment = params.mediaAttachment || null;
    if ((!text && !attachment) || sendingRef.current) return;
    if (!userId || !otherUserId || !conversationId || !conversationReady || readyForUserId !== otherUserId) {
      Alert.alert("Chat unavailable", "The conversation is not ready yet.");
      return;
    }
    if (blockState.blockedEitherWay) {
      Alert.alert("Messaging unavailable", blockState.blockedByMe ? "Unblock this account before sending a message." : "You cannot message this account right now.");
      return;
    }
    const optimisticId = `local-${generateId()}`;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      conversationId,
      senderId: userId,
      text,
      mediaUrl: attachment?.uri || null,
      mediaType: attachment?.mediaType || null,
      mediaDuration: attachment?.durationSeconds ?? null,
      mediaName: attachment?.fileName || null,
      timestamp: new Date().toISOString(),
      readBy: [userId],
      deliveredTo: [],
      replyToId: replyTarget?.id || null,
      clientStatus: "sending",
    };

    sendingRef.current = true;
    setSending(true);
    setEmojiTrayOpen(false);
    setStickerTrayOpen(false);
    markMessageEntrance(optimisticId);
    setMessages((current) => prepareMessages([...current, optimisticMessage]));
    if (params.clearDraftOnSend) {
      setInputText("");
      setPendingMedia(null);
    }
    setReplyingTo(null);
    queueScrollToBottom();

    try {
      const latestBlockState = await getBlockStateBetweenUsers(userId, otherUserId);
      if (conversationSession !== conversationSessionRef.current) return;
      setBlockState(latestBlockState);
      setBlockStateError(null);
      if (latestBlockState.blockedEitherWay) {
        throw new Error(latestBlockState.blockedByMe
          ? "Unblock this account before sending a message."
          : "You cannot message this account right now.");
      }

      await consumeRateLimit(supabase as any, userId, "chat_message", conversationId);

      let uploadedMediaUrl: string | null = null;
      let uploadedMediaType: ChatMediaType | null = null;
      let uploadedMediaName: string | null = null;
      let uploadedMediaDuration: number | null = null;

      if (attachment) {
        const uploaded = await uploadChatMedia(attachment.uri, {
          mediaType: attachment.mediaType,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType ?? undefined,
          durationSeconds: attachment.durationSeconds,
        });
        uploadedMediaUrl = uploaded.mediaUrl;
        uploadedMediaType = uploaded.mediaType;
        uploadedMediaName = uploaded.mediaName;
        uploadedMediaDuration = uploaded.mediaDuration ?? null;
      }

      const selectColumns = mediaColumnsAvailableRef.current !== false && messageActionsAvailableRef.current === true
        ? MESSAGE_COLUMNS_WITH_MEDIA
        : messageActionsAvailableRef.current === true
          ? MESSAGE_COLUMNS_WITH_ACTIONS
          : deliveryReceiptsAvailableRef.current === true
            ? MESSAGE_COLUMNS_WITH_DELIVERY
            : MESSAGE_COLUMNS;

      const baseMessage = {
        conversationId,
        senderId: userId,
        text,
        readBy: [userId],
        ...(replyTarget ? { replyToId: replyTarget.id } : {}),
      };
      const messageWithMedia = uploadedMediaUrl
        ? {
            ...baseMessage,
            mediaUrl: uploadedMediaUrl,
            mediaType: uploadedMediaType,
            mediaDuration: uploadedMediaDuration,
            mediaName: uploadedMediaName,
          }
        : baseMessage;

      let insertResult = await supabase
        .from("messages")
        .insert(messageWithMedia)
        .select(selectColumns)
        .single();

      if (insertResult.error && uploadedMediaUrl && isMissingMediaColumnsSchema(insertResult.error)) {
        mediaColumnsAvailableRef.current = false;
        const fallbackText = text ? `${text}\n${uploadedMediaUrl}` : uploadedMediaUrl;
        insertResult = await supabase
          .from("messages")
          .insert({
            ...baseMessage,
            text: fallbackText,
          })
          .select(
            messageActionsAvailableRef.current === true
              ? MESSAGE_COLUMNS_WITH_ACTIONS
              : deliveryReceiptsAvailableRef.current === true
                ? MESSAGE_COLUMNS_WITH_DELIVERY
                : MESSAGE_COLUMNS
          )
          .single();
      }
      if (insertResult.error) throw insertResult.error;

      const sentMessage: ChatMessage = {
        ...(insertResult.data as unknown as ChatMessage),
        clientKey: optimisticId,
        text,
        mediaUrl: uploadedMediaUrl,
        mediaType: uploadedMediaType,
        mediaDuration: uploadedMediaDuration,
        mediaName: uploadedMediaName,
      };
      const stillViewingConversation = conversationSession === conversationSessionRef.current;
      if (stillViewingConversation) {
        void playSentSound();
        setMessages((current) => prepareMessages([
          ...current.filter((item) => item.id !== optimisticId && item.id !== sentMessage.id),
          sentMessage,
        ]));
        // Invalidate any snapshot started before the server confirmed this row.
        void loadMessages();
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
        const previewText = text
          || (uploadedMediaType === "image"
            ? "Sent a photo"
            : uploadedMediaType === "video"
              ? "Sent a video"
              : uploadedMediaType === "audio"
                ? "Sent a voice message"
                : uploadedMediaType === "file"
                  ? "Sent a file"
                  : "New message");
        const { error: previewError } = await supabase.from("conversations").update({
          lastMessage: { id: sentMessage.id, text: previewText, senderId: userId, timestamp: previewTimestamp, readBy: [userId] },
          hiddenFor,
          updatedAt: previewTimestamp,
        }).eq("id", conversationId).lte("updatedAt", previewTimestamp);
        if (previewError) console.warn("Message sent but conversation preview was not updated:", previewError.message);
      }
    } catch (error: any) {
      if (conversationSession !== conversationSessionRef.current) return;
      consumeMessageEntrance(optimisticId);
      setMessages((current) => prepareMessages(
        current.filter((message) => message.id !== optimisticId)
      ));
      void loadMessages();
      if (params.clearDraftOnSend) {
        setInputText((current) => current || params.rawText);
        if (attachment) setPendingMedia((current) => current || attachment);
      }
      setReplyingTo((current) => current || replyTarget);
      if (isRateLimitError(error)) {
        Alert.alert("Slow down", `Try again in ${error.retryAfterSeconds} seconds.`);
      } else {
        Alert.alert("Message not sent", error?.message || "Please try again.");
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [blockState, consumeMessageEntrance, conversationId, conversationReady, loadMessages, markMessageEntrance, otherUserId, playSentSound, queueScrollToBottom, readyForUserId, replyingTo, userId]);

  const sendMessage = useCallback(async () => {
    if (editingMessage) {
      await saveEditedMessage();
      return;
    }
    await dispatchChatPayload({
      rawText: inputText,
      mediaAttachment: pendingMedia,
      clearDraftOnSend: true,
    });
  }, [dispatchChatPayload, editingMessage, inputText, pendingMedia, saveEditedMessage]);

  const sendQuickText = useCallback(async (quickText: string) => {
    if (editingMessage) return;
    await dispatchChatPayload({
      rawText: quickText,
      mediaAttachment: null,
      clearDraftOnSend: false,
    });
  }, [dispatchChatPayload, editingMessage]);

  const pickPhotoOrVideo = useCallback(async () => {
    if (sendingRef.current || editingMessage) return;
    setEmojiTrayOpen(false);
    setStickerTrayOpen(false);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Photo access required", "Allow photo and video library access in your settings to share media.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsEditing: false,
        quality: 0.82,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      const isVideo = asset.type === "video" || Boolean(asset.mimeType?.startsWith("video/"));
      const ext = isVideo ? "mp4" : "jpg";
      setPendingMedia({
        uri: asset.uri,
        mediaType: isVideo ? "video" : "image",
        fileName: asset.fileName || `${isVideo ? "video" : "photo"}-${Date.now()}.${ext}`,
        mimeType: asset.mimeType || (isVideo ? "video/mp4" : "image/jpeg"),
        durationSeconds: asset.duration ? Math.max(1, Math.round(asset.duration / 1000)) : null,
      });
    } catch (error: any) {
      Alert.alert("Media selection failed", error?.message || "Unable to open your photo library.");
    }
  }, [editingMessage]);

  const startVoiceRecording = useCallback(async () => {
    if (sendingRef.current || isRecordingVoice || editingMessage) return;
    setEmojiTrayOpen(false);
    setStickerTrayOpen(false);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Microphone permission required",
          "Allow microphone access in your device settings to record voice messages."
        );
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
      await recorder.prepareToRecordAsync();
      recorder.record();
      voiceRecorderRef.current = recorder;
      recordingStartMsRef.current = Date.now();
      setRecordingSeconds(0);
      setIsRecordingVoice(true);
      stopRecordingTimer();
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartMsRef.current) / 1000);
        setRecordingSeconds(elapsed);
      }, 250);
    } catch (error: any) {
      await cleanupVoiceRecorder();
      Alert.alert("Voice recording unavailable", error?.message || "Unable to start microphone recording.");
    }
  }, [cleanupVoiceRecorder, editingMessage, isRecordingVoice, stopRecordingTimer]);

  const cancelVoiceRecording = useCallback(async () => {
    await cleanupVoiceRecorder();
  }, [cleanupVoiceRecorder]);

  const finishAndSendVoiceRecording = useCallback(async () => {
    stopRecordingTimer();
    const activeRecorder = voiceRecorderRef.current;
    voiceRecorderRef.current = null;
    const durationSec = Math.max(1, Math.round((Date.now() - recordingStartMsRef.current) / 1000));
    setIsRecordingVoice(false);
    setRecordingSeconds(0);
    if (!activeRecorder) return;
    try {
      if (activeRecorder.isRecording) {
        await activeRecorder.stop();
      }
      const recordedUri = activeRecorder.uri;
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => {});
      if (!recordedUri) return;
      await dispatchChatPayload({
        rawText: "",
        mediaAttachment: {
          uri: recordedUri,
          mediaType: "audio",
          fileName: `voice-${Date.now()}.m4a`,
          mimeType: "audio/mp4",
          durationSeconds: durationSec,
        },
        clearDraftOnSend: false,
      });
    } catch (error: any) {
      Alert.alert("Voice message failed", error?.message || "Unable to send voice recording.");
    }
  }, [dispatchChatPayload, stopRecordingTimer]);

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
        animate={(messageEntrancesRef.current.get(item.clientKey ?? item.id) ?? 0) > Date.now()}
        onEntered={consumeMessageEntrance}
        mine={mine}
        showDate={!!item.showDate}
        replyPreview={replyPreview}
        replyContextLabel={replyContextLabel}
        deliveryLabel={deliveryLabel}
        showSeenAvatar={showSeenAvatar}
        avatarSource={messageAvatarSource}
        onLongPress={openMessageActions}
        onOpenImage={setViewerImageUrl}
      />
    );
  }, [consumeMessageEntrance, latestOutgoingMessageId, latestSeenOutgoingMessageId, messageAvatarSource, messageById, openMessageActions, otherUserId, profile.name, userId]);

  const inputDisabled = blockState.blockedEitherWay || !conversationReady || readyForUserId !== otherUserId;
  const hasSendableDraft = Boolean(editingMessage || inputText.trim() || pendingMedia);
  const sendDisabled = inputDisabled || sending || messageActionBusy || (editingMessage ? !inputText.trim() : !hasSendableDraft);
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
  const actionRowCount = selectedMessage?.clientStatus === "sending" ? 1 : selectedMessageMine ? (selectedMessage?.text ? 4 : 3) : 2;
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
            <ContentSkeleton label="Loading messages" style={styles.messageList}>
              <View style={[styles.messageContent, styles.messagePlaceholders]}>
                <View style={styles.messageRow}>
                  <SkeletonBlock style={[styles.messageAvatar, styles.placeholderAvatar]} />
                  <SkeletonBlock style={styles.placeholderIncoming} />
                </View>
                <View style={[styles.messageRow, styles.messageRowMine]}>
                  <SkeletonBlock style={styles.placeholderOutgoing} />
                </View>
                <View style={styles.messageRow}>
                  <SkeletonBlock style={[styles.messageAvatar, styles.placeholderAvatar]} />
                  <SkeletonBlock style={[styles.placeholderIncoming, { width: "37%" }]} />
                </View>
              </View>
              <View style={[styles.composerSafeArea, styles.composerRow]}>
                {[0, 1, 2].map(index => <SkeletonBlock key={index} style={styles.placeholderComposerIcon} />)}
                <SkeletonBlock style={styles.placeholderComposerField} />
                <SkeletonBlock style={styles.placeholderComposerIcon} />
              </View>
            </ContentSkeleton>
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
            <Reanimated.View entering={contentFade} style={styles.messageList}>
              <FlatList
                ref={listRef}
                data={listMessages}
                renderItem={renderMessage}
                keyExtractor={(item) => item.clientKey ?? item.id}
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
            </Reanimated.View>
          )}

          {!loading && !loadError ? (
            <View style={styles.composerSafeArea}>
              {replyingTo || editingMessage ? (
                <View style={styles.composerContext}>
                  <View style={styles.composerContextIcon}>
                    <Ionicons name={editingMessage ? "create-outline" : "arrow-undo-outline"} size={16} color="#3d6656" />
                  </View>
                  <View style={styles.composerContextCopy}>
                    <Text style={styles.composerContextTitle}>
                      {editingMessage
                        ? "Editing message"
                        : `Replying to ${replyingTo?.senderId === userId ? "yourself" : profile.name}`}
                    </Text>
                    <Text numberOfLines={1} style={styles.composerContextText}>
                      {getMessagePreviewLabel(editingMessage || replyingTo)}
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

              {pendingMedia ? (
                <View style={styles.pendingMediaBar}>
                  <View style={styles.pendingMediaThumbWrap}>
                    {pendingMedia.mediaType === "image" ? (
                      <Image source={{ uri: pendingMedia.uri }} style={styles.pendingMediaThumb} resizeMode="cover" />
                    ) : (
                      <View style={styles.pendingMediaVideoIcon}>
                        <Ionicons name="videocam" size={18} color="#315f50" />
                      </View>
                    )}
                  </View>
                  <View style={styles.pendingMediaMeta}>
                    <Text style={styles.pendingMediaTitle}>
                      {pendingMedia.mediaType === "image" ? "Photo ready to send" : "Video ready to send"}
                    </Text>
                    <Text numberOfLines={1} style={styles.pendingMediaSubtitle}>
                      {pendingMedia.fileName}
                    </Text>
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Remove attachment"
                    disabled={sending}
                    onPress={() => setPendingMedia(null)}
                    style={styles.pendingMediaRemoveBtn}
                  >
                    <Ionicons name="close" size={16} color="#475569" />
                  </TouchableOpacity>
                </View>
              ) : null}

              {emojiTrayOpen ? (
                <View style={styles.pickerTray}>
                  <View style={styles.emojiGrid}>
                    {QUICK_EMOJIS.map((emoji) => (
                      <TouchableOpacity
                        key={emoji}
                        accessibilityRole="button"
                        accessibilityLabel={`Insert ${emoji}`}
                        onPress={() => setInputText((prev) => prev + emoji)}
                        style={styles.emojiCell}
                      >
                        <Text style={styles.emojiCellText}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}

              {stickerTrayOpen ? (
                <View style={styles.pickerTray}>
                  <View style={styles.stickerGrid}>
                    {QUICK_STICKERS.map((sticker) => (
                      <TouchableOpacity
                        key={sticker.label}
                        accessibilityRole="button"
                        accessibilityLabel={`Send ${sticker.label} sticker`}
                        onPress={() => void sendQuickText(sticker.emoji)}
                        style={styles.stickerCell}
                      >
                        <Text style={styles.stickerEmoji}>{sticker.emoji}</Text>
                        <Text style={styles.stickerLabel}>{sticker.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}

              {isRecordingVoice ? (
                <View style={styles.composerRow}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Cancel voice recording"
                    onPress={() => void cancelVoiceRecording()}
                    style={[styles.composerIconBtn, styles.recordingCancelBtn]}
                  >
                    <Ionicons name="trash-outline" size={20} color="#dc2626" />
                  </TouchableOpacity>
                  <View style={styles.recordingPill}>
                    <View style={styles.recordingDot} />
                    <Text style={styles.recordingTimeText}>{formatDuration(recordingSeconds)}</Text>
                    <View style={styles.recordingWaveRow}>
                      {VOICE_WAVE_BARS.slice(0, 10).map((h, i) => (
                        <View
                          key={i}
                          style={[
                            styles.recordingWaveBar,
                            { height: Math.max(5, Math.round(h * 16)) },
                          ]}
                        />
                      ))}
                    </View>
                    <Text numberOfLines={1} style={styles.recordingLabelText}>Recording voice...</Text>
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Send voice message"
                    onPress={() => void finishAndSendVoiceRecording()}
                    style={styles.composerIconBtn}
                  >
                    <Ionicons name="send" size={21} color="#315f50" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.composerRow}>
                  {!editingMessage ? (
                    <>
                      {/* 1. Microphone (Voice Over) */}
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Record voice message"
                        disabled={inputDisabled || sending}
                        onPress={() => void startVoiceRecording()}
                        style={[styles.composerIconBtn, (inputDisabled || sending) && styles.composerIconBtnDisabled]}
                      >
                        <Ionicons name="mic" size={22} color="#315f50" />
                      </TouchableOpacity>

                      {/* 2. Picture / Video Gallery */}
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Send photo or video"
                        disabled={inputDisabled || sending}
                        onPress={() => void pickPhotoOrVideo()}
                        style={[styles.composerIconBtn, (inputDisabled || sending) && styles.composerIconBtnDisabled]}
                      >
                        <Ionicons name="image" size={22} color="#315f50" />
                      </TouchableOpacity>

                      {/* 3. Sticker Button (Folded-corner smiley icon style, without GIF) */}
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Stickers"
                        disabled={inputDisabled || sending}
                        onPress={() => {
                          setStickerTrayOpen((prev) => !prev);
                          setEmojiTrayOpen(false);
                        }}
                        style={[
                          styles.composerIconBtn,
                          stickerTrayOpen && styles.composerIconBtnActive,
                          (inputDisabled || sending) && styles.composerIconBtnDisabled,
                        ]}
                      >
                        <View style={styles.stickerIconSquare}>
                          <Ionicons name="happy" size={16} color="#ffffff" />
                          <View style={styles.stickerIconFold} />
                        </View>
                      </TouchableOpacity>
                    </>
                  ) : null}

                  {/* 4. Rounded Pill Input ("Aa" + Emoji button inside right edge) */}
                  <View style={styles.inputPill}>
                    <TextInput
                      ref={composerInputRef}
                      value={inputText}
                      onChangeText={setInputText}
                      accessibilityLabel="Message"
                      placeholder={blockState.blockedEitherWay ? "Unavailable" : editingMessage ? "Edit message..." : "Aa"}
                      placeholderTextColor="#8a948f"
                      style={styles.input}
                      multiline
                      maxLength={1500}
                      editable={!inputDisabled}
                      textAlignVertical="center"
                    />
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Choose emoji"
                      disabled={inputDisabled || sending}
                      onPress={() => {
                        setEmojiTrayOpen((prev) => !prev);
                        setStickerTrayOpen(false);
                      }}
                      style={[styles.pillEmojiBtn, emojiTrayOpen && styles.pillEmojiBtnActive]}
                    >
                      <Ionicons name="happy" size={22} color="#315f50" />
                    </TouchableOpacity>
                  </View>

                  {/* 5. Thumbs-Up (when empty) or Send Button (when text/attachment exists) */}
                  {hasSendableDraft ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={editingMessage ? "Save edited message" : "Send message"}
                      disabled={sendDisabled}
                      onPress={() => void sendMessage()}
                      style={[styles.composerIconBtn, sendDisabled && styles.composerIconBtnDisabled]}
                    >
                      {sending || (editingMessage && messageActionBusy) ? (
                        <ActivityIndicator size="small" color="#315f50" />
                      ) : (
                        <Ionicons name={editingMessage ? "checkmark-circle" : "send"} size={22} color="#315f50" />
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Send thumbs up"
                      disabled={inputDisabled || sending}
                      onPress={() => void sendQuickText("👍")}
                      style={[styles.composerIconBtn, (inputDisabled || sending) && styles.composerIconBtnDisabled]}
                    >
                      <Ionicons name="thumbs-up" size={22} color="#315f50" />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      {/* Fullscreen Image Lightbox Modal */}
      <Modal
        visible={!!viewerImageUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerImageUrl(null)}
      >
        <Pressable style={styles.imageViewerBackdrop} onPress={() => setViewerImageUrl(null)}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close photo preview"
            onPress={() => setViewerImageUrl(null)}
            style={[styles.imageViewerCloseBtn, { top: Math.max(insets.top + 12, 24) }]}
          >
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
          {viewerImageUrl ? (
            <Image
              source={{ uri: viewerImageUrl }}
              style={styles.imageViewerFull}
              resizeMode="contain"
            />
          ) : null}
        </Pressable>
      </Modal>

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
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
            {messageBackdropUri ? (
              <Image
                source={{ uri: messageBackdropUri }}
                resizeMode="cover"
                blurRadius={30}
                fadeDuration={0}
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <View style={styles.messageActionFallback} />
            )}
            <View style={styles.messageActionScrim} />
          </Animated.View>
          <Pressable
            accessibilityLabel="Close message actions"
            style={StyleSheet.absoluteFill}
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
                  <Text numberOfLines={1} style={styles.selectedReplyText}>{getMessagePreviewLabel(selectedReplyPreview)}</Text>
                ) : null}
              </View>
            ) : null}
            <Text numberOfLines={5} style={styles.selectedMessagePreviewText}>{getMessagePreviewLabel(selectedMessage)}</Text>
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
                  {selectedMessage?.text ? (
                    <TouchableOpacity accessibilityRole="button" style={styles.messageActionRow} onPress={startEdit}>
                      <Text style={styles.messageActionLabel}>Edit</Text>
                      <Ionicons name="create-outline" size={19} color="#f2f2f3" />
                    </TouchableOpacity>
                  ) : null}
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
  headerActionButton: { width: 36, height: 36, margin: 0, borderRadius: 18, backgroundColor: "transparent" },
  blockBanner: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#fff0f2", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#efc4ca", flexDirection: "row", alignItems: "center", gap: 8 },
  blockBannerText: { flex: 1, color: "#8f3440", fontSize: 12, fontWeight: "700" },
  messageList: { flex: 1, minHeight: 0 },
  messageContent: { flexGrow: 1, justifyContent: "flex-start", paddingHorizontal: 14, paddingTop: 20, paddingBottom: 10 },
  messagePlaceholders: { flex: 1, justifyContent: "flex-end", gap: 5, paddingBottom: 24 },
  placeholderAvatar: { width: 28, height: 28, borderRadius: 14 },
  placeholderIncoming: { width: "53%", height: 37, borderRadius: 18, borderBottomLeftRadius: 6 },
  placeholderOutgoing: { width: "42%", height: 37, borderRadius: 18, borderBottomRightRadius: 6, backgroundColor: "#d5e2da" },
  placeholderComposerIcon: { width: 21, height: 21, marginHorizontal: 7, borderRadius: 11 },
  placeholderComposerField: { width: undefined, flex: 1, height: 38, borderRadius: 19 },
  emptyMessageContent: { justifyContent: "center" },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
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
  messageImageButton: { marginBottom: 6, borderRadius: 12, overflow: "hidden" },
  messageMediaImage: { width: 210, height: 190, borderRadius: 12, backgroundColor: "#e2e8e5" },
  messageVideoCard: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 188, maxWidth: 230, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 12, marginBottom: 5 },
  messageVideoCardMine: { backgroundColor: "rgba(255,255,255,0.14)" },
  messageVideoCardOther: { backgroundColor: "#e3eae6" },
  messageVideoPlayBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#24473b", alignItems: "center", justifyContent: "center" },
  messageVideoCopy: { flex: 1, minWidth: 0 },
  messageVideoTitle: { color: "#283630", fontSize: 13, fontWeight: "700" },
  messageVideoSub: { color: "#6c7772", fontSize: 11, marginTop: 2 },
  messageFileCard: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 160, maxWidth: 220, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, marginBottom: 5 },
  messageFileTitle: { flex: 1, color: "#283630", fontSize: 12, fontWeight: "600" },
  voicePlayer: { flexDirection: "row", alignItems: "center", gap: 9, minWidth: 180, maxWidth: 226, paddingVertical: 3, marginBottom: 2 },
  voicePlayButton: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  voicePlayButtonMine: { backgroundColor: "#ffffff" },
  voicePlayButtonOther: { backgroundColor: "#315f50" },
  voiceWaveform: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2.5, height: 22 },
  voiceWaveBar: { flex: 1, minWidth: 2.5, borderRadius: 999 },
  voiceWaveBarMine: { backgroundColor: "rgba(255,255,255,0.34)" },
  voiceWaveBarMineFilled: { backgroundColor: "#ffffff" },
  voiceWaveBarOther: { backgroundColor: "rgba(49,95,80,0.28)" },
  voiceWaveBarOtherFilled: { backgroundColor: "#315f50" },
  voiceDurationText: { color: "#52605a", fontSize: 11, fontWeight: "600" },
  voiceDurationTextMine: { color: "rgba(255,255,255,0.9)" },
  replyContext: { maxWidth: "100%", marginBottom: 6 },
  replyContextMine: { alignItems: "flex-end" },
  replyContextOther: { alignItems: "flex-start" },
  replyContextHeader: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, marginBottom: 5 },
  replyContextLabel: { flexShrink: 1, color: "#6c7772", fontSize: 10, fontWeight: "700" },
  replyQuote: { maxWidth: "100%", minWidth: 132, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: "#e8ecea" },
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
  composerContext: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 4, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#dce2de", backgroundColor: "#f2f5f3" },
  composerContextIcon: { width: 28, height: 34, marginRight: 8, alignItems: "center", justifyContent: "center" },
  composerContextCopy: { flex: 1, minWidth: 0 },
  composerContextTitle: { color: "#2f5f4e", fontSize: 11, fontWeight: "900" },
  composerContextText: { color: "#6f7b76", fontSize: 11, marginTop: 2 },
  composerContextClose: { margin: 0 },
  pendingMediaBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#f6f9f7", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#dce4df" },
  pendingMediaThumbWrap: { width: 42, height: 42, borderRadius: 8, overflow: "hidden", backgroundColor: "#e3ece7", alignItems: "center", justifyContent: "center" },
  pendingMediaThumb: { width: 42, height: 42 },
  pendingMediaVideoIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  pendingMediaMeta: { flex: 1, minWidth: 0 },
  pendingMediaTitle: { color: "#1f2e28", fontSize: 12, fontWeight: "700" },
  pendingMediaSubtitle: { color: "#64748b", fontSize: 11, marginTop: 1 },
  pendingMediaRemoveBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#e2e9e5", alignItems: "center", justifyContent: "center" },
  pickerTray: { paddingHorizontal: 10, paddingVertical: 10, backgroundColor: "#ffffff", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5eae7" },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 6 },
  emojiCell: { width: "12.5%", height: 36, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  emojiCellText: { fontSize: 22 },
  stickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stickerCell: { width: "23%", paddingVertical: 8, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1, borderColor: "#e6ece9", backgroundColor: "#f9fbfa", alignItems: "center", justifyContent: "center" },
  stickerEmoji: { fontSize: 24 },
  stickerLabel: { color: "#475569", fontSize: 10, fontWeight: "600", marginTop: 2 },
  composerRow: { minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8, gap: 4 },
  composerIconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  composerIconBtnActive: { backgroundColor: "#e7f0ec" },
  composerIconBtnDisabled: { opacity: 0.42 },
  stickerIconSquare: { width: 22, height: 22, borderRadius: 6, backgroundColor: "#315f50", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" },
  stickerIconFold: { position: "absolute", right: 0, bottom: 0, width: 6, height: 6, backgroundColor: "#a7c4b9", borderTopLeftRadius: 3 },
  inputPill: { flex: 1, minHeight: 40, maxHeight: 110, flexDirection: "row", alignItems: "center", backgroundColor: "#f0f2f5", borderRadius: 20, paddingLeft: 14, paddingRight: 4 },
  input: { flex: 1, minHeight: 38, maxHeight: 106, color: "#283630", paddingTop: 8, paddingBottom: 8, paddingRight: 6, fontSize: 14 },
  pillEmojiBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  pillEmojiBtnActive: { backgroundColor: "rgba(49,95,80,0.12)" },
  recordingCancelBtn: { backgroundColor: "#fee2e2" },
  recordingPill: { flex: 1, height: 40, borderRadius: 20, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" },
  recordingTimeText: { color: "#b91c1c", fontSize: 12, fontWeight: "700" },
  recordingWaveRow: { flexDirection: "row", alignItems: "center", gap: 2, height: 18 },
  recordingWaveBar: { width: 2.5, borderRadius: 999, backgroundColor: "#ef4444" },
  recordingLabelText: { flex: 1, color: "#991b1b", fontSize: 12 },
  imageViewerBackdrop: { flex: 1, backgroundColor: "rgba(12,18,15,0.92)", alignItems: "center", justifyContent: "center", padding: 16 },
  imageViewerCloseBtn: { position: "absolute", right: 18, zIndex: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  imageViewerFull: { width: "100%", height: "82%" },
  messageActionOverlay: { flex: 1 },
  messageActionFallback: { ...StyleSheet.absoluteFill, backgroundColor: "#25262c" },
  messageActionScrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(8,9,16,0.48)" },
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
