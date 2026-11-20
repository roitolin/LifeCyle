import { useEffect, useRef, useState, type ComponentRef, type ReactElement } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, TextInput, View, type AccessibilityState } from "react-native";
import { Button, Text } from "react-native-paper";
import { getProfileImageSource } from "@/utils/defaultProfileImage";
import { MAX_FEEDBACK_LENGTH, type FeedbackReply } from "@/services/feedbackBoard";

const AVATAR_SIZE = 32;
const ROW_PADDING = 8;
const REPLY_GUTTER = 14;
const CHILD_INDENT = 24;
const ACTION_HEIGHT = 36;
const LINE_COLOR = "#7c9085";
const INK = "#22312d";
const MUTED = "#62706b";
const ACCENT = "#315f50";

export function feedbackAuthor(entry: { isAnonymous: boolean; displayName?: string | null }) {
  return entry.isAnonymous ? "Anonymous" : entry.displayName || "Member";
}

export function formatFeedbackTime(value: string) {
  if (!value) return "Just now";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function FeedbackAvatar({ photoURL, isAnonymous }: { photoURL?: string | null; isAnonymous: boolean }) {
  const uri = isAnonymous ? undefined : photoURL?.trim();
  const [failedUrl, setFailedUrl] = useState<string>();
  const source = getProfileImageSource(uri === failedUrl ? undefined : uri);
  return <Image
    accessible={false}
    importantForAccessibility="no"
    source={source}
    style={styles.avatar}
    onError={() => setFailedUrl(uri)}
  />;
}

export function AnonymousFeedbackOption({ checked, label, disabled, onPress }: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.checkbox, disabled && styles.disabled]}
    >
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={18} color={ACCENT} />
      <Text style={styles.checkboxLabel}>{label}</Text>
    </Pressable>
  );
}

export function FeedbackAction({ children, label, state, disabled, destructive, onPress }: {
  children: string;
  label?: string;
  state?: AccessibilityState;
  disabled?: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ ...state, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        pressed && styles.actionPressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionText, destructive && styles.dangerText]}>{children}</Text>
    </Pressable>
  );
}

type FeedbackThreadProps = {
  replies: FeedbackReply[];
  draft: string;
  anonymous: boolean;
  targetId: string | null;
  posting: boolean;
  busy: boolean;
  canModerate: boolean;
  onDraft: (draft: string) => void;
  onAnonymous: (anonymous: boolean) => void;
  onTarget: (targetId: string | null) => void;
  onSubmit: () => void;
  onLike: (reply: FeedbackReply) => void;
  onEdit: (reply: FeedbackReply) => void;
  onDelete: (reply: FeedbackReply) => void;
};

