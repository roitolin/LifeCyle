import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";

export default function MobileLandingScreen({ navigation }: any) {
  const intro = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(intro, {
      toValue: 1,
      duration: 450,
      useNativeDriver: true,
    }).start();
  }, [intro]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.glowTop} pointerEvents="none" />
      <View style={styles.glowBottom} pointerEvents="none" />

      <Animated.View
        style={[
          styles.content,
          {
            opacity: intro,
            transform: [
              {
                translateY: intro.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View style={styles.heroCard}>
          <View style={styles.badge}>
            <Ionicons name="apps" size={22} color="#22312d" />
          </View>
          <Text style={styles.kicker}>Welcome</Text>
          <Text style={styles.title}>Log in to continue to LifeCycle</Text>
          <Text style={styles.subtitle}>
            Sign in or create an account first, then choose the service you want to open from the LifeCycle hub.
          </Text>
        </View>

        <Pressable style={styles.primaryButton} onPress={() => navigation.navigate("Login")}>
          <Text style={styles.primaryButtonText}>Log In</Text>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("Register")}>
          <Text style={styles.secondaryButtonText}>Create Account</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8f6f2",
  },
  glowTop: {
    position: "absolute",
    top: -120,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "#ebf1e8",
  },
  glowBottom: {
    position: "absolute",
    right: -100,
    bottom: -60,
    width: 280,
    height: 280,
    borderRadius: 999,
    backgroundColor: "#dce6d7",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  heroCard: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    shadowColor: "#22312d",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    marginBottom: 20,
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8f6f2",
    marginBottom: 14,
  },
  kicker: {
    color: "#5a6b64",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    color: "#111827",
    fontSize: 31,
    lineHeight: 36,
    fontWeight: "900",
    marginBottom: 10,
  },
  subtitle: {
    color: "#62706b",
    fontSize: 15,
    lineHeight: 23,
  },
  primaryButton: {
    borderRadius: 999,
    backgroundColor: "#22312d",
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  secondaryButton: {
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    paddingVertical: 15,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#22312d",
    fontSize: 16,
    fontWeight: "900",
  },
});
