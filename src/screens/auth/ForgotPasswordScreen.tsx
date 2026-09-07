import { useEffect, useRef, useState } from "react";
import {
  Animated,
  View,
  Text,
  Image,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  findNodeHandle,
} from "react-native";
import { Button as PaperButton } from "react-native-paper";
import { AppBackButton, KeyboardAwareScrollView } from "@/components";
import { supabase } from "../../services/supabaseClient";
import { getSupabaseEmailRedirectTo } from "../../services/supabaseAuthRedirect";
import { useResponsive } from "../../utils/responsive";
import { useAppDialog } from "../../hooks/useAppDialog";

export default function ForgotPasswordScreen({ navigation, route }: any) {
  const [email, setEmail] = useState(route.params?.email || "");
  const [loading, setLoading] = useState(false);
  const { isDesktop } = useResponsive();
  const scrollRef = useRef<any>(null);
  const emailRef = useRef<TextInput>(null);
  const entrance = useRef(new Animated.Value(0)).current;
  const { showDialog, dialog } = useAppDialog();

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const scrollToInput = (inputRef: any) => {
    const inputHandle = findNodeHandle(inputRef.current);
    if (!inputHandle) return;
    (scrollRef.current as any)?.scrollResponderScrollNativeHandleToKeyboard(inputHandle, 120, true);
  };

  const getResetErrorMessage = (error: any) => {
    const code = error?.code || "";

    if (code === "auth/invalid-email") {
      return "Please enter a valid email address.";
    }
    if (code === "auth/user-not-found") {
      return "No account was found for that email address.";
    }
    if (code === "auth/too-many-requests") {
      return "Too many reset attempts. Please wait a moment and try again.";
    }
    if (code === "auth/network-request-failed") {
      return "Network error. Please check your internet connection.";
    }
    return "Unable to send the reset email right now. Please try again.";
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      showDialog({
        title: "Email Required",
        message: "Please enter your email address first.",
        tone: "warning",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getSupabaseEmailRedirectTo(),
      });
      if (error) throw error;
      showDialog({
        title: "Reset Email Sent",
        message: `We sent a password reset link to ${email.trim()}. Check your inbox and spam folder, then come back once you've updated your password.`,
        tone: "success",
        actions: [
          {
            label: "Back to Login",
            mode: "contained",
            onPress: () => navigation.navigate("Login", { email: email.trim() }),
          },
        ],
      });
    } catch (error: any) {
      showDialog({
        title: "Reset Failed",
        message: getResetErrorMessage(error),
        tone: "danger",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.glowTop} pointerEvents="none" />
      <View style={styles.glowBottom} pointerEvents="none" />

      <KeyboardAwareScrollView
        ref={scrollRef}
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.authWrap, isDesktop && styles.authWrapDesktop]}>
          {isDesktop && (
            <Animated.View
              style={[
                styles.introCard,
                {
                  opacity: entrance,
                  transform: [
                    {
                      translateY: entrance.interpolate({
                        inputRange: [0, 1],
                        outputRange: [18, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text style={styles.introTitle}>Return to LifeCycle</Text>
              <Text style={styles.introBody}>Your service requests and messages will be waiting after you sign in.</Text>
            </Animated.View>
          )}

          <Animated.View
            style={[
              styles.container,
              isDesktop && styles.containerDesktop,
              {
                opacity: entrance,
                transform: [
                  {
                    translateY: entrance.interpolate({
                      inputRange: [0, 1],
                      outputRange: [28, 0],
                    }),
                  },
                  {
                    scale: entrance.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.98, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <AppBackButton style={styles.backRow} onPress={() => navigation.goBack()} accessibilityLabel="Back to login" />

            <Image source={require("../../../assets/Icon/AppICONTransparents.png")} style={styles.logo} resizeMode="contain" />
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              Enter your email and we&apos;ll send a reset link so you can create a new password.
            </Text>

            <TextInput
              ref={emailRef}
              placeholder="Email"
              placeholderTextColor="#9ca3af"
              value={email}
              onChangeText={setEmail}
              onFocus={() => scrollToInput(emailRef)}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              importantForAutofill="yes"
              returnKeyType="done"
              onSubmitEditing={handleResetPassword}
              style={styles.input}
            />

            <PaperButton
              mode="contained"
              loading={loading}
              disabled={loading}
              onPress={handleResetPassword}
              style={styles.primaryButton}
              contentStyle={styles.primaryButtonContent}
              labelStyle={styles.primaryButtonLabel}
              buttonColor="#22312d"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </PaperButton>

            <TouchableOpacity onPress={() => navigation.navigate("Login", { email: email.trim() })} style={styles.linkWrap}>
              <Text style={styles.link}>Remembered it? Back to login</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </KeyboardAwareScrollView>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8f6f2" },
  glowTop: {
    position: "absolute",
    top: -140,
    left: -90,
    width: 300,
    height: 300,
    borderRadius: 999,
    backgroundColor: "#ebf1e8",
  },
  glowBottom: {
    position: "absolute",
    right: -110,
    bottom: 30,
    width: 320,
    height: 320,
    borderRadius: 999,
    backgroundColor: "#dce6d7",
  },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 20 },
  authWrap: { width: "100%" },
  authWrapDesktop: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 18,
    maxWidth: 1080,
    width: "100%",
    alignSelf: "center",
  },
  container: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },
  backRow: {
    alignSelf: "flex-start",
    marginBottom: 12,
  },
  logo: {
    width: 104,
    height: 104,
    alignSelf: "center",
    marginBottom: 8,
  },
  title: { fontSize: 38, fontWeight: "800", textAlign: "center", marginBottom: 6, color: "#22312d" },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    color: "#62706b",
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 13,
    backgroundColor: "#ffffff",
    color: "#1f2937",
    fontSize: 16,
  },
  primaryButton: {
    borderRadius: 999,
    marginTop: 8,
  },
  primaryButtonContent: {
    paddingVertical: 10,
  },
  primaryButtonLabel: {
    fontWeight: "800",
    fontSize: 20,
    lineHeight: 24,
    includeFontPadding: false,
  },
  linkWrap: {
    marginTop: 14,
  },
  link: { color: "#41514d", textAlign: "center", fontWeight: "700", fontSize: 15 },
  containerDesktop: {
    maxWidth: 440,
    width: "100%",
    alignSelf: "center",
  },
  introCard: {
    flex: 1,
    backgroundColor: "#f8f6f2",
    borderRadius: 28,
    padding: 28,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    justifyContent: "center",
  },
  introTitle: {
    color: "#22312d",
    fontSize: 34,
    fontWeight: "800",
    marginBottom: 10,
  },
  introBody: {
    color: "#41514d",
    fontSize: 17,
    lineHeight: 25,
    maxWidth: 420,
  },
});
