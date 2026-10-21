import { useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  Alert,
  StyleSheet,
  TouchableOpacity,
  Platform,
  findNodeHandle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NavigationBar } from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { Picker } from "@react-native-picker/picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Button as PaperButton } from "react-native-paper";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton, KeyboardAwareScrollView } from "@/components";
import { colors, radii, spacing } from "@/theme";
import { supabase } from "../../services/supabaseClient";
import { getSupabaseEmailRedirectTo } from "../../services/supabaseAuthRedirect";
import { normalizeEmail } from "../../utils/inputSecurity";

const PAGE_COLOR = colors.surfaceWarm;
const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";
const PASSWORD_REQUIREMENTS = [
  { id: "length", label: "At least 8 characters", test: (value: string) => value.length >= 8 },
  { id: "lowercase", label: "One lowercase letter (a-z)", test: (value: string) => /[a-z]/.test(value) },
  { id: "uppercase", label: "One uppercase letter (A-Z)", test: (value: string) => /[A-Z]/.test(value) },
  { id: "number", label: "One number (0-9)", test: (value: string) => /[0-9]/.test(value) },
  { id: "symbol", label: "One special character (!@#$...)", test: (value: string) => Array.from(value).some((character) => PASSWORD_SYMBOLS.includes(character)) },
] as const;
const STRONG_PASSWORD_MESSAGE =
  "Use 8 or more characters with lowercase and uppercase letters, a number, and a special character.";

function getPasswordChecks(value: string) {
  return PASSWORD_REQUIREMENTS.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    met: requirement.test(value),
  }));
}

function isStrongPassword(value: string): boolean {
  return PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(value));
}

