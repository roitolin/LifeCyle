import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import KeyboardAwareScrollView from "@/components/KeyboardAwareScrollView";
import { auth } from "@/services";
import { supabase } from "@/services/supabaseClient";
import { sanitizePlainText } from "@/utils/inputSecurity";

const BANK_CHANNELS = [
  { code: "PH_BDO", label: "BDO Unibank", shortLabel: "BDO", logo: require("../../../assets/Payment Logos/BDO_Logo.png") },
  { code: "PH_BPI", label: "Bank of the Philippine Islands (BPI)", shortLabel: "BPI", logo: require("../../../assets/Payment Logos/BPI_Logo.png") },
  { code: "PH_UBP", label: "UnionBank", shortLabel: "UnionBank", logo: require("../../../assets/Payment Logos/UnionBank_Logo.png") },
  { code: "PH_METROBANK", label: "Metrobank", shortLabel: "Metrobank", logo: require("../../../assets/Payment Logos/MetroBank_Logo.png") },
  { code: "PH_LANDBANK", label: "Landbank of the Philippines", shortLabel: "Landbank", logo: require("../../../assets/Payment Logos/Landbank_logo.png") },
  { code: "PH_PNB", label: "Philippine National Bank (PNB)", shortLabel: "PNB", logo: require("../../../assets/Payment Logos/PNB_Logo.png") },
  { code: "PH_RCBC", label: "Rizal Commercial Banking Corporation (RCBC)", shortLabel: "RCBC", logo: require("../../../assets/Payment Logos/RCBC_Logo.png") },
  { code: "PH_CHINABANK", label: "China Banking Corporation", shortLabel: "Chinabank", logo: require("../../../assets/Payment Logos/Chinabank_Logo.png") },
  { code: "PH_SECURITYBANK", label: "Security Bank", shortLabel: "Security Bank", logo: require("../../../assets/Payment Logos/SecurityBank_Logo.png") },
] as const;

type BankChannel = (typeof BANK_CHANNELS)[number];

