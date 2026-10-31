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
  type TextInputInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NavigationBar } from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { Button as PaperButton } from "react-native-paper";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppBackButton, KeyboardAwareScrollView } from "@/components";
import SocialAuthButtons from "@/components/SocialAuthButtons";
import { colors, radii, spacing } from "@/theme";
import { supabase } from "../../services/supabaseClient";
import { ensureOwnUserProfile } from "../../services/userProfile";
import { useAuth } from "../../context/AuthContext";
import { clearLoginAttempts, getLoginBlockState, recordFailedLoginAttempt } from "../../utils/authAttemptGuard";
import { normalizeEmail } from "../../utils/inputSecurity";
import { recordAdminLoginActivity } from "../../utils/adminLoginActivity";

import { recordAccountLoginActivity } from '../../utils/accountLoginActivity';

const PAGE_COLOR = "#edf0f2";
const REMEMBERED_EMAIL_KEY = "@lifecycle/remembered-login-email";
const LIFECYCLE_MARK = require("../../../assets/Icon/IconTraparent.png");

export default function LoginScreen({ navigation, route }: any) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [banDialog, setBanDialog] = useState<{ reason: string; banEndsLabel: string } | null>(null);
  const { banNotice, clearBanNotice, refreshUserProfile } = useAuth();
  const scrollRef = useRef<any>(null);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const supportPhone = "+639123456789";
  const supportEmail = "support@lifecycle.app";
  const isAddingAccount = Boolean(route?.params?.addAccount);

  useEffect(() => {
    if (route?.params?.email) {
      setEmail(String(route.params.email));
      return;
    }

    let cancelled = false;
    AsyncStorage.getItem(REMEMBERED_EMAIL_KEY)
      .then((storedEmail) => {
        if (cancelled || !storedEmail) return;
        setEmail(storedEmail);
        setRememberMe(true);
      })
      .catch((error) => console.warn("Remembered email could not be loaded:", error));

    return () => {
      cancelled = true;
    };
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
      try {
        if (rememberMe) {
          await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, normalizedEmail);
        } else {
          await AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY);
        }
      } catch (storageError) {
        console.warn("Remembered email preference could not be saved:", storageError);
      }
      await recordAccountLoginActivity('login_success');
      await recordAdminLoginActivity(
        "login_success",
        typeof finalUserData?.role === "string" ? finalUserData.role : null,
      );
    } catch (error: any) {
      const errorCode = String(error?.code || "").toLowerCase();
      const errorMessage = String(error?.message || "").toLowerCase();
      if (errorCode === "email_not_confirmed" || errorMessage.includes("email not confirmed")) {
        navigation.navigate("VerifyEmail", { email: normalizedEmail });
        return;
      }
      await recordFailedLoginAttempt(normalizedEmail);
      Alert.alert("Login Failed", getLoginErrorMessage(error) || error?.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleRememberMe = () => {
    setRememberMe((current) => {
      const next = !current;
      if (!next) {
        void AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY).catch((error) => {
          console.warn("Remembered email could not be cleared:", error);
        });
      }
      return next;
    });
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
    <View style={styles.page}>
      <NavigationBar hidden={false} style="dark" />
      <StatusBar hidden={false} style="dark" />

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
        <LinearGradient colors={["#d9eee7", "#edf2e7", "#f4eadc"]} style={styles.hero}>
          {navigation.canGoBack?.() ? (
            <AppBackButton style={styles.backButton} onPress={() => navigation.goBack()} />
          ) : null}
          <View style={styles.brandLockup}>
            <Image source={LIFECYCLE_MARK} resizeMode="contain" style={styles.brandMark} />
            <Text style={styles.brandName}>LifeCycle</Text>
          </View>
          <Text style={styles.heroMessage}>Peace of mind, one step at a time.</Text>
        </LinearGradient>
        <View style={styles.formShell}>
          <View style={styles.headingBlock}>
            <Text style={styles.title}>{isAddingAccount ? "Add another account" : "Log in"}</Text>
            <Text style={styles.subtitle}>
              {isAddingAccount
                ? "Your current account will remain saved on this device."
                : "Enter your email and password to securely access your account."}
            </Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email</Text>
            <View style={[styles.inputShell, emailFocused && styles.inputFocused]}>
              <Ionicons name="mail-outline" size={19} color={emailFocused ? colors.primary : colors.textMuted} />
              <TextInput
                ref={emailRef}
                accessibilityLabel="Email address"
                placeholder="Email address"
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
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <View style={[styles.inputShell, passwordFocused && styles.inputFocused]}>
              <Ionicons name="lock-closed-outline" size={19} color={passwordFocused ? colors.primary : colors.textMuted} />
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
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                style={[styles.input, styles.passwordInput]}
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
            <View style={styles.loginOptionsRow}>
              <TouchableOpacity
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rememberMe }}
                accessibilityLabel="Remember my email address"
                onPress={toggleRememberMe}
                activeOpacity={0.72}
                style={styles.rememberButton}
              >
                <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                  {rememberMe ? <Ionicons name="checkmark" size={13} color="#ffffff" /> : null}
                </View>
                <Text style={styles.rememberText}>Remember me</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => navigation.navigate("ForgotPassword", { email: email.trim() })}
                style={styles.forgotButton}
              >
                <Text style={styles.forgotLink}>Forgot Password?</Text>
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

          <SocialAuthButtons
            disabled={loading}
            onError={(title, message) => Alert.alert(title, message)}
          />

          <View style={styles.accountPrompt}>
            <Text style={styles.accountPromptText}>New to LifeCycle?</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate("Register")}>
              <Text style={styles.accountPromptLink}>Create an account</Text>
            </TouchableOpacity>
          </View>

        </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: PAGE_COLOR },
  screen: { flex: 1, backgroundColor: PAGE_COLOR },
  scrollContent: { flexGrow: 1, backgroundColor: colors.surface },
  hero: { minHeight: 188, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 36, alignItems: "center", justifyContent: "center" },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandMark: { width: 66, height: 66 },
  brandName: { color: colors.text, fontSize: 25, fontWeight: "900", letterSpacing: -0.5 },
  heroMessage: { color: colors.textMuted, fontSize: 11, fontWeight: "600", marginTop: 2 },
  formShell: { flexGrow: 1, width: "100%", maxWidth: 560, alignSelf: "center", marginTop: -28, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface, paddingHorizontal: 22, paddingTop: 22, paddingBottom: spacing.lg },
  backButton: { position: "absolute", top: spacing.md, left: spacing.lg, width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.88)", borderWidth: 0 },
  headingBlock: { alignItems: "center", marginBottom: spacing.lg, paddingHorizontal: spacing.sm },
  title: { color: colors.text, fontSize: 27, lineHeight: 34, fontWeight: "900", textAlign: "center" },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    textAlign: "center",
  },
  fieldGroup: { marginBottom: spacing.md },
  fieldLabel: { color: colors.text, fontSize: 11, fontWeight: "800", marginBottom: 7, marginLeft: 2 },
  inputShell: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#e1e6e3", borderRadius: 15, paddingHorizontal: 14, backgroundColor: "#f7f9f8" },
  input: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 0,
    color: colors.text,
    fontSize: 14,
  },
  inputFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  passwordInput: { paddingRight: 0 },
  eyeButton: {
    width: 36,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    borderRadius: radii.md,
    marginTop: spacing.xs,
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
    fontSize: 11,
  },
  loginOptionsRow: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, marginTop: 5 },
  rememberButton: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 7, paddingRight: spacing.sm },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: colors.borderWarm, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  checkboxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  rememberText: { color: colors.text, fontSize: 11, fontWeight: "700" },
  forgotButton: { minHeight: 36, justifyContent: "center", paddingLeft: spacing.sm },
  accountPrompt: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, marginTop: spacing.md },
  accountPromptText: { color: colors.textMuted, fontSize: 13 },
  accountPromptLink: { color: colors.primary, fontSize: 13, fontWeight: "800" },
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