export default function FeedbackThread({
  replies, draft, anonymous, targetId, posting, busy, canModerate,
  onDraft, onAnonymous, onTarget, onSubmit, onLike, onEdit, onDelete,
}: FeedbackThreadProps) {
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  const focusOnTargetChange = useRef(false);
  const [focused, setFocused] = useState(false);
  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>({});
  const target = replies.find(reply => reply.id === targetId && !reply.parentReplyId);
  const missingTarget = Boolean(targetId && !target);
  const targetName = target ? (target.mine ? "your comment" : feedbackAuthor(target)) : null;

  useEffect(() => {
    if (focusOnTargetChange.current) {
      focusOnTargetChange.current = false;
      field.current?.focus();
    }
  }, [targetId]);

  const chooseTarget = (id: string | null) => {
    if (id === targetId) {
      field.current?.focus();
      return;
    }
    focusOnTargetChange.current = true;
    onTarget(id);
  };

  const rootIds = new Set(replies.filter(reply => !reply.parentReplyId).map(reply => reply.id));
  const roots: FeedbackReply[] = [];
  const children = new Map<string, FeedbackReply[]>();
  for (const reply of replies) {
    if (!reply.parentReplyId || !rootIds.has(reply.parentReplyId)) {
      roots.push(reply);
    } else {
      const siblings = children.get(reply.parentReplyId) ?? [];
      siblings.push(reply);
      children.set(reply.parentReplyId, siblings);
    }
  }

  const label = targetName ? `Reply to ${targetName}` : "Write a reply";
  const composer = (
    <View style={[styles.composer, focused && styles.composerFocused]}>
      {missingTarget && <Text accessibilityLiveRegion="polite" style={styles.meta}>This comment was removed.</Text>}
      <TextInput
        ref={field}
        accessible
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={MUTED}
        multiline
        maxLength={MAX_FEEDBACK_LENGTH}
        value={draft}
        onChangeText={onDraft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!posting}
        underlineColorAndroid="transparent"
        style={styles.input}
      />
      <View style={styles.composerActions}>
        <AnonymousFeedbackOption checked={anonymous} label="Reply anonymously" disabled={posting} onPress={() => onAnonymous(!anonymous)} />
        <View style={styles.actions}>
          {targetId && <FeedbackAction disabled={posting} onPress={() => chooseTarget(null)}>
            {target ? "Cancel" : "Reply to feedback"}
          </FeedbackAction>}
          <Button
            mode="contained"
            compact
            buttonColor={ACCENT}
            loading={posting}
            disabled={busy || missingTarget || !draft.trim()}
            onPress={() => {
              if (targetId) setOpenBranches(previous => ({ ...previous, [targetId]: true }));
              onSubmit();
            }}
          >{posting ? "Posting…" : "Post reply"}</Button>
        </View>
      </View>
    </View>
  );

  const renderReply = (reply: FeedbackReply, last: boolean, nested = false): ReactElement => {
    const name = feedbackAuthor(reply);
    const nestedReplies = children.get(reply.id);
    const branchOpen = Boolean(openBranches[reply.id]);
    const gutter = nested ? CHILD_INDENT - AVATAR_SIZE / 2 : REPLY_GUTTER;

    return (
      <View key={reply.id} style={styles.reply}>
        <View pointerEvents="none" style={[styles.rail, { start: -gutter }, last && styles.railEnd]} />
        <View pointerEvents="none" style={[styles.elbow, { start: -gutter, width: gutter - 2 }]} />
        <View style={styles.bylineRow}>
          {nestedReplies && <View pointerEvents="none" style={styles.parentRail} />}
          <FeedbackAvatar photoURL={reply.photoURL} isAnonymous={reply.isAnonymous} />
          <View style={styles.body}>
            <View style={styles.byline}>
              <Text style={styles.name}>{name}</Text>
              {reply.mine && <Text style={styles.role}>You</Text>}
              {reply.staff && !reply.isAnonymous && <Text style={styles.role}>Admin</Text>}
              <Text style={styles.meta}>{formatFeedbackTime(reply.createdAt)}</Text>
            </View>
            <Text style={styles.message}>{reply.text}</Text>
            <View style={styles.actions}>
              {!nested && !reply.parentReplyId && <FeedbackAction
                label={`Reply to ${reply.mine ? "your comment" : name}`}
                disabled={posting}
                onPress={() => chooseTarget(reply.id)}
              >Reply</FeedbackAction>}
              <FeedbackAction state={{ selected: Boolean(reply.liked) }} onPress={() => onLike(reply)}>
                {`${reply.liked ? "Unlike" : "Like"} (${reply.reactionCount})`}
              </FeedbackAction>
              {reply.mine && <FeedbackAction onPress={() => onEdit(reply)}>Edit</FeedbackAction>}
              {(reply.mine || canModerate) && <FeedbackAction destructive onPress={() => onDelete(reply)}>Delete</FeedbackAction>}
            </View>
            {target?.id === reply.id && composer}
          </View>
        </View>
        {nestedReplies && (
          <>
            <View style={styles.branchControl}>
              <View pointerEvents="none" style={[styles.branchElbow, branchOpen && styles.branchRail]} />
              <FeedbackAction
                state={{ expanded: branchOpen }}
                onPress={() => setOpenBranches(previous => ({ ...previous, [reply.id]: !previous[reply.id] }))}
              >
                {`${branchOpen ? "Hide" : "View"} ${nestedReplies.length} ${nestedReplies.length === 1 ? "reply" : "replies"}`}
              </FeedbackAction>
            </View>
            {branchOpen && <View style={styles.children}>
              {nestedReplies.map((child, index) => renderReply(child, index === nestedReplies.length - 1, true))}
            </View>}
          </>
        )}
      </View>
    );
  };

  return (
    <View style={styles.thread}>
      {roots.length > 0
        ? <View style={styles.roots}>{roots.map((reply, index) => renderReply(reply, index === roots.length - 1))}</View>
        : <Text style={styles.meta}>No replies yet.</Text>}
      {!target && composer}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: "#eef4f1" },
  checkbox: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: ACTION_HEIGHT },
  checkboxLabel: { color: INK, fontSize: 13 },
  disabled: { opacity: 0.55 },
  action: { minHeight: ACTION_HEIGHT, paddingHorizontal: 6, justifyContent: "center", borderRadius: 4 },
  actionPressed: { backgroundColor: "#eef4f1" },
  actionText: { color: ACCENT, fontSize: 13, fontWeight: "600" },
  dangerText: { color: "#9f2d2d" },
  composer: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "transparent", backgroundColor: "#f4f6f5" },
  composerFocused: { borderColor: ACCENT },
  input: { minHeight: 44, padding: 0, color: INK, fontSize: 14, textAlignVertical: "top" },
  composerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 2 },
  thread: { marginTop: 6 },
  roots: { paddingStart: REPLY_GUTTER },
  children: { paddingStart: CHILD_INDENT },
  reply: { position: "relative" },
  bylineRow: { flexDirection: "row", gap: 8, paddingVertical: ROW_PADDING, position: "relative" },
  body: { flex: 1, minWidth: 0 },
  byline: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5 },
  name: { color: INK, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  role: { color: ACCENT, fontSize: 12, fontWeight: "700" },
  meta: { color: MUTED, fontSize: 12 },
  message: { color: INK, fontSize: 14, lineHeight: 20, marginTop: 4 },
  rail: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: LINE_COLOR },
  railEnd: { bottom: undefined, height: ROW_PADDING + AVATAR_SIZE / 2 + 1 },
  elbow: { position: "absolute", top: ROW_PADDING + AVATAR_SIZE / 2, height: 1, backgroundColor: LINE_COLOR },
  parentRail: { position: "absolute", top: ROW_PADDING + AVATAR_SIZE + 3, bottom: 0, start: AVATAR_SIZE / 2, width: 1, backgroundColor: LINE_COLOR },
  branchControl: { paddingStart: CHILD_INDENT, position: "relative", alignItems: "flex-start" },
  branchElbow: { position: "absolute", top: 0, start: AVATAR_SIZE / 2, width: CHILD_INDENT - AVATAR_SIZE / 2 + 2, height: ACTION_HEIGHT / 2, borderStartWidth: 1, borderBottomWidth: 1, borderColor: LINE_COLOR, borderBottomStartRadius: 5 },
  branchRail: { width: 1, height: "100%", borderBottomWidth: 0, borderBottomStartRadius: 0 },
});
