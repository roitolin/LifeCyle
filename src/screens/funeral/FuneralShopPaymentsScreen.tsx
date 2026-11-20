import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton } from "@/components";
import LoadingStatus from "@/components/LoadingStatus";
import { auth } from "@/services";
import { supabase } from "@/services/supabaseClient";
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { syncServiceXenditCheckout } from "@/services/serviceXendit";
import { requestCustomShopWithdrawal } from "@/services/shopPayout";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { colors, radii, spacing } from "@/theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type PaymentFilter = "all" | "review" | "verified";
type OverviewTransactionFilter = "all" | "withdrawal" | "earnings";
type WithdrawalScreenMode = "overview" | "withdraw" | "details";
const BANK_PAYOUT_LABELS: Record<string, string> = {
  PH_BDO: "BDO Unibank",
  PH_BPI: "Bank of the Philippine Islands",
  PH_UBP: "UnionBank",
  PH_METROBANK: "Metrobank",
  PH_LANDBANK: "Landbank",
  PH_PNB: "PNB",
  PH_RCBC: "RCBC",
  PH_CHINABANK: "Chinabank",
  PH_SECURITYBANK: "Security Bank",
};
const BANK_PAYOUT_CHANNEL_CODES = Object.keys(BANK_PAYOUT_LABELS);
type ShopPayoutAccount = {
  id: string;
  channelCode: string;
  accountName: string;
  accountNumber: string;
  active: boolean;
  verifiedByAdmin: boolean;
};
type ShopWithdrawalRecord = {
  id: string;
  shopId: string;
  amount: number | string;
  channelCode: string;
  accountName: string;
  accountNumber: string;
  referenceNo: string;
  payoutId?: string | null;
  status: string;
  failureCode?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
};
type PaymentRequest = {
  id: string;
  requesterId: string;
  shopId: string;
  productName?: string;
  deceasedFullName?: string;
  familyCoordinatorName?: string;
  status: string;
  paymentOption?: string | null;
  downpaymentAmountSnapshot?: number | string | null;
  productPrice?: number | string | null;
  productFullPrice?: number | string | null;
  paymentAmount?: number | string | null;
  paymentPayerName?: string | null;
  paymentReferenceNumber?: string | null;
  paymentProofImageUrl?: string | null;
  paymentSubmittedAt?: string | null;
  paymentVerifiedAt?: string | null;
  paymentProvider?: string | null;
  providerCheckoutId?: string | null;
  providerPaymentCompletedAt?: string | null;
  payoutId?: string | null;
  payoutStatus?: string | null;
  payoutAmount?: number | string | null;
  shopNetAmount?: number | string | null;
  payoutCompletedAt?: string | null;
  payoutFailureCode?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
};

function isPaidXenditSale(request: PaymentRequest) {
  const status = String(request.status || "").toLowerCase();
  const provider = String(request.paymentProvider || "").toLowerCase();
  const isXendit = provider === "xendit" || Boolean(request.providerPaymentCompletedAt) || Boolean(request.providerCheckoutId);
  if (!isXendit) return false;
  return (
    ["payment_verified", "awaiting_customer_confirmation", "completed"].includes(status) ||
    Boolean(request.paymentVerifiedAt) ||
    Boolean(request.providerPaymentCompletedAt)
  );
}

function getShopShare(request: PaymentRequest) {
  const explicitShare = Number(request.shopNetAmount || request.payoutAmount || 0);
  if (explicitShare > 0) return explicitShare;
  const isDownpayment = String(request.paymentOption || "").toLowerCase() === "downpayment";
  const grossPaid = Number(
    request.paymentAmount ||
    (isDownpayment ? request.downpaymentAmountSnapshot : (request.productFullPrice ?? request.productPrice)) ||
    0
  );
  return grossPaid > 0 ? Math.round(grossPaid * 0.7 * 100) / 100 : 0;
}

