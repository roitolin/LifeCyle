import { useEffect, useRef, useState } from "react";
import { Alert, Linking, StyleSheet, TextInput, View } from "react-native";
import { Button, Text } from "react-native-paper";
import { AppBackButton } from "@/components";
import { colors, radii, spacing } from "@/theme";
import { supabase } from "../../services/supabaseClient";
import { normalizeEmail } from "../../utils/inputSecurity";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailScreen({ navigation, route }: any) {
  const email = normalizeEmail(String(route?.params?.email || ""));
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [status, setStatus] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const getErrorMessage = (error: unknown) => {
    const message = String((error as { message?: string })?.message || "").toLowerCase();
    if (message.includes("rate limit")) return "Too many attempts. Please wait and try again.";
    if (message.includes("expired") || message.includes("invalid")) {
      return "That code is invalid or expired. Request a new code and try again.";
    }
    if (message.includes("network") || message.includes("fetch")) {
      return "Check your internet connection and try again.";
    }
    return "We could not verify that code. Please try again.";
  };

  const verifyCode = async () => {
    if (!email || code.length !== OTP_LENGTH) {
      setStatusIsError(true);
      setStatus(`Enter the complete ${OTP_LENGTH}-digit code from your email.`);
      codeInputRef.current?.focus();
      return;
    }
    setVerifying(true);
    setStatus("");
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw error;
      if (!data.session) throw new Error("Verification completed without an active session.");
      setStatusIsError(false);
      setStatus("Email verified. Opening your LifeCycle account...");
    } catch (error) {
      setCode("");
      setStatusIsError(true);
      setStatus(getErrorMessage(error));
      codeInputRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const resendCode = async () => {
    if (!email || resending || resendCooldown > 0) return;
    setResending(true);
    setStatus("");
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw error;
      setCode("");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setStatusIsError(false);
      setStatus("A new code was sent. Check your inbox and spam folder.");
      codeInputRef.current?.focus();
    } catch (error) {
      setStatusIsError(true);
      setStatus(getErrorMessage(error));
    } finally {
      setResending(false);
    }
  };

  const openEmailApp = async () => {
    try {
      await Linking.openURL("mailto:");
    } catch {
      Alert.alert("Error", "Could not open email app. Please check your email manually.");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View>
          {navigation.canGoBack() && (
            <AppBackButton style={styles.backLink} onPress={() => navigation.goBack()} />
          )}
          <Text style={styles.title}>Enter Verification Code</Text>
          <Text style={styles.message}>We sent a {OTP_LENGTH}-digit code to:</Text>
          <Text style={styles.email}>{email || "your email"}</Text>

          <View style={styles.codeControl}>
            <View pointerEvents="none" style={styles.codeBoxes}>
              {Array.from({ length: OTP_LENGTH }, (_, index) => {
                const digit = code[index] || "";
                const isActive = codeFocused && index === Math.min(code.length, OTP_LENGTH - 1);
                return (
                  <View
                    key={index}
                    style={[
                      styles.codeBox,
                      digit ? styles.codeBoxFilled : null,
                      isActive ? styles.codeBoxActive : null,
                    ]}
                  >
                    <Text style={styles.codeDigit}>{digit}</Text>
                  </View>
                );
              })}
            </View>
            <TextInput
              ref={codeInputRef}
              accessibilityLabel="Email verification code"
              value={code}
              onChangeText={(value) => {
                setCode(value.replace(/\D/g, "").slice(0, OTP_LENGTH));
                if (statusIsError) setStatus("");
              }}
              onFocus={() => setCodeFocused(true)}
              onBlur={() => setCodeFocused(false)}
              onSubmitEditing={() => void verifyCode()}
              autoFocus
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              returnKeyType="done"
              caretHidden
              style={styles.hiddenCodeInput}
            />
          </View>
          <Text style={styles.helper}>The code expires in 60 minutes and can only be used once.</Text>
          {status ? <Text accessibilityLiveRegion="polite" style={[styles.status, statusIsError && styles.statusError]}>{status}</Text> : null}
        </View>

        <View style={styles.actions}>
          <Button
            mode="contained"
            buttonColor={colors.primaryDark}
            textColor={colors.surface}
            style={styles.primaryButton}
            contentStyle={styles.buttonContent}
            loading={verifying}
            disabled={verifying || code.length !== OTP_LENGTH}
            onPress={() => void verifyCode()}
          >
            {verifying ? "Verifying..." : "Verify Email"}
          </Button>
          <Button
            mode="outlined"
            textColor={colors.primary}
            style={styles.secondaryButton}
            contentStyle={styles.buttonContent}
            disabled={resending || resendCooldown > 0 || !email}
            onPress={() => void resendCode()}
          >
            {resending ? "Sending..." : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
          </Button>
          <Button mode="text" textColor={colors.primary} icon="email-open-outline" onPress={openEmailApp}>
            Open Email App
          </Button>
          <Button mode="text" textColor={colors.primary} onPress={() => navigation.navigate("Login", { email })}>
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
    backgroundColor: colors.surfaceWarm,
  },
  content: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  backLink: {
    alignSelf: "flex-start",
    marginBottom: spacing.xl,
    backgroundColor: "transparent",
    borderWidth: 0,
  },

  title: {
    fontSize: 30,
    fontWeight: "800",
    color: colors.text,
    marginBottom: 8,
  },
  message: {
    color: colors.textMuted,
    fontSize: 15,
  },
  email: {
    fontSize: 17,
    color: colors.primary,
    fontWeight: "700",
    marginTop: 4,
    marginBottom: 18,
  },
  codeControl: {
    position: "relative",
    width: "100%",
  },
  codeBoxes: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  codeBox: {
    flex: 1,
    maxWidth: 64,
    minHeight: 58,
    borderWidth: 1.5,
    borderColor: colors.borderWarm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  codeBoxFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceMuted,
  },
  codeBoxActive: {
    borderColor: colors.primaryDark,
    borderWidth: 2,
  },
  codeDigit: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  hiddenCodeInput: {
    position: "absolute",
    zIndex: 2,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: "100%",
    height: "100%",
    color: "transparent",
    backgroundColor: "transparent",
    opacity: 0.02,
  },
  helper: { marginTop: 8, color: colors.textMuted, fontSize: 11, lineHeight: 17, textAlign: "center" },
  status: { marginTop: 14, padding: 10, borderRadius: radii.md, color: colors.primary, backgroundColor: colors.surfaceMuted, fontSize: 12, lineHeight: 18, fontWeight: "600" },
  statusError: { color: colors.danger, backgroundColor: "#fff1f1" },
  actions: {
    flexDirection: "column",
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  primaryButton: { borderRadius: radii.md },
  secondaryButton: { borderRadius: radii.md, borderColor: colors.primary },
  buttonContent: { minHeight: 52 },
});
