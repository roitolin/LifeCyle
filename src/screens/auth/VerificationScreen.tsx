import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, Button, Alert, StyleSheet } from "react-native";
import { supabase } from "../../services/supabaseClient";
import { getSupabaseEmailRedirectTo } from "../../services/supabaseAuthRedirect";
import { useAuth } from "../../context/AuthContext";
import { useResponsive } from "../../utils/responsive";

const RESEND_COOLDOWN_SECONDS = 60;
const RATE_LIMIT_COOLDOWN_SECONDS = 120;

export default function VerificationScreen() {
  const { user, logout } = useAuth();
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);
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
      : "Resend Verification Email";

  const getResendErrorMessage = (error: any) => {
    const code = error?.code || "";
    if (code === "auth/too-many-requests") {
      return "Too many resend attempts. Please wait a bit before trying again.";
    }
    if (code === "auth/network-request-failed") {
      return "Network error. Please check your internet connection and try again.";
    }
    return "Unable to resend verification email right now. Please try again later.";
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
        options: {
          emailRedirectTo: getSupabaseEmailRedirectTo(),
        },
      });
      if (error) throw error;
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      Alert.alert("Verification Email Sent", "Please check your inbox and spam folder.");
    } catch (error: any) {
      if (error?.code === "auth/too-many-requests") {
        setResendCooldown(RATE_LIMIT_COOLDOWN_SECONDS);
      }
      Alert.alert("Resend Failed", getResendErrorMessage(error));
    } finally {
      if (mounted.current) setResending(false);
    }
  };

  const checkVerification = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (data.user?.email_confirmed_at) {
        Alert.alert("Email Verified", "Your email is verified. The app will continue shortly.");
        await supabase.auth.refreshSession();
        return;
      }
      Alert.alert("Still Pending", "Please click the verification link in your email first.");
    } catch (error: any) {
      Alert.alert("Check Failed", error?.message || "Unable to check verification right now.");
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error: any) {
      Alert.alert("Logout Failed", error.message);
    }
  };

  return (
    <View style={styles.overlay}>
      <View style={[styles.card, isDesktop && styles.cardDesktop]}>
        <Text style={styles.kicker}>Account Verification</Text>
        <Text style={styles.title}>Verify Your Email</Text>
        <Text style={styles.message}>
          We have sent a verification email to {"\n"}
          <Text style={styles.email}>{user?.email}</Text>
        </Text>
        <Text style={styles.countdown}>
          Session expires in {timeLabel}. You will be logged out if still unverified.
        </Text>
        <Button
          title={resending ? "Sending..." : resendLabel}
          onPress={resendVerification}
          disabled={resending || resendCooldown > 0}
        />
        <View style={{ marginTop: 10 }} />
        <Button title={checking ? "Checking..." : "I've Verified My Email"} onPress={checkVerification} disabled={checking} />
        <View style={{ marginTop: 10 }} />
        <Button title="Logout Now" onPress={handleLogout} color="red" />
      </View>
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
  kicker: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 8,
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
});
