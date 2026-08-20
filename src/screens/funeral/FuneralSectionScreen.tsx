import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

type FuneralSectionScreenProps = {
  navigation: any;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  badge: string;
};

export default function FuneralSectionScreen({
  navigation,
  icon,
  title,
  description,
  badge,
}: FuneralSectionScreenProps) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <View style={styles.glowTop} pointerEvents="none" />
      <View style={styles.glowBottom} pointerEvents="none" />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.topRow}>
            <View style={styles.badgeCircle}>
              <Ionicons name={icon} size={24} color="#5a6b64" />
            </View>
            <TouchableOpacity style={styles.hubButton} onPress={() => navigation.getParent()?.navigate("ServiceHub")}>
              <Ionicons name="apps-outline" size={16} color="#5a6b64" />
              <Text style={styles.hubButtonText}>Service Hub</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.kicker}>Funeral Service</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{description}</Text>

          <View style={styles.statusPill}>
            <Text style={styles.statusText}>{badge}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#e4ebe4",
  },
  glowTop: {
    position: "absolute",
    top: -100,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "#cad5cc",
  },
  glowBottom: {
    position: "absolute",
    left: -90,
    bottom: -60,
    width: 280,
    height: 280,
    borderRadius: 999,
    backgroundColor: "#fbfcf8",
  },
  content: {
    flexGrow: 1,
    padding: 20,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: "#cad5cc",
    shadowColor: "#5a6b64",
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  badgeCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f4ef",
  },
  hubButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cad5cc",
    backgroundColor: "#fbfcf8",
  },
  hubButtonText: {
    color: "#5a6b64",
    fontWeight: "800",
  },
  kicker: {
    color: "#66746f",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    color: "#0f172a",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    marginBottom: 10,
  },
  body: {
    color: "#66746f",
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 18,
  },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "#e4ebe4",
  },
  statusText: {
    color: "#5a6b64",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
