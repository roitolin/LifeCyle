import { Alert, Linking, StyleSheet, View } from "react-native";
import { Button, Card, Text } from "react-native-paper";
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
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          {navigation.canGoBack() && (
            <AppBackButton style={styles.backLink} onPress={() => navigation.goBack()} />
          )}
          <Text style={styles.kicker}>Almost Done</Text>
          <Text style={styles.title}>Verify Your Email</Text>
          <Text style={styles.message}>We sent a verification email to:</Text>
          <Text style={styles.email}>{email || "your email"}</Text>

          <View style={styles.stepsCard}>
            <Text style={styles.stepText}>1. Open your inbox and find the verification email.</Text>
            <Text style={styles.stepText}>2. Click the verification link in that message.</Text>
            <Text style={styles.stepText}>3. Return here, sign in, and continue to LifeCycle from the account hub.</Text>
          </View>
        </Card.Content>

        <Card.Actions style={styles.actions}>
          <Button mode="contained" icon="email-open-outline" onPress={openEmailApp}>
            Open Email App
          </Button>
          <Button mode="outlined" onPress={() => navigation.navigate("Login")}>
            Back to Login
          </Button>
        </Card.Actions>
      </Card>
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
  },
  backLink: {
    alignSelf: "flex-start",
    marginBottom: 6,
  },

  kicker: {
    color: "#9ca3af",
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
    fontWeight: "700",
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
  stepsCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff7f7",
    padding: 12,
    gap: 6,
  },
  stepText: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 21,
  },
  actions: {
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
});

