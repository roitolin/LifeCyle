import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  Alert,
  StyleSheet,
  TouchableOpacity,
  findNodeHandle,
  Linking,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button as PaperButton } from "react-native-paper";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton, KeyboardAwareScrollView } from "@/components";
import { colors, radii, spacing } from "@/theme";
import { supabase } from "../../services/supabaseClient";
import { ensureOwnUserProfile } from "../../services/userProfile";
import { useAuth } from "../../context/AuthContext";
import { clearLoginAttempts, getLoginBlockState, recordFailedLoginAttempt } from "../../utils/authAttemptGuard";
import { normalizeEmail } from "../../utils/inputSecurity";
import { recordAdminLoginActivity } from "../../utils/adminLoginActivity";

import { recordAccountLoginActivity } from '../../utils/accountLoginActivity';

export default function LoginScreen({ navigation, route }: any) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [banDialog, setBanDialog] = useState<{ reason: string; banEndsLabel: string } | null>(null);
  const { banNotice, clearBanNotice, refreshUserProfile } = useAuth();
  const scrollRef = useRef<any>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const supportPhone = "+639123456789";
  const supportEmail = "support@lifecycle.app";
  const isAddingAccount = Boolean(route?.params?.addAccount);

  useEffect(() => {
    if (route?.params?.email) {
      setEmail(String(route.params.email));
    }
  }, [route?.params?.email]);

  useEffect(() => {
    if (!banNotice) return;
    setBanDialog(banNotice);
    clearBanNotice();
  }, [banNotice, clearBanNotice]);

  const scrollToInput = (inputRef: any) => {
    const inputHandle = findNodeHandle(inputRef.current);
    if (!inputHandle) return;
    (scrollRef.current as any)?.scrollResponderScrollNativeHandleToKeyboard(inputHandle, 120, true);
  };

  const getLoginErrorMessage = (error: any) => {
    const code = error?.code || "";

    if (code === "auth/invalid-credential" || code === "auth/user-not-found") {
      return "We couldn't find an account with that email. Please check for typos or sign up first.";
    }
    if (code === "auth/wrong-password") {
      return "Incorrect password. Please try again.";
    }
    if (code === "auth/invalid-email") {
      return "Please enter a valid email address.";
    }
    if (code === "auth/user-disabled") {
      return "This account has been disabled.";
    }
    if (code === "auth/too-many-requests") {
      return "Too many attempts. Please wait a moment and try again.";
    }
    if (code === "auth/network-request-failed") {
      return "Network error. Please check your internet connection.";
    }
    if (code === "invalid_credentials") {
      return "Incorrect email or password. Please try again.";
    }
    if (code === "42501") {
      return "Your account profile could not be prepared. Please try again or contact support.";
    }
    return null;
  };

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }

    const normalizedEmail = normalizeEmail(email);
    const blockState = await getLoginBlockState(normalizedEmail);
    if (blockState.blocked) {
      Alert.alert("Too Many Attempts", `Please wait ${blockState.retryAfterSeconds}s before trying again.`);
      return;
    }

    setLoading(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (authError) throw authError;

      const user = authData.user;
      if (!user) {
        throw new Error("No user returned from Supabase.");
      }

      const finalUserData = await ensureOwnUserProfile(user);
      await refreshUserProfile();

      const disabled = Boolean(finalUserData?.disabled);
      const banReason = String(finalUserData?.banReason || "").trim() || "No reason provided by admin.";
      const bannedUntilRaw = finalUserData?.bannedUntil;
      const bannedUntil =
        typeof bannedUntilRaw?.toDate === "function"
          ? bannedUntilRaw.toDate()
          : bannedUntilRaw
          ? new Date(bannedUntilRaw)
          : null;
      const hasValidBanEnd = bannedUntil instanceof Date && !Number.isNaN(bannedUntil.getTime());

      if (disabled && hasValidBanEnd && bannedUntil.getTime() <= Date.now()) {
        await supabase.from("users").update({
          disabled: false,
          banReason: null,
          bannedBy: null,
          bannedAt: null,
          bannedUntil: null,
        }).eq("id", user.id);
        return;
      }

      if (disabled) {
        await supabase.auth.signOut();
        setBanDialog({
          reason: banReason,
          banEndsLabel: hasValidBanEnd ? bannedUntil.toLocaleString(undefined, { hour12: true }) : "No end date (permanent)",
        });
        await recordFailedLoginAttempt(normalizedEmail);
        return;
      }

      await clearLoginAttempts(normalizedEmail);
      await recordAccountLoginActivity('login_success');
      await recordAdminLoginActivity(
        "login_success",
        typeof finalUserData?.role === "string" ? finalUserData.role : null,
      );
    } catch (error: any) {
      await recordFailedLoginAttempt(normalizedEmail);
      Alert.alert("Login Failed", getLoginErrorMessage(error) || error?.message);
    } finally {
      setLoading(false);
    }
  };

  const openSupportChannel = async (channel: "sms" | "email") => {
    const url =
      channel === "sms"
        ? `sms:${supportPhone}?body=${encodeURIComponent("I need help logging in to my account.")}`
        : `mailto:${supportEmail}?subject=${encodeURIComponent("Account Login Help")}&body=${encodeURIComponent(
            `I need help logging in.\nEmail: ${email || "(not provided)"}\nIssue: `
          )}`;

    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert(
        "Unavailable",
        channel === "sms" ? "SMS is not available on this device." : "Email app is not available on this device."
      );
      return;
    }
    await Linking.openURL(url);
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <Modal visible={!!banDialog} transparent animationType="fade" onRequestClose={() => setBanDialog(null)}>
        <View style={styles.banOverlay}>
          <View style={styles.banDialog}>
            <View style={styles.banHeading}>
              <Ionicons name="warning-outline" size={24} color={colors.danger} />
              <Text style={styles.banTitle}>Account restricted</Text>
            </View>
            <Text style={styles.banSubtitle}>An administrator has restricted access to this account.</Text>

            <View style={styles.banDetail}>
              <Text style={styles.banLabel}>Reason</Text>
              <Text style={styles.banValue}>{banDialog?.reason || "No reason provided."}</Text>
            </View>
            <View style={[styles.banDetail, styles.banDetailLast]}>
              <Text style={styles.banLabel}>Restriction ends</Text>
              <Text style={styles.banValue}>{banDialog?.banEndsLabel || "Not available"}</Text>
            </View>

            <View style={styles.banActions}>
              <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={() => setBanDialog(null)}>
                <Text style={styles.secondaryButtonText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={styles.banPrimaryButton} onPress={() => void openSupportChannel("sms")}>
                <Text style={styles.banPrimaryButtonText}>Contact support</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <KeyboardAwareScrollView
        ref={scrollRef}
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formShell}>
          {navigation.canGoBack?.() ? (
            <AppBackButton style={styles.backButton} onPress={() => navigation.goBack()} />
          ) : null}

          <View style={styles.brandRow}>
            <Image source={require("../../../assets/Icon/AppICONTransparents.png")} style={styles.brandMark} resizeMode="contain" />
            <Text style={styles.brandName}>LifeCycle</Text>
          </View>

          <View style={styles.headingBlock}>
            <Text style={styles.title}>{isAddingAccount ? "Add another account" : "Welcome back"}</Text>
            <Text style={styles.subtitle}>
              {isAddingAccount
                ? "Your current account will remain saved on this device."
                : "Log in to continue to your account."}
            </Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email address</Text>
            <TextInput
              ref={emailRef}
              accessibilityLabel="Email address"
              placeholder="name@example.com"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              onFocus={() => {
                setEmailFocused(true);
                scrollToInput(emailRef);
              }}
              onBlur={() => setEmailFocused(false)}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              importantForAutofill="yes"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              style={[styles.input, emailFocused && styles.inputFocused]}
            />
          </View>

          <View style={styles.fieldGroup}>
            <View style={styles.passwordLabelRow}>
              <Text style={styles.fieldLabel}>Password</Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => navigation.navigate("ForgotPassword", { email: email.trim() })}
              >
                <Text style={styles.forgotLink}>Forgot password?</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.passwordFieldWrap}>
              <TextInput
                ref={passwordRef}
                accessibilityLabel="Password"
                placeholder="Enter your password"
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={setPassword}
                onFocus={() => {
                  setPasswordFocused(true);
                  scrollToInput(passwordRef);
                }}
                onBlur={() => setPasswordFocused(false)}
                secureTextEntry={!showPassword}
                autoComplete="password"
                textContentType="password"
                importantForAutofill="yes"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                style={[styles.input, styles.passwordInput, passwordFocused && styles.inputFocused]}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                style={styles.eyeButton}
                onPress={() => setShowPassword((previous) => !previous)}
              >
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          <PaperButton
            mode="contained"
            loading={loading}
            disabled={loading}
            onPress={handleLogin}
            style={styles.primaryButton}
            contentStyle={styles.primaryButtonContent}
            labelStyle={styles.primaryButtonLabel}
            buttonColor={colors.primaryDark}
          >
            {loading ? "Logging in..." : "Log in"}
          </PaperButton>

          <View style={styles.accountPrompt}>
            <Text style={styles.accountPromptText}>New to LifeCycle?</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate("Register")}>
              <Text style={styles.accountPromptLink}>Create an account</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.supportArea}>
            <Text style={styles.supportLabel}>Need help signing in?</Text>
            <View style={styles.supportLinks}>
              <TouchableOpacity accessibilityRole="button" onPress={() => void openSupportChannel("sms")}>
                <Text style={styles.supportLink}>Contact support</Text>
              </TouchableOpacity>
              <Text style={styles.supportSeparator}>·</Text>
              <TouchableOpacity accessibilityRole="button" onPress={() => void openSupportChannel("email")}>
                <Text style={styles.supportLink}>Report an issue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceWarm },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
  formShell: { width: "100%", maxWidth: 440, alignSelf: "center" },
  backButton: { alignSelf: "flex-start", marginBottom: spacing.xl, backgroundColor: "transparent", borderWidth: 0 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xxl },
  brandMark: { width: 44, height: 44 },
  brandName: { color: colors.text, fontSize: 20, fontWeight: "800" },
  headingBlock: { marginBottom: spacing.xl },
  title: { color: colors.text, fontSize: 32, lineHeight: 40, fontWeight: "800" },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 24,
    marginTop: spacing.sm,
  },
  fieldGroup: { marginBottom: spacing.lg },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: spacing.sm },
  passwordLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
  },
  inputFocused: {
    borderColor: colors.primaryDark,
  },
  passwordFieldWrap: { position: "relative" },
  passwordInput: { paddingRight: 52 },
  eyeButton: {
    position: "absolute",
    right: 2,
    top: 2,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    borderRadius: radii.md,
    marginTop: spacing.sm,
    elevation: 0,
  },
  primaryButtonContent: { minHeight: 52 },
  primaryButtonLabel: {
    fontWeight: "800",
    fontSize: 15,
    lineHeight: 20,
    includeFontPadding: false,
  },
  forgotLink: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 13,
  },
  accountPrompt: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, marginTop: spacing.lg },
  accountPromptText: { color: colors.textMuted, fontSize: 13 },
  accountPromptLink: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  supportArea: {
    marginTop: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
    paddingTop: spacing.lg,
  },
  supportLabel: {
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  supportLinks: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  supportLink: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  supportSeparator: { color: colors.textMuted, fontSize: 13 },
  banOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  banDialog: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.xl,
  },
  banHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  banTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  banSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  banDetail: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderWarm,
    paddingVertical: spacing.md,
  },
  banDetailLast: { borderBottomWidth: 0 },
  banLabel: {
    color: colors.textMuted,
    fontWeight: "800",
    fontSize: 11,
    marginBottom: spacing.xs,
  },
  banValue: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
  banActions: {
    marginTop: spacing.lg,
    flexDirection: "row",
    gap: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.md,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  secondaryButtonText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  banPrimaryButton: {
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.primaryDark,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  banPrimaryButtonText: { color: colors.surface, fontSize: 13, fontWeight: "800" },
});
