import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput as NativeTextInput,
  View,
} from "react-native";
import {
  Button,
  Dialog,
  Menu,
  Portal,
  Snackbar,
  Text,
  TextInput,
} from "react-native-paper";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import ContentSkeleton, { SkeletonBlock } from "@/components/ContentSkeleton";
import { MAX_FEEDBACK_LENGTH, editFeedbackEntry, feedbackSources, fetchFeedbackBoard, notifyFeedbackAdmins, removeFeedbackEntry, saveFeedbackRating, saveFeedbackReaction, submitFeedbackPost, submitFeedbackReply, type FeedbackPost, type FeedbackReply, type RatingDoc } from "@/services/feedbackBoard";
import { useResponsive } from "../../utils/responsive";
import { useAuth } from "../../context/AuthContext";
import FeedbackThread, { AnonymousFeedbackOption, FeedbackAction, FeedbackAvatar, feedbackAuthor, formatFeedbackTime } from "./FeedbackThread";

const RATING_VALUES = [1, 2, 3, 4, 5];
const FILTERS = [
  { value: "all", label: "All posts" },
  { value: "unanswered", label: "Unanswered" },
  { value: "answered", label: "With replies" },
] as const;
const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "replies", label: "Most replies" },
] as const;

const INK = "#22312d";
const MUTED = "#62706b";
const BORDER = "#d8e0dc";
const ACCENT = "#315f50";
const SURFACE = "#ffffff";
const BACKGROUND = "#f4f6f5";

type EditState = {
  type: "feedback" | "reply";
  feedbackId: string;
  replyId?: string;
  initialText: string;
} | null;

