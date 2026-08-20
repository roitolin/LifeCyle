import { useCallback, useEffect, useMemo, useState } from "react";
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  Divider,
  Portal,
  Snackbar,
  Text,
  TextInput,
} from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { auth } from "../../services/supabaseAuth";
import { useResponsive } from "../../utils/responsive";
import { useAuth } from "../../context/AuthContext";
import { createAdminNotification } from "../../utils/createAdminNotification";

const RATING_VALUES = [1, 2, 3, 4, 5];
const LIKE = "Like";
const MAX_FEEDBACK_LENGTH = 1200;
const RATING_LABELS: Record<number, string> = {
  1: 'Needs improvement',
  2: 'Could be better',
  3: 'Good',
  4: 'Very good',
  5: 'Excellent',
};

type RatingDoc = {
  id: string;
  userId: string;
  userEmail?: string | null;
  displayName?: string | null;
  isAnonymous?: boolean;
  rating: number;
  createdAt?: any;
  updatedAt?: any;
};

type FeedbackReply = {
  id: string;
  userId: string;
  userEmail?: string | null;
  displayName?: string | null;
  isAnonymous?: boolean;
  text: string;
  createdAt?: any;
  updatedAt?: any;
  reactions?: Record<string, string>;
};

type FeedbackPost = {
  id: string;
  userId: string;
  userEmail?: string | null;
  displayName?: string | null;
  isAnonymous?: boolean;
  feedback: string;
  createdAt?: any;
  updatedAt?: any;
  reactions?: Record<string, string>;
  replies: FeedbackReply[];
};

type EditState = {
  type: "feedback" | "reply";
  feedbackId: string;
  replyId?: string;
  initialText: string;
} | null;

const formatDateTime = (timestamp: any) => {
  if (!timestamp) return "Just now";
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, { hour12: true });
};