type BankAccount = {
  id: string;
  shopId: string;
  channelCode: string;
  accountName: string;
  accountNumber: string;
  accountEmail?: string | null;
  active: boolean;
  verifiedByAdmin: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PendingVerification = {
  challengeId: string;
  maskedEmail: string;
  expiresAt: string;
};

const BANK_CHANNEL_CODES = BANK_CHANNELS.map((item) => item.code);

function maskAccountNumber(value?: string | null) {
  const clean = String(value || "").replace(/\s/g, "");
  return clean.length > 4 ? `•••• ${clean.slice(-4)}` : clean || "—";
}

async function extractFunctionError(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (typeof body?.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Fallback to default message
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function FuneralShopBankPayoutScreen({ navigation, route }: any) {
  const initialChannelCode = route?.params?.channelCode as string | undefined;
  const initialMode = route?.params?.mode as "add" | "list" | undefined;
  const [shopId, setShopId] = useState<string | null>(route?.params?.shopId || auth.currentUser?.uid || null);
  const [userEmail, setUserEmail] = useState<string>(auth.currentUser?.email || "");
  const [shopApproved, setShopApproved] = useState<boolean>(true);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [page, setPage] = useState<"list" | "setup" | "verify">(
    initialMode === "add" || Boolean(initialChannelCode) ? "setup" : "list"
  );
  const [channelCode, setChannelCode] = useState<string>(
    initialChannelCode && BANK_CHANNEL_CODES.includes(initialChannelCode as any)
      ? initialChannelCode
      : ""
  );
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", number: "", email: auth.currentUser?.email || "" });
  const [pendingVerification, setPendingVerification] = useState<PendingVerification | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [codeFocused, setCodeFocused] = useState(false);
  const codeInputRef = useRef<TextInputInstance>(null);

  const selectedChannel = useMemo(
    () => BANK_CHANNELS.find((item) => item.code === channelCode) || null,
    [channelCode]
  );
  const existingAccount = useMemo(
    () => (selectedChannel ? accounts.find((item) => item.channelCode === selectedChannel.code) || null : null),
    [accounts, selectedChannel]
  );

  const loadBankAccounts = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      let resolvedShopId = route?.params?.shopId || auth.currentUser?.uid || null;
      let resolvedEmail = auth.currentUser?.email || "";
      if (!resolvedShopId || !resolvedEmail) {
        const { data: sessionData } = await supabase.auth.getSession();
        resolvedShopId = resolvedShopId || sessionData.session?.user?.id || null;
        resolvedEmail = resolvedEmail || sessionData.session?.user?.email || "";
      }
      if (resolvedEmail) {
        setUserEmail(resolvedEmail);
        setDraft((current) => (current.email ? current : { ...current, email: resolvedEmail }));
      }
      if (!resolvedShopId) {
        setShopId(null);
        setAccounts([]);
        return;
      }
      setShopId(resolvedShopId);

      const [accountsResult, shopResult] = await Promise.all([
        supabase
          .from("funeral_shop_payout_accounts")
          .select('id, "shopId", "channelCode", "accountName", "accountNumber", "accountEmail", active, "verifiedByAdmin", "verifiedAt", "createdAt", "updatedAt"')
          .eq("shopId", resolvedShopId)
          .in("channelCode", BANK_CHANNEL_CODES)
          .order("verifiedAt", { ascending: false, nullsFirst: false })
          .order("createdAt", { ascending: true }),
        supabase
          .from("funeral_shops")
          .select("status")
          .eq("id", resolvedShopId)
          .maybeSingle(),
      ]);

      if (accountsResult.error) throw accountsResult.error;
      const loadedAccounts = (accountsResult.data || []) as BankAccount[];
      setAccounts(loadedAccounts);

      if (loadedAccounts.length === 0 && !isRefresh) {
        setPage("setup");
      }

      if (shopResult.data?.status) {
        const status = String(shopResult.data.status).toLowerCase();
        setShopApproved(["verified", "live", "offline"].includes(status));
      } else {
        setShopApproved(true);
      }
    } catch (error: any) {
      Alert.alert("Bank accounts unavailable", error?.message || "Unable to load your bank withdrawal methods.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [route?.params?.shopId]);

  useFocusEffect(
    useCallback(() => {
      void loadBankAccounts();
    }, [loadBankAccounts])
  );

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleBack = () => {
    if (page === "verify") {
      setPage("setup");
      return;
    }
    if (page === "setup" && accounts.length > 0 && initialMode !== "add") {
      setBankDropdownOpen(false);
      setPage("list");
      return;
    }
    if (navigation.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation.navigate("ShopPayments", { section: "withdrawals" });
    }
  };

  const openBankSetup = (bank?: BankChannel) => {
    const saved = bank ? accounts.find((item) => item.channelCode === bank.code) : undefined;
    setChannelCode(bank ? bank.code : "");
    setDraft({
      name: saved?.accountName || "",
      number: saved?.accountNumber || "",
      email: saved?.accountEmail || userEmail || "",
    });
    setBankDropdownOpen(false);
    setPendingVerification(null);
    setVerificationCode("");
    setResendCooldown(0);
    setPage("setup");
  };

  const handleSelectBankInSetup = (bank: BankChannel) => {
    const saved = accounts.find((item) => item.channelCode === bank.code);
    setChannelCode(bank.code);
    setBankDropdownOpen(false);
    if (saved) {
      setDraft({
        name: saved.accountName,
        number: saved.accountNumber,
        email: saved.accountEmail || draft.email || userEmail || "",
      });
    }
  };

  const saveBankAccount = async () => {
    if (!shopId || saving) return;
    const name = sanitizePlainText(draft.name, 120);
    const number = draft.number.trim().replace(/[\s-]+/g, "");
    const email = draft.email.trim().toLowerCase();

    if (name.length < 2) {
      Alert.alert("Check account name", "Enter the account holder name registered with your bank.");
      return;
    }
    if (!selectedChannel) {
      Alert.alert("Choose bank", "Please select a bank name from the dropdown.");
      return;
    }
    if (number.length < 4 || number.length > 30) {
      Alert.alert("Check account number", "Enter a valid bank account number (4 to 30 digits).");
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert("Check email", "Enter a valid email address.");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("provision-xendit-shop", {
        body: {
          shopId,
          action: "update",
          payoutChannelCode: selectedChannel.code,
          payoutAccountName: name,
          payoutAccountNumber: number,
          payoutAccountEmail: email,
        },
      });
      if (error) throw new Error(await extractFunctionError(error, "Unable to save the bank account."));

      if (
        data?.verificationRequired === true &&
        typeof data.challengeId === "string" &&
        typeof data.maskedEmail === "string" &&
        typeof data.expiresAt === "string"
      ) {
        setDraft({ name, number, email });
        setPendingVerification({
          challengeId: data.challengeId,
          maskedEmail: data.maskedEmail,
          expiresAt: data.expiresAt,
        });
        setVerificationCode("");
        setResendCooldown(Number(data.resendAfterSeconds) || 60);
        setPage("verify");
        return;
      }

      if (!data || data.shopId !== shopId || (data.reviewPending !== true && data.unchanged !== true)) {
        throw new Error("The bank payout account could not be submitted.");
      }

      await loadBankAccounts(true);
      setPage("list");
      Alert.alert(
        data.unchanged ? "No changes" : "Payout method saved",
        data.unchanged
          ? "This bank account is already saved."
          : "Your bank account has been submitted for admin verification."
      );
    } catch (error: any) {
      Alert.alert("Save failed", error?.message || "Unable to save the bank payout account.");
    } finally {
      setSaving(false);
    }
  };

  const verifyBankChange = async () => {
    if (!shopId || !pendingVerification || saving) return;
    if (!/^\d{6}$/.test(verificationCode)) {
      Alert.alert("Code required", "Enter the complete 6-digit verification code sent to your email.");
      codeInputRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("provision-xendit-shop", {
        body: {
          shopId,
          action: "confirm-update",
          challengeId: pendingVerification.challengeId,
          code: verificationCode,
        },
      });
      if (error) throw new Error(await extractFunctionError(error, "Unable to verify the bank account change."));
      if (!data || data.shopId !== shopId || data.reviewPending !== true) {
        throw new Error("The bank account change could not be confirmed.");
      }
      await loadBankAccounts(true);
      setPendingVerification(null);
      setVerificationCode("");
      setPage("list");
      Alert.alert(
        "Payout method updated",
        "Your email was confirmed. An administrator will verify the updated bank account."
      );
    } catch (error: any) {
      setVerificationCode("");
      Alert.alert("Verification failed", error?.message || "Unable to verify the bank account change.");
      codeInputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const resendVerificationCode = async () => {
    if (!shopId || !pendingVerification || resending || resendCooldown > 0) return;
    setResending(true);
    try {
      const { data, error } = await supabase.functions.invoke("provision-xendit-shop", {
        body: {
          shopId,
          action: "resend-update-code",
          challengeId: pendingVerification.challengeId,
        },
      });
      if (error) throw new Error(await extractFunctionError(error, "Unable to resend the verification code."));
      setPendingVerification((current) =>
        current
          ? {
              ...current,
              maskedEmail: typeof data?.maskedEmail === "string" ? data.maskedEmail : current.maskedEmail,
              expiresAt: typeof data?.expiresAt === "string" ? data.expiresAt : current.expiresAt,
            }
          : null
      );
      setVerificationCode("");
      setResendCooldown(Number(data?.resendAfterSeconds) || 60);
      Alert.alert("Code sent", "A new verification code was sent to your account email.");
      codeInputRef.current?.focus();
    } catch (error: any) {
      Alert.alert("Resend failed", error?.message || "Unable to resend the verification code.");
    } finally {
      setResending(false);
    }
  };

  const toggleBankAccount = async (account: BankAccount) => {
    if (!shopId || saving) return;
    if (!account.verifiedByAdmin) {
      Alert.alert("Review pending", "An administrator must verify this bank account before it can be enabled.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("provision-xendit-shop", {
        body: {
          shopId,
          action: "set-active",
          payoutChannelCode: account.channelCode,
          active: !account.active,
        },
      });
      if (error) throw new Error(await extractFunctionError(error, "Unable to update this bank account."));
      await loadBankAccounts(true);
    } catch (error: any) {
      Alert.alert("Update failed", error?.message || "Unable to update this bank account.");
    } finally {
      setSaving(false);
    }
  };

  const unconfiguredBanks = useMemo(
    () => BANK_CHANNELS.filter((bank) => !accounts.some((acc) => acc.channelCode === bank.code)),
    [accounts]
  );

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.headerSafeArea}>
        <View style={styles.headerBar}>
          <TouchableOpacity
            style={styles.circleBackBtn}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={19} color="#18221e" />
          </TouchableOpacity>
          {page === "list" && unconfiguredBanks.length > 0 ? (
            <TouchableOpacity
              style={styles.headerAddBtn}
              onPress={() => openBankSetup()}
              disabled={!shopApproved}
              accessibilityRole="button"
              accessibilityLabel="Add payout method"
            >
              <Ionicons name="add" size={17} color="#ffffff" />
              <Text style={styles.headerAddBtnText}>Add</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerRightSpacer} />
          )}
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.body}>
        {page === "verify" && pendingVerification ? (
          <KeyboardAwareScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.pageHeading}>Verify payout method</Text>
            <View style={styles.payoutMethodCard}>
              <Text style={styles.verificationMessage}>
                Enter the 6-digit verification code sent to{" "}
                <Text style={styles.verificationEmail}>{pendingVerification.maskedEmail}</Text>.
              </Text>

              <View style={styles.codeControl}>
                <View pointerEvents="none" style={styles.codeBoxes}>
                  {Array.from({ length: 6 }, (_, index) => {
                    const digit = verificationCode[index] || "";
                    const active = codeFocused && index === Math.min(verificationCode.length, 5);
                    return (
                      <View
                        key={index}
                        style={[
                          styles.codeBox,
                          digit ? styles.codeBoxFilled : null,
                          active ? styles.codeBoxActive : null,
                        ]}
                      >
                        <Text style={styles.codeDigit}>{digit}</Text>
                      </View>
                    );
                  })}
                </View>
                <TextInput
                  ref={codeInputRef}
                  accessibilityLabel="Bank change verification code"
                  value={verificationCode}
                  onChangeText={(value) => setVerificationCode(value.replace(/\D/g, "").slice(0, 6))}
                  onFocus={() => setCodeFocused(true)}
                  onBlur={() => setCodeFocused(false)}
                  onSubmitEditing={() => void verifyBankChange()}
                  autoFocus
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  inputMode="numeric"
                  keyboardType="number-pad"
                  maxLength={6}
                  returnKeyType="done"
                  caretHidden
                  style={styles.hiddenCodeInput}
                />
              </View>

              <View style={styles.formActionsRow}>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => void resendVerificationCode()}
                  disabled={resending || resendCooldown > 0}
                >
                  <Text style={styles.secondaryBtnText}>
                    {resending
                      ? "Sending..."
                      : resendCooldown > 0
                      ? `Resend (${resendCooldown}s)`
                      : "Resend code"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryBtn, styles.flexActionBtn, (saving || verificationCode.length !== 6) && styles.disabledBtn]}
                  onPress={() => void verifyBankChange()}
                  disabled={saving || verificationCode.length !== 6}
                >
                  {saving ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                  <Text style={styles.primaryBtnText}>{saving ? "Verifying..." : "Confirm"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareScrollView>
        ) : page === "setup" ? (
          <KeyboardAwareScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.pageHeading}>
              {existingAccount ? "Edit payout method" : "Add payout method"}
            </Text>

            <View style={styles.payoutMethodCard}>
              <View style={styles.bankTransferHeaderRow}>
                <View style={styles.cardIconBadge}>
                  <Ionicons name="card-outline" size={14} color="#6b7280" />
                </View>
                <Text style={styles.bankTransferTitle}>Bank transfer</Text>
              </View>

              <View style={styles.payoutFieldsContainer}>
                <View style={styles.payoutFieldGroup}>
                  <View style={styles.payoutLabelRow}>
                    <Text style={styles.payoutFieldLabel}>Name</Text>
                    <TouchableOpacity
                      onPress={() =>
                        Alert.alert(
                          "Account Holder Name",
                          "Enter the full name or business name registered with your bank account."
                        )
                      }
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel="Account holder name info"
                    >
                      <Ionicons name="information-circle-outline" size={15} color="#6b7280" />
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.flatGrayInput}
                    value={draft.name}
                    onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
                    placeholder=""
                    placeholderTextColor="#9ca3af"
                    maxLength={120}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.payoutFieldGroup}>
                  <Text style={styles.payoutFieldLabel}>Bank name</Text>
                  <TouchableOpacity
                    style={styles.flatGraySelect}
                    onPress={() => setBankDropdownOpen((prev) => !prev)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Choose bank"
                  >
                    <Text
                      style={[
                        styles.flatGraySelectText,
                        !selectedChannel ? styles.flatGraySelectPlaceholder : null,
                      ]}
                      numberOfLines={1}
                    >
                      {selectedChannel ? selectedChannel.label : "Choose bank"}
                    </Text>
                    <View style={styles.selectChevrons}>
                      <Ionicons name="chevron-up" size={10} color="#6b7280" style={styles.selectChevronUp} />
                      <Ionicons name="chevron-down" size={10} color="#6b7280" style={styles.selectChevronDown} />
                    </View>
                  </TouchableOpacity>

                  {bankDropdownOpen ? (
                    <View style={styles.bankDropdownMenu}>
                      {BANK_CHANNELS.map((item, idx) => {
                        const isSelected = selectedChannel?.code === item.code;
                        return (
                          <TouchableOpacity
                            key={item.code}
                            style={[
                              styles.bankDropdownOption,
                              idx === BANK_CHANNELS.length - 1 ? styles.noBottomBorder : null,
                              isSelected ? styles.bankDropdownOptionActive : null,
                            ]}
                            onPress={() => handleSelectBankInSetup(item)}
                          >
                            <Text
                              style={[
                                styles.bankDropdownOptionText,
                                isSelected ? styles.bankDropdownOptionTextActive : null,
                              ]}
                            >
                              {item.label}
                            </Text>
                            {isSelected ? <Ionicons name="checkmark" size={16} color="#117a6f" /> : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                </View>

                <View style={styles.payoutFieldGroup}>
                  <Text style={styles.payoutFieldLabel}>Bank account number</Text>
                  <TextInput
                    style={styles.flatGrayInput}
                    value={draft.number}
                    onChangeText={(number) => setDraft((current) => ({ ...current, number }))}
                    placeholder=""
                    placeholderTextColor="#9ca3af"
                    keyboardType="number-pad"
                    maxLength={30}
                  />
                </View>

                <View style={styles.payoutFieldGroup}>
                  <Text style={styles.payoutFieldLabel}>Email</Text>
                  <TextInput
                    style={styles.flatGrayInput}
                    value={draft.email}
                    onChangeText={(email) => setDraft((current) => ({ ...current, email }))}
                    placeholder="example@email.com"
                    placeholderTextColor="#9ca3af"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={120}
                  />
                </View>
              </View>
            </View>

            <View style={styles.formActionsRow}>
              {accounts.length > 0 ? (
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => {
                    setBankDropdownOpen(false);
                    if (initialMode === "add" && navigation.canGoBack?.()) {
                      navigation.goBack();
                    } else {
                      setPage("list");
                    }
                  }}
                  disabled={saving}
                >
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.primaryBtn, styles.flexActionBtn, saving && styles.disabledBtn]}
                onPress={() => void saveBankAccount()}
                disabled={saving}
              >
                {saving ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                <Text style={styles.primaryBtnText}>
                  {saving ? "Saving..." : existingAccount ? "Update payout method" : "Save payout method"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
        ) : loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color="#117a6f" />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void loadBankAccounts(true)}
                tintColor="#117a6f"
              />
            }
          >
            <Text style={styles.pageHeading}>Payout methods</Text>

            <View style={styles.savedList}>
              {accounts.map((account) => {
                const bank = BANK_CHANNELS.find((item) => item.code === account.channelCode);
                if (!bank) return null;
                const isReady = account.active && account.verifiedByAdmin;

                return (
                  <View
                    key={account.id}
                    style={[
                      styles.savedAccountCard,
                      !account.active && account.verifiedByAdmin ? styles.savedAccountDimmed : null,
                    ]}
                  >
                    <View style={styles.savedAccountTop}>
                      <View style={styles.bankLogoBoxSmall}>
                        <Image source={bank.logo} resizeMode="contain" style={styles.bankLogoImg} />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.savedBankName}>{bank.label}</Text>
                        <Text style={styles.savedAccountHolder}>
                          {account.accountName} · {maskAccountNumber(account.accountNumber)}
                        </Text>
                        {account.accountEmail ? (
                          <Text style={styles.savedAccountEmail}>{account.accountEmail}</Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.savedAccountFooter}>
                      <Text
                        style={[
                          styles.statusText,
                          isReady
                            ? styles.statusTextReady
                            : account.verifiedByAdmin
                            ? styles.statusTextDisabled
                            : styles.statusTextPending,
                        ]}
                      >
                        {isReady
                          ? "Active"
                          : account.verifiedByAdmin
                          ? "Disabled"
                          : "Pending verification"}
                      </Text>

                      <View style={styles.savedAccountActions}>
                        <TouchableOpacity
                          style={styles.actionLinkBtn}
                          disabled={saving}
                          onPress={() => openBankSetup(bank)}
                        >
                          <Text style={styles.actionLinkText}>Edit</Text>
                        </TouchableOpacity>
                        {account.verifiedByAdmin ? (
                          <TouchableOpacity
                            style={styles.actionLinkBtn}
                            disabled={saving}
                            onPress={() => void toggleBankAccount(account)}
                          >
                            <Text style={[styles.actionLinkText, !account.active ? styles.actionLinkPrimary : null]}>
                              {account.active ? "Disable" : "Enable"}
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  body: { flex: 1, backgroundColor: "#ffffff" },
  flex: { flex: 1, minWidth: 0 },
  headerSafeArea: { backgroundColor: "#ffffff" },
  headerBar: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: "#ffffff",
  },
  circleBackBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#f7f8fa",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#ebedf0",
  },
  headerAddBtn: {
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: "#117a6f",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
  },
  headerAddBtnText: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  headerRightSpacer: { width: 38 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  formContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  pageHeading: {
    color: "#1e2432",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 16,
  },
  payoutMethodCard: {
    backgroundColor: "#ffffff",
    paddingTop: 4,
    paddingBottom: 8,
  },
  bankTransferHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  cardIconBadge: {
    width: 28,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    alignItems: "center",
    justifyContent: "center",
  },
  bankTransferTitle: {
    color: "#1f2937",
    fontSize: 14,
    fontWeight: "600",
  },
  payoutFieldsContainer: {
    gap: 18,
  },
  payoutFieldGroup: {
    gap: 8,
  },
  payoutLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  payoutFieldLabel: {
    color: "#4b5563",
    fontSize: 12,
    fontWeight: "600",
  },
  flatGrayInput: {
    minHeight: 42,
    borderRadius: 3,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 12,
    color: "#111827",
    fontSize: 13,
  },
  flatGraySelect: {
    minHeight: 42,
    borderRadius: 3,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  flatGraySelectText: {
    flex: 1,
    color: "#111827",
    fontSize: 13,
  },
  flatGraySelectPlaceholder: {
    color: "#9ca3af",
  },
  selectChevrons: {
    alignItems: "center",
    justifyContent: "center",
  },
  selectChevronUp: {
    marginBottom: -2,
  },
  selectChevronDown: {
    marginTop: -2,
  },
  bankDropdownMenu: {
    marginTop: 4,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  bankDropdownOption: {
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  bankDropdownOptionActive: {
    backgroundColor: "#f0fdfa",
  },
  bankDropdownOptionText: {
    flex: 1,
    color: "#1f2937",
    fontSize: 13,
  },
  bankDropdownOptionTextActive: {
    color: "#117a6f",
    fontWeight: "600",
  },
  noBottomBorder: { borderBottomWidth: 0 },
  formActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
  secondaryBtn: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: "#374151", fontSize: 13, fontWeight: "600" },
  primaryBtn: {
    minHeight: 42,
    borderRadius: 3,
    backgroundColor: "#117a6f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
  },
  flexActionBtn: { flex: 1 },
  primaryBtnText: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  disabledBtn: { opacity: 0.5 },
  savedList: { gap: 12 },
  savedAccountCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  savedAccountDimmed: { opacity: 0.6 },
  savedAccountTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  bankLogoBoxSmall: {
    width: 40,
    height: 40,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    backgroundColor: "#f9fafb",
    alignItems: "center",
    justifyContent: "center",
    padding: 5,
  },
  bankLogoImg: { width: "100%", height: "100%" },
  savedBankName: { color: "#111827", fontSize: 14, fontWeight: "600" },
  savedAccountHolder: { color: "#4b5563", fontSize: 13, marginTop: 2 },
  savedAccountEmail: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  savedAccountFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    paddingTop: 10,
  },
  statusText: { fontSize: 12, fontWeight: "600" },
  statusTextReady: { color: "#117a6f" },
  statusTextPending: { color: "#b45309" },
  statusTextDisabled: { color: "#6b7280" },
  savedAccountActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  actionLinkBtn: { paddingVertical: 2, paddingHorizontal: 4 },
  actionLinkText: { color: "#4b5563", fontSize: 13, fontWeight: "600" },
  actionLinkPrimary: { color: "#117a6f" },
  verificationMessage: {
    color: "#4b5563",
    fontSize: 13,
    lineHeight: 19,
  },
  verificationEmail: { color: "#111827", fontWeight: "600" },
  codeControl: { position: "relative", width: "100%", marginTop: 18, marginBottom: 6 },
  codeBoxes: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  codeBox: {
    flex: 1,
    minHeight: 48,
    borderRadius: 3,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  codeBoxFilled: { backgroundColor: "#e5e7eb" },
  codeBoxActive: { borderWidth: 1.5, borderColor: "#117a6f" },
  codeDigit: { color: "#111827", fontSize: 18, fontWeight: "700" },
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
});