function getPaymentStatus(request: PaymentRequest) {
  const status = String(request.status || "").toLowerCase();
  if (status === "payment_submitted") {
    return { label: "Needs review", icon: "time-outline" as IoniconName, background: "#fff0dc", color: "#934b16" };
  }
  if (request.paymentVerifiedAt || ["payment_verified", "awaiting_customer_confirmation", "completed"].includes(status)) {
    const isDownpayment = String(request.paymentOption || "").toLowerCase() === "downpayment";
    return {
      label: isDownpayment ? "Downpayment Confirmed" : "Payment Confirmed",
      icon: "checkmark-circle-outline" as IoniconName,
      background: "#e3f3e8",
      color: "#236441",
    };
  }
  return { label: "Submitted", icon: "receipt-outline" as IoniconName, background: "#e8eef5", color: "#3f5f7d" };
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Recently submitted";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recently submitted";
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function maskBankAccount(value: string) {
  const digits = String(value || "").replace(/\s/g, "");
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : digits || "Account number unavailable";
}

function formatBalanceNumber(amount: number) {
  const numeric = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatAmountInputWithCommas(raw: string) {
  const sanitized = raw.replace(/[^0-9.]/g, "");
  if (!sanitized) return "";
  const [intPart = "", ...decParts] = sanitized.split(".");
  const normalizedInt = intPart.replace(/^0+(?=\d)/, "");
  const formattedInt = normalizedInt.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (decParts.length > 0) {
    return `${formattedInt || "0"}.${decParts.join("").slice(0, 2)}`;
  }
  return formattedInt;
}

function getSaleTimestamp(sale: PaymentRequest) {
  return (
    sale.payoutCompletedAt ||
    sale.providerPaymentCompletedAt ||
    sale.paymentVerifiedAt ||
    sale.paymentSubmittedAt ||
    sale.createdAt ||
    null
  );
}

function formatSettlementDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${month}/${day}/${year}`;
}

function formatDateGroupHeader(value?: string | null) {
  if (!value) return "RECENT";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "RECENT";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfTarget) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "TODAY";
  if (diffDays === 1) return "YESTERDAY";

  const day = String(parsed.getDate()).padStart(2, "0");
  const month = parsed.toLocaleString("en-US", { month: "short" }).toUpperCase();
  return `${day} ${month}, ${parsed.getFullYear()}`;
}

export default function FuneralShopPaymentsScreen({ navigation, route }: any) {
  const withdrawalsOnly = route?.params?.section === "withdrawals";
  const [withdrawalScreenMode, setWithdrawalScreenMode] = useState<WithdrawalScreenMode>("overview");
  const [selectedDetailRowId, setSelectedDetailRowId] = useState<string | null>(null);
  const [withdrawalSearch, setWithdrawalSearch] = useState("");
  const [overviewFilter, setOverviewFilter] = useState<OverviewTransactionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [withdrawalSales, setWithdrawalSales] = useState<PaymentRequest[]>([]);
  const [shopWithdrawals, setShopWithdrawals] = useState<ShopWithdrawalRecord[]>([]);
  const [withdrawalAmountDraft, setWithdrawalAmountDraft] = useState("");
  const [shopId, setShopId] = useState<string | null>(null);
  const [bankPayoutAccounts, setBankPayoutAccounts] = useState<ShopPayoutAccount[]>([]);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const openBankPayoutScreen = useCallback(() => {
    navigation.navigate("ShopBankPayouts", { shopId, mode: "list" });
  }, [navigation, shopId]);

  const openAddBankPayoutScreen = useCallback(() => {
    navigation.navigate("ShopBankPayouts", { shopId, mode: "add" });
  }, [navigation, shopId]);

  const loadPayments = useCallback(async (refresh = false, background = false) => {
    if (!background) {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setLoadError(null);
    }
    try {
      let userId = auth.currentUser?.uid || null;
      if (!userId) {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        userId = sessionData.session?.user?.id || null;
      }
      if (!userId) {
        setShopId(null);
        setRequests([]);
        setWithdrawalSales([]);
        setShopWithdrawals([]);
        setBankPayoutAccounts([]);
        return;
      }
      setShopId(userId);
      const [salesResult, payoutAccountsResult, withdrawalsResult] = await Promise.all([
        supabase
          .from("funeral_service_requests")
          .select("*")
          .eq("shopId", userId)
          .order("paymentSubmittedAt", { ascending: false, nullsFirst: false }),
        supabase
          .from("funeral_shop_payout_accounts")
          .select('id, "channelCode", "accountName", "accountNumber", active, "verifiedByAdmin"')
          .eq("shopId", userId)
          .in("channelCode", BANK_PAYOUT_CHANNEL_CODES)
          .order("verifiedAt", { ascending: false, nullsFirst: false })
          .order("createdAt", { ascending: false }),
        supabase
          .from("shop_withdrawals")
          .select('id, "shopId", amount, "channelCode", "accountName", "accountNumber", "referenceNo", "payoutId", status, "failureCode", "createdAt", "completedAt"')
          .eq("shopId", userId)
          .order("createdAt", { ascending: false }),
      ]);
      const { data, error } = salesResult;
      if (error) throw error;
      let allRequests = (data || []) as unknown as PaymentRequest[];

      const pendingXenditRows = allRequests.filter((row) => {
        const rowStatus = String(row.status || "").toLowerCase();
        return (
          (rowStatus === "awaiting_payment" || rowStatus === "paid_waiting_for_split") &&
          !row.paymentVerifiedAt &&
          (String(row.paymentProvider || "").toLowerCase() === "xendit" || Boolean(row.providerCheckoutId))
        );
      });

      if (!background && pendingXenditRows.length > 0) {
        const syncResults = await Promise.all(
          pendingXenditRows.slice(0, 6).map((row) =>
            syncServiceXenditCheckout(row.id).catch(() => null)
          )
        );
        if (syncResults.some((res) => res?.paid)) {
          const { data: refreshedData } = await supabase
            .from("funeral_service_requests")
            .select("*")
            .eq("shopId", userId)
            .order("paymentSubmittedAt", { ascending: false, nullsFirst: false });
          if (refreshedData) {
            allRequests = refreshedData as unknown as PaymentRequest[];
          }
        }
      }

      setWithdrawalSales(allRequests.filter(isPaidXenditSale));
      setShopWithdrawals(withdrawalsResult.error ? [] : ((withdrawalsResult.data || []) as ShopWithdrawalRecord[]));
      setRequests(withdrawalsOnly ? [] : allRequests.filter((item) => {
        const status = String(item.status || "").toLowerCase();
        return Boolean(item.paymentProofImageUrl || item.paymentSubmittedAt || item.paymentVerifiedAt) ||
          ["payment_submitted", "payment_verified", "awaiting_customer_confirmation", "completed"].includes(status);
      }));
      if (payoutAccountsResult.error) {
        setBankPayoutAccounts([]);
      } else {
        setBankPayoutAccounts((payoutAccountsResult.data || []) as ShopPayoutAccount[]);
      }
    } catch (error: any) {
      if (!background) setLoadError(error?.message || (withdrawalsOnly ? "Withdrawals could not be loaded." : "Payments could not be loaded."));
    } finally {
      if (!background) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [withdrawalsOnly]);

  useFocusEffect(useCallback(() => { void loadPayments(); }, [loadPayments]));

  useRealtimeRefresh([
    { table: 'funeral_service_requests', filter: `shopId=eq.${shopId}` },
    { table: 'shop_withdrawals', filter: `shopId=eq.${shopId}` },
  ], () => loadPayments(false, true), Boolean(shopId) && !loading && !refreshing);

  const reviewCount = useMemo(
    () => requests.filter((item) => String(item.status || "").toLowerCase() === "payment_submitted").length,
    [requests]
  );
  const verifiedCount = useMemo(
    () =>
      requests.filter((item) => {
        const status = String(item.status || "").toLowerCase();
        return Boolean(item.paymentVerifiedAt) || ["payment_verified", "awaiting_customer_confirmation", "completed"].includes(status);
      }).length,
    [requests]
  );
  const withdrawalTotals = useMemo(() => {
    const received = Math.round(withdrawalSales.reduce((total, item) => total + getShopShare(item), 0) * 100) / 100;
    const activeWithdrawals = shopWithdrawals.filter(
      (w) => !["failed", "cancelled", "reversed"].includes(String(w.status || "").toLowerCase())
    );
    const recordedPayoutIds = new Set(activeWithdrawals.map((w) => String(w.payoutId || "")).filter(Boolean));
    const legacyWithdrawn = withdrawalSales
      .filter((s) => {
        const pId = String(s.payoutId || "");
        const pStatus = String(s.payoutStatus || "").toLowerCase();
        return Boolean(pId) && !recordedPayoutIds.has(pId) && !["failed", "cancelled", "reversed"].includes(pStatus);
      })
      .reduce((total, item) => total + getShopShare(item), 0);
    const withdrawnFromTable = activeWithdrawals.reduce((total, w) => total + (Number(w.amount) || 0), 0);
    const available = Math.max(0, Math.round((received - (withdrawnFromTable + legacyWithdrawn)) * 100) / 100);
    return { received, available };
  }, [withdrawalSales, shopWithdrawals]);
  const verifiedBankAccounts = useMemo(
    () => bankPayoutAccounts.filter((account) => account.active && account.verifiedByAdmin),
    [bankPayoutAccounts]
  );
  const selectedBankAccount = useMemo(
    () => verifiedBankAccounts.find((account) => account.id === selectedBankAccountId) || verifiedBankAccounts[0] || null,
    [verifiedBankAccounts, selectedBankAccountId]
  );
  const typedWithdrawalAmount = useMemo(() => {
    const cleaned = withdrawalAmountDraft.replace(/[^\d.]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  }, [withdrawalAmountDraft]);

  const allDetailItems = useMemo(() => {
    const withdrawalItems = shopWithdrawals.map((w) => ({
      id: `w-${w.id}`,
      kind: "withdrawal" as const,
      timestamp: w.completedAt || w.createdAt || null,
      dateText: formatSettlementDate(w.completedAt || w.createdAt),
      fullTimeText: formatTimestamp(w.completedAt || w.createdAt),
      amount: Number(w.amount) || 0,
      status: String(w.status || "transferred").toLowerCase(),
      referenceNo: String(w.referenceNo || "—"),
      title: BANK_PAYOUT_LABELS[w.channelCode] || w.channelCode || "Bank withdrawal",
      subtitle: `${w.accountName || "Bank account"} · ${maskBankAccount(w.accountNumber)}`,
      bankName: BANK_PAYOUT_LABELS[w.channelCode] || w.channelCode || "Bank transfer",
      accountName: w.accountName || "—",
      accountNumber: maskBankAccount(w.accountNumber),
      failureCode: w.failureCode || null,
      serviceName: null as string | null,
      customerName: null as string | null,
      paymentTypeLabel: null as string | null,
    }));
    const earningItems = withdrawalSales.map((sale) => {
      const isDownpayment = String(sale.paymentOption || "").toLowerCase() === "downpayment";
      return {
        id: `e-${sale.id}`,
        kind: "earning" as const,
        timestamp: getSaleTimestamp(sale),
        dateText: formatSettlementDate(getSaleTimestamp(sale)),
        fullTimeText: formatTimestamp(getSaleTimestamp(sale)),
        amount: getShopShare(sale),
        status: "credited",
        referenceNo: String(sale.paymentReferenceNumber || sale.providerCheckoutId || sale.id.slice(0, 12)),
        title: String(sale.productName || "Service sale"),
        subtitle: `${isDownpayment ? "Downpayment" : "Full payment"}${sale.deceasedFullName ? ` · For ${sale.deceasedFullName}` : ""}`,
        bankName: null as string | null,
        accountName: null as string | null,
        accountNumber: null as string | null,
        failureCode: null as string | null,
        serviceName: String(sale.productName || "Funeral service"),
        customerName: String(sale.paymentPayerName || sale.familyCoordinatorName || sale.deceasedFullName || "Customer"),
        paymentTypeLabel: isDownpayment ? "Downpayment (70% net share)" : "Full payment (70% net share)",
      };
    });
    return [...withdrawalItems, ...earningItems].sort(
      (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
    );
  }, [shopWithdrawals, withdrawalSales]);

  const selectedDetailItem = useMemo(
    () => allDetailItems.find((item) => item.id === selectedDetailRowId) || allDetailItems[0] || null,
    [allDetailItems, selectedDetailRowId]
  );

  const groupedOverviewTransactions = useMemo(() => {
    const withdrawalItems = shopWithdrawals.map((w) => ({
      id: `w-${w.id}`,
      kind: "withdrawal" as const,
      timestamp: w.completedAt || w.createdAt || null,
      amount: Number(w.amount) || 0,
      status: String(w.status || "transferred").toLowerCase(),
      referenceNo: String(w.referenceNo || "—"),
      title: BANK_PAYOUT_LABELS[w.channelCode] || "Bank withdrawal",
      subtitle: `${maskBankAccount(w.accountNumber)} · Tap to view details`,
    }));
    const earningItems = withdrawalSales.map((sale) => ({
      id: `e-${sale.id}`,
      kind: "earning" as const,
      timestamp: getSaleTimestamp(sale),
      amount: getShopShare(sale),
      status: "credited",
      referenceNo: String(sale.paymentReferenceNumber || sale.providerCheckoutId || sale.id.slice(0, 12)),
      title: String(sale.productName || "Service sale"),
      subtitle: `${String(sale.paymentOption || "").toLowerCase() === "downpayment" ? "Downpayment · " : ""}Added · Tap to view details`,
    }));

    const allItems = (
      overviewFilter === "withdrawal"
        ? withdrawalItems
        : overviewFilter === "earnings"
        ? earningItems
        : [...withdrawalItems, ...earningItems]
    ).sort(
      (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
    );
    const query = withdrawalSearch.trim().toLowerCase();
    const filtered = query
      ? allItems.filter(
          (item) =>
            item.title.toLowerCase().includes(query) ||
            item.subtitle.toLowerCase().includes(query) ||
            item.referenceNo.toLowerCase().includes(query)
        )
      : allItems;

    const groups: { title: string; items: typeof allItems }[] = [];
    for (const item of filtered) {
      const title = formatDateGroupHeader(item.timestamp);
      const existing = groups.find((group) => group.title === title);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.push({ title, items: [item] });
      }
    }
    return groups;
  }, [overviewFilter, shopWithdrawals, withdrawalSales, withdrawalSearch]);

  const visibleRequests = useMemo(() => {
    if (filter === "review") return requests.filter((item) => String(item.status || "").toLowerCase() === "payment_submitted");
    if (filter === "verified") {
      return requests.filter((item) => {
        const status = String(item.status || "").toLowerCase();
        return Boolean(item.paymentVerifiedAt) || ["payment_verified", "awaiting_customer_confirmation", "completed"].includes(status);
      });
    }
    return requests;
  }, [filter, requests]);

  const handleBack = () => {
    if (withdrawalsOnly && withdrawalScreenMode !== "overview") {
      setWithdrawalScreenMode("overview");
      setSelectedDetailRowId(null);
      return;
    }
    if (navigation.canGoBack?.()) navigation.goBack();
    else navigation.navigate("ShopCenter");
  };

  const openWithdrawAmountScreen = useCallback(() => {
    if (!selectedBankAccount) {
      const hasUnverifiedBank = bankPayoutAccounts.length > 0;
      Alert.alert(
        hasUnverifiedBank ? "Bank account pending review" : "Bank account required",
        hasUnverifiedBank
          ? "Your saved bank account is currently pending admin verification or disabled. Manage your bank accounts to review its status."
          : "Add a bank account and wait for admin verification before requesting a withdrawal.",
        [
          { text: "Cancel", style: "cancel" },
          { text: hasUnverifiedBank ? "Manage bank" : "Add bank", onPress: openBankPayoutScreen },
        ]
      );
      return;
    }
    setWithdrawalAmountDraft("");
    setWithdrawalScreenMode("withdraw");
  }, [bankPayoutAccounts.length, openBankPayoutScreen, selectedBankAccount]);

  const confirmCustomWithdrawal = useCallback(() => {
    if (withdrawing) return;
    if (!selectedBankAccount) {
      openBankPayoutScreen();
      return;
    }
    if (withdrawalTotals.available <= 0) {
      Alert.alert("No available balance", "You currently have no available balance to withdraw.");
      return;
    }
    if (typedWithdrawalAmount <= 0) {
      Alert.alert("Enter withdrawal amount", "Type how much you want to withdraw before submitting.");
      return;
    }
    if (typedWithdrawalAmount > withdrawalTotals.available + 0.009) {
      Alert.alert(
        "Amount exceeds balance",
        `Enter an amount up to your available balance of ₱${formatBalanceNumber(withdrawalTotals.available)}.`
      );
      return;
    }

    Alert.alert(
      "Confirm withdrawal",
      `Withdraw ₱${formatBalanceNumber(typedWithdrawalAmount)} to ${BANK_PAYOUT_LABELS[selectedBankAccount.channelCode] || "your bank"} (${maskBankAccount(selectedBankAccount.accountNumber)})?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          onPress: async () => {
            setWithdrawing(true);
            try {
              const result = await requestCustomShopWithdrawal(typedWithdrawalAmount, selectedBankAccount.channelCode);
              setWithdrawalAmountDraft("");
              setWithdrawalScreenMode("overview");
              await loadPayments(true);
              Alert.alert(
                "Withdrawal transferred",
                `₱${formatBalanceNumber(typedWithdrawalAmount)} was submitted to your bank account.${result.referenceNo ? ` Reference No. ${result.referenceNo}` : ""}`
              );
            } catch (error: any) {
              Alert.alert("Withdrawal not completed", error?.message || "Please refresh and try again.");
            } finally {
              setWithdrawing(false);
            }
          },
        },
      ]
    );
  }, [
    loadPayments,
    openBankPayoutScreen,
    selectedBankAccount,
    typedWithdrawalAmount,
    withdrawalTotals.available,
    withdrawing,
  ]);

  const handleSwitchBankAccount = useCallback(() => {
    if (verifiedBankAccounts.length <= 1) {
      openBankPayoutScreen();
      return;
    }
    const currentIndex = verifiedBankAccounts.findIndex((account) => account.id === selectedBankAccount?.id);
    const nextAccount = verifiedBankAccounts[(currentIndex + 1) % verifiedBankAccounts.length];
    if (nextAccount) setSelectedBankAccountId(nextAccount.id);
  }, [openBankPayoutScreen, selectedBankAccount, verifiedBankAccounts]);

  return (
    <View style={withdrawalsOnly ? styles.withdrawalScreen : styles.screen}>
      <SafeAreaView edges={["top", "left", "right"]} style={withdrawalsOnly ? styles.withdrawalHeaderSafeArea : styles.headerSafeArea}>
        {withdrawalsOnly ? (
          <View style={styles.withdrawalHeaderBar}>
            <TouchableOpacity
              style={styles.withdrawalCircleBtn}
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={19} color="#18221e" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.withdrawalCircleBtn}
              onPress={openBankPayoutScreen}
              accessibilityRole="button"
              accessibilityLabel="Manage bank payout methods"
            >
              <Ionicons name="ellipsis-vertical" size={17} color="#18221e" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerBar}>
            <AppBackButton onPress={handleBack} />
            <View style={styles.headerCopy}>
              <Text style={styles.headerTitle}>Family Payments</Text>
            </View>
          </View>
        )}
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={withdrawalsOnly ? styles.withdrawalBody : styles.body}>
        <ScrollView
          contentContainerStyle={withdrawalsOnly ? styles.withdrawalContent : styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPayments(true)} tintColor="#22312d" />}
        >
          {!withdrawalsOnly ? <View style={styles.summaryCard}>
            <View style={styles.summaryIcon}><Ionicons name="wallet-outline" size={24} color="#ffffff" /></View>
            <Text style={styles.summaryTitle}>Review family receipts</Text>
            <Text style={styles.summaryText}>Check the sender, account, reference number, and proof before verifying a payment.</Text>
            <View style={styles.summaryStats}>
              {[
                { value: reviewCount, label: "Need review" },
                { value: verifiedCount, label: "Verified" },
                { value: requests.length, label: "Total" },
              ].map((stat, index) => (
                <View key={stat.label} style={styles.summaryStatWrap}>
                  {index > 0 ? <View style={styles.summaryDivider} /> : null}
                  <View style={styles.summaryStat}>
                    <Text style={styles.summaryStatValue}>{stat.value}</Text>
                    <Text style={styles.summaryStatLabel}>{stat.label}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View> : null}

          {withdrawalsOnly && !loading && !loadError ? (
            <View style={styles.withdrawalPage}>
              {withdrawalScreenMode === "overview" ? (
                <>
                  <View style={styles.accountOverview}>
                    <View style={styles.accountIdentity}>
                      <View style={styles.accountMark}>
                        <Ionicons name="card-outline" size={18} color="#ffffff" />
                      </View>
                      <Text style={styles.accountTypeLabel}>Shop payout account</Text>
                    </View>

                    <View style={styles.primaryBalance}>
                      <Text style={styles.primaryBalanceLine}>
                        <Text style={styles.primaryBalanceCurrency}>₱</Text>
                        <Text style={styles.primaryBalanceAmount}>{formatBalanceNumber(withdrawalTotals.available)}</Text>
                      </Text>
                    </View>

                    <View style={styles.actionPillsRow}>
                      <TouchableOpacity
                        style={styles.primaryActionPill}
                        onPress={openAddBankPayoutScreen}
                        accessibilityRole="button"
                        accessibilityLabel="Add payout method"
                      >
                        <Ionicons name="add" size={18} color="#ffffff" />
                        <Text style={styles.primaryActionPillText}>Add</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.secondaryActionPill}
                        onPress={openWithdrawAmountScreen}
                        accessibilityRole="button"
                        accessibilityLabel="Open withdraw screen"
                      >
                        <Ionicons name="paper-plane-outline" size={16} color="#1a2622" />
                        <Text style={styles.secondaryActionPillText}>Withdraw</Text>
                      </TouchableOpacity>

                      {verifiedBankAccounts.length > 1 ? (
                        <TouchableOpacity
                          style={styles.secondaryActionPill}
                          onPress={handleSwitchBankAccount}
                          accessibilityRole="button"
                          accessibilityLabel="Switch active bank payout account"
                        >
                          <Ionicons name="swap-horizontal-outline" size={16} color="#1a2622" />
                          <Text style={styles.secondaryActionPillText}>Switch</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.salesSection}>
                    <View style={styles.withdrawalSearchWrap}>
                      <Ionicons name="search-outline" size={19} color="#1e2824" />
                      <TextInput
                        style={styles.withdrawalSearchInput}
                        value={withdrawalSearch}
                        onChangeText={setWithdrawalSearch}
                        placeholder="Search"
                        placeholderTextColor="#7a847f"
                        returnKeyType="search"
                      />
                      {withdrawalSearch.length > 0 ? (
                        <TouchableOpacity onPress={() => setWithdrawalSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={17} color="#8a948f" />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    <View style={styles.overviewTabsRow}>
                      {([
                        { key: "all", label: "All" },
                        { key: "withdrawal", label: "Withdrawal" },
                        { key: "earnings", label: "Earnings" },
                      ] as { key: OverviewTransactionFilter; label: string }[]).map((tab) => {
                        const active = overviewFilter === tab.key;
                        return (
                          <TouchableOpacity
                            key={tab.key}
                            style={[styles.overviewTabItem, active ? styles.overviewTabItemActive : null]}
                            onPress={() => setOverviewFilter(tab.key)}
                          >
                            <Text style={[styles.overviewTabText, active ? styles.overviewTabTextActive : null]}>
                              {tab.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {groupedOverviewTransactions.length === 0 ? (
                      <Text style={styles.withdrawalEmptyText}>
                        {withdrawalSales.length === 0 && shopWithdrawals.length === 0
                          ? "Transactions will appear here once recorded."
                          : overviewFilter === "withdrawal"
                          ? "No withdrawals match your filter."
                          : overviewFilter === "earnings"
                          ? "No earnings match your filter."
                          : "No transactions match your search."}
                      </Text>
                    ) : (
                      groupedOverviewTransactions.map((group) => (
                        <View key={group.title} style={styles.withdrawalDateGroup}>
                          <Text style={styles.withdrawalDateHeader}>{group.title}</Text>
                          {group.items.map((item) => {
                            const isWithdrawal = item.kind === "withdrawal";
                            const iconName: IoniconName = isWithdrawal ? "arrow-up" : "add";
                            return (
                              <TouchableOpacity
                                key={item.id}
                                activeOpacity={0.72}
                                onPress={() => {
                                  setSelectedDetailRowId(item.id);
                                  setWithdrawalScreenMode("details");
                                }}
                                style={styles.withdrawalSale}
                              >
                                <View style={styles.saleTransactionRow}>
                                  <View style={styles.saleTransactionIcon}>
                                    <Ionicons name={iconName} size={19} color="#18221e" />
                                  </View>
                                  <View style={styles.withdrawalSaleCopy}>
                                    <Text style={styles.withdrawalSaleName} numberOfLines={1}>
                                      {item.title}
                                    </Text>
                                    <Text style={styles.withdrawalSaleStatus} numberOfLines={1}>
                                      {item.subtitle}
                                    </Text>
                                  </View>
                                  <Text style={styles.withdrawalSaleAmount}>
                                    {isWithdrawal
                                      ? `-₱${formatBalanceNumber(item.amount)}`
                                      : `+₱${formatBalanceNumber(item.amount)}`}
                                  </Text>
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))
                    )}
                  </View>
                </>
              ) : withdrawalScreenMode === "withdraw" ? (
                <View style={styles.withdrawDedicatedPage}>
                  <Text style={styles.withdrawDedicatedTitle}>Withdraw funds</Text>
                  <Text style={styles.withdrawDedicatedSub}>
                    Enter how much you want to transfer from your available balance.
                  </Text>

                  <View style={styles.withdrawAvailableBox}>
                    <Text style={styles.withdrawAvailableLabel}>Available balance</Text>
                    <Text style={styles.withdrawAvailableValue}>₱{formatBalanceNumber(withdrawalTotals.available)}</Text>
                  </View>

                  <View style={styles.withdrawAmountField}>
                    <Text style={styles.withdrawAmountLabel}>Withdrawal amount</Text>
                    <View style={styles.withdrawAmountInputRow}>
                      <Text style={styles.withdrawAmountCurrency}>₱</Text>
                      <TextInput
                        style={styles.withdrawAmountInput}
                        value={withdrawalAmountDraft}
                        onChangeText={(value) => {
                          setWithdrawalAmountDraft(formatAmountInputWithCommas(value));
                        }}
                        placeholder="0.00"
                        placeholderTextColor="#9aa4a0"
                        keyboardType="decimal-pad"
                        editable={!withdrawing}
                        autoFocus
                      />
                      {withdrawalTotals.available > 0 ? (
                        <TouchableOpacity
                          style={styles.withdrawAmountMaxBtn}
                          onPress={() => setWithdrawalAmountDraft(formatBalanceNumber(withdrawalTotals.available))}
                          disabled={withdrawing}
                        >
                          <Text style={styles.withdrawAmountMaxText}>Max</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.withdrawDedicatedActions}>
                    <TouchableOpacity
                      style={styles.withdrawCancelBtn}
                      onPress={() => setWithdrawalScreenMode("overview")}
                      disabled={withdrawing}
                    >
                      <Text style={styles.withdrawCancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.withdrawSubmitBtn,
                        (withdrawalTotals.available <= 0 || typedWithdrawalAmount <= 0 || withdrawing)
                          ? styles.secondaryActionPillDisabled
                          : null,
                      ]}
                      onPress={confirmCustomWithdrawal}
                      disabled={withdrawalTotals.available <= 0 || typedWithdrawalAmount <= 0 || withdrawing}
                    >
                      {withdrawing ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text style={styles.withdrawSubmitBtnText}>Withdraw</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.historySection}>
                  {selectedDetailItem ? (() => {
                    const isWithdrawal = selectedDetailItem.kind === "withdrawal";
                    const isFailed =
                      selectedDetailItem.status === "failed" ||
                      selectedDetailItem.status === "cancelled" ||
                      selectedDetailItem.status === "reversed";
                    const isPending =
                      selectedDetailItem.status === "in_progress" ||
                      selectedDetailItem.status === "pending" ||
                      selectedDetailItem.status === "requested";
                    const isTransferred = !isFailed && !isPending;
                    const finalStatusLabel = isWithdrawal
                      ? isFailed
                        ? "Failed"
                        : isTransferred
                        ? "Transferred"
                        : "Pending"
                      : "Credited";

                    return (
                      <View style={styles.fullDetailCard}>
                        <Text style={styles.fullDetailEyebrow}>
                          {isWithdrawal ? "Withdrawal Details" : "Earning Details"}
                        </Text>
                        <Text style={styles.fullDetailAmount}>
                          {isWithdrawal
                            ? `-₱${formatBalanceNumber(selectedDetailItem.amount)}`
                            : `+₱${formatBalanceNumber(selectedDetailItem.amount)}`}
                        </Text>
                        <Text style={styles.fullDetailTitle}>{selectedDetailItem.title}</Text>

                        <View style={styles.fullDetailStepperBox}>
                          <Text style={styles.fullDetailSectionLabel}>Status</Text>
                          <View style={styles.fullWidthStepperTrack}>
                            <View style={styles.fullWidthStepperLine} />
                            <View style={styles.stepperNodesRow}>
                              <View style={styles.fullWidthStepperNodeCol}>
                                <View style={styles.stepperDotDone}>
                                  <Ionicons name="checkmark" size={11} color="#ffffff" />
                                </View>
                                <Text style={styles.stepperLabelMuted}>Requested</Text>
                              </View>

                              <View style={styles.fullWidthStepperNodeCol}>
                                <View style={styles.stepperDotDone}>
                                  <Ionicons name="checkmark" size={11} color="#ffffff" />
                                </View>
                                <Text style={styles.stepperLabelMuted}>In progress</Text>
                              </View>

                              <View style={styles.fullWidthStepperNodeCol}>
                                <View
                                  style={[
                                    styles.stepperDotDone,
                                    isPending ? styles.stepperDotPending : null,
                                    isFailed ? styles.stepperDotFailed : null,
                                  ]}
                                >
                                  <Ionicons
                                    name={isFailed ? "close" : "checkmark"}
                                    size={11}
                                    color={isPending ? "#9aa4a0" : "#ffffff"}
                                  />
                                </View>
                                <Text style={[styles.stepperLabelActive, isFailed ? styles.stepperLabelFailed : null]}>
                                  {finalStatusLabel}
                                </Text>
                              </View>
                            </View>
                          </View>
                        </View>

                        <View style={styles.fullDetailRows}>
                          <View style={styles.fullDetailRow}>
                            <Text style={styles.fullDetailRowLabel}>Time</Text>
                            <Text style={styles.fullDetailRowValue}>{selectedDetailItem.dateText}</Text>
                          </View>
                          <View style={styles.fullDetailRow}>
                            <Text style={styles.fullDetailRowLabel}>Recorded at</Text>
                            <Text style={styles.fullDetailRowValue}>{selectedDetailItem.fullTimeText}</Text>
                          </View>
                          <View style={styles.fullDetailRow}>
                            <Text style={styles.fullDetailRowLabel}>Amount</Text>
                            <Text style={styles.fullDetailRowValue}>
                              {isWithdrawal
                                ? `₱-${formatBalanceNumber(selectedDetailItem.amount)}`
                                : `₱+${formatBalanceNumber(selectedDetailItem.amount)}`}
                            </Text>
                          </View>
                          <View style={styles.fullDetailRow}>
                            <Text style={styles.fullDetailRowLabel}>Status</Text>
                            <Text style={[styles.fullDetailRowValue, isFailed ? styles.stepperLabelFailed : styles.fullDetailStatusText]}>
                              {finalStatusLabel}
                            </Text>
                          </View>
                          <View style={styles.fullDetailRow}>
                            <Text style={styles.fullDetailRowLabel}>Reference No.</Text>
                            <Text style={styles.fullDetailRowValue} selectable>
                              {selectedDetailItem.referenceNo}
                            </Text>
                          </View>
                          {isWithdrawal ? (
                            <>
                              <View style={styles.fullDetailRow}>
                                <Text style={styles.fullDetailRowLabel}>Bank</Text>
                                <Text style={styles.fullDetailRowValue}>{selectedDetailItem.bankName}</Text>
                              </View>
                              <View style={styles.fullDetailRow}>
                                <Text style={styles.fullDetailRowLabel}>Account</Text>
                                <Text style={styles.fullDetailRowValue}>
                                  {selectedDetailItem.accountName} · {selectedDetailItem.accountNumber}
                                </Text>
                              </View>
                              {selectedDetailItem.failureCode ? (
                                <View style={styles.fullDetailRow}>
                                  <Text style={styles.fullDetailRowLabel}>Failure reason</Text>
                                  <Text style={[styles.fullDetailRowValue, styles.stepperLabelFailed]}>
                                    {selectedDetailItem.failureCode}
                                  </Text>
                                </View>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <View style={styles.fullDetailRow}>
                                <Text style={styles.fullDetailRowLabel}>Service</Text>
                                <Text style={styles.fullDetailRowValue}>{selectedDetailItem.serviceName}</Text>
                              </View>
                              <View style={styles.fullDetailRow}>
                                <Text style={styles.fullDetailRowLabel}>Customer</Text>
                                <Text style={styles.fullDetailRowValue}>{selectedDetailItem.customerName}</Text>
                              </View>
                              <View style={styles.fullDetailRow}>
                                <Text style={styles.fullDetailRowLabel}>Payment option</Text>
                                <Text style={styles.fullDetailRowValue}>{selectedDetailItem.paymentTypeLabel}</Text>
                              </View>
                            </>
                          )}
                        </View>
                      </View>
                    );
                  })() : (
                    <Text style={styles.withdrawalEmptyText}>Transaction details unavailable.</Text>
                  )}
                </View>
              )}
            </View>
          ) : null}

          {withdrawalsOnly && loading ? <View style={styles.loadingWrap}><LoadingStatus label="Loading withdrawals…" /></View> : null}
          {withdrawalsOnly && loadError ? (
            <View style={styles.emptyCard}>
              <Ionicons name="cloud-offline-outline" size={28} color="#9b403b" />
              <Text style={styles.emptyTitle}>Withdrawals unavailable</Text>
              <Text style={styles.emptyText}>{loadError}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void loadPayments()}><Text style={styles.retryButtonText}>Try Again</Text></TouchableOpacity>
            </View>
          ) : null}

          {!withdrawalsOnly ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {([
              { key: "all", label: `All (${requests.length})` },
              { key: "review", label: `Needs review (${reviewCount})` },
              { key: "verified", label: `Verified (${verifiedCount})` },
            ] as { key: PaymentFilter; label: string }[]).map((item) => (
              <TouchableOpacity key={item.key} style={[styles.filterChip, filter === item.key ? styles.filterChipActive : null]} onPress={() => setFilter(item.key)}>
                <Text style={[styles.filterChipText, filter === item.key ? styles.filterChipTextActive : null]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView> : null}

          {!withdrawalsOnly && loading ? (
            <View style={styles.loadingWrap}><LoadingStatus label="Loading payments…" /></View>
          ) : !withdrawalsOnly && loadError ? (
            <View style={styles.emptyCard}>
              <Ionicons name="cloud-offline-outline" size={28} color="#9b403b" />
              <Text style={styles.emptyTitle}>Payments unavailable</Text>
              <Text style={styles.emptyText}>{loadError}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void loadPayments()}><Text style={styles.retryButtonText}>Try Again</Text></TouchableOpacity>
            </View>
          ) : !withdrawalsOnly && visibleRequests.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="receipt-outline" size={28} color="#8b938c" />
              <Text style={styles.emptyTitle}>{filter === "all" ? "No family payments yet" : "Nothing in this filter"}</Text>
              <Text style={styles.emptyText}>Submitted payment receipts will appear here for review.</Text>
            </View>
          ) : !withdrawalsOnly ? visibleRequests.map((item) => {
            const statusMeta = getPaymentStatus(item);
            const needsReview = String(item.status || "").toLowerCase() === "payment_submitted";
            return (
              <TouchableOpacity
                key={item.id}
                activeOpacity={0.9}
                style={[styles.paymentCard, needsReview ? styles.paymentCardReview : null]}
                onPress={() => navigation.navigate("ShopPaymentReceipt", { request: item })}
              >
                <View style={styles.paymentTopRow}>
                  <View style={styles.paymentTitleBlock}>
                    <Text style={styles.paymentProduct} numberOfLines={1}>{item.productName || "Funeral service"}</Text>
                    <Text style={styles.paymentFor} numberOfLines={1}>For {item.deceasedFullName || "family service"}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
                    <Ionicons name={statusMeta.icon} size={13} color={statusMeta.color} />
                    <Text style={[styles.statusBadgeText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
                  </View>
                </View>
                <Text style={styles.paymentAmount}>{Number(item.paymentAmount) > 0 ? formatPhilippinePeso(String(item.paymentAmount)) : "Amount not provided"}</Text>
                <View style={styles.paymentMetaCard}>
                  <View style={styles.paymentMetaLine}><Ionicons name="person-outline" size={15} color="#71807a" /><Text style={styles.paymentMetaText}>{item.paymentPayerName || item.familyCoordinatorName || "Unknown sender"}</Text></View>
                  <View style={styles.paymentMetaLine}><Ionicons name="time-outline" size={15} color="#71807a" /><Text style={styles.paymentMetaText}>{formatTimestamp(item.paymentSubmittedAt || item.createdAt)}</Text></View>
                  {item.paymentReferenceNumber ? <View style={styles.paymentMetaLine}><Ionicons name="key-outline" size={15} color="#71807a" /><Text style={styles.paymentMetaText}>Reference {item.paymentReferenceNumber}</Text></View> : null}
                </View>
                <View style={styles.paymentFooter}>
                  <View style={styles.proofIndicator}>
                    <Ionicons name={item.paymentProofImageUrl ? "image-outline" : "alert-circle-outline"} size={15} color={item.paymentProofImageUrl ? "#2f6b55" : "#9b403b"} />
                    <Text style={[styles.proofIndicatorText, !item.paymentProofImageUrl ? styles.proofIndicatorMissing : null]}>{item.paymentProofImageUrl ? "Receipt available" : "Receipt missing"}</Text>
                  </View>
                  <View style={styles.openPaymentButton}><Text style={styles.openPaymentButtonText}>View Receipt</Text><Ionicons name="chevron-forward" size={16} color="#ffffff" /></View>
                </View>
              </TouchableOpacity>
            );
          }) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceMuted },
  withdrawalScreen: { flex: 1, backgroundColor: "#ffffff" },
  body: { flex: 1 },
  withdrawalBody: { flex: 1, backgroundColor: "#ffffff" },
  headerSafeArea: { backgroundColor: "#f8f6f2" },
  withdrawalHeaderSafeArea: { backgroundColor: "#ffffff" },
  headerBar: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#d9d6cd" },
  withdrawalHeaderBar: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6, backgroundColor: "#ffffff" },
  withdrawalCircleBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#ecefee" },
  headerCopy: { flex: 1 },
  headerTitle: { color: "#22312d", fontSize: 20, fontWeight: "900" },
  content: { padding: spacing.lg, paddingBottom: 36, gap: spacing.md },
  withdrawalContent: { paddingBottom: 36, backgroundColor: "#ffffff" },
  summaryCard: { borderRadius: 26, backgroundColor: "#22312d", padding: 18 },
  summaryIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.13)" },
  summaryTitle: { color: "#ffffff", fontSize: 23, lineHeight: 29, fontWeight: "900", marginTop: 16 },
  summaryText: { color: "#d3ddd9", fontSize: 13, lineHeight: 19, marginTop: 7 },
  summaryStats: { flexDirection: "row", borderRadius: 17, backgroundColor: "rgba(255,255,255,0.09)", marginTop: 17, paddingVertical: 12 },
  summaryStatWrap: { flex: 1, flexDirection: "row", alignItems: "center" },
  summaryStat: { flex: 1, alignItems: "center" },
  summaryDivider: { width: 1, height: 32, backgroundColor: "rgba(255,255,255,0.14)" },
  summaryStatValue: { color: "#ffffff", fontSize: 20, fontWeight: "900" },
  summaryStatLabel: { color: "#c6d1cd", fontSize: 10, fontWeight: "700", marginTop: 2 },
  withdrawalPage: { backgroundColor: "#ffffff" },
  accountOverview: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 22, backgroundColor: "#ffffff", borderBottomWidth: 1, borderBottomColor: "#eaeeec" },
  accountIdentity: { flexDirection: "row", alignItems: "center", gap: 11 },
  accountMark: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#0e1512" },
  accountTypeLabel: { color: "#6c7571", fontSize: 15, fontWeight: "600" },
  primaryBalance: { marginTop: 16 },
  primaryBalanceLine: { fontSize: 36, lineHeight: 43 },
  primaryBalanceCurrency: { color: "#6e7773", fontSize: 33, fontWeight: "600" },
  primaryBalanceAmount: { color: "#111815", fontSize: 36, fontWeight: "800" },
  withdrawAmountField: { marginTop: 16 },
  withdrawAmountLabel: { color: "#5e6873", fontSize: 12, fontWeight: "700", marginBottom: 6 },
  withdrawAmountInputRow: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: "#dfe4e2", backgroundColor: "#ffffff", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 6 },
  withdrawAmountCurrency: { color: "#5e6873", fontSize: 16, fontWeight: "700" },
  withdrawAmountInput: { flex: 1, color: "#111815", fontSize: 15, fontWeight: "700", paddingVertical: 8 },
  withdrawAmountMaxBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: "#eef3f1" },
  withdrawAmountMaxText: { color: "#117a6f", fontSize: 12, fontWeight: "800" },
  actionPillsRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 22 },
  primaryActionPill: { minHeight: 44, borderRadius: 999, backgroundColor: "#146c60", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 22 },
  primaryActionPillText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  secondaryActionPill: { minHeight: 44, borderRadius: 999, backgroundColor: "#e6ecea", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 22 },
  secondaryActionPillDisabled: { opacity: 0.55 },
  secondaryActionPillText: { color: "#18221e", fontSize: 14, fontWeight: "700" },
  salesSection: { paddingHorizontal: 20, paddingTop: 18, backgroundColor: "#ffffff" },
  withdrawalSearchWrap: { minHeight: 46, borderRadius: 13, backgroundColor: "#f3f5f4", flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 },
  withdrawalSearchInput: { flex: 1, color: "#18221e", fontSize: 14, fontWeight: "500", paddingVertical: 8 },
  overviewTabsRow: { flexDirection: "row", alignItems: "center", gap: 22, marginTop: 16, borderBottomWidth: 1, borderBottomColor: "#eceff2" },
  overviewTabItem: { paddingBottom: 10, borderBottomWidth: 2.5, borderBottomColor: "transparent" },
  overviewTabItemActive: { borderBottomColor: "#146c60" },
  overviewTabText: { color: "#687570", fontSize: 14, fontWeight: "600" },
  overviewTabTextActive: { color: "#182026", fontWeight: "700" },
  withdrawalDateGroup: { marginTop: 22 },
  withdrawalDateHeader: { color: "#88928e", fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginBottom: 8 },
  withdrawalSale: { paddingVertical: 11, backgroundColor: "#ffffff" },
  saleTransactionRow: { flexDirection: "row", alignItems: "center", gap: 13 },
  saleTransactionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#eaeeec", backgroundColor: "#ffffff" },
  withdrawalSaleCopy: { flex: 1, minWidth: 0 },
  withdrawalSaleName: { color: "#17201c", fontSize: 15, fontWeight: "700" },
  withdrawalSaleStatus: { color: "#7d8681", fontSize: 13, fontWeight: "500", marginTop: 2 },
  withdrawalSaleAmount: { color: "#17201c", fontSize: 15, fontWeight: "800" },
  withdrawDedicatedPage: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28, backgroundColor: "#ffffff" },
  withdrawDedicatedTitle: { color: "#182026", fontSize: 22, fontWeight: "800" },
  withdrawDedicatedSub: { color: "#687570", fontSize: 13, lineHeight: 19, marginTop: 4 },
  withdrawAvailableBox: { marginTop: 18, padding: 16, borderRadius: 12, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#eaeeec" },
  withdrawAvailableLabel: { color: "#6c7571", fontSize: 12, fontWeight: "600" },
  withdrawAvailableValue: { color: "#111815", fontSize: 26, fontWeight: "800", marginTop: 4 },
  withdrawDedicatedActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 24 },
  withdrawCancelBtn: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: "#d8dee4", backgroundColor: "#ffffff", justifyContent: "center", alignItems: "center", paddingHorizontal: 18 },
  withdrawCancelBtnText: { color: "#2d3741", fontSize: 14, fontWeight: "700" },
  withdrawSubmitBtn: { minHeight: 44, borderRadius: 8, backgroundColor: "#146c60", justifyContent: "center", alignItems: "center", paddingHorizontal: 22 },
  withdrawSubmitBtnText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  historySection: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28, backgroundColor: "#ffffff" },
  fullDetailCard: { marginBottom: 24, padding: 18, borderRadius: 12, borderWidth: 1, borderColor: "#e6eaee", backgroundColor: "#ffffff" },
  fullDetailEyebrow: { color: "#6c7571", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  fullDetailAmount: { color: "#111815", fontSize: 30, fontWeight: "800", marginTop: 6 },
  fullDetailTitle: { color: "#4e585f", fontSize: 14, fontWeight: "600", marginTop: 4 },
  fullDetailStepperBox: { marginTop: 18, paddingTop: 16, paddingBottom: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#eef1f4" },
  fullDetailSectionLabel: { color: "#6c7571", fontSize: 12, fontWeight: "700", marginBottom: 14 },
  fullWidthStepperTrack: { width: "100%", position: "relative", justifyContent: "center", marginVertical: 4 },
  fullWidthStepperLine: { position: "absolute", top: 8, left: "16%", right: "16%", height: 1.5, backgroundColor: "#cdd5df" },
  fullWidthStepperNodeCol: { flex: 1, alignItems: "center" },
  fullDetailRows: { marginTop: 14, gap: 12 },
  fullDetailRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  fullDetailRowLabel: { color: "#6c7571", fontSize: 13, fontWeight: "500" },
  fullDetailRowValue: { flex: 1, color: "#1a222b", fontSize: 13, fontWeight: "700", textAlign: "right" },
  fullDetailStatusText: { color: "#146c60" },
  stepperNodesRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  stepperDotDone: { width: 17, height: 17, borderRadius: 9, backgroundColor: "#239b43", alignItems: "center", justifyContent: "center" },
  stepperDotPending: { backgroundColor: "#ffffff", borderWidth: 1.5, borderColor: "#c5ced8" },
  stepperDotFailed: { backgroundColor: "#d9383a" },
  stepperLabelMuted: { color: "#9ba3ab", fontSize: 11, fontWeight: "500", marginTop: 6, textAlign: "center" },
  stepperLabelActive: { color: "#232b33", fontSize: 11, fontWeight: "700", marginTop: 6, textAlign: "center" },
  stepperLabelFailed: { color: "#c93535" },
  withdrawalEmptyText: { color: "#687570", fontSize: 13, lineHeight: 19, textAlign: "center", paddingVertical: 16 },
  filterRow: { gap: 8, paddingRight: 4 },
  filterChip: { minHeight: 38, borderRadius: 999, borderWidth: 1, borderColor: "#d6d2c9", backgroundColor: "#ffffff", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  filterChipActive: { backgroundColor: "#516961", borderColor: "#516961" },
  filterChipText: { color: "#62706b", fontSize: 12, fontWeight: "900" },
  filterChipTextActive: { color: "#ffffff" },
  loadingWrap: { minHeight: 220, alignItems: "center", justifyContent: "center" },
  emptyCard: { minHeight: 220, borderRadius: 24, borderWidth: 1, borderColor: "#d9d6cd", backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", padding: 24 },
  emptyTitle: { color: "#22312d", fontSize: 18, fontWeight: "900", marginTop: 11 },
  emptyText: { color: "#687570", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 5 },
  retryButton: { minHeight: 40, borderRadius: 13, backgroundColor: "#22312d", justifyContent: "center", paddingHorizontal: 16, marginTop: 15 },
  retryButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  paymentCard: { borderRadius: radii.xl, borderWidth: 1, borderColor: colors.borderWarm, backgroundColor: colors.surface, padding: spacing.lg },
  paymentCardReview: { borderColor: "#e3b88f", backgroundColor: "#fffdf9" },
  paymentTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  paymentTitleBlock: { flex: 1, minWidth: 0 },
  paymentProduct: { color: "#22312d", fontSize: 16, fontWeight: "900" },
  paymentFor: { color: "#77817c", fontSize: 12, fontWeight: "700", marginTop: 3 },
  statusBadge: { maxWidth: 112, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 6 },
  statusBadgeText: { fontSize: 10, fontWeight: "900" },
  paymentAmount: { color: "#2d6752", fontSize: 23, fontWeight: "900", marginTop: 14 },
  paymentMetaCard: { borderRadius: 15, backgroundColor: "#f4f2ed", padding: 11, gap: 7, marginTop: 12 },
  paymentMetaLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  paymentMetaText: { flex: 1, color: "#5e6b66", fontSize: 11, fontWeight: "700" },
  paymentFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderTopWidth: 1, borderTopColor: "#ebe7df", paddingTop: 12, marginTop: 13 },
  proofIndicator: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  proofIndicatorText: { color: "#2f6b55", fontSize: 11, fontWeight: "800" },
  proofIndicatorMissing: { color: "#9b403b" },
  openPaymentButton: { minHeight: 36, borderRadius: 12, backgroundColor: "#22312d", flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 12 },
  openPaymentButtonText: { color: "#ffffff", fontSize: 11, fontWeight: "900" },
});
