import { useMemo, useState } from "react";
import { Alert, Image, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Card } from "react-native-paper";
import { Picker } from "@react-native-picker/picker";
import * as ImagePicker from "expo-image-picker";
import { KeyboardAwareScrollView } from "@/components";
import { useAuth } from "../../context/AuthContext";
import { useResponsive } from "../../utils/responsive";
import { uploadReportEvidence } from '../../services/supabaseStorage';
import { db } from "../../services/supabaseAuth";
import { reportUserAbuse } from "../../utils/userModeration";
import { consumeRateLimit, isRateLimitError } from "../../utils/rateLimiter";
import { hasSuspiciousPayload, sanitizePlainText } from "../../utils/inputSecurity";

const REASONS = ["Spam", "Harassment", "Fake Information", "No-show", "Scam Attempt", "Other"];

export default function ReportCenterScreen({ route, navigation }: any) {
  const { user } = useAuth();
  const { isDesktop } = useResponsive();
  const prefilledTargetUserId = route.params?.targetUserId || "";
  const prefilledRequestId = route.params?.requestId || "";
  const prefilledConversationId = route.params?.conversationId || "";
  const reportSource = route.params?.source || "report_center";
  const initialReason = route.params?.initialReason;

  const [targetUserId, setTargetUserId] = useState(prefilledTargetUserId);
  const [reason, setReason] = useState(REASONS.includes(initialReason) ? initialReason : REASONS[0]);
  const [details, setDetails] = useState("");
  const [evidenceUri, setEvidenceUri] = useState<string | null>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    return Boolean(user?.uid && targetUserId.trim() && reason.trim());
  }, [reason, targetUserId, user?.uid]);

  const pickEvidence = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.75,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets?.[0]) {
      setEvidenceUri(result.assets[0].uri);
    }
  };

  const submitReport = async () => {
    if (!user?.uid) {
      Alert.alert("Error", "You must be logged in.");
      return;
    }
    const safeTargetUserId = sanitizePlainText(targetUserId, 64);
    const safeReason = sanitizePlainText(reason, 80);
    const safeDetails = sanitizePlainText(details, 1500);

    if (!safeTargetUserId) {
      Alert.alert("Required", "Target user ID is required.");
      return;
    }
    if (hasSuspiciousPayload(safeReason) || hasSuspiciousPayload(safeDetails)) {
      Alert.alert("Blocked", "Report contains unsafe text patterns. Please revise and try again.");
      return;
    }

    setSubmitting(true);
    try {
      await consumeRateLimit(db, user.uid, "abuse_report", safeTargetUserId);

      let evidenceURL: string | null = null;
      if (evidenceUri) {
        setUploadingEvidence(true);
        evidenceURL = await uploadReportEvidence(evidenceUri);
        setUploadingEvidence(false);
      }

      await reportUserAbuse({
        reporterId: user.uid,
        reporterName: user.displayName || user.email || null,
        targetUserId: safeTargetUserId,
        reason: safeReason,
        details: safeDetails || undefined,
        evidenceURL,
        source: reportSource,
        requestId: prefilledRequestId || undefined,
        conversationId: prefilledConversationId || undefined,
      });

      Alert.alert("Report Submitted", "Thanks for reporting. Admin will review this incident.", [
        {
          text: "OK",
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error: any) {
      if (isRateLimitError(error)) {
        Alert.alert("Slow down", `Please wait ${error.retryAfterSeconds}s before submitting another report.`);
        return;
      }
      Alert.alert("Error", error?.message || "Failed to submit report.");
    } finally {
      setSubmitting(false);
      setUploadingEvidence(false);
    }
  };

  return (
    <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}>
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <Text style={styles.title}>Report Center</Text>
          <Text style={styles.subtitle}>
            Report suspicious behavior, abuse, scams, or fake information. Admin reviews all reports in Moderation Queue.
          </Text>

          <View style={styles.uidBanner}>
            <Text style={styles.uidBannerLabel}>Your UID</Text>
            <Text style={styles.uidBannerValue}>{user?.uid || "Unknown"}</Text>
          </View>

          <Text style={styles.label}>Target User ID *</Text>
          <TextInput
            value={targetUserId}
            onChangeText={setTargetUserId}
            style={styles.input}
            autoCapitalize="none"
          />

          <Text style={styles.label}>Reason *</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={reason} onValueChange={(value) => setReason(String(value))}>
              {REASONS.map((item: any) => (
                <Picker.Item key={item} label={item} value={item} />
              ))}
            </Picker>
          </View>

          <Text style={styles.label}>Details</Text>
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Describe what happened..."
            style={[styles.input, styles.textArea]}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />

          <Text style={styles.label}>Evidence Upload (optional)</Text>
          <View style={styles.evidenceWrap}>
            {evidenceUri ? (
              <Image source={{ uri: evidenceUri }} style={styles.evidencePreview} resizeMode="cover" />
            ) : (
              <Text style={styles.evidenceHint}>Attach screenshot or proof image.</Text>
            )}
            <View style={styles.evidenceActions}>
              <Button mode="outlined" onPress={pickEvidence} disabled={submitting || uploadingEvidence}>
                {evidenceUri ? "Replace Evidence" : "Upload Evidence"}
              </Button>
              {evidenceUri ? (
                <Button mode="text" onPress={() => setEvidenceUri(null)} disabled={submitting || uploadingEvidence}>
                  Remove
                </Button>
              ) : null}
            </View>
          </View>

          <Button
            mode="contained"
            onPress={submitReport}
            disabled={!canSubmit || submitting}
            loading={submitting || uploadingEvidence}
            style={styles.submitButton}
          >
            {submitting || uploadingEvidence ? "Submitting..." : "Submit Report"}
          </Button>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>How admin handles your report</Text>
            <Text style={styles.infoText}>1. Report goes to Admin Moderation Queue.</Text>
            <Text style={styles.infoText}>2. Admin reviews evidence and linked request/chat context.</Text>
            <Text style={styles.infoText}>3. Admin updates status to reviewing, resolved, or dismissed.</Text>
          </View>
        </Card.Content>
      </Card>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  container: {
    padding: 16,
    paddingBottom: 120,
    backgroundColor: "#f5f5f5",
  },
  containerDesktop: {
    maxWidth: 760,
    width: "100%",
    alignSelf: "center",
  },
  card: {
    borderRadius: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#b91c1c",
  },
  subtitle: {
    color: "#4b5563",
    marginTop: 4,
    marginBottom: 8,
  },
  uidBanner: {
    borderWidth: 1,
    borderColor: "#ddd6fe",
    backgroundColor: "#f5f3ff",
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
  },
  uidBannerLabel: {
    color: "#5b21b6",
    fontWeight: "700",
    fontSize: 12,
  },
  uidBannerValue: {
    color: "#312e81",
    fontWeight: "800",
    marginTop: 2,
  },
  label: {
    marginTop: 10,
    marginBottom: 4,
    color: "#111827",
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  textArea: {
    minHeight: 110,
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  evidenceWrap: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    backgroundColor: "#fff",
    padding: 10,
    gap: 8,
  },
  evidenceHint: {
    color: "#6b7280",
    fontSize: 13,
  },
  evidencePreview: {
    width: "100%",
    height: 180,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
  },
  evidenceActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  submitButton: {
    marginTop: 12,
    borderRadius: 10,
  },
  infoCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 10,
    backgroundColor: "#f9fafb",
    gap: 2,
  },
  infoTitle: {
    color: "#111827",
    fontWeight: "800",
    marginBottom: 3,
  },
  infoText: {
    color: "#4b5563",
    fontSize: 13,
  },
});
