import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, TextInput, Button, Alert, StyleSheet } from "react-native";
import { supabase } from "../../services/supabaseClient";
import { useAuth } from "../../context/AuthContext";
import { useAppDialog } from '../../hooks/useAppDialog';
import { useResponsive } from "../../utils/responsive";
import { confirmLogout } from '../../utils/logoutConfirmation';

const RESEND_COOLDOWN_SECONDS = 60;
const RATE_LIMIT_COOLDOWN_SECONDS = 120;

export default function VerificationScreen() {
  const { user, logout } = useAuth();
  const { showDialog, dialog } = useAppDialog();
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(30 * 60);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { isDesktop } = useResponsive();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const handleAutoLogout = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Auto logout failed:", error);
    }
  }, [logout]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleAutoLogout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [handleAutoLogout]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const cooldownTimer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(cooldownTimer);
  }, [resendCooldown]);

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const timeLabel = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const resendLabel =
    resendCooldown > 0
      ? `Resend in ${String(Math.floor(resendCooldown / 60)).padStart(2, "0")}:${String(resendCooldown % 60).padStart(
          2,
          "0"
        )}`
      : "Resend Verification Code";

  const getVerificationErrorMessage = (error: any, action: "verify" | "resend") => {
    const errorCode = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    if (errorCode.includes("rate") || message.includes("rate limit")) {
      return "Too many attempts. Please wait before trying again.";
    }
    if (errorCode.includes("network") || message.includes("network") || message.includes("fetch")) {
      return "Network error. Please check your internet connection and try again.";
    }
    if (action === "verify" && (message.includes("expired") || message.includes("invalid"))) {
      return "That code is invalid or expired. Request a new code and try again.";
    }
    return action === "resend"
      ? "Unable to send a verification code right now. Please try again later."
      : "Unable to verify that code right now. Please try again.";
  };

  const resendVerification = async () => {
    if (!user) {
      Alert.alert("Session Ended", "Please log in again to resend the verification email.");
      return;
    }
    if (resendCooldown > 0) {
      Alert.alert("Please Wait", `You can resend another email in ${resendCooldown} seconds.`);
      return;
    }

    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: user.email || "",
      });
      if (error) throw error;
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setCode("");
      Alert.alert("Verification Code Sent", "Please check your inbox and spam folder.");
    } catch (error: any) {
      if (String(error?.code || "").toLowerCase().includes("rate")) {
        setResendCooldown(RATE_LIMIT_COOLDOWN_SECONDS);
      }
      Alert.alert("Resend Failed", getVerificationErrorMessage(error, "resend"));
    } finally {
      if (mounted.current) setResending(false);
    }
  };

  const checkVerification = async () => {
    if (!user?.email || code.length !== 6) {
      Alert.alert("Code Required", "Enter the complete 6-digit verification code from your email.");
      return;
    }
    setChecking(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: user.email,
        token: code,
        type: "email",
      });
      if (error) throw error;
      if (data.user?.email_confirmed_at) {
        Alert.alert("Email Verified", "Your email is verified. LifeCycle will continue shortly.");
        return;
      }
      Alert.alert("Verification Pending", "The code could not be confirmed. Please request a new code.");
    } catch (error: any) {
      setCode("");
      Alert.alert("Verification Failed", getVerificationErrorMessage(error, "verify"));
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  const handleLogout = () => {
    confirmLogout({
      logout,
      showDialog,
    });
  };

  return (
    <View style={styles.overlay}>
      <View style={[styles.card, isDesktop && styles.cardDesktop]}>
        <Text style={styles.title}>Verify Your Email</Text>
        <Text style={styles.message}>
          We sent a 6-digit verification code to {"\n"}
          <Text style={styles.email}>{user?.email}</Text>
        </Text>
        <Text style={styles.countdown}>
          Session expires in {timeLabel}. You will be logged out if still unverified.
        </Text>
        <TextInput
          accessibilityLabel="Email verification code"
          value={code}
          onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          placeholder="000000"
          style={styles.codeInput}
        />
        <Button
          title={resending ? "Sending..." : resendLabel}
          onPress={resendVerification}
          disabled={resending || resendCooldown > 0}
        />
        <View style={{ marginTop: 10 }} />
        <Button title={checking ? "Verifying..." : "Verify Email"} onPress={checkVerification} disabled={checking || code.length !== 6} />
        <View style={{ marginTop: 10 }} />
        <Button title="Logout Now" onPress={handleLogout} color="#22312d" />
      </View>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: "90%",
    maxWidth: 400,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  cardDesktop: {
    maxWidth: 500,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 14,
    color: "#d32f2f",
    textAlign: "center",
  },
  message: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 10,
  },
  email: {
    fontWeight: "600",
    color: "#d32f2f",
  },
  countdown: {
    fontSize: 14,
    color: "#666",
    marginBottom: 20,
    fontStyle: "italic",
    textAlign: "center",
  },
  codeInput: {
    minHeight: 56,
    marginBottom: 18,
    paddingHorizontal: 12,
    color: "#22312d",
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#315f50",
    borderRadius: 10,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 8,
    textAlign: "center",
  },
});
