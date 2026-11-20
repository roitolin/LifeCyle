import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";
import * as SplashScreen from "expo-splash-screen";
import { colors } from "@/theme";

type StartupConnection = "checking" | "offline" | "ready";

function isOffline(state: NetworkState) {
  return state.isConnected === false || state.isInternetReachable === false;
}

export default function StartupConnectionGate({ children }: PropsWithChildren) {
  const [connection, setConnection] = useState<StartupConnection>("checking");
  const [retrying, setRetrying] = useState(false);
  const checkSequence = useRef(0);
  const ready = connection === "ready";

  const reportNetwork = useCallback((state: NetworkState) => {
    setConnection(current => current === "ready" || !isOffline(state) ? "ready" : "offline");
    setRetrying(false);
  }, []);

  const check = useCallback(async () => {
    const request = ++checkSequence.current;
    setRetrying(true);
    try {
      const state = await getNetworkStateAsync();
      if (request === checkSequence.current) reportNetwork(state);
    } catch {
      if (request !== checkSequence.current) return;
      setConnection(current => current === "checking" ? "ready" : current);
      setRetrying(false);
    }
  }, [reportNetwork]);

  useEffect(() => {
    if (ready) return;
    const network = addNetworkStateListener(state => {
      checkSequence.current += 1;
      reportNetwork(state);
    });
    const foreground = AppState.addEventListener("change", state => {
      if (state === "active") void check();
    });
    void check();
    return () => {
      checkSequence.current += 1;
      network.remove();
      foreground.remove();
    };
  }, [check, ready, reportNetwork]);

  if (ready) return <>{children}</>;
  if (connection === "checking") return <View style={styles.screen} />;

  return (
    <View style={styles.screen} onLayout={() => void SplashScreen.hideAsync().catch(() => undefined)}>
      <View style={styles.content}>
        <View style={styles.icon} accessible={false} importantForAccessibility="no">
          <Ionicons name="cloud-offline-outline" size={32} color={colors.primary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">No internet connection</Text>
        <Text style={styles.body}>Connect to Wi-Fi or mobile data to open LifeCycle.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: retrying, disabled: retrying }}
          disabled={retrying}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => void check()}
        >
          <Text style={styles.buttonText}>{retrying ? "Checking…" : "Try again"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, backgroundColor: colors.surfaceWarm },
  content: { width: "100%", maxWidth: 360, alignItems: "center", gap: 12 },
  icon: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 23, fontWeight: "700", color: colors.text, textAlign: "center" },
  body: { color: colors.textMuted, lineHeight: 21, fontSize: 15, textAlign: "center" },
  button: { backgroundColor: colors.primary, minHeight: 44, minWidth: 116, borderRadius: 8, paddingHorizontal: 18, justifyContent: "center", alignItems: "center", marginTop: 8 },
  buttonPressed: { backgroundColor: colors.primaryDark },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
