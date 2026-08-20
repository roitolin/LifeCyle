import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import KeyboardAwareScrollView from "./KeyboardAwareScrollView";
import { supabase } from "@/services/supabaseClient";
import { uploadCertificate } from "@/services";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { hapticSuccess } from "@/utils/haptics";
import { createAdminNotification } from "@/utils/createAdminNotification";

type AdminPayment = {
  id: string;
  status: string;
  amount: number;
  payerName: string;
  gcashName: string;
  gcashNumber: string;
  referenceNumber: string;
  proofImageUrl: string;
  createdAt: string;
  verifiedAt?: string | null;
  expiresAt?: string | null;
  rejectionReason?: string | null;
};

type PaymentQrSetting = {
  imageUrl: string | null;
  feeAmount: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

const PAYMENT_QR_SETTING_KEY = "payment_qr_code";

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function getStatusMeta(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "verified") {
    return { label: "Verified", background: "#e7f5ec", text: "#166534" };
  }
  if (normalized === "rejected") {
    return { label: "Rejected", background: "#fde8e8", text: "#991b1b" };
  }
  return { label: "Pending Review", background: "#fff7ed", text: "#b45309" };
}

function getDaysRemaining(value?: string | null) {
  if (!value) return 0;
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000)));
}

function toAdminPayment(row: any): AdminPayment {
  return {
    id: row.id,
    status: row.status || "pending",
    amount: Number(row.amount) || 0,
    payerName: row.payerName || "",
    gcashName: row.gcashName || "",
    gcashNumber: row.gcashNumber || "",
    referenceNumber: row.referenceNumber || "",
    proofImageUrl: row.proofImageUrl || "",
    createdAt: row.createdAt || "",
    verifiedAt: row.verifiedAt || null,
    expiresAt: row.expiresAt || null,
    rejectionReason: row.rejectionReason || null,
  };
}