function PasswordStrengthChecklist({ password }: { password: string }) {
  const checks = getPasswordChecks(password);
  const passedCount = checks.filter((check) => check.met).length;
  const level = password.length === 0 ? 0 : passedCount === checks.length ? 3 : passedCount >= 3 ? 2 : 1;
  const tone = level === 3 ? "strong" : level === 2 ? "medium" : level === 1 ? "weak" : "empty";
  const label = level === 3 ? "Strong" : level === 2 ? "Medium" : level === 1 ? "Weak" : "Not started";
  const activeColor = tone === "strong" ? "#16a36a" : tone === "medium" ? "#e99b18" : "#df6677";

  return (
    <View
      style={styles.passwordStrengthCard}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Password strength ${label}. ${passedCount} of ${checks.length} requirements met.`}
    >
      <View style={styles.passwordStrengthHeading}>
        <Text style={styles.passwordStrengthTitle}>Password strength</Text>
        <Text style={[styles.passwordStrengthLabel, tone === "strong" && styles.passwordStrengthLabelStrong]}>{label}</Text>
      </View>
      <View style={styles.passwordStrengthTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[1, 2, 3].map((segment) => (
          <View key={segment} style={[styles.passwordStrengthSegment, segment <= level && { backgroundColor: activeColor }]} />
        ))}
      </View>
      <View style={styles.passwordRequirements}>
        {checks.map((check) => (
          <View key={check.id} style={styles.passwordRequirementRow}>
            <View style={[styles.passwordRequirementIcon, check.met && styles.passwordRequirementIconMet]}>
              <Ionicons
                name={check.met ? "checkmark" : "close"}
                size={12}
                color={check.met ? "#16885a" : "#94a0ad"}
              />
            </View>
            <Text style={[styles.passwordRequirementText, check.met && styles.passwordRequirementTextMet]}>{check.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function RegisterScreen({ navigation }: any) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | "">("");
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<"fullName" | "email" | "password" | "confirmPassword" | null>(null);
  const scrollRef = useRef<any>(null);
  const fullNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const passwordIsStrong = isStrongPassword(password);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  const scrollToInput = (inputRef: any) => {
    const inputHandle = findNodeHandle(inputRef.current);
    if (!inputHandle) return;
    (scrollRef.current as any)?.scrollResponderScrollNativeHandleToKeyboard(inputHandle, 120, true);
  };

  const handleRegister = async () => {
    if (!fullName.trim() || !gender || !dateOfBirth || !email.trim() || !password.trim() || !confirmPassword.trim()) {
      Alert.alert("Missing information", "Please complete every field before continuing.");
      return;
    }
    if (!passwordIsStrong) {
      Alert.alert("Use a stronger password", STRONG_PASSWORD_MESSAGE);
      return;
    }
    if (!passwordsMatch) {
      Alert.alert("Passwords do not match", "Enter the same password in both fields.");
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = normalizeEmail(email);
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: getSupabaseEmailRedirectTo(),
          data: {
            fullName: fullName.trim(),
            gender,
            dateOfBirth: dateOfBirth.toISOString(),
          },
        },
      });
      if (signUpError) throw signUpError;

      const user = authData.user;
      if (!user) {
        throw new Error("Supabase did not return a user for this registration.");
      }

      // We no longer insert into public.users here because the user is not authenticated yet.
      // Doing so triggers a row_level_security error.
      // The profile will be created upon first login in LoginScreen using the metadata saved above.

      navigation.replace("VerifyEmail", { email: normalizedEmail });
    } catch (error: any) {
      const message = String(error?.message || "").toLowerCase();
      if (message.includes("already") || message.includes("already registered")) {
        Alert.alert("Registration Failed", "Email already in use. Try logging in instead.");
      } else if (message.includes("password")) {
        Alert.alert("Registration Failed", STRONG_PASSWORD_MESSAGE);
      } else if (message.includes("network")) {
        Alert.alert("Network Error", "Please check your internet connection and try again.");
      } else {
        Alert.alert("Registration Failed", error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const onDateChange = (_event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === "ios");
    if (selectedDate) {
      setDateOfBirth(selectedDate);
    }
  };

  const dateOfBirthLabel = dateOfBirth
    ? dateOfBirth.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })
    : "Select your date of birth";

  return (
    <View style={styles.page}>
      <NavigationBar hidden={false} style="dark" />
      <StatusBar hidden={false} style="dark" />

      <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
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
            <Image source={require("../../../assets/Icon/IconTraparent.png")} style={styles.brandMark} resizeMode="contain" />
            <Text style={styles.brandName}>LifeCycle</Text>
          </View>

          <View style={styles.headingBlock}>
            <Text style={styles.title}>Create your account</Text>
            <Text style={styles.subtitle}>Enter your details to get started.</Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Full name</Text>
            <TextInput
              ref={fullNameRef}
              accessibilityLabel="Full name"
              placeholder="Enter your full name"
              placeholderTextColor={colors.textMuted}
              value={fullName}
              onChangeText={setFullName}
              onFocus={() => {
                setFocusedField("fullName");
                scrollToInput(fullNameRef);
              }}
              onBlur={() => setFocusedField(null)}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              style={[styles.input, focusedField === "fullName" && styles.inputFocused]}
            />
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
                setFocusedField("email");
                scrollToInput(emailRef);
              }}
              onBlur={() => setFocusedField(null)}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              importantForAutofill="yes"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              style={[styles.input, focusedField === "email" && styles.inputFocused]}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <View style={styles.passwordFieldWrap}>
              <TextInput
                ref={passwordRef}
                accessibilityLabel="Password"
                placeholder="Create a password"
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={setPassword}
                onFocus={() => {
                  setFocusedField("password");
                  scrollToInput(passwordRef);
                }}
                onBlur={() => setFocusedField(null)}
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                importantForAutofill="yes"
                returnKeyType="next"
                onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                style={[styles.input, styles.passwordInput, focusedField === "password" && styles.inputFocused]}
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
            <PasswordStrengthChecklist password={password} />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Confirm password</Text>
            <View style={styles.passwordFieldWrap}>
              <TextInput
                ref={confirmPasswordRef}
                accessibilityLabel="Confirm password"
                placeholder="Re-enter your password"
                placeholderTextColor={colors.textMuted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                onFocus={() => {
                  setFocusedField("confirmPassword");
                  scrollToInput(confirmPasswordRef);
                }}
                onBlur={() => setFocusedField(null)}
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                importantForAutofill="yes"
                returnKeyType="done"
                style={[
                  styles.input,
                  styles.passwordInput,
                  focusedField === "confirmPassword" && styles.inputFocused,
                  confirmPassword.length > 0 && !passwordsMatch && styles.inputError,
                ]}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "Hide passwords" : "Show passwords"}
                style={styles.eyeButton}
                onPress={() => setShowPassword((previous) => !previous)}
              >
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.passwordMatchRow} accessibilityLiveRegion="polite">
              {confirmPassword.length > 0 ? (
                <Ionicons
                  name={passwordsMatch ? "checkmark-circle" : "alert-circle"}
                  size={15}
                  color={passwordsMatch ? "#16885a" : colors.danger}
                />
              ) : null}
              <Text style={[styles.passwordMatchText, passwordsMatch && styles.passwordMatchTextSuccess]}>
                {confirmPassword.length === 0
                  ? "Re-enter your password."
                  : passwordsMatch
                    ? "Passwords match."
                    : "Passwords do not match."}
              </Text>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Gender</Text>
            <View style={styles.pickerContainer}>
              <Picker
                accessibilityLabel="Gender"
                selectedValue={gender}
                onValueChange={(value) => setGender(value)}
                dropdownIconColor={colors.text}
                style={styles.picker}
              >
                <Picker.Item label="Select gender" value="" color={colors.textMuted} />
                <Picker.Item label="Male" value="male" />
                <Picker.Item label="Female" value="female" />
                <Picker.Item label="Other" value="other" />
              </Picker>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Date of birth</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Date of birth, ${dateOfBirthLabel}`}
              onPress={() => setShowDatePicker(true)}
              style={[styles.dateButton, showDatePicker && styles.inputFocused]}
            >
              <Text style={[styles.dateButtonText, !dateOfBirth && styles.placeholderText]}>{dateOfBirthLabel}</Text>
              <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            {showDatePicker && (
              <View style={styles.datePickerArea}>
                <DateTimePicker
                  value={dateOfBirth || new Date(2000, 0, 1)}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onValueChange={onDateChange}
                  onDismiss={() => setShowDatePicker(false)}
                  maximumDate={new Date()}
                />
                {Platform.OS === "ios" ? (
                  <TouchableOpacity accessibilityRole="button" style={styles.dateDoneButton} onPress={() => setShowDatePicker(false)}>
                    <Text style={styles.dateDoneButtonText}>Done</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>

          <PaperButton
            mode="contained"
            loading={loading}
            disabled={loading || !passwordIsStrong || !passwordsMatch}
            onPress={handleRegister}
            style={styles.primaryButton}
            contentStyle={styles.primaryButtonContent}
            labelStyle={styles.primaryButtonLabel}
            buttonColor={colors.primaryDark}
          >
            {loading ? "Creating account..." : "Create account"}
          </PaperButton>

          <View style={styles.accountPrompt}>
            <Text style={styles.accountPromptText}>Already have an account?</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate("Login")}>
              <Text style={styles.accountPromptLink}>Log in</Text>
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
  scrollContent: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
  formShell: { width: "100%", maxWidth: 520, alignSelf: "center" },
  backButton: { alignSelf: "flex-start", marginBottom: spacing.xl, backgroundColor: "transparent", borderWidth: 0 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xxl },
  brandMark: { width: 44, height: 44 },
  brandName: { color: colors.text, fontSize: 20, fontWeight: "800" },
  headingBlock: { marginBottom: spacing.xl },
  title: { color: colors.text, fontSize: 32, lineHeight: 40, fontWeight: "800" },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 24, marginTop: spacing.sm },
  fieldGroup: { marginBottom: spacing.lg },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: spacing.sm },
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
  inputFocused: { borderColor: colors.primaryDark },
  inputError: { borderColor: colors.danger },
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
  passwordStrengthCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "#dce4ec",
    backgroundColor: "#f2f6fa",
  },
  passwordStrengthHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  passwordStrengthTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  passwordStrengthLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "800" },
  passwordStrengthLabelStrong: { color: "#16885a" },
  passwordStrengthTrack: { flexDirection: "row", gap: 6, marginBottom: spacing.md },
  passwordStrengthSegment: { flex: 1, height: 4, borderRadius: 999, backgroundColor: "#d8e0ea" },
  passwordRequirements: { gap: 7 },
  passwordRequirementRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  passwordRequirementIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  passwordRequirementIconMet: { backgroundColor: "#e8f8f1" },
  passwordRequirementText: { flex: 1, color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  passwordRequirementTextMet: { color: "#476458" },
  passwordMatchRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.xs },
  passwordMatchText: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  passwordMatchTextSuccess: { color: "#16885a", fontWeight: "700" },
  pickerContainer: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.md,
    overflow: "hidden",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  picker: { minHeight: 52, color: colors.text },
  dateButton: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
  },
  dateButtonText: { color: colors.text, fontSize: 15 },
  placeholderText: { color: colors.textMuted },
  datePickerArea: { paddingTop: spacing.sm },
  dateDoneButton: { alignSelf: "flex-end", minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.sm },
  dateDoneButtonText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
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
  accountPrompt: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, marginTop: spacing.lg, paddingBottom: spacing.xl },
  accountPromptText: { color: colors.textMuted, fontSize: 13 },
  accountPromptLink: { color: colors.primary, fontSize: 13, fontWeight: "800" },
});
