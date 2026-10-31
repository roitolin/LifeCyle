import { useState } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  TextInput,
  Alert,
  StyleSheet,
  Linking,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Dialog, Portal, Button as PaperButton } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { KeyboardAwareScrollView } from "@/components";
import { useAuth } from "../../context/AuthContext";
import { useResponsive } from "../../utils/responsive";
import { ensureConversationForUsers } from "../../utils/chatHelpers";
import { consumeRateLimit, isRateLimitError } from "../../utils/rateLimiter";
import { hasSuspiciousPayload, sanitizePlainText } from "../../utils/inputSecurity";
import { getAdminId } from "../../utils/adminConfig";
import { colors, radii, spacing } from "@/theme";

const SUPPORT_PHONE = "+639123456789";
const isPermissionDeniedError = (error: any) =>
  error?.code === "permission-denied" ||
  /missing or insufficient permissions/i.test(String(error?.message || ""));

export default function ContactScreen({ navigation }: any) {
  const { user } = useAuth();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [successDialogVisible, setSuccessDialogVisible] = useState(false);
  const { isDesktop } = useResponsive();

  const ensureSupportConversation = async () => {
    if (!user?.uid) {
      throw new Error("Please log in again before contacting support.");
    }
    const adminUserId = await getAdminId({
      excludeUserId: user.uid,
      allowExcludedFallback: true,
    });
    if (!adminUserId) {
      throw new Error("Support chat is unavailable because no admin support account is configured yet.");
    }

    const conversationId = await ensureConversationForUsers(null, user.uid, adminUserId);
    return { conversationId, adminUserId };
  };

  const handleCall = async () => {
    const url = `tel:${SUPPORT_PHONE.replace(/\s+/g, "")}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Unavailable", "Calling is not available on this device.");
    }
  };

  const handleSms = async () => {
    const url = `sms:${SUPPORT_PHONE.replace(/\s+/g, "")}?body=${encodeURIComponent(
      "Hello Support Team, I need help with LifeCycle."
    )}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Unavailable", "SMS is not available on this device.");
    }
  };

  const handleOpenChat = async () => {
    try {
      const { conversationId, adminUserId } = await ensureSupportConversation();
      navigation.navigate("SupportChat", {
        conversationId,
        otherUserId: adminUserId,
      });
    } catch (error: any) {
      if (isPermissionDeniedError(error)) {
        Alert.alert(
          "Support Chat Unavailable",
          "Live chat is temporarily unavailable because your account could not open the assigned support conversation. You can still send your concern below and our support team will receive it."
        );
        return;
      }
      Alert.alert("Error", error?.message || "Failed to open support chat.");
    }
  };

  const handleSubmit = async () => {
    if (!user?.uid) {
      Alert.alert("Session Ended", "Please log in again before sending a support message.");
      return;
    }

    const safeSubject = sanitizePlainText(subject, 120);
    const safeMessage = sanitizePlainText(message, 1200);

    if (!safeSubject || !safeMessage) {
      Alert.alert("Error", "Please fill in both subject and message.");
      return;
    }
    if (hasSuspiciousPayload(safeSubject) || hasSuspiciousPayload(safeMessage)) {
      Alert.alert("Blocked", "Your message contains unsafe text patterns. Please revise and try again.");
      return;
    }

    setLoading(true);
    try {
      await consumeRateLimit(null, user.uid, "support_message");

      const { conversationId, adminUserId } = await ensureSupportConversation();
      const messageText = `${safeSubject}\n\n${safeMessage}`;
      const previewText = `${safeSubject}: ${safeMessage.substring(0, 50)}${safeMessage.length > 50 ? "..." : ""}`;
      const notificationBody = `${safeSubject}: ${safeMessage.substring(0, 100)}${safeMessage.length > 100 ? "..." : ""}`;

      const { data: sentMessage, error: messageError } = await supabase
        .from("messages")
        .insert({
          conversationId,
          senderId: user.uid,
          text: messageText,
          readBy: [user.uid],
        })
        .select("id")
        .single();
      if (messageError) throw messageError;

      const { data: convData } = await supabase.from("conversations").select("hiddenFor").eq("id", conversationId).single();
      let currentHiddenFor = convData?.hiddenFor || [];
      if (!Array.isArray(currentHiddenFor)) currentHiddenFor = [];
      const updatedHiddenFor = currentHiddenFor.filter((id: string) => id !== user.uid && id !== adminUserId);

      const settled = await Promise.allSettled([
        supabase.from("conversations").update({
          lastMessage: {
            id: sentMessage.id,
            text: previewText,
            senderId: user.uid,
            timestamp: new Date().toISOString(),
            readBy: [user.uid],
          },
          hiddenFor: updatedHiddenFor,
          updatedAt: new Date().toISOString(),
        }).eq("id", conversationId),
        
        supabase.from("notifications").insert({
          userId: adminUserId,
          type: "support_message",
          title: `New Support Message from ${user?.email}`,
          body: notificationBody,
          read: false,
          data: { conversationId, otherUserId: user.uid },
        }),
      ]);

      settled.forEach((result) => {
        if (result.status === "rejected" && !isPermissionDeniedError(result.reason)) {
          console.warn("Support follow-up write failed:", result.reason);
        }
      });

      setSubject("");
      setMessage("");
      setSuccessDialogVisible(true);
    } catch (error: any) {
      if (isRateLimitError(error)) {
        Alert.alert("Slow down", `Please wait ${error.retryAfterSeconds}s before sending another support message.`);
        return;
      }

      if (isPermissionDeniedError(error)) {
        try {
          await supabase.from("support_messages").insert({
            userId: user.uid,
            email: user.email || null,
            subject: safeSubject,
            message: safeMessage,
            read: false,
            status: "open",
            channel: "contact_fallback",
          });
          setSubject("");
          setMessage("");
          Alert.alert(
            "Message Sent",
            "Your message was sent via fallback support channel. Our team will still receive and review it."
          );
          return;
        } catch (fallbackError: any) {
          console.error("Fallback support message failed:", fallbackError);
        }
      }

      Alert.alert("Error", "Unable to send your support message right now. Please try again shortly.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}>
      <View style={styles.introCard}>
        <View style={styles.introIcon}>
          <Ionicons name="headset-outline" size={24} color={colors.primary} />
        </View>
        <View style={styles.introCopy}>
          <Text style={styles.introTitle}>How can we help?</Text>
          <Text style={styles.subtitle}>Choose a quick option or send the support team a detailed message.</Text>
        </View>
      </View>

      <View style={styles.quickActions}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Call support" style={styles.quickButton} onPress={handleCall} activeOpacity={0.8}>
          <View style={styles.quickButtonIcon}>
            <Ionicons name="call-outline" size={20} color={colors.primary} />
          </View>
          <Text style={styles.quickButtonText}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Text support" style={styles.quickButton} onPress={handleSms} activeOpacity={0.8}>
          <View style={styles.quickButtonIcon}>
            <Ionicons name="chatbox-outline" size={20} color={colors.primary} />
          </View>
          <Text style={styles.quickButtonText}>Text</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open support chat" style={[styles.quickButton, styles.quickButtonPrimary]} onPress={handleOpenChat} activeOpacity={0.8}>
          <View style={[styles.quickButtonIcon, styles.quickButtonIconPrimary]}>
            <Ionicons name="chatbubbles-outline" size={20} color="#ffffff" />
          </View>
          <Text style={[styles.quickButtonText, styles.quickButtonTextPrimary]}>Chat</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.formTitle}>Send a message</Text>
        <Text style={styles.formDescription}>Include any order or service-request reference that can help us investigate.</Text>

        <Text style={styles.label}>Subject</Text>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          placeholder="e.g. Payment question"
          placeholderTextColor="#89958f"
          maxLength={120}
          returnKeyType="next"
        />

        <View style={styles.messageLabelRow}>
          <Text style={styles.label}>Message</Text>
          <Text style={styles.characterCount}>{message.length}/1200</Text>
        </View>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={message}
          onChangeText={setMessage}
          placeholder="Describe what happened and what you need help with"
          placeholderTextColor="#89958f"
          multiline
          numberOfLines={6}
          maxLength={1200}
          textAlignVertical="top"
        />

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={loading ? "Sending message" : "Send message"}
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? <ActivityIndicator color="#ffffff" size="small" /> : <Ionicons name="send-outline" size={18} color="#ffffff" />}
          <Text style={styles.submitButtonText}>{loading ? "Sending..." : "Send message"}</Text>
        </TouchableOpacity>
      </View>

      <Portal>
        <Dialog visible={successDialogVisible} onDismiss={() => setSuccessDialogVisible(false)}>
          <Dialog.Title>Message Sent</Dialog.Title>
          <Dialog.Content>
            <Text>Your support message was sent successfully. The admin team will reply soon.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <PaperButton onPress={() => setSuccessDialogVisible(false)}>
              Close
            </PaperButton>
            <PaperButton
              onPress={async () => {
                setSuccessDialogVisible(false);
                await handleOpenChat();
              }}
            >
              Open Support Chat
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceMuted },
  container: { flexGrow: 1, padding: spacing.lg, paddingBottom: 64, backgroundColor: colors.surfaceMuted },
  introCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderWarm, backgroundColor: colors.surfaceWarm, padding: spacing.lg, marginBottom: spacing.md },
  introIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#e4eee9" },
  introCopy: { flex: 1 },
  introTitle: { color: colors.text, fontSize: 18, fontWeight: "900", marginBottom: 3 },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  quickActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  quickButton: {
    flex: 1,
    minHeight: 82,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  quickButtonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  quickButtonIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#edf3f0" },
  quickButtonIconPrimary: { backgroundColor: "rgba(255,255,255,0.16)" },
  quickButtonText: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 13,
  },
  quickButtonTextPrimary: { color: "#ffffff" },
  formCard: { borderRadius: radii.xl, borderWidth: 1, borderColor: colors.borderWarm, backgroundColor: colors.surface, padding: spacing.lg },
  formTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  formDescription: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: spacing.lg },
  label: { color: colors.text, fontSize: 13, fontWeight: "800", marginBottom: spacing.sm },
  messageLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg },
  characterCount: { color: colors.textMuted, fontSize: 11, marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    fontSize: 14,
    color: colors.text,
    backgroundColor: "#fbfcfb",
  },
  textArea: { minHeight: 150, textAlignVertical: "top" },
  submitButton: { minHeight: 50, borderRadius: radii.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.primaryDark, marginTop: spacing.lg },
  submitButtonDisabled: { opacity: 0.62 },
  submitButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
  containerDesktop: { maxWidth: 600, alignSelf: "center", width: "100%" },
});


