import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "@/components";
import { useAuth } from "@/context/AuthContext";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "@/utils/notificationPreferences";

type PreferenceKey = keyof NotificationPreferences;

type PreferenceRowProps = {
  description: string;
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
  last?: boolean;
};

type CategoryRow = Omit<
  PreferenceRowProps,
  "disabled" | "onValueChange" | "value"
> & { key: PreferenceKey };

const categoryRows: CategoryRow[] = [
  {
    key: "serviceRequests",
    icon: "receipt-outline",
    label: "Service requests",
    description: "Status changes and updates for your service requests.",
  },
  {
    key: "payments",
    icon: "card-outline",
    label: "Payments",
    description: "Payment instructions, submissions, and verification updates.",
  },
  {
    key: "messages",
    icon: "chatbubble-ellipses-outline",
    label: "Messages",
    description: "Alerts for new support and conversation messages.",
  },
  {
    key: "announcements",
    icon: "megaphone-outline",
    label: "Announcements",
    description: "Important news and newly available products.",
    last: true,
  },
];

export default function NotificationPreferencesScreen() {
  const { user } = useAuth();
  const userId = user?.id;
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const preferencesRef = useRef<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });
  const saveVersionRef = useRef(0);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setLoading(false);
      return undefined;
    }

    void getNotificationPreferences(userId).then((stored) => {
      if (!active) return;
      preferencesRef.current = stored;
      setPreferences(stored);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [userId]);

  const persistPreferences = useCallback(
    async (next: NotificationPreferences, version: number) => {
      if (!userId) return;
      try {
        await saveNotificationPreferences(userId, next);
        if (saveVersionRef.current === version) setStatus("saved");
      } catch (error) {
        console.warn("Unable to save notification preferences:", error);
        if (saveVersionRef.current === version) {
          const stored = await getNotificationPreferences(userId);
          preferencesRef.current = stored;
          setPreferences(stored);
          setStatus("error");
        }
      }
    },
    [userId]
  );

  const setPreference = (key: PreferenceKey, value: boolean) => {
    if (!userId) return;
    const version = saveVersionRef.current + 1;
    saveVersionRef.current = version;
    setStatus("saving");
    const next = { ...preferencesRef.current, [key]: value };
    preferencesRef.current = next;
    setPreferences(next);
    void persistPreferences(next, version);
  };

  const statusText =
    status === "saving"
      ? "Saving changes..."
      : status === "saved"
        ? "Changes saved"
        : status === "error"
          ? "Changes could not be saved. Try the switch again."
          : "Changes are saved automatically.";

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="notifications-outline" size={28} color="#ffffff" />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Notification preferences</Text>
            <Text style={styles.heroText}>
              Choose which updates appear in Notifications and whether alerts
              play a sound.
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#41514d" />
            <Text style={styles.loadingText}>Loading your preferences...</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>NOTIFICATION CATEGORIES</Text>
            <View style={styles.menuCard}>
              {categoryRows.map((row) => (
                <PreferenceRow
                  key={row.key}
                  icon={row.icon}
                  label={row.label}
                  description={row.description}
                  last={row.last}
                  disabled={!userId}
                  value={preferences[row.key]}
                  onValueChange={(value) => setPreference(row.key, value)}
                />
              ))}
            </View>

            <Text style={[styles.sectionLabel, styles.secondSectionLabel]}>
              ALERT SOUND
            </Text>
            <View style={styles.menuCard}>
              <PreferenceRow
                icon="volume-high-outline"
                label="Notification sound"
                description="Play a sound for enabled app and message notifications."
                disabled={!userId}
                value={preferences.sound}
                onValueChange={(value) => setPreference("sound", value)}
                last
              />
            </View>

            <TouchableOpacity
              accessibilityRole={status === "error" ? "alert" : "text"}
              disabled
              style={[styles.statusCard, status === "error" && styles.errorCard]}
            >
              <Ionicons
                name={
                  status === "error"
                    ? "alert-circle-outline"
                    : status === "saving"
                      ? "sync-outline"
                      : "checkmark-circle-outline"
                }
                size={20}
                color={status === "error" ? "#a52b2b" : "#2f6b4f"}
              />
              <Text
                style={[
                  styles.statusText,
                  status === "error" && styles.errorText,
                ]}
              >
                {userId ? statusText : "Sign in to manage notification preferences."}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function PreferenceRow({
  description,
  disabled = false,
  icon,
  label,
  onValueChange,
  value,
  last = false,
}: PreferenceRowProps) {
  return (
    <View style={[styles.menuRow, last && styles.lastRow]}>
      <View style={styles.menuIcon}>
        <Ionicons name={icon} size={22} color="#41514d" />
      </View>
      <View style={styles.menuCopy}>
        <Text style={styles.menuTitle}>{label}</Text>
        <Text style={styles.menuDescription}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={description}
        disabled={disabled}
        onValueChange={onValueChange}
        value={value}
        trackColor={{ false: "#c9cfcb", true: "#8eaa9d" }}
        thumbColor={value ? "#2f6b4f" : "#f4f4f4"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#eef1ec" },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: 18,
    paddingBottom: 120,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    borderRadius: 18,
    backgroundColor: "#22312d",
    marginBottom: 24,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  heroCopy: { flex: 1 },
  heroTitle: { color: "#ffffff", fontSize: 21, fontWeight: "900" },
  heroText: {
    color: "#d6dfda",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  sectionLabel: {
    color: "#62706b",
    fontSize: 11,
    fontWeight: "800",
    marginLeft: 2,
    marginBottom: 9,
  },
  secondSectionLabel: { marginTop: 20 },
  menuCard: {
    overflow: "hidden",
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
  },
  menuRow: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e7e5df",
  },
  lastRow: { borderBottomWidth: 0 },
  menuIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ebf1e8",
  },
  menuCopy: { flex: 1, minWidth: 0 },
  menuTitle: { color: "#22312d", fontSize: 15, fontWeight: "800" },
  menuDescription: {
    color: "#7a8580",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 3,
  },
  loadingCard: {
    minHeight: 170,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
  },
  loadingText: { color: "#7a8580", fontSize: 12 },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 14,
    padding: 13,
    borderRadius: 14,
    backgroundColor: "#e5efe5",
  },
  errorCard: { backgroundColor: "#fff0f0" },
  statusText: { flex: 1, color: "#41514d", fontSize: 12, lineHeight: 17 },
  errorText: { color: "#8f2929" },
});
