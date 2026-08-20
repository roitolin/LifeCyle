import { useEffect, useRef, useState } from "react";
import {
  Animated,
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
import { Picker } from "@react-native-picker/picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Button as PaperButton } from "react-native-paper";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton, KeyboardAwareScrollView } from "@/components";
import { supabase } from "../../services/supabaseClient";
import { getSupabaseEmailRedirectTo } from "../../services/supabaseAuthRedirect";
import { useResponsive } from "../../utils/responsive";

export default function RegisterScreen({ navigation, route }: any) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | "">("");
  const [dateOfBirth, setDateOfBirth] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { isDesktop } = useResponsive();
  const scrollRef = useRef<any>(null);
  const fullNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const entrance = useRef(new Animated.Value(0)).current;

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

  const handleRegister = async () => {
    if (!fullName.trim() || !gender || !dateOfBirth || !email.trim() || !password.trim()) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim();
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

      Alert.alert(
        "Registration Successful",
        "A verification email has been sent. Please check your inbox and verify your account."
      );
      navigation.navigate("VerifyEmail", { email: normalizedEmail });
    } catch (error: any) {
      const message = String(error?.message || "").toLowerCase();
      if (message.includes("already") || message.includes("already registered")) {
        Alert.alert("Registration Failed", "Email already in use. Try logging in instead.");
      } else if (message.includes("password")) {
        Alert.alert("Registration Failed", "Password should be at least 6 characters.");
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
              <Text style={styles.introKicker}>Create Account</Text>
              <Text style={styles.introTitle}>Join First</Text>
              <Text style={styles.introBody}>Create your account first, then continue to LifeCycle after signing in.</Text>
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
            {navigation.canGoBack() && (
              <AppBackButton style={styles.backLink} onPress={() => navigation.goBack()} />
            )}
            <Image source={require("../../../assets/Icon/AppICONTransparents.png")} style={styles.logo} resizeMode="contain" />
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Register first so you can access LifeCycle after signing in.</Text>

            <TextInput
              ref={fullNameRef}
              placeholder="Full Name"
              placeholderTextColor="#9ca3af"
              value={fullName}
              onChangeText={setFullName}
              onFocus={() => scrollToInput(fullNameRef)}
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              style={styles.input}
            />
            <TextInput
              ref={emailRef}
              placeholder="Email"
              placeholderTextColor="#9ca3af"
              value={email}
              onChangeText={setEmail}
              onFocus={() => scrollToInput(emailRef)}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              style={styles.input}
            />
            <View style={styles.passwordFieldWrap}>
              <TextInput
              ref={passwordRef}
              placeholder="Password"
              placeholderTextColor="#9ca3af"
                value={password}
                onChangeText={setPassword}
                onFocus={() => scrollToInput(passwordRef)}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                style={[styles.input, styles.passwordInput]}
              />
              <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword((prev) => !prev)}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={21} color="#22312d" />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Gender</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={gender}
                onValueChange={(value) => setGender(value)}
                dropdownIconColor="#22312d"
                style={styles.picker}
              >
                <Picker.Item label="Select gender..." value="" />
                <Picker.Item label="Male" value="male" />
                <Picker.Item label="Female" value="female" />
                <Picker.Item label="Other" value="other" />
              </Picker>
            </View>

            <Text style={styles.label}>Date of Birth</Text>
            <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.dateButton}>
              <Text style={styles.dateButtonText}>{dateOfBirth.toLocaleDateString()}</Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={dateOfBirth}
                mode="date"
                display="default"
                onChange={onDateChange}
                maximumDate={new Date()}
              />
            )}

            <PaperButton
              mode="contained"
              loading={loading}
              disabled={loading}
              onPress={handleRegister}
              style={styles.primaryButton}
              contentStyle={styles.primaryButtonContent}
              labelStyle={styles.primaryButtonLabel}
                buttonColor="#22312d"
            >
              {loading ? "Registering..." : "Sign up"}
            </PaperButton>
            <TouchableOpacity onPress={() => navigation.navigate("Login")} style={styles.linkWrap}>
              <Text style={styles.link}>Already have an account? Login</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </KeyboardAwareScrollView>
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
    maxWidth: 1120,
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
    shadowColor: "#22312d",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
  },
  logo: {
    width: 96,
    height: 96,
    alignSelf: "center",
    marginBottom: 8,
  },
  title: { fontSize: 38, fontWeight: "800", textAlign: "center", marginBottom: 6, color: "#22312d" },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    color: "#62706b",
    marginBottom: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
    color: "#22312d",
    marginTop: 6,
    marginBottom: 6,
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
  passwordFieldWrap: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 46,
  },
  eyeButton: {
    position: "absolute",
    right: 10,
    top: 8,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 18,
    marginBottom: 13,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  picker: {
    color: "#1f2937",
  },
  dateButton: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 14,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  dateButtonText: {
    color: "#1f2937",
    fontWeight: "600",
  },
  backLink: {
    alignSelf: "flex-start",
    marginBottom: 10,
  },

  primaryButton: {
    borderRadius: 999,
    marginTop: 8,
    shadowColor: "#22312d",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
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
    maxWidth: 500,
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
  introKicker: {
    color: "#5a6b64",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
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