export default function AppFeedbackScreen() {
  const { isDesktop } = useResponsive();
  const { role } = useAuth();
  const currentUser = auth.currentUser;
  const isSuperAdmin = String(role ?? "").toLowerCase() === "super_admin";
  const canModerate = role === "admin" || isSuperAdmin;

  const [rating, setRating] = useState(0);
  const [ratingAnonymous, setRatingAnonymous] = useState(false);
  const [savingRating, setSavingRating] = useState(false);
  const [showRatingsList, setShowRatingsList] = useState(true);

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
  const [replySubmittingPostId, setReplySubmittingPostId] = useState<string | null>(null);

  const [editState, setEditState] = useState<EditState>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [snackbarText, setSnackbarText] = useState("");
  const [snackbarVisible, setSnackbarVisible] = useState(false);

  const canManage = useCallback(
    (ownerUserId: string) => !!currentUser?.uid && (ownerUserId === currentUser.uid || canModerate),
    [currentUser?.uid, canModerate]
  );

  const getIdentity = useCallback(async () => {
    if (!currentUser) return null;
    const { data } = await supabase.from("users").select("email, fullName").eq("id", currentUser.uid).single();
    return {
      userId: currentUser.uid,
      userEmail: currentUser.email || null,
      displayName: data?.fullName || currentUser.email || "User",
    };
  }, [currentUser]);

  const loadBoard = useCallback(async () => {
    if (!currentUser) {
      setRatings([]);
      setFeedbacks([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const { data: ratingsData, error: ratingsError } = await supabase
        .from("app_ratings")
        .select("*, users(email, fullName)")
        .order("updatedAt", { ascending: false });

      if (ratingsError) throw ratingsError;

      const ratingsList = (ratingsData || []).map((r: any) => ({
        ...r,
        userEmail: r.users?.email,
        displayName: r.users?.fullName,
      })) as RatingDoc[];

      setRatings(ratingsList);

      const mine = ratingsList.find((item) => item.userId === currentUser.uid);
      if (mine) {
        setRating(mine.rating || 0);
        setRatingAnonymous(Boolean(mine.isAnonymous));
      } else {
        setRating(0);
        setRatingAnonymous(false);
      }

      const { data: feedbackData, error: feedbackError } = await supabase
        .from("app_feedback")
        .select("*, users(email, fullName), app_feedback_replies(*, users(email, fullName))")
        .order("createdAt", { ascending: false });

      if (feedbackError) throw feedbackError;

      const feedbackList = (feedbackData || []).map((f: any) => {
        const replies = (f.app_feedback_replies || []).map((r: any) => ({
          ...r,
          userEmail: r.users?.email,
          displayName: r.users?.fullName,
        })).sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        return {
          ...f,
          userEmail: f.users?.email,
          displayName: f.users?.fullName,
          replies,
        } as FeedbackPost;
      });

      setFeedbacks(feedbackList);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to load ratings and feedback.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const showSnackbar = (message: string) => {
    setSnackbarText(message);
    setSnackbarVisible(true);
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadBoard();
  };

  const saveMyRating = async () => {
    if (isSuperAdmin) {
      Alert.alert("Not Allowed", "Superadmin accounts cannot submit ratings.");
      return;
    }

    const identity = await getIdentity();
    if (!identity) {
      Alert.alert("Error", "You need to be logged in.");
      return;
    }

    setSavingRating(true);
    try {
      if (rating < 1) {
        await supabase.from("app_ratings").delete().eq("userId", identity.userId);
        await createAdminNotification(
          "rating_update",
          "App Rating Updated",
          `${identity.displayName || "A user"} removed their app rating.`,
          { userId: identity.userId }
        );
        showSnackbar("Rating removed.");
        loadBoard();
        return;
      }

      const { data: existing } = await supabase.from("app_ratings").select("id").eq("userId", identity.userId).maybeSingle();
      if (existing) {
        await supabase.from("app_ratings").update({
          isAnonymous: ratingAnonymous,
          rating,
          updatedAt: new Date().toISOString(),
        }).eq("userId", identity.userId);
      } else {
        await supabase.from("app_ratings").insert({
          userId: identity.userId,
          isAnonymous: ratingAnonymous,
          rating,
        });
      }

      await createAdminNotification(
        "rating_update",
        "New/Updated App Rating",
        `${identity.displayName || "A user"} rated the app ${rating}/5.`,
        { rating, userId: identity.userId }
      );

      showSnackbar("Rating saved.");
      loadBoard();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to save rating.");
    } finally {
      setSavingRating(false);
    }
  };

  const removeMyRating = async () => {
    const identity = await getIdentity();
    if (!identity) return;

    try {
      await supabase.from("app_ratings").delete().eq("userId", identity.userId);
      await createAdminNotification(
        "rating_update",
        "App Rating Updated",
        `${identity.displayName || "A user"} removed their app rating.`,
        { userId: identity.userId }
      );
      setRating(0);
      setRatingAnonymous(false);
      showSnackbar("Rating removed.");
      loadBoard();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to remove rating.");
    }
  };

  const submitFeedback = async () => {
    if (!feedbackText.trim()) {
      Alert.alert("Feedback Required", "Please write your feedback before submitting.");
      return;
    }

    const identity = await getIdentity();
    if (!identity) {
      Alert.alert("Error", "You need to be logged in.");
      return;
    }

    setPostingFeedback(true);
    try {
      await supabase.from("app_feedback").insert({
        userId: identity.userId,
        isAnonymous: postAnonymous,
        feedback: feedbackText.trim(),
        reactions: {},
      });

      await createAdminNotification(
        "feedback_new",
        "New App Feedback",
        `${identity.displayName || "A user"} posted new feedback.`,
        { userId: identity.userId }
      );

      setFeedbackText("");
      setPostAnonymous(false);
      showSnackbar("Feedback posted.");
      loadBoard();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not submit feedback.");
    } finally {
      setPostingFeedback(false);
    }
  };

  const toggleFeedbackReaction = async (feedbackItem: FeedbackPost) => {
    if (!currentUser?.uid) return;
    try {
      const currentReactions = feedbackItem.reactions || {};
      const nextReactions = { ...currentReactions };
      if (nextReactions[currentUser.uid]) {
        delete nextReactions[currentUser.uid];
      } else {
        nextReactions[currentUser.uid] = "like";
      }

      await supabase.from("app_feedback").update({ reactions: nextReactions }).eq("id", feedbackItem.id);
      loadBoard();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to react.");
    }
  };

  const toggleReplyReaction = async (feedbackId: string, reply: FeedbackReply) => {
    if (!currentUser?.uid) return;
    try {
      const currentReactions = reply.reactions || {};
      const nextReactions = { ...currentReactions };
      if (nextReactions[currentUser.uid]) {
        delete nextReactions[currentUser.uid];
      } else {
        nextReactions[currentUser.uid] = "like";
      }

      await supabase.from("app_feedback_replies").update({ reactions: nextReactions }).eq("id", reply.id);
      loadBoard();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to react.");
    }
  };

  const submitReply = async (feedbackId: string) => {
    const replyText = (replyInputByPost[feedbackId] || "").trim();
    if (!replyText) return;

    const identity = await getIdentity();
    if (!identity) return;

    setReplySubmittingPostId(feedbackId);
    try {
      await supabase.from("app_feedback_replies").insert({
        feedbackId: feedbackId,
        userId: identity.userId,
        isAnonymous: Boolean(replyAnonymousByPost[feedbackId]),
        text: replyText,
        reactions: {},
      });

      setReplyInputByPost((prev) => ({ ...prev, [feedbackId]: "" }));
      setReplyAnonymousByPost((prev) => ({ ...prev, [feedbackId]: false }));
      setExpandedReplies((prev) => ({ ...prev, [feedbackId]: true }));
      showSnackbar("Reply posted.");
      loadBoard();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to post reply.");
    } finally {
      setReplySubmittingPostId(null);
    }
  };

  const promptDeleteFeedback = (feedbackId: string) => {
    Alert.alert("Delete Feedback", "Delete this feedback and all replies?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await supabase.from("app_feedback").delete().eq("id", feedbackId);
            showSnackbar("Feedback deleted.");
            loadBoard();
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Failed to delete feedback.");
          }
        },
      },
    ]);
  };

  const promptDeleteReply = (feedbackId: string, replyId: string) => {
    Alert.alert("Delete Reply", "Are you sure you want to delete this reply?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await supabase.from("app_feedback_replies").delete().eq("id", replyId);
            showSnackbar("Reply deleted.");
            loadBoard();
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Failed to delete reply.");
          }
        },
      },
    ]);
  };

  const openEditDialog = (state: EditState) => {
    setEditState(state);
    setEditText(state?.initialText || "");
  };

  const saveEdit = async () => {
    if (!editState || !editText.trim()) return;
    setSavingEdit(true);
    try {
      if (editState.type === "feedback") {
        await supabase.from("app_feedback").update({
          feedback: editText.trim(),
          updatedAt: new Date().toISOString(),
        }).eq("id", editState.feedbackId);
      } else {
        await supabase.from("app_feedback_replies").update({
          text: editText.trim(),
          updatedAt: new Date().toISOString(),
        }).eq("id", editState.replyId);
      }

      setEditState(null);
      setEditText("");
      showSnackbar("Changes saved.");
      loadBoard();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to save changes.");
    } finally {
      setSavingEdit(false);
    }
  };

  const averageRating = useMemo(() => {
    if (ratings.length === 0) return 0;
    const total = ratings.reduce((sum, entry) => sum + (entry.rating || 0), 0);
    return total / ratings.length;
  }, [ratings]);

  const hasSavedRating = useMemo(
    () =>
      Boolean(
        currentUser?.uid &&
          ratings.some((entry) => entry.userId === currentUser.uid)
      ),
    [currentUser?.uid, ratings]
  );

  const ratingByUserId = useMemo(() => {
    const entries: Record<string, number> = {};
    ratings.forEach((entry) => {
      if (entry.userId) {
        entries[entry.userId] = Number(entry.rating) || 0;
      }
    });
    return entries;
  }, [ratings]);

  const renderRatingItem = (item: RatingDoc) => {
    const ratingName = item.isAnonymous ? "Anonymous" : item.displayName || item.userEmail || "User";
    const safeRating = Math.max(1, Math.min(5, Number(item.rating) || 0));
    return (
      <View key={item.id} style={styles.ratingListItem}>
        <View style={styles.ratingListHead}>
          <Text style={styles.ratingListName}>{ratingName}</Text>
          <Text style={styles.ratingListTime}>{formatDateTime(item.updatedAt || item.createdAt)}</Text>
        </View>
        <Text style={styles.ratingListStars}>{`${"\u2605".repeat(safeRating)}${"\u2606".repeat(5 - safeRating)} (${safeRating}/5)`}</Text>
      </View>
    );
  };

  const renderReply = (feedbackId: string, reply: FeedbackReply) => {
    const reactionsCount = Object.keys(reply.reactions || {}).length;
    const editable = canManage(reply.userId);
    const replyName = reply.isAnonymous ? "Anonymous" : reply.displayName || reply.userEmail || "User";

    return (
      <View key={reply.id} style={styles.replyItem}>
        <View style={styles.replyHead}>
          <Text style={styles.replyAuthor}>{replyName}</Text>
          <Text style={styles.replyTime}>{formatDateTime(reply.createdAt)}</Text>
        </View>
        <Text style={styles.replyBody}>{reply.text}</Text>
        <View style={styles.replyActions}>
          <Button compact mode="text" onPress={() => toggleReplyReaction(feedbackId, reply)}>
            {`${LIKE} (${reactionsCount})`}
          </Button>
          {editable && (
            <Button
              compact
              mode="text"
              onPress={() =>
                openEditDialog({
                  type: "reply",
                  feedbackId,
                  replyId: reply.id,
                  initialText: reply.text,
                })
              }
            >
              Edit
            </Button>
          )}
          {editable && (
            <Button compact mode="text" textColor="#b91c1c" onPress={() => promptDeleteReply(feedbackId, reply.id)}>
              Delete
            </Button>
          )}
        </View>
      </View>
    );
  };

  const renderFeedbackItem = ({ item }: { item: FeedbackPost }) => {
    const feedbackName = item.isAnonymous ? "Anonymous" : item.displayName || item.userEmail || "User";
    const userRating = ratingByUserId[item.userId];
    const reactionCount = Object.keys(item.reactions || {}).length;
    const isExpanded = Boolean(expandedReplies[item.id]);
    const editable = canManage(item.userId);
    const replyText = replyInputByPost[item.id] || "";
    const replyAnonymous = Boolean(replyAnonymousByPost[item.id]);

    return (
      <Card style={styles.feedbackCard} mode="elevated">
        <Card.Content>
          <View style={styles.feedbackHeader}>
            <View style={styles.authorIdentity}>
              <View style={styles.authorAvatar}>
                <Text style={styles.authorAvatarText}>
                  {feedbackName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.authorCopy}>
                <Text style={styles.feedbackAuthor}>{feedbackName}</Text>
                <Text style={styles.feedbackDate}>{formatDateTime(item.createdAt)}</Text>
              </View>
            </View>
            {item.isAnonymous ? (
              <View style={styles.anonymousBadge}>
                <Ionicons name='eye-off-outline' size={12} color='#62706b' />
                <Text style={styles.anonymousBadgeText}>Anonymous</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.feedbackRatingMeta}>
            {userRating > 0 ? `App Rating: ${userRating}/5` : "App Rating: No rating yet"}
          </Text>

          <Text style={styles.feedbackText}>{item.feedback}</Text>
          {item.updatedAt && <Text style={styles.editedTag}>Edited</Text>}

          <View style={styles.feedbackActions}>
            <Button compact mode="text" onPress={() => toggleFeedbackReaction(item)}>
              {`${LIKE} (${reactionCount})`}
            </Button>
            <Button compact mode="text" onPress={() => setExpandedReplies((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}>
              {isExpanded ? `Hide Replies (${item.replies.length})` : `Replies (${item.replies.length})`}
            </Button>
            {editable && (
              <Button
                compact
                mode="text"
                onPress={() =>
                  openEditDialog({
                    type: "feedback",
                    feedbackId: item.id,
                    initialText: item.feedback,
                  })
                }
              >
                Edit
              </Button>
            )}
            {editable && (
              <Button compact mode="text" textColor="#b91c1c" onPress={() => promptDeleteFeedback(item.id)}>
                Delete
              </Button>
            )}
          </View>

          {isExpanded && (
            <View style={styles.repliesWrap}>
              {item.replies.length === 0 && <Text style={styles.noReplies}>No replies yet.</Text>}
              {item.replies.map((reply) => renderReply(item.id, reply))}

              <Divider style={styles.replyDivider} />
              <TextInput
                mode="outlined"
                placeholder="Write a reply..."
                value={replyText}
                onChangeText={(text) => setReplyInputByPost((prev) => ({ ...prev, [item.id]: text }))}
                multiline
                style={styles.replyInput}
              />
              <TouchableOpacity
                style={styles.replyAnonRow}
                onPress={() => setReplyAnonymousByPost((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                activeOpacity={0.8}
              >
                <Checkbox status={replyAnonymous ? "checked" : "unchecked"} />
                <Text style={styles.replyAnonText}>Reply anonymously</Text>
              </TouchableOpacity>
              <Button
                mode="contained-tonal"
                onPress={() => submitReply(item.id)}
                loading={replySubmittingPostId === item.id}
                disabled={replySubmittingPostId === item.id || !replyText.trim()}
              >
                Reply
              </Button>
            </View>
          )}
        </Card.Content>
      </Card>
    );
  };

  return (
    <View style={[styles.screen, isDesktop && styles.screenDesktop]}>
      <FlatList
        data={feedbacks}
        keyExtractor={(item) => item.id}
        renderItem={renderFeedbackItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={isDesktop ? "none" : "on-drag"}
        ListHeaderComponent={
          <ScrollView scrollEnabled={false}>
            <View style={styles.feedbackHero}>
              <View style={styles.feedbackHeroOrb} />
              <View style={styles.feedbackHeroTop}>
                <View style={styles.feedbackHeroIcon}>
                  <Ionicons name='star-outline' size={25} color='#ffffff' />
                </View>
                <Text style={styles.feedbackHeroEyebrow}>RATE & FEEDBACK</Text>
              </View>
              <Text accessibilityRole='header' style={styles.feedbackHeroTitle}>
                Help make LifeCycle better.
              </Text>
              <Text style={styles.feedbackHeroText}>
                Share what works, what feels confusing, and what would make the experience
                more helpful for families and service providers.
              </Text>

              <View style={styles.feedbackStatsRow}>
                <View style={styles.feedbackStat}>
                  <Text style={styles.feedbackStatValue}>
                    {ratings.length > 0 ? averageRating.toFixed(1) : '—'}
                  </Text>
                  <Text style={styles.feedbackStatLabel}>Average rating</Text>
                </View>
                <View style={styles.feedbackStat}>
                  <Text style={styles.feedbackStatValue}>{ratings.length}</Text>
                  <Text style={styles.feedbackStatLabel}>Ratings</Text>
                </View>
                <View style={styles.feedbackStat}>
                  <Text style={styles.feedbackStatValue}>{feedbacks.length}</Text>
                  <Text style={styles.feedbackStatLabel}>Feedback posts</Text>
                </View>
              </View>
            </View>

            <Card style={styles.composerCard}>
              <Card.Content>
                <View style={styles.composerHeading}>
                  <View style={styles.composerHeadingIcon}>
                    <Ionicons name='create-outline' size={21} color='#2f6b4f' />
                  </View>
                  <View style={styles.composerHeadingCopy}>
                    <Text style={styles.title}>Share your experience</Text>
                    <Text style={styles.subtitle}>
                      Your rating and comments help guide future improvements.
                    </Text>
                  </View>
                </View>

                <View style={styles.privacyNote}>
                  <Ionicons name='shield-checkmark-outline' size={19} color='#2f6b4f' />
                  <Text style={styles.privacyNoteText}>
                    You control whether your rating or feedback appears with your name.
                  </Text>
                </View>
                <Text style={styles.label}>Your rating</Text>
                {isSuperAdmin ? (
                  <Text style={styles.superAdminNotice}>Superadmin accounts can read ratings but cannot submit one.</Text>
                ) : (
                  <>
                    <Text style={styles.ratingHint}>
                      {rating > 0
                        ? rating + '/5 · ' + RATING_LABELS[rating]
                        : 'Tap a star to choose your rating.'}
                    </Text>
                    <View style={styles.ratingPickerRow}>
                      {RATING_VALUES.map((value) => (
                        <TouchableOpacity
                          key={value}
                          accessibilityRole='button'
                          accessibilityLabel={value + ' out of 5 stars'}
                          accessibilityState={{ selected: value === rating }}
                          onPress={() => setRating(value)}
                          style={styles.ratingButton}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.ratingIcon, value <= rating && styles.ratingIconActive]}>{"\u2605"}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TouchableOpacity style={styles.anonRow} onPress={() => setRatingAnonymous((prev) => !prev)} activeOpacity={0.8}>
                      <Checkbox status={ratingAnonymous ? "checked" : "unchecked"} />
                      <Text style={styles.anonText}>Show this rating as anonymous</Text>
                    </TouchableOpacity>
                    <Button
                      mode='contained'
                      icon='check-circle-outline'
                      onPress={saveMyRating}
                      loading={savingRating}
                      disabled={savingRating || rating < 1}
                      buttonColor='#2f6b4f'
                      contentStyle={styles.primaryButtonContent}
                    >
                      Save My Rating
                    </Button>
                    {hasSavedRating ? (
                      <Button
                        mode='text'
                        icon='delete-outline'
                        onPress={removeMyRating}
                        textColor='#8f2929'
                        style={styles.removeRatingButton}
                      >
                        Remove saved rating
                      </Button>
                    ) : null}
                  </>
                )}

                <Divider style={styles.sectionDivider} />

                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.label}>Community Ratings</Text>
                  <Button compact mode="text" onPress={() => setShowRatingsList((prev) => !prev)}>
                    {showRatingsList ? "Hide" : "Show"}
                  </Button>
                </View>
                {!showRatingsList ? (
                  <Text style={styles.noRatingsText}>Ratings are hidden. Tap Show to view.</Text>
                ) : ratings.length === 0 ? (
                  <Text style={styles.noRatingsText}>No ratings yet. Be the first to rate the app.</Text>
                ) : (
                  <View style={styles.ratingListWrap}>{ratings.map((item: any) => renderRatingItem(item))}</View>
                )}

                <Divider style={styles.sectionDivider} />

                <Text style={styles.label}>Write feedback</Text>
                <Text style={styles.feedbackPrompt}>
                  Tell us what happened, what you expected, and what would improve the experience.
                </Text>
                <TextInput
                  mode='outlined'
                  label='Share your feedback'
                  value={feedbackText}
                  onChangeText={setFeedbackText}
                  multiline
                  maxLength={MAX_FEEDBACK_LENGTH}
                  outlineColor='#cfd6d1'
                  activeOutlineColor='#2f6b4f'
                  placeholder='Example: I found the service-request updates helpful, but...'
                  style={styles.feedbackInput}
                />
                <Text style={styles.characterCount}>
                  {feedbackText.length}/{MAX_FEEDBACK_LENGTH}
                </Text>
                <TouchableOpacity style={styles.anonRow} onPress={() => setPostAnonymous((prev) => !prev)} activeOpacity={0.8}>
                  <Checkbox status={postAnonymous ? "checked" : "unchecked"} />
                  <Text style={styles.anonText}>Post feedback anonymously</Text>
                </TouchableOpacity>
                <Button
                  mode='contained'
                  icon='send-outline'
                  onPress={submitFeedback}
                  loading={postingFeedback}
                  disabled={postingFeedback || !feedbackText.trim()}
                  buttonColor='#2f6b4f'
                  contentStyle={styles.primaryButtonContent}
                >
                  {postingFeedback ? "Posting..." : "Post Feedback"}
                </Button>
              </Card.Content>
            </Card>

            <View style={styles.boardHeading}>
              <View style={styles.boardHeadingIcon}>
                <Ionicons name='chatbubbles-outline' size={21} color='#2f6b4f' />
              </View>
              <View style={styles.boardHeadingCopy}>
                <Text style={styles.boardTitle}>Community feedback</Text>
                <Text style={styles.boardSubtitle}>
                  Read experiences, join a discussion, or respond with support.
                </Text>
              </View>
            </View>
          </ScrollView>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size='small' color='#2f6b4f' />
              <Text style={styles.loadingText}>Loading community feedback...</Text>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <Ionicons name='chatbubble-ellipses-outline' size={27} color='#2f6b4f' />
              </View>
              <Text style={styles.emptyTitle}>No feedback posts yet</Text>
              <Text style={styles.emptyHint}>Start the conversation by sharing your experience.</Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
      />

      <Portal>
        <Dialog visible={!!editState} onDismiss={() => setEditState(null)}>
          <Dialog.Title>Edit</Dialog.Title>
          <Dialog.Content>
            <TextInput mode="outlined" multiline value={editText} onChangeText={setEditText} placeholder="Update your text" />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditState(null)}>Cancel</Button>
            <Button onPress={saveEdit} loading={savingEdit} disabled={savingEdit || !editText.trim()}>
              Save
            </Button>
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
  screen: {
    flex: 1,
    backgroundColor: '#eef1ec',
  },
  screenDesktop: {
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
  },
  listContent: {
    padding: 18,
    paddingBottom: 56,
  },
  feedbackHero: {
    overflow: 'hidden',
    borderRadius: 23,
    backgroundColor: '#22312d',
    padding: 20,
    marginBottom: 13,
  },
  feedbackHeroOrb: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    top: -102,
    right: -55,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  feedbackHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  feedbackHeroIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  feedbackHeroEyebrow: {
    color: '#b9c8c0',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  feedbackHeroTitle: {
    color: '#ffffff',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
  },
  feedbackHeroText: {
    color: '#d6dfda',
    fontSize: 13,
    lineHeight: 21,
    marginTop: 8,
  },
  feedbackStatsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
  },
  feedbackStat: {
    flex: 1,
    minWidth: 80,
    padding: 11,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  feedbackStatValue: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  feedbackStatLabel: {
    color: '#c8d3cd',
    fontSize: 9,
    lineHeight: 13,
    marginTop: 3,
  },
  composerHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  composerHeadingIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5efe5',
  },
  composerHeadingCopy: {
    flex: 1,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#cfdccc',
    backgroundColor: '#eaf2e8',
    marginTop: 13,
    marginBottom: 8,
  },
  privacyNoteText: {
    flex: 1,
    color: '#41514d',
    fontSize: 11,
    lineHeight: 17,
  },
  primaryButtonContent: {
    minHeight: 45,
  },
  removeRatingButton: {
    alignSelf: 'center',
    marginTop: 5,
  },
  feedbackPrompt: {
    color: '#62706b',
    fontSize: 11,
    lineHeight: 17,
    marginBottom: 8,
  },
  characterCount: {
    color: '#7a8580',
    fontSize: 10,
    textAlign: 'right',
    marginTop: -3,
    marginBottom: 4,
  },
  boardHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  boardHeadingIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5efe5',
  },
  boardHeadingCopy: {
    flex: 1,
  },
  boardTitle: {
    color: '#22312d',
    fontSize: 17,
    fontWeight: '900',
  },
  boardSubtitle: {
    color: '#62706b',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    minHeight: 130,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
  },
  loadingText: {
    color: '#62706b',
    fontSize: 11,
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5efe5',
    marginBottom: 10,
  },
  authorIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 9,
  },
  authorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5efe5',
  },
  authorAvatarText: {
    color: '#2f6b4f',
    fontSize: 15,
    fontWeight: '900',
  },
  authorCopy: {
    flex: 1,
  },
  anonymousBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: '#eef1ec',
  },
  anonymousBadgeText: {
    color: '#62706b',
    fontSize: 9,
    fontWeight: '800',
  },
  composerCard: {
    borderRadius: 19,
    marginBottom: 19,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9d6cd',
  },
  title: {
    fontSize: 19,
    fontWeight: '900',
    color: '#22312d',
  },
  subtitle: {
    marginTop: 4,
    color: '#62706b',
    fontSize: 11,
    lineHeight: 17,
  },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
    padding: 10,
    backgroundColor: "#fee2e2",
    borderRadius: 8,
  },
  summaryText: {
    fontWeight: "600",
    color: "#991b1b",
  },
  label: {
    color: '#22312d',
    fontWeight: '900',
    marginTop: 12,
    marginBottom: 6,
    fontSize: 15,
  },
  superAdminNotice: {
    color: '#8f2929',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  ratingHint: {
    color: '#2f6b4f',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  ratingPickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
    gap: 5,
  },
  ratingButton: {
    padding: 3,
  },
  ratingIcon: {
    fontSize: 36,
    color: '#cdd3cf',
  },
  ratingIconActive: {
    color: "#f59e0b",
  },
  anonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  anonText: {
    marginLeft: 4,
    color: '#41514d',
    fontSize: 12,
  },
  sectionDivider: {
    marginVertical: 18,
    height: 1,
    backgroundColor: '#e7e5df',
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  noRatingsText: {
    color: '#62706b',
    fontStyle: 'italic',
    fontSize: 11,
  },
  ratingListWrap: {
    backgroundColor: '#f8faf7',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#e2e1da',
    padding: 10,
    maxHeight: 200,
  },
  ratingListItem: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d1d5db",
  },
  ratingListHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  ratingListName: {
    fontWeight: "600",
  },
  ratingListTime: {
    fontSize: 12,
    color: "#6b7280",
  },
  ratingListStars: {
    color: "#f59e0b",
    fontSize: 14,
  },
  feedbackInput: {
    marginBottom: 8,
    minHeight: 125,
    backgroundColor: '#ffffff',
  },
  emptyWrap: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#22312d',
  },
  emptyHint: {
    color: '#62706b',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  feedbackCard: {
    marginBottom: 11,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
  },
  feedbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  feedbackAuthor: {
    color: '#22312d',
    fontWeight: '900',
    fontSize: 14,
  },
  feedbackDate: {
    fontSize: 10,
    color: '#7a8580',
    marginTop: 2,
  },
  feedbackRatingMeta: {
    alignSelf: 'flex-start',
    fontSize: 10,
    color: '#2f6b4f',
    fontWeight: '800',
    marginTop: 10,
    marginBottom: 9,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: '#e5efe5',
  },
  feedbackText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#41514d',
  },
  editedTag: {
    fontSize: 11,
    fontStyle: "italic",
    color: "#9ca3af",
    marginTop: 4,
  },
  feedbackActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e7e5df',
    paddingTop: 4,
  },
  repliesWrap: {
    marginTop: 12,
    backgroundColor: '#f8faf7',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#e2e1da',
    padding: 12,
  },
  noReplies: {
    fontStyle: "italic",
    color: "#9ca3af",
    marginBottom: 8,
  },
  replyItem: {
    marginBottom: 12,
  },
  replyHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  replyAuthor: {
    fontWeight: "600",
    fontSize: 13,
  },
  replyTime: {
    fontSize: 11,
    color: "#6b7280",
  },
  replyBody: {
    fontSize: 14,
    color: "#374151",
    marginTop: 2,
  },
  replyActions: {
    flexDirection: "row",
    marginTop: 4,
  },
  replyDivider: {
    marginVertical: 12,
  },
  replyInput: {
    backgroundColor: "#fff",
    marginBottom: 8,
  },
  replyAnonRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  replyAnonText: {
    fontSize: 13,
    color: "#4b5563",
  },
});
