import { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from "react-native";
import { BlurView } from "expo-blur";
import { Button } from "react-native-paper";
import { useAuth } from "../../context/AuthContext";
import { confirmLogout } from "../../utils/logoutConfirmation";

export default function TermsAndConditionsScreen() {
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const { acceptTerms, logout } = useAuth();

  const handleLogout = () => confirmLogout({ logout });

  const handleContinue = async () => {
    if (!accepted) {
      Alert.alert("Required", "Please accept the Terms & Conditions to continue.");
      return;
    }

    setSaving(true);
    try {
      await acceptTerms();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to save your acceptance.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.fakeBackgroundLayer}>
        <View style={[styles.fakeStrip, { width: "88%" }]} />
        <View style={[styles.fakeStrip, { width: "72%" }]} />
        <View style={[styles.fakeStrip, { width: "80%" }]} />
      </View>

      <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFillObject} />

      <View style={styles.modalWrap}>
        <View style={styles.modalCard}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Terms & Conditions</Text>
            <Text style={styles.updated}>Effective Date: April 2, 2026</Text>

            <Text style={styles.body}>
              By using LifeCycle, you agree to provide accurate information, communicate
              respectfully, and use the platform only for legitimate funeral service coordination.
            </Text>
            <Text style={styles.body}>
              LifeCycle connects families and funeral service providers but does not replace legal,
              financial, or professional care advice. Users should verify service details directly
              with the selected provider.
            </Text>
            <Text style={styles.body}>
              You are responsible for the accuracy of submitted arrangement details, communication
              with providers, and compliance with local requirements.
            </Text>

            <Pressable
              style={styles.acceptRow}
              onPress={() => setAccepted((prev) => !prev)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accepted }}
            >
              <View style={[styles.checkboxBox, accepted && styles.checkboxBoxChecked]}>
                {accepted ? <Text style={styles.checkboxMark}>✓</Text> : null}
              </View>
              <Text style={styles.acceptText}>I have read and agree to the Terms & Conditions.</Text>
            </Pressable>
          </ScrollView>

          <View style={styles.footer}>
            <Button mode="contained" onPress={handleContinue} loading={saving} disabled={saving}>
              Accept and Continue
            </Button>
            <Pressable style={styles.logoutLink} onPress={handleLogout}>
              <Text style={styles.logoutText}>Log out</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#eef2f6",
  },
  fakeBackgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
    opacity: 0.7,
  },
  fakeStrip: {
    height: 78,
    borderRadius: 14,
    backgroundColor: "#d8dde3",
  },
  modalWrap: {
    width: "100%",
    paddingHorizontal: 18,
  },
  modalCard: {
    maxWidth: 620,
    alignSelf: "center",
    width: "100%",
    height: "78%",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 10,
  },
  content: { padding: 18, paddingBottom: 26 },
  title: { fontSize: 26, fontWeight: "700", color: "#b71c1c", marginBottom: 8 },
  updated: { fontSize: 13, color: "#6d737a", marginBottom: 18 },
  body: {
    fontSize: 15,
    color: "#222",
    lineHeight: 23,
    marginBottom: 14,
  },
  acceptRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 8,
    gap: 12,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#b91c1c",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxBoxChecked: {
    backgroundColor: "#b91c1c",
    borderColor: "#b91c1c",
  },
  checkboxMark: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 15,
    lineHeight: 16,
  },
  acceptText: {
    flex: 1,
    fontSize: 15,
    color: "#333",
    lineHeight: 22,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  logoutLink: {
    alignSelf: "center",
    paddingVertical: 10,
  },
  logoutText: {
    fontSize: 15,
    color: "#b91c1c",
    fontWeight: "600",
  },
});