export default function AdminPaymentModal({ visible, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [proofViewerUrl, setProofViewerUrl] = useState<string | null>(null);
  const [successfulPayment, setSuccessfulPayment] = useState<AdminPayment | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<AdminPayment | null>(null);
  const [paymentInfoExpanded, setPaymentInfoExpanded] = useState(false);
  const [submittedProofExpanded, setSubmittedProofExpanded] = useState(false);

  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [qrSetting, setQrSetting] = useState<PaymentQrSetting>({ imageUrl: null, feeAmount: 0 });
  const [paidUntil, setPaidUntil] = useState<string | null>(null);

  const [payerName, setPayerName] = useState("");
  const [gcashName, setGcashName] = useState("");
  const [payerGcash, setPayerGcash] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id || null;

      if (!userId) {
        setPayments([]);
        setQrSetting({ imageUrl: null, feeAmount: 0 });
        setPaidUntil(null);
        return;
      }

      const [settingRes, paymentsRes, shopRes] = await Promise.all([
        supabase
          .from("settings")
          .select('value, "updatedAt"')
          .eq("key", PAYMENT_QR_SETTING_KEY)
          .maybeSingle(),
        supabase
          .from("shop_payments")
          .select("*")
          .eq("shopId", userId)
          .order("createdAt", { ascending: false }),
        supabase
          .from("funeral_shops")
          .select("paidUntil, status")
          .eq("id", userId)
          .maybeSingle(),
      ]);

      const value = (settingRes.data?.value ?? {}) as { imageUrl?: string; feeAmount?: number };
      setQrSetting({
        imageUrl: value.imageUrl?.trim() || null,
        feeAmount: Number(value.feeAmount) || 0,
      });
      setPayments(((paymentsRes.data as AdminPayment[]) || []).map(toAdminPayment));
      setPaidUntil(shopRes.data?.paidUntil || null);
    } catch (error) {
      console.error("Failed to load admin payments:", error);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setPayerName("");
      setGcashName("");
      setPayerGcash("");
      setReferenceNumber("");
      setProofUri(null);
      setSuccessfulPayment(null);
      setSelectedPayment(null);
      void loadData();
    }
  }, [visible, loadData]);

  useEffect(() => {
    if (!visible) return;
    const channel = supabase
      .channel("shop-admin-payment-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_payments" }, () => void loadData())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [visible, loadData]);

  const latestPayment = payments[0] || null;
  const hasQrSetup = Boolean(qrSetting.imageUrl) && Number(qrSetting.feeAmount) > 0;
  const paymentPending = latestPayment?.status === "pending";
  const subscriptionDaysLeft = getDaysRemaining(paidUntil);
  const subscriptionActive = Boolean(
    paidUntil && new Date(paidUntil).getTime() > Date.now()
  );

  const openPaymentDetails = (payment: AdminPayment) => {
    setPaymentInfoExpanded(false);
    setSubmittedProofExpanded(false);
    setSelectedPayment(payment);
  };

  const pickAndUploadProof = async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.75,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingProof(true);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setProofUri(url);
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Failed to upload payment proof.");
    } finally {
      setUploadingProof(false);
    }
  };

  const submitPayment = async () => {
    if (submitting) return;

    if (paymentPending) {
      Alert.alert("Payment Under Review", "Please wait for the admin to review your current submission.");
      return;
    }
    if (!payerName.trim() || !gcashName.trim() || !payerGcash.trim()) {
      Alert.alert("Incomplete Details", "Enter the sender name, GCash account name, and GCash number.");
      return;
    }
    if (!proofUri) {
      Alert.alert("Proof Required", "Attach a screenshot as proof that you paid.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) throw new Error("You must be signed in to submit payment details.");

      const { data, error } = await supabase
        .from("shop_payments")
        .insert({
          shopId: userId,
          payerName: payerName.trim(),
          gcashName: gcashName.trim(),
          gcashNumber: payerGcash.trim(),
          referenceNumber: referenceNumber.trim(),
          amount: Number(qrSetting.feeAmount) || 0,
          proofImageUrl: proofUri,
          status: "pending",
        })
        .select("*")
        .single();
      if (error) throw error;

      const submittedPayment = toAdminPayment(data);

      setPayerName("");
      setGcashName("");
      setPayerGcash("");
      setReferenceNumber("");
      setProofUri(null);
      await loadData();
      onChanged?.();
      hapticSuccess();
      setSuccessfulPayment(submittedPayment);
      void createAdminNotification(
        "shop_payment_submitted",
        "Shop Payment Submitted",
        `${payerName.trim()} submitted a registration payment for review.`,
        { shopId: userId }
      );
    } catch (error: any) {
      Alert.alert("Submission Failed", error?.message || "Unable to submit payment details.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        visible={visible && !successfulPayment && !selectedPayment && !proofViewerUrl}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Ionicons name="card-outline" size={20} color="#22312d" />
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>Payments to Admin</Text>
                <Text style={styles.caption}>Registration and renewal payments</Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel="Close payments">
                <Ionicons name="close" size={20} color="#53615d" />
              </TouchableOpacity>
            </View>
            <KeyboardAwareScrollView
              style={styles.paymentScroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              scrollEnabled
              overScrollMode="always"
              keyboardShouldPersistTaps="handled"
              bottomOffset={24}
            >
              {loading ? (
                <View style={styles.stateBox}>
                  <ActivityIndicator size="small" color="#7f6653" />
                  <Text style={styles.stateText}>Loading payment records…</Text>
                </View>
              ) : (
                <>
                  <View style={styles.subscriptionCard}>
                    <View style={styles.subscriptionTop}>
                      <View style={styles.subscriptionTitleRow}>
                        <Ionicons name="wallet-outline" size={18} color="#22312d" />
                        <Text style={styles.subscriptionTitle}>Registration Subscription</Text>
                      </View>
                      <View
                        style={[
                          styles.statusBadge,
                          latestPayment
                            ? { backgroundColor: getStatusMeta(latestPayment.status).background }
                            : { backgroundColor: "#eef1ec" },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            latestPayment ? { color: getStatusMeta(latestPayment.status).text } : { color: "#4c5b57" },
                          ]}
                        >
                          {latestPayment ? getStatusMeta(latestPayment.status).label : "Not Paid Yet"}
                        </Text>
                      </View>
                    </View>

                    {subscriptionActive ? (
                      <Text style={styles.subscriptionLine}>
                        Active until {formatDate(paidUntil)} · {subscriptionDaysLeft} day
                        {subscriptionDaysLeft === 1 ? "" : "s"} left
                      </Text>
                    ) : paidUntil ? (
                      <Text style={[styles.subscriptionLine, styles.subscriptionLineExpired]}>
                        Expired on {formatDate(paidUntil)} — submit a renewal payment below.
                      </Text>
                    ) : (
                      <Text style={styles.subscriptionLine}>
                        No active subscription yet. Submit your registration payment below.
                      </Text>
                    )}

                    {latestPayment?.status === "pending" ? (
                      <View style={styles.notice}>
                        <Ionicons name="time-outline" size={15} color="#b45309" />
                        <Text style={styles.noticeText}>
                          Your payment is under review. You can submit again after the admin finishes reviewing it.
                        </Text>
                      </View>
                    ) : null}

                    {latestPayment?.status === "rejected" ? (
                      <View style={styles.notice}>
                        <Ionicons name="alert-circle-outline" size={15} color="#991b1b" />
                        <Text style={styles.noticeText}>
                          Your last payment was rejected
                          {latestPayment.rejectionReason
                            ? `: ${latestPayment.rejectionReason}`
                            : ". Please resubmit with the correct details."}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {!paymentPending && !hasQrSetup ? (
                    <View style={styles.infoCard}>
                      <Ionicons name="information-circle-outline" size={18} color="#7f6653" />
                      <Text style={styles.infoText}>
                        The admin has not configured a payment QR code yet. Please check back later.
                      </Text>
                    </View>
                  ) : !paymentPending ? (
                    <View style={styles.paymentFormCard}>
                      <View style={styles.formTitleRow}>
                        <View style={styles.formTitleIcon}>
                          <Ionicons name="shield-checkmark-outline" size={20} color="#22312d" />
                        </View>
                        <View style={styles.formTitleCopy}>
                          <Text style={styles.formTitle}>Pay Registration / Renewal</Text>
                          <Text style={styles.formSubtitle}>Complete the three steps below to send your payment.</Text>
                        </View>
                      </View>

                      <View style={styles.stepHeader}>
                        <View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View>
                        <View style={styles.stepCopy}>
                          <Text style={styles.stepTitle}>Scan and pay</Text>
                          <Text style={styles.stepDescription}>Use the admin QR code, then return here.</Text>
                        </View>
                      </View>

                      {qrSetting.imageUrl ? (
                        <TouchableOpacity
                          activeOpacity={0.9}
                          style={styles.qrWrap}
                          onPress={() => setProofViewerUrl(qrSetting.imageUrl)}
                        >
                          <Image source={{ uri: qrSetting.imageUrl }} style={styles.qrImage} resizeMode="contain" />
                          <Text style={styles.qrHint}>Tap to enlarge QR code</Text>
                        </TouchableOpacity>
                      ) : null}

                      <View style={styles.amountRow}>
                        <Text style={styles.amountLabel}>Amount to pay</Text>
                        <Text style={styles.amountValue}>
                          {Number(qrSetting.feeAmount) > 0
                            ? formatPhilippinePeso(String(qrSetting.feeAmount))
                            : "Ask admin for the amount"}
                        </Text>
                      </View>

                      <View style={styles.stepDivider} />

                      <View style={styles.stepHeader}>
                        <View style={styles.stepNumber}><Text style={styles.stepNumberText}>2</Text></View>
                        <View style={styles.stepCopy}>
                          <Text style={styles.stepTitle}>Enter payment information</Text>
                          <Text style={styles.stepDescription}>Use the exact details shown in your GCash receipt.</Text>
                        </View>
                      </View>

                      <View style={styles.fieldGroup}>
                        <Text style={styles.inputLabel}>Sender Name</Text>
                        <TextInput
                          style={styles.input}
                          value={payerName}
                          onChangeText={setPayerName}
                          placeholder="Name of the person who sent payment"
                          placeholderTextColor="#9aa39d"
                        />

                        <Text style={styles.inputLabel}>GCash Account Name</Text>
                        <TextInput
                          style={styles.input}
                          value={gcashName}
                          onChangeText={setGcashName}
                          placeholder="Name shown in GCash"
                          placeholderTextColor="#9aa39d"
                        />

                        <Text style={styles.inputLabel}>GCash Number</Text>
                        <TextInput
                          style={styles.input}
                          value={payerGcash}
                          onChangeText={setPayerGcash}
                          placeholder="e.g. 09XX XXX XXXX"
                          placeholderTextColor="#9aa39d"
                          keyboardType="phone-pad"
                        />

                        <Text style={styles.inputLabel}>Reference Number <Text style={styles.optionalLabel}>(Optional)</Text></Text>
                        <TextInput
                          style={styles.input}
                          value={referenceNumber}
                          onChangeText={setReferenceNumber}
                          placeholder="Reference number from the receipt"
                          placeholderTextColor="#9aa39d"
                        />
                      </View>

                      <View style={styles.stepDivider} />

                      <View style={styles.stepHeader}>
                        <View style={styles.stepNumber}><Text style={styles.stepNumberText}>3</Text></View>
                        <View style={styles.stepCopy}>
                          <Text style={styles.stepTitle}>Attach payment proof</Text>
                          <Text style={styles.stepDescription}>Upload a clear screenshot showing the completed payment.</Text>
                        </View>
                      </View>

                      {proofUri ? (
                        <View style={styles.proofPreviewWrap}>
                          <Image source={{ uri: proofUri }} style={styles.proofPreview} resizeMode="cover" />
                          <View style={styles.proofPreviewActions}>
                            <TouchableOpacity
                              style={styles.proofInlineButton}
                              onPress={pickAndUploadProof}
                              disabled={uploadingProof}
                            >
                              {uploadingProof ? (
                                <ActivityIndicator size="small" color="#7f6653" />
                              ) : (
                                <Ionicons name="image-outline" size={16} color="#7f6653" />
                              )}
                              <Text style={styles.proofInlineButtonText}>Replace</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.proofInlineButton, styles.proofRemoveButton]}
                              onPress={() => setProofUri(null)}
                            >
                              <Ionicons name="trash-outline" size={16} color="#912929" />
                              <Text style={[styles.proofInlineButtonText, styles.proofRemoveText]}>Remove</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <TouchableOpacity style={styles.proofEmpty} onPress={pickAndUploadProof} disabled={uploadingProof}>
                          {uploadingProof ? (
                            <ActivityIndicator size="small" color="#7f6653" />
                          ) : (
                            <Ionicons name="image-outline" size={30} color="#c2c9c3" />
                          )}
                          <Text style={styles.proofEmptyText}>
                            {uploadingProof ? "Uploading..." : "Tap to attach a payment screenshot"}
                          </Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        style={[styles.submitButton, submitting ? styles.submitButtonDisabled : null]}
                        onPress={submitPayment}
                        disabled={submitting || uploadingProof}
                      >
                        {submitting ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                        <Text style={styles.submitButtonText}>
                          {submitting ? "Submitting..." : "Submit Payment for Review"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  <View style={styles.historySectionHeader}>
                    <View style={styles.historySectionIcon}>
                      <Ionicons name="time-outline" size={18} color="#7f6653" />
                    </View>
                    <View style={styles.historySectionCopy}>
                      <Text style={styles.sectionLabel}>Payment History</Text>
                      <Text style={styles.historySectionCaption}>Tap a record to view its complete details and proof.</Text>
                    </View>
                  </View>
                  {payments.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Ionicons name="receipt-outline" size={22} color="#8b938c" />
                      <Text style={styles.emptyTitle}>No payments sent yet</Text>
                      <Text style={styles.emptyText}>
                        Your submitted registration payments will appear here.
                      </Text>
                    </View>
                  ) : (
                    payments.map((payment) => {
                      const meta = getStatusMeta(payment.status);
                      return (
                        <TouchableOpacity
                          key={payment.id}
                          style={styles.historyRow}
                          onPress={() => openPaymentDetails(payment)}
                          activeOpacity={0.86}
                          accessibilityRole="button"
                          accessibilityLabel="View payment details"
                        >
                          <View style={styles.historyIconWrap}>
                            <Ionicons name="cash-outline" size={18} color="#7f6653" />
                          </View>
                          <View style={styles.historyCopy}>
                            <View style={styles.historyTop}>
                              <Text style={styles.historyAmount}>
                                {payment.amount > 0
                                  ? formatPhilippinePeso(String(payment.amount))
                                  : "Amount not provided"}
                              </Text>
                              <View style={[styles.statusBadge, { backgroundColor: meta.background }]}>
                                <Text style={[styles.statusBadgeText, { color: meta.text }]}>{meta.label}</Text>
                              </View>
                            </View>
                            <Text style={styles.historyMeta}>
                              Submitted {formatDate(payment.createdAt)}
                            </Text>
                            {payment.status === "verified" && payment.expiresAt ? (
                              <Text style={[styles.historyMeta, styles.historyMetaVerified]}>
                                Access until {formatDate(payment.expiresAt)}
                              </Text>
                            ) : null}
                            <View style={styles.historyDetailsRow}>
                              <Text style={styles.historyDetailsText}>Payment Details</Text>
                              <Ionicons name="chevron-forward" size={15} color="#7f6653" />
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}

                  <TouchableOpacity style={styles.closeRowButton} onPress={onClose}>
                    <Text style={styles.closeRowButtonText}>Close</Text>
                  </TouchableOpacity>
                </>
              )}
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(successfulPayment)}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={() => setSuccessfulPayment(null)}
      >
        {successfulPayment ? (
          <SafeAreaView style={styles.successScreen} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor="#101312" />
            <ScrollView
              style={styles.successScroll}
              contentContainerStyle={styles.successContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.successHero}>
                <View style={styles.successBadge}>
                  <Ionicons name="checkmark" size={34} color="#10201b" style={styles.successCheck} />
                </View>
                <Text style={styles.successTitle}>Payment Successful</Text>
                <Text style={styles.successMessage}>
                  Thank you for your payment. Your proof was sent to the LifeCycle admin and is now being reviewed.
                </Text>
              </View>

              <View style={styles.successBody}>
                <Text style={styles.successSectionTitle}>Payment Details</Text>
                <View style={styles.successDetails}>
                  <View style={styles.successDetailRow}>
                    <Text style={styles.successDetailLabel}>Payment Date</Text>
                    <Text style={styles.successDetailValue}>{formatDate(successfulPayment.createdAt)}</Text>
                  </View>
                  <View style={styles.successDetailRow}>
                    <Text style={styles.successDetailLabel}>Payment ID</Text>
                    <Text style={styles.successDetailValue}>#{successfulPayment.id.slice(0, 10).toUpperCase()}</Text>
                  </View>
                  <View style={styles.successDetailRow}>
                    <Text style={styles.successDetailLabel}>Status</Text>
                    <Text style={[styles.successDetailValue, styles.successPendingValue]}>Pending admin review</Text>
                  </View>
                </View>

                <View style={styles.successDivider} />

                <View style={styles.successItemRow}>
                  <View style={styles.successItemIcon}>
                    <Ionicons name="wallet-outline" size={25} color="#5f6b66" />
                  </View>
                  <View style={styles.successItemCopy}>
                    <Text style={styles.successItemName}>Registration / Renewal Payment</Text>
                    <Text style={styles.successItemMeta}>LifeCycle Admin</Text>
                    <Text style={styles.successItemMeta}>GCash: {successfulPayment.gcashName}</Text>
                  </View>
                  <Text style={styles.successItemAmount}>
                    {formatPhilippinePeso(String(successfulPayment.amount))}
                  </Text>
                </View>

                <View style={styles.successDivider} />

                <View style={styles.successDetailRow}>
                  <Text style={styles.successDetailLabel}>Sender</Text>
                  <Text style={styles.successDetailValue}>{successfulPayment.payerName}</Text>
                </View>
                <View style={styles.successDetailRow}>
                  <Text style={styles.successDetailLabel}>GCash Number</Text>
                  <Text style={styles.successDetailValue}>{successfulPayment.gcashNumber}</Text>
                </View>
                {successfulPayment.referenceNumber ? (
                  <View style={styles.successDetailRow}>
                    <Text style={styles.successDetailLabel}>Reference Number</Text>
                    <Text style={styles.successDetailValue}>{successfulPayment.referenceNumber}</Text>
                  </View>
                ) : null}

                <View style={styles.successDivider} />

                <View style={styles.successTotalRow}>
                  <Text style={styles.successTotalLabel}>Total Paid</Text>
                  <Text style={styles.successTotalValue}>
                    {formatPhilippinePeso(String(successfulPayment.amount))}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.successActionButton}
                  activeOpacity={0.88}
                  onPress={() => {
                    const payment = successfulPayment;
                    setSuccessfulPayment(null);
                    openPaymentDetails(payment);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="View payment status"
                >
                  <Ionicons name="receipt-outline" size={19} color="#8d4aac" />
                  <Text style={styles.successActionText}>View Payment Details</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </SafeAreaView>
        ) : null}
      </Modal>

      <Modal
        visible={Boolean(selectedPayment) && !proofViewerUrl}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setSelectedPayment(null)}
      >
        {selectedPayment ? (
          <View style={styles.successScreen}>
            <StatusBar barStyle="light-content" backgroundColor="#101312" translucent />
            <ScrollView
              style={styles.successScroll}
              contentContainerStyle={styles.successContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={[styles.successHero, styles.paymentDetailsHero]}>
                <TouchableOpacity
                  style={styles.paymentDetailsCloseButton}
                  onPress={() => setSelectedPayment(null)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Close payment details"
                >
                  <Ionicons name="close" size={24} color="#ffffff" />
                </TouchableOpacity>
                <View
                  style={[
                    styles.successBadge,
                    {
                      backgroundColor:
                        selectedPayment.status === "verified"
                          ? "#48c978"
                          : selectedPayment.status === "rejected"
                            ? "#e77b72"
                            : "#69b8e7",
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      selectedPayment.status === "verified"
                        ? "checkmark"
                        : selectedPayment.status === "rejected"
                          ? "close"
                          : "time-outline"
                    }
                    size={32}
                    color="#10201b"
                    style={styles.successCheck}
                  />
                </View>
                <Text style={styles.successTitle}>{getStatusMeta(selectedPayment.status).label}</Text>
                <Text style={styles.successMessage}>
                  {selectedPayment.status === "verified"
                    ? "Your payment has been verified by the LifeCycle admin."
                    : selectedPayment.status === "rejected"
                      ? "Your payment needs attention. Review the reason below before submitting again."
                      : "Your payment proof was sent to the LifeCycle admin and is currently being reviewed."}
                </Text>
              </View>

              <View style={styles.successBody}>
                <Text style={styles.successSectionTitle}>Payment Details</Text>
                <View style={styles.successDetails}>
                  <View style={styles.successDetailRow}>
                    <Text style={styles.successDetailLabel}>Payment Date</Text>
                    <Text style={styles.successDetailValue}>{formatDate(selectedPayment.createdAt)}</Text>
                  </View>
                  <View style={styles.successDetailRow}>
                    <Text style={styles.successDetailLabel}>Payment ID</Text>
                    <Text style={styles.successDetailValue}>#{selectedPayment.id.slice(0, 10).toUpperCase()}</Text>
                  </View>
                  <View style={styles.successDetailRow}>
                    <Text style={styles.successDetailLabel}>Status</Text>
                    <Text
                      style={[
                        styles.successDetailValue,
                        { color: getStatusMeta(selectedPayment.status).text },
                      ]}
                    >
                      {getStatusMeta(selectedPayment.status).label}
                    </Text>
                  </View>
                  {selectedPayment.verifiedAt ? (
                    <View style={styles.successDetailRow}>
                      <Text style={styles.successDetailLabel}>Verified Date</Text>
                      <Text style={styles.successDetailValue}>{formatDate(selectedPayment.verifiedAt)}</Text>
                    </View>
                  ) : null}
                  {selectedPayment.expiresAt ? (
                    <View style={styles.successDetailRow}>
                      <Text style={styles.successDetailLabel}>Access Until</Text>
                      <Text style={styles.successDetailValue}>{formatDate(selectedPayment.expiresAt)}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.successDivider} />

                <View style={styles.successItemRow}>
                  <View style={styles.successItemIcon}>
                    <Ionicons name="wallet-outline" size={25} color="#5f6b66" />
                  </View>
                  <View style={styles.successItemCopy}>
                    <Text style={styles.successItemName}>Registration / Renewal Payment</Text>
                    <Text style={styles.successItemMeta}>LifeCycle Admin</Text>
                  </View>
                  <Text style={styles.successItemAmount}>
                    {formatPhilippinePeso(String(selectedPayment.amount))}
                  </Text>
                </View>

                <View style={styles.successDivider} />

                <TouchableOpacity
                  style={styles.paymentDetailsAccordionHeader}
                  onPress={() => setPaymentInfoExpanded((expanded) => !expanded)}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={paymentInfoExpanded ? "Hide payment information" : "Show payment information"}
                  accessibilityState={{ expanded: paymentInfoExpanded }}
                >
                  <Text style={styles.paymentDetailsSectionTitle}>Payment Information</Text>
                  <View style={styles.paymentDetailsAccordionIcon}>
                    <Ionicons name={paymentInfoExpanded ? "chevron-up" : "chevron-down"} size={19} color="#53615d" />
                  </View>
                </TouchableOpacity>

                {paymentInfoExpanded ? (
                  <View style={styles.paymentDetailsAccordionBody}>
                    <View style={styles.successDetailRow}>
                      <Text style={styles.successDetailLabel}>Payment Method</Text>
                      <Text style={styles.successDetailValue}>GCash / E-wallet</Text>
                    </View>
                    <View style={styles.successDetailRow}>
                      <Text style={styles.successDetailLabel}>Sender</Text>
                      <Text style={styles.successDetailValue}>{selectedPayment.payerName || "â€”"}</Text>
                    </View>
                    <View style={styles.successDetailRow}>
                      <Text style={styles.successDetailLabel}>GCash Name</Text>
                      <Text style={styles.successDetailValue}>{selectedPayment.gcashName || "â€”"}</Text>
                    </View>
                    <View style={styles.successDetailRow}>
                      <Text style={styles.successDetailLabel}>GCash Number</Text>
                      <Text style={styles.successDetailValue}>{selectedPayment.gcashNumber || "â€”"}</Text>
                    </View>
                    {selectedPayment.referenceNumber ? (
                      <View style={styles.successDetailRow}>
                        <Text style={styles.successDetailLabel}>Reference Number</Text>
                        <Text style={styles.successDetailValue}>{selectedPayment.referenceNumber}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {selectedPayment.status === "rejected" && selectedPayment.rejectionReason ? (
                  <View style={styles.paymentDetailsRejectCard}>
                    <Text style={styles.paymentDetailsRejectTitle}>Your submission was rejected</Text>
                    <Text style={styles.paymentDetailsRejectText}>{selectedPayment.rejectionReason}</Text>
                  </View>
                ) : null}

                {selectedPayment.proofImageUrl ? (
                  <View style={styles.paymentDetailsProofSection}>
                    <TouchableOpacity
                      style={styles.paymentDetailsAccordionHeader}
                      onPress={() => setSubmittedProofExpanded((expanded) => !expanded)}
                      activeOpacity={0.82}
                      accessibilityRole="button"
                      accessibilityLabel={submittedProofExpanded ? "Hide submitted proof" : "Show submitted proof"}
                      accessibilityState={{ expanded: submittedProofExpanded }}
                    >
                      <Text style={styles.paymentDetailsSectionTitle}>Submitted Proof</Text>
                      <View style={styles.paymentDetailsAccordionIcon}>
                        <Ionicons name={submittedProofExpanded ? "chevron-up" : "chevron-down"} size={19} color="#53615d" />
                      </View>
                    </TouchableOpacity>
                    {submittedProofExpanded ? (
                      <View style={styles.paymentDetailsProofBody}>
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => setProofViewerUrl(selectedPayment.proofImageUrl)}
                        >
                          <Image
                            source={{ uri: selectedPayment.proofImageUrl }}
                            style={styles.paymentDetailsProofImage}
                            resizeMode="cover"
                          />
                        </TouchableOpacity>
                        <Text style={styles.paymentDetailsMediaHint}>Tap the photo to enlarge it.</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.successDivider} />

                <View style={styles.successTotalRow}>
                  <Text style={styles.successTotalLabel}>Total Paid</Text>
                  <Text style={styles.successTotalValue}>
                    {formatPhilippinePeso(String(selectedPayment.amount))}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
        ) : null}
      </Modal>

      <Modal
        visible={Boolean(proofViewerUrl)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setProofViewerUrl(null)}
      >
        <TouchableOpacity
          style={styles.viewerOverlay}
          activeOpacity={1}
          onPress={() => setProofViewerUrl(null)}
        >
          <View style={styles.viewerCard}>
            <TouchableOpacity style={styles.viewerClose} activeOpacity={0.9} onPress={() => setProofViewerUrl(null)}>
              <Ionicons name="close" size={22} color="#ffffff" />
            </TouchableOpacity>
            {proofViewerUrl ? (
              <Image source={{ uri: proofViewerUrl }} style={styles.viewerImage} resizeMode="contain" />
            ) : null}
            <Text style={styles.viewerCaption}>Submitted proof of payment</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(16, 10, 8, 0.58)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    height: "90%",
    borderRadius: 24,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 18,
  },
  paymentScroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 96,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e6e3da",
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dfe8db",
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
  },
  caption: {
    color: "#62706b",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ece9e3",
  },
  stateBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 60,
  },
  stateText: {
    color: "#62706b",
    fontSize: 13,
    fontWeight: "600",
  },
  subscriptionCard: {
    marginTop: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    padding: 14,
    gap: 8,
  },
  subscriptionTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  subscriptionTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  subscriptionTitle: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "900",
  },
  subscriptionLine: {
    color: "#53615d",
    fontSize: 13,
    lineHeight: 19,
  },
  subscriptionLineExpired: {
    color: "#8f2525",
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "900",
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#f2d2a2",
    padding: 10,
  },
  noticeText: {
    flex: 1,
    color: "#9a5417",
    fontSize: 12,
    lineHeight: 17,
  },
  infoCard: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e6e3da",
    backgroundColor: "#fbfaf7",
    padding: 12,
  },
  infoText: {
    flex: 1,
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
  },
  paymentFormCard: {
    marginTop: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    padding: 14,
  },
  formTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginBottom: 20,
  },
  formTitleIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dfe8db",
  },
  formTitleCopy: {
    flex: 1,
  },
  formTitle: {
    color: "#22312d",
    fontSize: 16,
    fontWeight: "900",
  },
  formSubtitle: {
    color: "#6b7671",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#22312d",
  },
  stepNumberText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  stepCopy: {
    flex: 1,
  },
  stepTitle: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "900",
  },
  stepDescription: {
    color: "#77827d",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  stepDivider: {
    height: 1,
    backgroundColor: "#ece9e3",
    marginVertical: 20,
  },
  fieldGroup: {
    borderRadius: 16,
    backgroundColor: "#f8f9f7",
    padding: 12,
  },
  optionalLabel: {
    color: "#8b938c",
    fontWeight: "600",
  },
  sectionLabel: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "900",
  },
  historySectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 24,
    marginBottom: 10,
  },
  historySectionIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1ebe4",
  },
  historySectionCopy: {
    flex: 1,
  },
  historySectionCaption: {
    color: "#77827d",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  qrWrap: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e6e3da",
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  qrImage: {
    width: "100%",
    height: 200,
    backgroundColor: "#ffffff",
  },
  qrHint: {
    color: "#7d8580",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    paddingBottom: 10,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#f3f8f1",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  amountLabel: {
    color: "#62706b",
    fontSize: 13,
    fontWeight: "700",
  },
  amountValue: {
    color: "#22312d",
    fontSize: 16,
    fontWeight: "900",
  },
  inputLabel: {
    color: "#53615d",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 16,
    backgroundColor: "#fbfaf7",
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "#22312d",
  },
  proofPreviewWrap: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e6e3da",
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  proofPreview: {
    width: "100%",
    height: 180,
    backgroundColor: "#ffffff",
  },
  proofPreviewActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  proofInlineButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#fbfaf7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
  },
  proofInlineButtonText: {
    color: "#8b7255",
    fontSize: 12,
    fontWeight: "900",
  },
  proofRemoveButton: {
    borderColor: "#efc4c4",
    backgroundColor: "#fff8f8",
  },
  proofRemoveText: {
    color: "#912929",
  },
  proofEmpty: {
    height: 150,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#d9d6cd",
    backgroundColor: "#fbfaf7",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  proofEmptyText: {
    color: "#8b938c",
    fontSize: 12,
    fontWeight: "600",
  },
  submitButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#22312d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  emptyBox: {
    alignItems: "center",
    gap: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e6e3da",
    backgroundColor: "#ffffff",
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  emptyTitle: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "800",
  },
  emptyText: {
    color: "#62706b",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    padding: 14,
    marginBottom: 9,
  },
  historyIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1ebe4",
  },
  historyCopy: {
    flex: 1,
    gap: 3,
  },
  historyTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  historyAmount: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "900",
  },
  historyMeta: {
    color: "#62706b",
    fontSize: 12,
    lineHeight: 17,
  },
  historyMetaVerified: {
    color: "#166534",
    fontWeight: "700",
  },
  historyDetailsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#ece9e3",
    paddingTop: 9,
    marginTop: 7,
  },
  historyDetailsText: {
    color: "#7f6653",
    fontSize: 12,
    fontWeight: "900",
  },
  closeRowButton: {
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: "#ece9e3",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  closeRowButtonText: {
    color: "#62706b",
    fontSize: 14,
    fontWeight: "900",
  },
  successScreen: {
    flex: 1,
    backgroundColor: "#101312",
  },
  successScroll: {
    flex: 1,
    backgroundColor: "#101312",
  },
  successContent: {
    flexGrow: 1,
  },
  successHero: {
    minHeight: 270,
    paddingHorizontal: 28,
    paddingTop: 50,
    paddingBottom: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101312",
  },
  successBadge: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: "#48c978",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "45deg" }],
    marginBottom: 26,
  },
  successCheck: {
    transform: [{ rotate: "-45deg" }],
  },
  successTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  successMessage: {
    maxWidth: 340,
    color: "#aeb5b1",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },
  successBody: {
    flex: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 24,
    paddingTop: 25,
    paddingBottom: 28,
  },
  successSectionTitle: {
    color: "#191c1b",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 16,
  },
  successDetails: {
    gap: 12,
  },
  successDetailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
    marginBottom: 10,
  },
  successDetailLabel: {
    flexShrink: 0,
    color: "#686e6b",
    fontSize: 13,
    lineHeight: 19,
  },
  successDetailValue: {
    flex: 1,
    color: "#262a28",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    textAlign: "right",
  },
  successPendingValue: {
    color: "#9a5417",
  },
  successDivider: {
    height: 1,
    backgroundColor: "#e5e7e6",
    marginVertical: 21,
  },
  successItemRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  successItemIcon: {
    width: 58,
    height: 70,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f3f2",
  },
  successItemCopy: {
    flex: 1,
    paddingHorizontal: 13,
  },
  successItemName: {
    color: "#202422",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
  },
  successItemMeta: {
    color: "#7d8580",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  successItemAmount: {
    color: "#202422",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  successTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  successTotalLabel: {
    color: "#686e6b",
    fontSize: 14,
  },
  successTotalValue: {
    color: "#151817",
    fontSize: 18,
    fontWeight: "900",
  },
  successActionButton: {
    minHeight: 52,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: "#bf7fd5",
    backgroundColor: "#f8eefa",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 28,
  },
  successActionText: {
    color: "#8d4aac",
    fontSize: 14,
    fontWeight: "900",
  },
  paymentDetailsHero: {
    position: "relative",
  },
  paymentDetailsCloseButton: {
    position: "absolute",
    top: 18,
    right: 18,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  paymentDetailsSectionTitle: {
    color: "#191c1b",
    fontSize: 15,
    fontWeight: "900",
  },
  paymentDetailsAccordionHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  paymentDetailsAccordionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#f1f3f2",
    alignItems: "center",
    justifyContent: "center",
  },
  paymentDetailsAccordionBody: {
    gap: 12,
    borderRadius: 14,
    backgroundColor: "#f7f8f7",
    padding: 14,
    marginTop: 6,
  },
  paymentDetailsProofSection: {
    marginTop: 18,
  },
  paymentDetailsProofBody: {
    borderRadius: 14,
    backgroundColor: "#f7f8f7",
    padding: 10,
    marginTop: 6,
  },
  paymentDetailsProofImage: {
    width: "100%",
    height: 210,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7e6",
    backgroundColor: "#f1f3f2",
  },
  paymentDetailsMediaHint: {
    color: "#7d8580",
    fontSize: 12,
    textAlign: "center",
    marginTop: 7,
  },
  paymentDetailsRejectCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#f4b7b7",
    backgroundColor: "#fff1f1",
    padding: 14,
    marginTop: 16,
  },
  paymentDetailsRejectTitle: {
    color: "#991b1b",
    fontSize: 13,
    fontWeight: "900",
  },
  paymentDetailsRejectText: {
    color: "#7f1d1d",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  viewerOverlay: {
    flex: 1,
    backgroundColor: "rgba(10, 8, 6, 0.92)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  viewerCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
  },
  viewerClose: {
    alignSelf: "flex-end",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    marginBottom: 12,
  },
  viewerImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  viewerCaption: {
    color: "#ffffff",
    fontSize: 13,
    marginTop: 14,
    textAlign: "center",
  },
});
