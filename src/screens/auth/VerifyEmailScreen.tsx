import { Alert, Linking, StyleSheet, View } from "react-native";
import { Button, Text } from "react-native-paper";
import { AppBackButton } from "@/components";

export default function VerifyEmailScreen({ navigation, route }: any) {
  const { email } = route.params || {};

  const openEmailApp = async () => {
    try {
      await Linking.openURL("mailto:");
    } catch {
      Alert.alert("Error", "Could not open email app. Please check your email manually.");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View>
          {navigation.canGoBack() && (
            <AppBackButton style={styles.backLink} onPress={() => navigation.goBack()} />
          )}
          <Text style={styles.title}>Verify Your Email</Text>
          <Text style={styles.message}>We sent a verification email to:</Text>
          <Text style={styles.email}>{email || "your email"}</Text>

          <View style={styles.steps}>
            <Text style={styles.stepText}>1. Open your inbox and find the verification email.</Text>
            <Text style={styles.stepText}>2. Click the verification link in that message.</Text>
            <Text style={styles.stepText}>3. Return here, sign in, and continue to LifeCycle from the account hub.</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Button mode="contained" icon="email-open-outline" onPress={openEmailApp}>
            Open Email App
          </Button>
          <Button mode="outlined" onPress={() => navigation.navigate("Login")}>
            Back to Login
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 560,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d8e0e8",
    backgroundColor: "#ffffff",
    padding: 18,
  },
  backLink: {
    alignSelf: "flex-start",
    marginBottom: 6,
  },

  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#b91c1c",
    marginBottom: 8,
  },
  message: {
    color: "#4b5563",
    fontSize: 15,
  },
  email: {
    fontSize: 17,
    color: "#dc2626",
    fontWeight: "700",
    marginTop: 4,
    marginBottom: 14,
  },
  steps: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 14,
    gap: 6,
  },
  stepText: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 21,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    paddingTop: 16,
  },
});