export default function AppFeedbackScreen() {
  const { isDesktop } = useResponsive();
  const { user } = useAuth();
  const viewerId = user?.id;
  const [canRate, setCanRate] = useState(true);
  const [canModerate, setCanModerate] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [hasSavedRating, setHasSavedRating] = useState(false);

  const [rating, setRating] = useState(0);
  const [ratingAnonymous, setRatingAnonymous] = useState(false);
  const [savingRating, setSavingRating] = useState(false);
  const [showRatingsList, setShowRatingsList] = useState(false);
  const [activePanel, setActivePanel] = useState<"post" | "ratings" | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<typeof FILTERS[number]["value"]>("all");
  const [sort, setSort] = useState<typeof SORTS[number]>(SORTS[0]);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const [feedbackText, setFeedbackText] = useState("");
  const [postAnonymous, setPostAnonymous] = useState(false);
  const [postingFeedback, setPostingFeedback] = useState(false);

  const [ratings, setRatings] = useState<RatingDoc[]>([]);
  const [feedbacks, setFeedbacks] = useState<FeedbackPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [replyInputByPost, setReplyInputByPost] = useState<Record<string, string>>({});
  const [replyAnonymousByPost, setReplyAnonymousByPost] = useState<Record<string, boolean>>({});
  const [replyTargetByPost, setReplyTargetByPost] = useState<Record<string, string | null>>({});
  const [replySubmittingPostId, setReplySubmittingPostId] = useState<string | null>(null);

  const [editState, setEditState] = useState<EditState>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [snackbarText, setSnackbarText] = useState("");
  const [snackbarVisible, setSnackbarVisible] = useState(false);

  const canManage = (item: FeedbackPost | FeedbackReply) => item.mine || canModerate;
  const requestVersion = useRef(0);
  const locks = useRef(new Set<string>());

  const loadBoard = useCallback(async (syncRating = false) => {
    if (!viewerId) return;
    const version = ++requestVersion.current;
    try {
      const board = await fetchFeedbackBoard();
      if (version !== requestVersion.current) return;
      setRatings(board.ratings);
      setFeedbacks(board.posts);
      setHasSavedRating(Boolean(board.myRating));
      setCanRate(board.canRate);
      setCanModerate(board.canModerate);
      if (syncRating) {
        setRating(board.myRating?.rating ?? 0);
        setRatingAnonymous(board.myRating?.isAnonymous ?? false);
      }
      setLoadError("");
    } catch {
      if (version === requestVersion.current) setLoadError("Could not load feedback. Please try again.");
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [viewerId]);

  useEffect(() => {
    setLoading(Boolean(viewerId));
    if (viewerId) void loadBoard(true);
    else {
      setFeedbacks([]);
      setRatings([]);
      setLoadError("Sign in to view feedback.");
    }
    return () => { requestVersion.current += 1; };
  }, [viewerId, loadBoard]);

  useRealtimeRefresh(feedbackSources, () => loadBoard(), Boolean(viewerId) && !loading);

  const showSnackbar = (message: string) => {
    setSnackbarText(message);
    setSnackbarVisible(true);
  };

  const onRefresh = () => {
    if (!viewerId) return;
    setRefreshing(true);
    void loadBoard();
  };

  const runAction = async (key: string, title: string, action: () => Promise<void>) => {
    if (locks.current.has(key)) return;
    locks.current.add(key);
    try {
      await action();
    } catch (error) {
      Alert.alert(title, error instanceof Error ? error.message : "Please try again.");
    } finally {
      locks.current.delete(key);
    }
  };

  const saveRating = (value: number) => runAction("rating", "Rating could not be saved", async () => {
    if (!viewerId || !canRate) return;
    setSavingRating(true);
    try {
      await saveFeedbackRating(value, ratingAnonymous);
      if (value === 0) {
        setRating(0);
        setRatingAnonymous(false);
      }
      showSnackbar(value === 0 ? "Rating removed." : "Rating saved.");
      void notifyFeedbackAdmins("rating_update");
      await loadBoard();
    } finally { setSavingRating(false); }
  });

  const submitFeedback = () => runAction("post", "Feedback could not be posted", async () => {
    const text = feedbackText.trim();
    if (!viewerId || !text) return;
    setPostingFeedback(true);
    try {
      const post = await submitFeedbackPost(viewerId, text, postAnonymous);
      setFeedbackText("");
      setPostAnonymous(false);
      setActivePanel(current => current === "post" ? null : current);
      showSnackbar("Feedback posted.");
      void notifyFeedbackAdmins("feedback_new", post.id);
      await loadBoard();
    } finally { setPostingFeedback(false); }
  });

  const toggleReaction = (kind: "post" | "reply", item: FeedbackPost | FeedbackReply) =>
    runAction("reaction-" + item.id, "Reaction could not be saved", async () => {
      await saveFeedbackReaction(kind, item.id, !item.liked);
      await loadBoard();
    });

  const submitReply = (feedbackId: string, parentReplyId: string | null) => runAction("reply", "Reply could not be posted", async () => {
    const text = (replyInputByPost[feedbackId] || "").trim();
    if (!viewerId || !text) return;
    setReplySubmittingPostId(feedbackId);
    try {
      await submitFeedbackReply(viewerId, feedbackId, text, Boolean(replyAnonymousByPost[feedbackId]), parentReplyId);
      setReplyTargetByPost(prev => ({ ...prev, [feedbackId]: null }));
      setReplyInputByPost(prev => ({ ...prev, [feedbackId]: "" }));
      setReplyAnonymousByPost(prev => ({ ...prev, [feedbackId]: false }));
      setExpandedReplies(prev => ({ ...prev, [feedbackId]: true }));
      showSnackbar("Reply posted.");
      await loadBoard();
    } finally { setReplySubmittingPostId(null); }
  });

  const promptDelete = (kind: "post" | "reply", id: string) => {
    const label = kind === "post" ? "Feedback" : "Reply";
    Alert.alert("Delete " + label, kind === "post" ? "Delete this feedback and all replies?" : "Delete this reply?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void runAction("delete-" + id, label + " could not be deleted", async () => {
          await removeFeedbackEntry(kind, id);
          showSnackbar(label + " deleted.");
          await loadBoard();
        }),
      },
    ]);
  };

  const openEditDialog = (state: EditState) => {
    setEditState(state);
    setEditText(state?.initialText || "");
  };

  const saveEdit = () => runAction("edit", "Changes could not be saved", async () => {
    if (!editState || !editText.trim()) return;
    const id = editState.type === "feedback" ? editState.feedbackId : editState.replyId;
    if (!id) return;
    setSavingEdit(true);
    try {
      await editFeedbackEntry(editState.type === "feedback" ? "post" : "reply", id, editText.trim());
      setEditState(null);
      setEditText("");
      showSnackbar("Changes saved.");
      await loadBoard();
    } finally { setSavingEdit(false); }
  });

  const visiblePosts = useMemo(() => {
    const search = query.trim().toLowerCase();
    const posts = feedbacks.filter(post => {
      if (filter === "answered" && post.replies.length === 0) return false;
      if (filter === "unanswered" && post.replies.length > 0) return false;
      return !search || post.feedback.toLowerCase().includes(search) || feedbackAuthor(post).toLowerCase().includes(search)
        || post.replies.some(reply => reply.text.toLowerCase().includes(search) || feedbackAuthor(reply).toLowerCase().includes(search));
    });
    if (sort.value === "oldest") posts.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (sort.value === "replies") posts.sort((a, b) => b.replies.length - a.replies.length);
    return posts;
  }, [feedbacks, filter, query, sort]);

  const clearFilters = () => {
    setQuery("");
    setFilter("all");
  };

  const renderFeedbackItem = ({ item, index }: { item: FeedbackPost; index: number }) => {
    const expanded = Boolean(expandedReplies[item.id]);
    const targetId = replyTargetByPost[item.id] ?? null;
    const postRating = item.publicRating ?? 0;

    return (
      <View style={[styles.post, index === visiblePosts.length - 1 && styles.feedEnd]}>
        <View style={styles.authorRow}>
          <FeedbackAvatar photoURL={item.photoURL} isAnonymous={item.isAnonymous} />
          <View style={styles.authorDetails}>
            <View style={styles.byline}>
              <Text style={styles.authorName}>{feedbackAuthor(item)}</Text>
              {item.mine && <Text style={styles.role}>You</Text>}
            </View>
            <Text style={styles.meta}>{formatFeedbackTime(item.createdAt)}</Text>
          </View>
          {item.replies.some(reply => reply.staff && !reply.isAnonymous) && <Text style={styles.role}>Admin replied</Text>}
        </View>
        {postRating > 0 && !item.isAnonymous && <Text style={styles.postRating}>App rating {postRating}/5</Text>}
        <Text style={styles.postText}>{item.feedback}</Text>
        {Date.parse(item.updatedAt) > Date.parse(item.createdAt) && <Text style={styles.meta}>Edited</Text>}
        <View style={styles.actions}>
          <FeedbackAction state={{ selected: Boolean(item.liked) }} onPress={() => void toggleReaction("post", item)}>
            {`${item.liked ? "Unlike" : "Like"} (${item.reactionCount})`}
          </FeedbackAction>
          <FeedbackAction
            state={{ expanded }}
            onPress={() => setExpandedReplies(previous => ({ ...previous, [item.id]: !previous[item.id] }))}
          >
            {`${expanded ? "Hide replies" : "Replies"} (${item.replies.length})`}
          </FeedbackAction>
          {item.mine && <FeedbackAction onPress={() => openEditDialog({
            type: "feedback", feedbackId: item.id, initialText: item.feedback,
          })}>Edit</FeedbackAction>}
          {canManage(item) && <FeedbackAction destructive onPress={() => promptDelete("post", item.id)}>Delete</FeedbackAction>}
        </View>
        {expanded && (
          <FeedbackThread
            replies={item.replies}
            draft={replyInputByPost[item.id] || ""}
            anonymous={Boolean(replyAnonymousByPost[item.id])}
            targetId={targetId}
            posting={replySubmittingPostId === item.id}
            busy={replySubmittingPostId !== null}
            canModerate={canModerate}
            onDraft={value => setReplyInputByPost(previous => ({ ...previous, [item.id]: value }))}
            onAnonymous={value => setReplyAnonymousByPost(previous => ({ ...previous, [item.id]: value }))}
            onTarget={value => setReplyTargetByPost(previous => ({ ...previous, [item.id]: value }))}
            onSubmit={() => void submitReply(item.id, targetId)}
            onLike={reply => void toggleReaction("reply", reply)}
            onEdit={reply => openEditDialog({ type: "reply", feedbackId: item.id, replyId: reply.id, initialText: reply.text })}
            onDelete={reply => promptDelete("reply", reply.id)}
          />
        )}
      </View>
    );
  };

  const postComposer = (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Post feedback</Text>
      <TextInput
        mode="outlined"
        accessibilityLabel="Write your feedback"
        placeholder="Write your feedback"
        value={feedbackText}
        onChangeText={setFeedbackText}
        editable={!postingFeedback}
        multiline
        maxLength={MAX_FEEDBACK_LENGTH}
        outlineColor={BORDER}
        activeOutlineColor={ACCENT}
        style={styles.feedbackInput}
      />
      <Text style={styles.characterCount}>{feedbackText.length} / {MAX_FEEDBACK_LENGTH}</Text>
      <AnonymousFeedbackOption
        checked={postAnonymous}
        label="Post feedback anonymously"
        disabled={postingFeedback}
        onPress={() => setPostAnonymous(previous => !previous)}
      />
      <Button
        mode="contained"
        onPress={() => void submitFeedback()}
        loading={postingFeedback}
        disabled={postingFeedback || !feedbackText.trim()}
        buttonColor={ACCENT}
        style={styles.saveButton}
      >{postingFeedback ? "Posting…" : "Post feedback"}</Button>
    </View>
  );

  const ratingsPanel = (
    <View style={styles.panel}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>App ratings</Text>
        {ratings.length > 0 && <FeedbackAction
          state={{ expanded: showRatingsList }}
          onPress={() => setShowRatingsList(previous => !previous)}
        >{showRatingsList ? "Hide ratings" : "View ratings"}</FeedbackAction>}
      </View>
      <Text style={styles.meta}>{ratings.length} {ratings.length === 1 ? "rating" : "ratings"}</Text>
      <View style={styles.distribution}>
        {[...RATING_VALUES].reverse().map(star => {
          const count = ratings.filter(item => item.rating === star).length;
          const share = ratings.length === 0 ? 0 : count / ratings.length * 100;
          return (
            <View key={star} accessible accessibilityLabel={`${star} ${star === 1 ? "star" : "stars"}: ${count}`} style={styles.distributionRow}>
              <Text style={styles.starLabel}>{star} ★</Text>
              <View style={styles.ratingTrack}><View style={[styles.ratingFill, { width: `${share}%` }]} /></View>
              <Text style={styles.ratingCount}>{count}</Text>
            </View>
          );
        })}
      </View>
      {showRatingsList && ratings.length > 0 && (
        <ScrollView nestedScrollEnabled style={styles.ratingHistory}>
          {ratings.map(item => (
            <View key={item.id} style={styles.ratingHistoryRow}>
              <View style={styles.authorDetails}>
                <Text style={styles.authorName}>{feedbackAuthor(item)}</Text>
                <Text style={styles.meta}>{formatFeedbackTime(item.updatedAt || item.createdAt)}</Text>
              </View>
              <Text style={styles.starLabel}>{item.rating}/5</Text>
            </View>
          ))}
        </ScrollView>
      )}
      {canRate && (
        <View style={styles.personalRating}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Your app rating</Text>
          <View style={styles.stars}>
            {RATING_VALUES.map(value => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`${value} out of 5 stars`}
                accessibilityState={{ selected: value === rating, disabled: savingRating }}
                disabled={savingRating}
                onPress={() => setRating(value)}
                style={styles.starButton}
              >
                <Text style={[styles.star, value <= rating && styles.starSelected]}>{value <= rating ? "★" : "☆"}</Text>
              </Pressable>
            ))}
          </View>
          <AnonymousFeedbackOption
            checked={ratingAnonymous}
            label="Show this rating as anonymous"
            disabled={savingRating}
            onPress={() => setRatingAnonymous(previous => !previous)}
          />
          <View style={styles.actions}>
            <Button mode="contained" buttonColor={ACCENT} disabled={savingRating || !rating} loading={savingRating} onPress={() => void saveRating(rating)}>
              Save rating
            </Button>
            {hasSavedRating && <FeedbackAction destructive disabled={savingRating} onPress={() => void saveRating(0)}>Remove saved rating</FeedbackAction>}
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.screen, isDesktop && styles.screenDesktop]}>
      <FlatList
        data={visiblePosts}
        keyExtractor={item => item.id}
        renderItem={renderFeedbackItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={isDesktop ? "none" : "on-drag"}
        ListHeaderComponent={
          <View>
            <View style={styles.headingRow}>
              <Text accessibilityRole="header" style={styles.title}>Feedback posts</Text>
              {!loading && <Text accessibilityLiveRegion="polite" style={styles.meta}>
                {visiblePosts.length} {visiblePosts.length === 1 ? "post" : "posts"}
              </Text>}
            </View>
            <View style={styles.headerActions}>
              <Button
                mode="outlined"
                compact
                accessibilityState={{ expanded: activePanel === "post" }}
                disabled={loading || !viewerId}
                textColor={ACCENT}
                onPress={() => setActivePanel(current => current === "post" ? null : "post")}
              >{activePanel === "post" ? "Close feedback form" : "Write feedback"}</Button>
              <Button
                mode="outlined"
                compact
                accessibilityState={{ expanded: activePanel === "ratings" }}
                disabled={loading || !viewerId}
                textColor={ACCENT}
                onPress={() => setActivePanel(current => current === "ratings" ? null : "ratings")}
              >{activePanel === "ratings" ? "Close ratings" : "App ratings"}</Button>
            </View>
            {activePanel === "post" && postComposer}
            {activePanel === "ratings" && ratingsPanel}
            {loadError && feedbacks.length > 0 && (
              <View style={styles.panel}>
                <Text accessibilityRole="alert" style={styles.meta}>{loadError}</Text>
                <FeedbackAction onPress={() => void loadBoard()}>Retry</FeedbackAction>
              </View>
            )}
            <View style={styles.toolbar}>
              <View style={styles.searchRow}>
                <NativeTextInput
                  accessibilityLabel="Search feedback and replies"
                  placeholder="Search feedback and replies"
                  placeholderTextColor={MUTED}
                  value={query}
                  onChangeText={setQuery}
                  editable={!loading}
                  returnKeyType="search"
                  style={styles.searchInput}
                />
                <Menu
                  visible={sortMenuOpen}
                  onDismiss={() => setSortMenuOpen(false)}
                  anchor={
                    <Button
                      mode="text"
                      compact
                      accessibilityLabel={`Sort feedback posts: ${sort.label}`}
                      accessibilityState={{ expanded: sortMenuOpen }}
                      textColor={ACCENT}
                      disabled={loading}
                      onPress={() => setSortMenuOpen(true)}
                    >{sort.label}</Button>
                  }
                >
                  {SORTS.map(option => <Menu.Item key={option.value} title={option.label} onPress={() => {
                    setSort(option);
                    setSortMenuOpen(false);
                  }} />)}
                </Menu>
              </View>
              <View style={styles.filters}>
                {FILTERS.map(option => (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filter === option.value }}
                    onPress={() => setFilter(option.value)}
                    style={[styles.filterButton, filter === option.value && styles.selectedFilter]}
                  >
                    <Text style={styles.filterLabel}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={loading ? (
          <ContentSkeleton label="Loading feedback">
            {[0, 1].map(index => (
              <View key={index} style={[styles.post, styles.placeholder, index === 1 && styles.feedEnd]}>
                <View style={styles.authorRow}>
                  <SkeletonBlock style={styles.avatarPlaceholder} />
                  <View style={styles.authorDetails}>
                    <SkeletonBlock style={styles.authorPlaceholder} />
                    <SkeletonBlock style={styles.datePlaceholder} />
                  </View>
                </View>
                <SkeletonBlock />
                <SkeletonBlock style={styles.actionPlaceholder} />
              </View>
            ))}
          </ContentSkeleton>
        ) : (
          <View style={[styles.post, styles.feedEnd, styles.empty]}>
            {loadError && feedbacks.length === 0 ? (
              <>
                <Text accessibilityRole="alert" style={styles.sectionTitle}>{loadError}</Text>
                {viewerId && <FeedbackAction onPress={() => void loadBoard(true)}>Retry</FeedbackAction>}
              </>
            ) : feedbacks.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>No matching posts</Text>
                <FeedbackAction onPress={clearFilters}>Clear filters</FeedbackAction>
              </>
            ) : <Text style={styles.sectionTitle}>No feedback yet</Text>}
          </View>
        )}
        contentContainerStyle={styles.listContent}
      />

      <Portal>
        <Dialog visible={Boolean(editState)} onDismiss={() => !savingEdit && setEditState(null)}>
          <Dialog.Title>Edit {editState?.type === "reply" ? "reply" : "feedback"}</Dialog.Title>
          <Dialog.Content>
            <TextInput mode="outlined" multiline maxLength={MAX_FEEDBACK_LENGTH} editable={!savingEdit} value={editText} onChangeText={setEditText} placeholder="Update your text" />
          </Dialog.Content>
          <Dialog.Actions>
            <Button disabled={savingEdit} onPress={() => setEditState(null)}>Cancel</Button>
            <Button onPress={saveEdit} loading={savingEdit} disabled={savingEdit || !editText.trim()}>Save</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={snackbarVisible} onDismiss={() => setSnackbarVisible(false)} duration={2200}>
        {snackbarText}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BACKGROUND },
  screenDesktop: { maxWidth: 860, width: "100%", alignSelf: "center" },
  listContent: { padding: 14, paddingBottom: 40 },
  title: { color: INK, fontSize: 22, fontWeight: "700" },
  sectionTitle: { color: INK, fontSize: 15, fontWeight: "700" },
  meta: { color: MUTED, fontSize: 12 },
  headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 },
  headerActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 12 },
  panel: { gap: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: BORDER, borderRadius: 6, backgroundColor: SURFACE },
  toolbar: {
    padding: 12, gap: 8, borderWidth: 1, borderColor: BORDER,
    borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: SURFACE,
  },
  searchRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  searchInput: {
    flex: 1, flexBasis: 155, minHeight: 38, paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1, borderColor: BORDER, borderRadius: 5, color: INK, fontSize: 13,
  },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  filterButton: {
    minHeight: 36, justifyContent: "center", paddingHorizontal: 8,
    borderRadius: 4, borderWidth: 1, borderColor: BORDER,
  },
  selectedFilter: { backgroundColor: "#eef4f1", borderColor: ACCENT },
  filterLabel: { color: ACCENT, fontSize: 13, fontWeight: "600" },
  post: {
    padding: 12, borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: BORDER, backgroundColor: SURFACE,
  },
  feedEnd: { borderBottomLeftRadius: 6, borderBottomRightRadius: 6 },
  authorRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  authorDetails: { flex: 1, minWidth: 0 },
  byline: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  authorName: { color: INK, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  role: { color: ACCENT, fontSize: 12, fontWeight: "600" },
  postRating: { color: ACCENT, fontSize: 12, marginTop: 8 },
  postText: { color: INK, fontSize: 14, lineHeight: 21, marginTop: 8 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, marginTop: 4 },
  feedbackInput: { minHeight: 92, backgroundColor: SURFACE },
  characterCount: { textAlign: "right", color: MUTED, fontSize: 12 },
  saveButton: { alignSelf: "flex-start" },
  distribution: { gap: 8 },
  distributionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  starLabel: { color: "#8a5e08", minWidth: 28, fontSize: 13 },
  ratingTrack: { flex: 1, height: 6, backgroundColor: "#eef4f1", borderRadius: 3, overflow: "hidden" },
  ratingFill: { height: 6, backgroundColor: ACCENT },
  ratingCount: { minWidth: 18, textAlign: "right", color: INK, fontSize: 12 },
  ratingHistory: { maxHeight: 180 },
  ratingHistoryRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderColor: BORDER },
  personalRating: { borderTopWidth: 1, borderColor: BORDER, paddingTop: 10, marginTop: 6 },
  stars: { flexDirection: "row", flexWrap: "wrap", gap: 3 },
  starButton: { minWidth: 38, minHeight: 42, alignItems: "center", justifyContent: "center" },
  star: { color: MUTED, fontSize: 27 },
  starSelected: { color: "#8a5e08" },
  empty: { alignItems: "center", paddingVertical: 22 },
  placeholder: { gap: 10 },
  avatarPlaceholder: { width: 32, height: 32, borderRadius: 16 },
  authorPlaceholder: { width: 104, height: 11 },
  datePlaceholder: { width: 74, height: 8, marginTop: 5 },
  actionPlaceholder: { width: 84, height: 10, marginTop: 5 },
});
