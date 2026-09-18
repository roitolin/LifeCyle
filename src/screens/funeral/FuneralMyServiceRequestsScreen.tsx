import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { KeyboardAwareScrollView } from "@/components";
import ServiceRequestScheduleFields from "@/components/ServiceRequestScheduleFields";
import ServiceXenditSheet from "@/components/ServiceXenditSheet";
import { syncServiceXenditCheckout } from "@/services/serviceXendit";
import { supabase } from "@/services/supabaseClient";
import { auth, uploadCertificate } from "@/services";
import { hapticMedium, hapticSuccess } from "@/utils/haptics";
import {
  paymentSubmissionErrorMessage,
  validatePaymentSubmission,
} from '@/utils/paymentValidation';
import {
  formatServiceDate,
  formatServiceTime,
  parseDateOnly,
  parseTimeOnly,
  serializeDateOnly,
  serializeTimeOnly,
  validateServiceSchedule,
} from "@/utils/serviceRequestSchedule";

type FuneralServiceRequest = {
  id: string;
  requesterId: string;
  shopId: string;
  shopName: string;
  shopContactNumber?: string | null;
  shopAddress?: string | null;
  productName: string;
  productPrice?: number | string | null;
  productImageUrl?: string | null;
  variationName?: string | null;
  packageItems?: string[] | null;
  requestType?: string;
  customDesignNotes?: string | null;
  memorialPhotoUrl?: string | null;
  deceasedFullName: string;
  deceasedDateOfBirth?: any;
  deceasedDateOfPassing?: any;
  deceasedAge?: number | null;
  tributeMessage: string;
  familyCoordinatorName: string;
  wakeAddress: string;
  churchName?: string | null;
  cemeteryName?: string | null;
  wakeStartDate?: string | null;
  wakeEndDate?: string | null;
  burialTime?: string | null;
  pickupAddress: string;
  contactNumber: string;
  status: string;
  paymentQrUrl?: string | null;
  paymentAmount?: number | string | null;
  paymentPayerName?: string | null;
  paymentGcashName?: string | null;
  paymentGcashNumber?: string | null;
  paymentReferenceNumber?: string | null;
  paymentProofImageUrl?: string | null;
  paymentSubmittedAt?: any;
  paymentVerifiedAt?: any;
  paymentRejectionReason?: string | null;
  paymentProvider?: "manual" | "paymongo" | "xendit";
  providerPaymentMethod?: string | null;
  completionProofImageUrl?: string | null;
  shopMarkedCompletedAt?: any;
  completionProofSeenAt?: any;
  completedAt?: any;
  createdAt?: any;
  updatedAt?: any;
  acceptedAt?: any;
  declinedAt?: any;
  cancelledAt?: any;
  sharedWithMe?: boolean;
};

type PaymentSubmissionForm = {
  senderName: string;
  gcashName: string;
  gcashNumber: string;
  referenceNumber: string;
  proofImageUrl: string | null;
};

type RequestEditForm = {
  deceasedFullName: string;
  tributeMessage: string;
  familyCoordinatorName: string;
  wakeAddress: string;
  churchName: string;
  cemeteryName: string;
  wakeStartDate: Date | null;
  wakeEndDate: Date | null;
  burialTime: Date | null;
  pickupAddress: string;
  contactNumber: string;
};

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type RequestFilter = "all" | "action" | "active" | "completed";

const isPendingRequest = (status: string) => String(status || "").toLowerCase() === "pending_shop_acceptance";

const isCancellable = (status: string) => {
  const normalized = String(status || "").toLowerCase();
  return ["pending_shop_acceptance", "accepted_by_shop", "awaiting_payment"].includes(normalized);
};

const hasPaymentSetup = (request: FuneralServiceRequest) =>
  Number(request.paymentAmount) > 0;

const needsPayment = (request: FuneralServiceRequest) =>
  !request.sharedWithMe &&
  String(request.status || "").toLowerCase() === "awaiting_payment" &&
  hasPaymentSetup(request);

const formatPeso = (value: number | string | null | undefined) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "—";
  return `₱${num.toLocaleString("en-PH")}`;
};

const escapeHtml = (value: string | null | undefined) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const buildReceiptNumber = (requestId: string) =>
  `RCPT-${String(requestId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}`;

const buildReceiptHtml = (request: FuneralServiceRequest) => {
  const meta = getStatusMeta(request.status);
  const amount = Number(request.paymentAmount) || 0;
  const issuedAt = request.paymentVerifiedAt || request.paymentSubmittedAt || request.createdAt;
  const issuedText = issuedAt ? formatTimestamp(issuedAt) : "—";
  const receiptNumber = buildReceiptNumber(request.id);
  const sender = String(request.paymentPayerName || "");
  const gcashName = String(request.paymentGcashName || "");
  const gcashNumber = String(request.paymentGcashNumber || "");
  const referenceNumber = String(request.paymentReferenceNumber || "");
  const shopName = escapeHtml(request.shopName || "Funeral Shop");
  const productName = escapeHtml(request.productName || "Funeral Service");
  const variation = request.variationName ? escapeHtml(request.variationName) : "";
  const deceasedName = escapeHtml(request.deceasedFullName || "—");
  const address = escapeHtml(request.shopAddress || "");
  const contact = escapeHtml(request.shopContactNumber || "");
  const statusColor = meta.text === "#ffffff" ? "#14532d" : meta.text;

  const proofImage = request.paymentProofImageUrl
    ? `<div style="margin-top:14px;">
         <p style="margin:0 0 6px;font-size:12px;color:#62706b;font-weight:700;">PAYMENT PROOF</p>
         <img src="${request.paymentProofImageUrl}" style="width:100%;max-width:300px;border-radius:12px;border:1px solid #e6e3da;" />
       </div>`
    : "";

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { margin: 0; }
          body { margin: 0; padding: 24px; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #22312d; background: #ffffff; }
          .receipt { max-width: 640px; margin: 0 auto; border: 1px solid #e6e3da; border-radius: 16px; padding: 28px; }
          .brand { display: flex; align-items: center; gap: 10px; }
          .brand-badge { width: 40px; height: 40px; border-radius: 12px; background: #22312d; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 15px; }
          .brand-name { font-size: 18px; font-weight: 900; }
          .brand-sub { font-size: 11px; color: #8b7255; font-weight: 800; letter-spacing: 0.5px; }
          h1 { font-size: 20px; margin: 18px 0 2px; }
          .status { display: inline-block; margin-top: 8px; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 900; background: #e7f5ec; color: ${statusColor}; }
          .meta { display: flex; justify-content: space-between; gap: 16px; font-size: 12px; color: #62706b; margin-top: 12px; }
          .divider { border-top: 1px dashed #d9d6cd; margin: 18px 0; }
          .amount { display: flex; justify-content: space-between; align-items: center; background: #f1ebe4; border-radius: 12px; padding: 14px 16px; margin: 6px 0 18px; }
          .amount span { font-size: 13px; color: #62706b; font-weight: 700; }
          .amount strong { font-size: 24px; font-weight: 900; }
          .row { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; font-size: 13px; }
          .row .label { color: #86654a; font-weight: 800; }
          .row .value { font-weight: 700; text-align: right; max-width: 60%; word-break: break-word; }
          .footer { margin-top: 22px; text-align: center; font-size: 12px; color: #8a948f; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="receipt">
          <div class="brand">
            <div class="brand-badge">LC</div>
            <div>
              <div class="brand-name">LifeCycle</div>
              <div class="brand-sub">FUNERAL SERVICES</div>
            </div>
          </div>
          <h1>Payment Receipt</h1>
          <span class="status">${escapeHtml(meta.label)}</span>
          <div class="meta">
            <span>Receipt No: <strong>${receiptNumber}</strong></span>
            <span>Issued: ${issuedText}</span>
          </div>
          <div class="divider"></div>
          <div class="amount">
            <span>Amount Paid</span>
            <strong>${formatPeso(amount)}</strong>
          </div>
          <div class="row"><span class="label">Shop</span><span class="value">${shopName}</span></div>
          <div class="row"><span class="label">Service</span><span class="value">${productName}${variation ? ` (${variation})` : ""}</span></div>
          <div class="row"><span class="label">Deceased</span><span class="value">${deceasedName}</span></div>
          <div class="row"><span class="label">Sender</span><span class="value">${escapeHtml(sender || "—")}</span></div>
          <div class="row"><span class="label">GCash Name</span><span class="value">${escapeHtml(gcashName || "—")}</span></div>
          <div class="row"><span class="label">GCash Number</span><span class="value">${escapeHtml(gcashNumber || "—")}</span></div>
          <div class="row"><span class="label">GCash Reference</span><span class="value">${escapeHtml(referenceNumber || "—")}</span></div>
          <div class="row"><span class="label">Payment Method</span><span class="value">GCash / E-wallet</span></div>
          ${address ? `<div class="row"><span class="label">Shop Address</span><span class="value">${address}</span></div>` : ""}
          ${contact ? `<div class="row"><span class="label">Shop Contact</span><span class="value">${contact}</span></div>` : ""}
          ${proofImage}
          <div class="divider"></div>
          <div class="footer">
            Thank you for your payment. This receipt confirms your payment to ${shopName} through LifeCycle.<br/>
            For questions, contact the shop or LifeCycle support.
          </div>
        </div>
      </body>
    </html>
  `;
};

function DetailRow({ icon, label, value }: { icon: IoniconName; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIconWrap}>
        <Ionicons name={icon} size={16} color="#7f6653" />
      </View>
      <View style={styles.detailCopy}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

const getStatusMeta = (status: string) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "accepted_by_shop") {
    return {
      label: "Accepted by Shop",
      background: "#e7f5ec",
      text: "#166534",
      message: "The shop accepted your request, but its saved payment setup is not complete yet.",
    };
  }
  if (normalized === "awaiting_payment") {
    return {
      label: "Awaiting Payment",
      background: "#e0eefa",
      text: "#1c4f7e",
      message: "Payment details are ready. Send the amount to the shop and submit your proof below.",
    };
  }
  if (normalized === "payment_submitted") {
    return {
      label: "Payment Under Review",
      background: "#e0eefa",
      text: "#1c4f7e",
      message: "Your payment details are under review by the shop.",
    };
  }
  if (normalized === "paid_waiting_for_split") {
    return {
      label: "Payment Confirmed",
      background: "#fef3c7",
      text: "#86654a",
      message: "Payment received. The shop payout is being processed and the shop is preparing your order.",
    };
  }
  if (normalized === "commission_failed") {
    return {
      label: "Payout Review",
      background: "#fde8e8",
      text: "#991b1b",
      message: "Your payment was received, but shop payout needs administrator review. Support is resolving it.",
    };
  }
  if (normalized === "payment_verified") {
    return {
      label: "Payment Confirmed",
      background: "#e7f5ec",
      text: "#166534",
      message: "Your payment is confirmed. The shop is preparing your casket.",
    };
  }
  if (normalized === "awaiting_customer_confirmation") {
    return {
      label: "Awaiting Your Confirmation",
      background: "#fef3c7",
      text: "#86654a",
      message: "The shop has delivered and attached a completion proof. Review the photo and mark the request as done.",
    };
  }
  if (normalized === "completed") {
    return {
      label: "Completed",
      background: "#14532d",
      text: "#ffffff",
      message: "This request has been completed. Thank you.",
    };
  }
  if (normalized === "declined_by_shop") {
    return {
      label: "Declined",
      background: "#fde8e8",
      text: "#991b1b",
      message: "This request was declined by the shop.",
    };
  }
  if (normalized === "cancelled_by_requester") {
    return {
      label: "Cancelled",
      background: "#eef1ec",
      text: "#4c5b57",
      message: "You cancelled this request.",
    };
  }
  return {
    label: "Waiting for Shop",
    background: "#fef3c7",
    text: "#86654a",
    message: "Your request has been sent. Please wait while the shop reviews it.",
  };
};

const formatTimestamp = (value: any) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString(undefined, { hour12: true });
};

const buildEditForm = (request: FuneralServiceRequest): RequestEditForm => ({
  deceasedFullName: String(request.deceasedFullName || ""),
  tributeMessage: String(request.tributeMessage || ""),
  familyCoordinatorName: String(request.familyCoordinatorName || ""),
  wakeAddress: String(request.wakeAddress || ""),
  churchName: String(request.churchName || ""),
  cemeteryName: String(request.cemeteryName || ""),
  wakeStartDate: parseDateOnly(request.wakeStartDate),
  wakeEndDate: parseDateOnly(request.wakeEndDate),
  burialTime: parseTimeOnly(request.burialTime),
  pickupAddress: String(request.pickupAddress || ""),
  contactNumber: String(request.contactNumber || ""),
});

const EMPTY_PAYMENT_FORM: PaymentSubmissionForm = {
  senderName: "",
  gcashName: "",
  gcashNumber: "",
  referenceNumber: "",
  proofImageUrl: null,
};

export default function FuneralMyServiceRequestsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [requests, setRequests] = useState<FuneralServiceRequest[]>([]);
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("all");
  const [selectedRequest, setSelectedRequest] = useState<FuneralServiceRequest | null>(null);
  const [xenditRequest, setXenditRequest] = useState<FuneralServiceRequest | null>(null);
  const markedSeenRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!selectedRequest) return;
    const isAwaitingConfirmation =
      String(selectedRequest.status || "").toLowerCase() === "awaiting_customer_confirmation";
    if (!isAwaitingConfirmation || !selectedRequest.completionProofImageUrl) return;
    if (selectedRequest.completionProofSeenAt) return;
    if (markedSeenRef.current[selectedRequest.id]) return;
    markedSeenRef.current[selectedRequest.id] = true;
    void (async () => {
      const { error: updateError } = await supabase
        .from("funeral_service_requests")
        .update({ completionProofSeenAt: new Date().toISOString() })
        .eq("id", selectedRequest.id)
        .eq("status", "awaiting_customer_confirmation")
        .is("completionProofSeenAt", null);
      if (updateError) {
        console.warn("Failed to mark completion proof seen:", updateError);
        return;
      }
      setSelectedRequest((current) =>
        current ? { ...current, completionProofSeenAt: new Date().toISOString() } : current
      );
      const { error: notifyError } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("userId", auth.currentUser?.uid || "")
        .eq("type", "funeral_request_completed")
        .eq("data->>requestId", selectedRequest.id);
      if (notifyError) console.warn("Failed to mark notification read:", notifyError);
    })();
  }, [selectedRequest, markedSeenRef]);
  const [editingRequest, setEditingRequest] = useState<FuneralServiceRequest | null>(null);
  const [editForm, setEditForm] = useState<RequestEditForm>({
    deceasedFullName: "",
    tributeMessage: "",
    familyCoordinatorName: "",
    wakeAddress: "",
    churchName: "",
    cemeteryName: "",
    wakeStartDate: null,
    wakeEndDate: null,
    burialTime: null,
    pickupAddress: "",
    contactNumber: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);

  const [paymentForm, setPaymentForm] = useState<PaymentSubmissionForm>(EMPTY_PAYMENT_FORM);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentViewerUrl, setPaymentViewerUrl] = useState<string | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<FuneralServiceRequest | null>(null);
  const [paymentInfoExpanded, setPaymentInfoExpanded] = useState(false);
  const [submittedProofExpanded, setSubmittedProofExpanded] = useState(false);
  const [paymentSuccessRequest, setPaymentSuccessRequest] = useState<FuneralServiceRequest | null>(null);
  const [receiptRequest, setReceiptRequest] = useState<FuneralServiceRequest | null>(null);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);

  const openPhoneLink = useCallback(async (mode: "call" | "sms", rawPhone: string | null | undefined) => {
    const phone = String(rawPhone || "").trim();
    if (!phone) return;

    try {
      await Linking.openURL(`${mode === "call" ? "tel" : "sms"}:${phone.replace(/\s+/g, "")}`);
    } catch {
      // Keep interaction quiet if the device cannot open it.
    }
  }, []);

  const loadRequests = useCallback(async (): Promise<boolean> => {
    const user = auth.currentUser;
    if (!user) return false;

    try {
      const { data: memberships, error: membershipsError } = await supabase
        .from("service_request_members")
        .select("service_request_id")
        .eq("user_id", user.uid)
        .eq("status", "active");
      if (membershipsError && !["42P01", "PGRST204", "PGRST205"].includes(String(membershipsError.code || ""))) {
        throw membershipsError;
      }
      const sharedRequestIds = (memberships || []).map((membership: any) => String(membership.service_request_id));
      let requestQuery = supabase
        .from("funeral_service_requests")
        .select("*")
        .order("createdAt", { ascending: false });
      requestQuery = sharedRequestIds.length > 0
        ? requestQuery.or(`requesterId.eq.${user.uid},id.in.(${sharedRequestIds.join(",")})`)
        : requestQuery.eq("requesterId", user.uid);
      const { data: rows, error } = await requestQuery;
      if (error) throw error;

      const nextRequests = (rows || []).map((row: any) => ({
        ...row,
        sharedWithMe: String(row.requesterId) !== String(user.uid),
      })) as FuneralServiceRequest[];
      setRequests(nextRequests);
      setSelectedRequest((current) => nextRequests.find((item: any) => item.id === current?.id) || null);
      setReconnecting(false);
      setLoading(false);

      // Auto-sync any awaiting Xendit payments seamlessly in the background
      const awaitingXendit = (rows || []).filter(
        (r: any) =>
          String(r.status || "").toLowerCase() === "awaiting_payment" &&
          (r.paymentProvider === "xendit" || Boolean(r.providerCheckoutId))
      );
      if (awaitingXendit.length > 0) {
        Promise.allSettled(awaitingXendit.map((r: any) => syncServiceXenditCheckout(r.id))).then((results) => {
          const anyPaid = results.some((res) => res.status === "fulfilled" && res.value?.paid === true);
          if (anyPaid) {
            void loadRequests();
          }
        });
      }

      return true;
    } catch {
      setReconnecting(true);
      return false;
    }
  }, []);

  const focusedRef = useRef(true);
  const retryLoopActiveRef = useRef(false);

  const loadWithRetry = useCallback(async () => {
    if (retryLoopActiveRef.current) return;
    retryLoopActiveRef.current = true;
    try {
      let attempt = 0;
      while (focusedRef.current) {
        setLoading(true);
        const ok = await loadRequests();
        if (ok || !focusedRef.current) return;
        const delay = Math.min(2000 * Math.pow(1.7, attempt), 30000);
        attempt += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    } finally {
      retryLoopActiveRef.current = false;
    }
  }, [loadRequests]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void loadWithRetry();
      return () => {
        focusedRef.current = false;
      };
    }, [loadWithRetry])
  );

  const openEditRequest = useCallback((request: FuneralServiceRequest) => {
    setEditingRequest(request);
    setEditForm(buildEditForm(request));
  }, []);

  const closeEditRequest = useCallback(() => {
    if (savingEdit) return;
    setEditingRequest(null);
  }, [savingEdit]);

  const saveRequestEdits = useCallback(async () => {
    if (!editingRequest) return;
    const user = auth.currentUser;
    if (!user) return;

    const safeDeceasedFullName = editForm.deceasedFullName.trim();
    const safeTributeMessage = editForm.tributeMessage.trim();
    const safeFamilyCoordinatorName = editForm.familyCoordinatorName.trim();
    const safeWakeAddress = editForm.wakeAddress.trim();
    const safeChurchName = editForm.churchName.trim();
    const safeCemeteryName = editForm.cemeteryName.trim();
    const safePickupAddress = editForm.pickupAddress.trim();
    const safeContactNumber = editForm.contactNumber.trim();

    const scheduleIssue = validateServiceSchedule({
      wakeStartDate: editForm.wakeStartDate,
      wakeEndDate: editForm.wakeEndDate,
      burialTime: editForm.burialTime,
      dateOfPassing: editingRequest.deceasedDateOfPassing ? new Date(editingRequest.deceasedDateOfPassing) : null,
    });
    if (scheduleIssue === "incomplete") {
      Alert.alert("Incomplete", "Choose the wake From and To dates and the burial time before saving.");
      return;
    }
    if (scheduleIssue === "before_passing") {
      Alert.alert("Invalid Wake Schedule", "The wake cannot start before the date of passing.");
      return;
    }
    if (scheduleIssue === "invalid_range") {
      Alert.alert("Invalid Wake Schedule", "The wake end date must be the same as or after the start date.");
      return;
    }

    const wakeStartDate = serializeDateOnly(editForm.wakeStartDate);
    const wakeEndDate = serializeDateOnly(editForm.wakeEndDate);
    const burialTime = serializeTimeOnly(editForm.burialTime);

    if (
      !safeDeceasedFullName ||
      !safeTributeMessage ||
      !safeFamilyCoordinatorName ||
      !safeWakeAddress ||
      !safeChurchName ||
      !safeCemeteryName ||
      !safePickupAddress ||
      !safeContactNumber
    ) {
      Alert.alert("Incomplete", "Please complete all required request fields before saving.");
      return;
    }

    setSavingEdit(true);
    try {
      const { error } = await supabase.from("funeral_service_requests").update({
        deceasedFullName: safeDeceasedFullName,
        tributeMessage: safeTributeMessage,
        familyCoordinatorName: safeFamilyCoordinatorName,
        wakeAddress: safeWakeAddress,
        churchName: safeChurchName,
        cemeteryName: safeCemeteryName,
        wakeStartDate,
        wakeEndDate,
        burialTime,
        pickupAddress: safePickupAddress,
        contactNumber: safeContactNumber,
        updatedAt: new Date().toISOString(),
      })
        .eq("id", editingRequest.id)
        .eq("requesterId", user.uid)
        .eq("status", "pending_shop_acceptance");
      if (error) throw error;

      await loadRequests();
      setSelectedRequest((current) =>
        current?.id === editingRequest.id
          ? {
              ...current,
              deceasedFullName: safeDeceasedFullName,
              tributeMessage: safeTributeMessage,
              familyCoordinatorName: safeFamilyCoordinatorName,
              wakeAddress: safeWakeAddress,
              churchName: safeChurchName,
              cemeteryName: safeCemeteryName,
              wakeStartDate,
              wakeEndDate,
              burialTime,
              pickupAddress: safePickupAddress,
              contactNumber: safeContactNumber,
            }
          : current
      );
      setEditingRequest(null);
      Alert.alert("Saved", "Your request details were updated.");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to update your request.");
    } finally {
      setSavingEdit(false);
    }
  }, [editForm, editingRequest, loadRequests]);

  const cancelRequest = useCallback(
    async (request: FuneralServiceRequest) => {
      if (!isCancellable(request.status)) {
        Alert.alert("Unavailable", "This request can no longer be cancelled because the payment was already verified.");
        return;
      }

      Alert.alert("Cancel Request", "Cancel this request? If the shop has already set payment details, you will not need to pay.", [
        { text: "Keep Request", style: "cancel" },
        {
          text: "Cancel Request",
          style: "destructive",
          onPress: async () => {
            setCancellingRequestId(request.id);
            try {
              await supabase.from("funeral_service_requests").update({
                status: "cancelled_by_requester",
                cancelledAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }).eq("id", request.id);
              await loadRequests();
              setSelectedRequest((current) =>
                current?.id === request.id
                  ? {
                      ...current,
                      status: "cancelled_by_requester",
                    }
                  : current
              );
              Alert.alert("Cancelled", "Your request has been cancelled.");
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to cancel your request.");
            } finally {
              setCancellingRequestId(null);
            }
          },
        },
      ]);
    },
    [loadRequests]
  );

  const pickPaymentProof = useCallback(async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.7,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingProof(true);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setPaymentForm((current) => ({ ...current, proofImageUrl: url }));
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Failed to upload your proof of payment.");
    } finally {
      setUploadingProof(false);
    }
  }, []);

  const submitPayment = useCallback(
    async (request: FuneralServiceRequest) => {
      const validation = validatePaymentSubmission(paymentForm);
      if (!validation.value) {
        Alert.alert('Check Payment Details', validation.message || 'Complete all required payment fields.');
        return;
      }
      const { senderName, gcashName, gcashNumber, referenceNumber, proofImageUrl } = validation.value;

      setSubmittingPayment(true);
      try {
        const submittedAt = new Date().toISOString();
        const { error: paymentError } = await supabase.from("funeral_service_requests").update({
          status: "payment_submitted",
          paymentPayerName: senderName,
          paymentGcashName: gcashName,
          paymentGcashNumber: gcashNumber,
          paymentReferenceNumber: referenceNumber,
          paymentProofImageUrl: proofImageUrl,
          paymentSubmittedAt: submittedAt,
          paymentRejectionReason: null,
          updatedAt: new Date().toISOString(),
        }).eq("id", request.id).eq("status", "awaiting_payment");
        if (paymentError) throw paymentError;

        try {
          await supabase.from("notifications").insert({
            userId: request.shopId,
            type: "funeral_payment_submitted",
            title: "Payment Submitted",
            body: senderName + " submitted payment proof for " + (request.productName || "a service request") + ". Please verify it.",
            data: { requestId: request.id, requesterId: auth.currentUser?.uid },
            read: false,
          });
        } catch (notificationError) {
          console.warn("Failed to create payment notification:", notificationError);
        }

        const submittedRequest: FuneralServiceRequest = {
          ...request,
          status: "payment_submitted",
          paymentPayerName: senderName,
          paymentGcashName: gcashName,
          paymentGcashNumber: gcashNumber,
          paymentReferenceNumber: referenceNumber,
          paymentProofImageUrl: proofImageUrl,
          paymentSubmittedAt: submittedAt,
          paymentRejectionReason: null,
        };

        await loadRequests();
        setSelectedRequest((current) =>
          current?.id === request.id
            ? submittedRequest
            : current
        );
        setPaymentForm(EMPTY_PAYMENT_FORM);
        hapticSuccess();
        setSelectedRequest(null);
        setPaymentSuccessRequest(submittedRequest);
      } catch (error: any) {
        Alert.alert('Payment Not Submitted', paymentSubmissionErrorMessage(error));
      } finally {
        setSubmittingPayment(false);
      }
    },
    [paymentForm, loadRequests]
  );

  const canShowPaymentSection = (request: FuneralServiceRequest) => {
    const status = String(request.status || "").toLowerCase();
    return !request.sharedWithMe && ["awaiting_payment", "payment_submitted", "payment_verified", "awaiting_customer_confirmation", "completed"].includes(status) && hasPaymentSetup(request);
  };

  const confirmDoneRequest = useCallback(
    async (request: FuneralServiceRequest) => {
      const user = auth.currentUser;
      if (!user) return;

      Alert.alert("Mark as Done", "Confirm this request has been fully delivered and completed?", [
        { text: "Not Yet", style: "cancel" },
        {
          text: "Mark as Done",
          onPress: async () => {
            hapticMedium();
            setCancellingRequestId(request.id);
            try {
              const { error: confirmError } = await supabase.from("funeral_service_requests").update({
                status: "completed",
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }).eq("id", request.id)
                .eq("requesterId", user.uid)
                .eq("status", "awaiting_customer_confirmation");
              if (confirmError) throw confirmError;

              await loadRequests();
              setSelectedRequest((current) =>
                current?.id === request.id
                  ? { ...current, status: "completed", completedAt: new Date().toISOString() }
                  : current
              );
              Alert.alert("Completed", "Thank you! This request is now marked as done.");

              try {
                await supabase.from("notifications").insert({
                  userId: request.shopId,
                  type: "funeral_request_completed",
                  title: "Request Confirmed Done",
                  body: `The family confirmed the request for "${request.productName || "a service request"}" as done.`,
                  data: { requestId: request.id, requesterId: user.uid },
                  read: false,
                });
              } catch (notificationError) {
                console.warn("Failed to create notification:", notificationError);
              }
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to confirm this request as done.");
            } finally {
              setCancellingRequestId(null);
            }
          },
        },
      ]);
    },
    [loadRequests]
  );

  const printReceipt = useCallback(async (request: FuneralServiceRequest) => {
    try {
      setGeneratingReceipt(true);
      await Print.printAsync({ html: buildReceiptHtml(request) });
    } catch {
      Alert.alert("Unable to print", "Could not open the print dialog on this device.");
    } finally {
      setGeneratingReceipt(false);
    }
  }, []);

  const shareReceipt = useCallback(async (request: FuneralServiceRequest) => {
    try {
      setGeneratingReceipt(true);
      const { uri } = await Print.printToFileAsync({ html: buildReceiptHtml(request) });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("Unavailable", "Sharing is not available on this device.");
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: "Payment Receipt",
        UTI: "com.adobe.pdf",
      });
    } catch {
      Alert.alert("Unable to share", "Could not create the receipt PDF on this device.");
    } finally {
      setGeneratingReceipt(false);
    }
  }, []);

  const paymentNeededCount = useMemo(() => requests.filter(needsPayment).length, [requests]);
  const actionNeededCount = useMemo(
    () => requests.filter((item) =>
      ["awaiting_payment", "awaiting_customer_confirmation"].includes(String(item.status || "").toLowerCase())
    ).length,
    [requests]
  );
  const activeCount = useMemo(
    () => requests.filter((item) =>
      !["completed", "declined_by_shop", "cancelled_by_requester"].includes(String(item.status || "").toLowerCase())
    ).length,
    [requests]
  );
  const completedCount = useMemo(
    () => requests.filter((item) => String(item.status || "").toLowerCase() === "completed").length,
    [requests]
  );
  const visibleRequests = useMemo(() => {
    if (requestFilter === "action") {
      return requests.filter((item) =>
        ["awaiting_payment", "awaiting_customer_confirmation"].includes(String(item.status || "").toLowerCase())
      );
    }
    if (requestFilter === "active") {
      return requests.filter((item) =>
        !["completed", "declined_by_shop", "cancelled_by_requester"].includes(String(item.status || "").toLowerCase())
      );
    }
    if (requestFilter === "completed") {
      return requests.filter((item) => String(item.status || "").toLowerCase() === "completed");
    }
    return requests;
  }, [requestFilter, requests]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>Service requests</Text>
          <Text style={styles.headerSubtitle}>Track shop responses, payments, and completion.</Text>
          <View style={styles.headerStats}>
            <View style={styles.headerStat}>
              <Text style={styles.headerStatValue}>{actionNeededCount}</Text>
              <Text style={styles.headerStatLabel}>Your action</Text>
            </View>
            <View style={styles.headerStatDivider} />
            <View style={styles.headerStat}>
              <Text style={styles.headerStatValue}>{activeCount}</Text>
              <Text style={styles.headerStatLabel}>Active</Text>
            </View>
            <View style={styles.headerStatDivider} />
            <View style={styles.headerStat}>
              <Text style={styles.headerStatValue}>{completedCount}</Text>
              <Text style={styles.headerStatLabel}>Completed</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.refreshButton} onPress={() => void loadWithRetry()} disabled={loading}>
          <Ionicons name="refresh-outline" size={16} color="#22312d" />
          <Text style={styles.refreshButtonText}>{loading ? "Refreshing..." : "Refresh requests"}</Text>
        </TouchableOpacity>

        {!loading && paymentNeededCount > 0 ? (
          <View style={styles.paymentNeededBanner}>
            <View style={styles.paymentNeededIcon}>
              <Ionicons name="wallet-outline" size={20} color="#22312d" />
            </View>
            <View style={styles.paymentNeededCopy}>
              <Text style={styles.paymentNeededTitle}>Payment required</Text>
              <Text style={styles.paymentNeededText}>
                {paymentNeededCount === 1
                  ? "1 request needs your payment to proceed. Tap it below and pay the shop."
                  : `${paymentNeededCount} requests need your payment to proceed. Tap each one below and pay the shop.`}
              </Text>
            </View>
          </View>
        ) : null}

        {!loading && requests.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.requestFilterRow}>
            {([
              { key: "all", label: `All (${requests.length})` },
              { key: "action", label: `Your action (${actionNeededCount})` },
              { key: "active", label: `Active (${activeCount})` },
              { key: "completed", label: `Completed (${completedCount})` },
            ] as { key: RequestFilter; label: string }[]).map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.requestFilterChip, requestFilter === item.key ? styles.requestFilterChipActive : null]}
                onPress={() => setRequestFilter(item.key)}
              >
                <Text style={[styles.requestFilterText, requestFilter === item.key ? styles.requestFilterTextActive : null]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {loading ? (
          <View style={styles.loadingWrap}>
            <LoadingBird />
            {reconnecting ? (
              <Text style={styles.loadingText}>Connection lost. Still trying to load your requests...</Text>
            ) : null}
          </View>
        ) : requests.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={28} color="#8b938c" />
            <Text style={styles.emptyTitle}>No service requests yet</Text>
            <Text style={styles.emptyText}>Once you send a funeral service request, it will appear here for tracking.</Text>
          </View>
        ) : visibleRequests.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="filter-outline" size={28} color="#8b938c" />
            <Text style={styles.emptyTitle}>Nothing in this view</Text>
            <Text style={styles.emptyText}>Choose another filter to see your other service requests.</Text>
          </View>
        ) : (
          visibleRequests.map((item: any) => {
            const statusMeta = getStatusMeta(item.status);
            const paymentRequired = needsPayment(item);
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.requestCard, paymentRequired ? styles.requestCardPayment : null]}
                activeOpacity={0.92}
                onPress={async () => {
                  if (
                    String(item.status || "").toLowerCase() === "awaiting_payment" &&
                    (item.paymentProvider === "xendit" || Boolean((item as any).providerCheckoutId))
                  ) {
                    try {
                      const res = await syncServiceXenditCheckout(item.id);
                      if (res.paid) {
                        await loadRequests();
                      }
                    } catch {}
                  }
                  navigation.navigate("ServiceRequestDetails", { request: item, requesterView: true });
                }}
              >
                {item.productImageUrl ? (
                  <Image source={{ uri: item.productImageUrl }} style={styles.requestImage} resizeMode="cover" />
                ) : (
                  <View style={styles.requestImageFallback}>
                    <Ionicons name="cube-outline" size={26} color="#9aa39d" />
                  </View>
                )}
                <View style={styles.requestBody}>
                  <View style={styles.requestTopRow}>
                    <View style={styles.requestTextBlock}>
                      <Text style={styles.requestName}>{item.deceasedFullName}</Text>
                      <Text style={styles.requestShop}>{item.shopName}</Text>
                      {item.sharedWithMe ? <Text style={styles.sharedRequestLabel}>Shared family arrangement</Text> : null}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
                      <Text style={[styles.statusBadgeText, { color: statusMeta.text }]}>{statusMeta.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.requestMeta}>Service: {item.productName}</Text>
                  <Text style={styles.requestMeta}>Sent: {formatTimestamp(item.createdAt)}</Text>
                  <Text style={[styles.requestMeta, styles.requestMessage]} numberOfLines={3}>{statusMeta.message}</Text>
                  {canShowPaymentSection(item) ? (
                    <TouchableOpacity
                      style={styles.cardPaymentButton}
                      onPress={async () => {
                        setPaymentInfoExpanded(false);
                        setSubmittedProofExpanded(false);
                        if (
                          String(item.status || "").toLowerCase() === "awaiting_payment" &&
                          (item.paymentProvider === "xendit" || Boolean((item as any).providerCheckoutId))
                        ) {
                          try {
                            const res = await syncServiceXenditCheckout(item.id);
                            if (res.paid) {
                              await loadRequests();
                              return;
                            }
                          } catch {}
                        }
                        setPaymentRequest(item);
                      }}
                    >
                      <Ionicons name="receipt-outline" size={15} color="#7f6653" />
                      <Text style={styles.cardPaymentButtonText}>{paymentRequired ? "Pay now" : "View receipt"}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {paymentRequired ? (
                    <View style={styles.payNowBanner}>
                      <Ionicons name="alert-circle-outline" size={17} color="#ffffff" />
                      <Text style={styles.payNowBannerText}>Payment needed — tap to open</Text>
                    </View>
                  ) : null}
                  <View style={styles.viewDetailsRow}>
                    <Text style={styles.viewDetailsText}>View details</Text>
                    <Ionicons name="chevron-forward" size={16} color="#7f6653" />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={Boolean(paymentSuccessRequest)}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setPaymentSuccessRequest(null)}
      >
        {paymentSuccessRequest ? (
          <SafeAreaView style={styles.paymentSuccessScreen}>
            <ScrollView
              style={styles.paymentSuccessScroll}
              contentContainerStyle={styles.paymentSuccessContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.paymentSuccessHero}>
                <View style={styles.paymentSuccessBadge}>
                  <Ionicons name="checkmark" size={34} color="#10201b" style={styles.paymentSuccessCheck} />
                </View>
                <Text style={styles.paymentSuccessTitle}>Payment Successful</Text>
                <Text style={styles.paymentSuccessMessage}>
                  Thank you for your payment. Your proof was sent to {paymentSuccessRequest.shopName} and is now being reviewed.
                </Text>
              </View>

              <View style={styles.paymentSuccessBody}>
                <Text style={styles.paymentSuccessSectionTitle}>Order Details</Text>
                <View style={styles.paymentSuccessDetails}>
                  <View style={styles.paymentSuccessDetailRow}>
                    <Text style={styles.paymentSuccessDetailLabel}>Order Date</Text>
                    <Text style={styles.paymentSuccessDetailValue}>
                      {formatTimestamp(paymentSuccessRequest.paymentSubmittedAt)}
                    </Text>
                  </View>
                  <View style={styles.paymentSuccessDetailRow}>
                    <Text style={styles.paymentSuccessDetailLabel}>Order ID</Text>
                    <Text style={styles.paymentSuccessDetailValue}>#{paymentSuccessRequest.id.slice(0, 10).toUpperCase()}</Text>
                  </View>
                  <View style={[styles.paymentSuccessDetailRow, styles.paymentSuccessAddressRow]}>
                    <Text style={styles.paymentSuccessDetailLabel}>Service Address</Text>
                    <Text style={styles.paymentSuccessDetailValue}>{paymentSuccessRequest.wakeAddress}</Text>
                  </View>
                </View>

                <View style={styles.paymentSuccessDivider} />

                <View style={styles.paymentSuccessItemRow}>
                  {paymentSuccessRequest.productImageUrl ? (
                    <Image
                      source={{ uri: paymentSuccessRequest.productImageUrl }}
                      style={styles.paymentSuccessItemImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.paymentSuccessItemImage, styles.paymentSuccessItemFallback]}>
                      <Ionicons name="cube-outline" size={25} color="#7a847f" />
                    </View>
                  )}
                  <View style={styles.paymentSuccessItemCopy}>
                    <Text style={styles.paymentSuccessItemName}>{paymentSuccessRequest.productName}</Text>
                    <Text style={styles.paymentSuccessItemMeta}>
                      {paymentSuccessRequest.variationName || "Funeral service"}
                    </Text>
                    <Text style={styles.paymentSuccessItemMeta}>{paymentSuccessRequest.shopName}</Text>
                  </View>
                  <Text style={styles.paymentSuccessItemAmount}>{formatPeso(paymentSuccessRequest.paymentAmount)}</Text>
                </View>

                <View style={styles.paymentSuccessDivider} />

                <View style={styles.paymentSuccessTotalRow}>
                  <Text style={styles.paymentSuccessTotalLabel}>Order Total</Text>
                  <Text style={styles.paymentSuccessTotalValue}>{formatPeso(paymentSuccessRequest.paymentAmount)}</Text>
                </View>

                <TouchableOpacity
                  style={styles.paymentSuccessTrackButton}
                  activeOpacity={0.88}
                  onPress={() => {
                    const request = paymentSuccessRequest;
                    setPaymentSuccessRequest(null);
                    navigation.navigate("ServiceRequestDetails", { request, requesterView: true });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Track your order"
                >
                  <Ionicons name="location-outline" size={19} color="#315f50" />
                  <Text style={styles.paymentSuccessTrackText}>Track your order</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </SafeAreaView>
        ) : null}

      </Modal>

      <Modal visible={Boolean(selectedRequest)} transparent animationType="fade" onRequestClose={() => setSelectedRequest(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelectedRequest(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            {selectedRequest ? (
              <KeyboardAwareScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                scrollEnabled
                overScrollMode="always"
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.modalTitle}>{selectedRequest.deceasedFullName}</Text>
                <Text style={styles.modalSubtitle}>{selectedRequest.shopName}</Text>
                {selectedRequest.productImageUrl ? (
                  <>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setPaymentViewerUrl(selectedRequest.productImageUrl || null)}
                    >
                      <Image source={{ uri: selectedRequest.productImageUrl }} style={styles.modalItemImage} resizeMode="cover" />
                    </TouchableOpacity>
                    <Text style={styles.photoEnlargeHint}>Tap the photo to enlarge it.</Text>
                  </>
                ) : null}
                {selectedRequest.memorialPhotoUrl ? (
                  <>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setPaymentViewerUrl(selectedRequest.memorialPhotoUrl || null)}
                    >
                      <Image source={{ uri: selectedRequest.memorialPhotoUrl }} style={styles.modalImage} resizeMode="cover" />
                    </TouchableOpacity>
                    <Text style={styles.photoEnlargeHint}>Tap the photo to enlarge it.</Text>
                  </>
                ) : null}

                {needsPayment(selectedRequest) ? (
                  <View style={styles.payNowModalBanner}>
                    <Ionicons name="wallet-outline" size={22} color="#ffffff" />
                    <View style={styles.payNowModalBannerCopy}>
                      <Text style={styles.payNowModalBannerTitle}>Payment required</Text>
                      <Text style={styles.payNowModalBannerText}>
                        The shop is waiting for your payment to proceed. Scroll down to the Pay the Shop section below.
                      </Text>
                    </View>
                  </View>
                ) : null}

                <View style={styles.detailCard}>
                  <DetailRow icon="shield-checkmark-outline" label="Status" value={getStatusMeta(selectedRequest.status).label} />
                  <DetailRow
                    icon="cube-outline"
                    label="Service"
                    value={selectedRequest.productName + (selectedRequest.variationName ? ` (${selectedRequest.variationName})` : "")}
                  />
                  {selectedRequest.packageItems?.length ? (
                    <DetailRow icon="gift-outline" label="Package inclusions" value={selectedRequest.packageItems.join(", ")} />
                  ) : null}
                  {selectedRequest.requestType === "custom_casket" ? (
                    <DetailRow icon="pricetag-outline" label="Request Type" value="Custom Casket Request" />
                  ) : null}
                  {selectedRequest.customDesignNotes ? (
                    <DetailRow icon="brush-outline" label="Custom Design Specifications" value={selectedRequest.customDesignNotes} />
                  ) : null}
                  <DetailRow icon="storefront-outline" label="Shop" value={selectedRequest.shopName} />
                </View>

                <Text style={styles.detailSectionTitle}>Deceased Information</Text>
                <View style={styles.detailCard}>
                  <DetailRow icon="person-outline" label="Full Name of the Deceased" value={selectedRequest.deceasedFullName} />
                  {selectedRequest.deceasedDateOfBirth ? (
                    <DetailRow icon="calendar-outline" label="Date of Birth" value={formatTimestamp(selectedRequest.deceasedDateOfBirth)} />
                  ) : null}
                  {selectedRequest.deceasedDateOfPassing ? (
                    <DetailRow icon="calendar-outline" label="Date of Passing" value={formatTimestamp(selectedRequest.deceasedDateOfPassing)} />
                  ) : null}
                  {selectedRequest.deceasedAge != null ? (
                    <DetailRow icon="hourglass-outline" label="Age at Time of Passing" value={String(selectedRequest.deceasedAge)} />
                  ) : null}
                  {selectedRequest.tributeMessage ? (
                    <DetailRow icon="heart-outline" label="Tribute Message" value={selectedRequest.tributeMessage} />
                  ) : null}
                </View>

                <Text style={styles.detailSectionTitle}>Family & Contact Information</Text>
                <View style={styles.detailCard}>
                  <DetailRow icon="people-outline" label="Family Coordinator" value={selectedRequest.familyCoordinatorName} />
                  <DetailRow icon="call-outline" label="Contact Number" value={selectedRequest.contactNumber} />
                  <DetailRow icon="home-outline" label="Wake Venue" value={selectedRequest.wakeAddress} />
                  <DetailRow icon="business-outline" label="Church / Chapel" value={selectedRequest.churchName || "Not provided"} />
                  <DetailRow icon="location-outline" label="Cemetery" value={selectedRequest.cemeteryName || "Not provided"} />
                  <DetailRow icon="calendar-outline" label="Wake From" value={formatServiceDate(selectedRequest.wakeStartDate)} />
                  <DetailRow icon="calendar-outline" label="Wake To" value={formatServiceDate(selectedRequest.wakeEndDate)} />
                  <DetailRow
                    icon="time-outline"
                    label="Burial"
                    value={
                      selectedRequest.wakeEndDate && selectedRequest.burialTime
                        ? `${formatServiceDate(selectedRequest.wakeEndDate)} at ${formatServiceTime(selectedRequest.burialTime)}`
                        : "Not provided"
                    }
                  />
                  <DetailRow icon="car-outline" label="Pickup Address" value={selectedRequest.pickupAddress} />
                  <DetailRow icon="call-outline" label="Shop Contact" value={selectedRequest.shopContactNumber || "Not available"} />
                  {selectedRequest.shopAddress ? (
                    <DetailRow icon="location-outline" label="Shop Address" value={selectedRequest.shopAddress} />
                  ) : null}
                </View>

                <View style={styles.contactActionRow}>
                  <TouchableOpacity
                    style={[styles.contactActionButton, !selectedRequest.shopContactNumber ? styles.contactActionButtonDisabled : null]}
                    onPress={() => void openPhoneLink("call", selectedRequest.shopContactNumber)}
                    disabled={!selectedRequest.shopContactNumber}
                  >
                    <Ionicons name="call-outline" size={16} color="#22312d" />
                    <Text style={styles.contactActionButtonText}>Call Shop</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.contactActionButton, !selectedRequest.shopContactNumber ? styles.contactActionButtonDisabled : null]}
                    onPress={() => void openPhoneLink("sms", selectedRequest.shopContactNumber)}
                    disabled={!selectedRequest.shopContactNumber}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color="#22312d" />
                    <Text style={styles.contactActionButtonText}>SMS Shop</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.detailSectionTitle}>Timeline</Text>
                <View style={styles.detailCard}>
                  <DetailRow icon="time-outline" label="Submitted" value={formatTimestamp(selectedRequest.createdAt)} />
                  {selectedRequest.acceptedAt ? (
                    <DetailRow icon="checkmark-circle-outline" label="Accepted" value={formatTimestamp(selectedRequest.acceptedAt)} />
                  ) : null}
                  {selectedRequest.declinedAt ? (
                    <DetailRow icon="close-circle-outline" label="Declined" value={formatTimestamp(selectedRequest.declinedAt)} />
                  ) : null}
                  {selectedRequest.cancelledAt ? (
                    <DetailRow icon="ban-outline" label="Cancelled" value={formatTimestamp(selectedRequest.cancelledAt)} />
                  ) : null}
                  {selectedRequest.paymentSubmittedAt ? (
                    <DetailRow icon="paper-plane-outline" label="Payment Submitted" value={formatTimestamp(selectedRequest.paymentSubmittedAt)} />
                  ) : null}
                  {selectedRequest.paymentVerifiedAt ? (
                    <DetailRow icon="shield-checkmark-outline" label="Payment Verified" value={formatTimestamp(selectedRequest.paymentVerifiedAt)} />
                  ) : null}
                  {selectedRequest.shopMarkedCompletedAt ? (
                    <DetailRow icon="checkmark-done-outline" label="Shop Marked Completed" value={formatTimestamp(selectedRequest.shopMarkedCompletedAt)} />
                  ) : null}
                  {selectedRequest.completedAt ? (
                    <DetailRow icon="flag-outline" label="Completed" value={formatTimestamp(selectedRequest.completedAt)} />
                  ) : null}
                </View>

                {!selectedRequest.sharedWithMe && isPendingRequest(selectedRequest.status) ? (
                  <View style={styles.actionStack}>
                    <TouchableOpacity
                      style={styles.editButton}
                      onPress={() => openEditRequest(selectedRequest)}
                    >
                      <Text style={styles.editButtonText}>Edit Request</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {!selectedRequest.sharedWithMe && isCancellable(selectedRequest.status) ? (
                  <View style={styles.actionStack}>
                    <TouchableOpacity
                      style={[styles.cancelButton, cancellingRequestId === selectedRequest.id ? styles.buttonDisabled : null]}
                      onPress={() => void cancelRequest(selectedRequest)}
                      disabled={cancellingRequestId === selectedRequest.id}
                    >
                      <Text style={styles.cancelButtonText}>{cancellingRequestId === selectedRequest.id ? "Cancelling..." : "Cancel Request"}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                <View style={styles.statusInfoCard}>
                  <Text style={styles.statusInfoTitle}>Current Update</Text>
                  <Text style={styles.statusInfoText}>{getStatusMeta(selectedRequest.status).message}</Text>
                </View>

                {!selectedRequest.sharedWithMe && String(selectedRequest.status || "").toLowerCase() === "awaiting_customer_confirmation" ? (
                  <View style={styles.actionStack}>
                    <TouchableOpacity
                      style={[styles.confirmDoneButton, cancellingRequestId === selectedRequest.id ? styles.buttonDisabled : null]}
                      onPress={() => void confirmDoneRequest(selectedRequest)}
                      disabled={cancellingRequestId === selectedRequest.id}
                    >
                      {cancellingRequestId === selectedRequest.id ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                      <Text style={styles.confirmDoneButtonText}>
                        {cancellingRequestId === selectedRequest.id ? "Confirming..." : "Mark as Done"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {canShowPaymentSection(selectedRequest) ? (
                  <View style={styles.paymentSection}>
                    <View style={styles.paymentHeader}>
                      <View style={styles.paymentHeaderIcon}>
                        <Ionicons name="wallet-outline" size={20} color="#7f6653" />
                      </View>
                      <View style={styles.paymentHeaderCopy}>
                        <Text style={styles.paymentTitle}>Pay the Shop</Text>
                      </View>
                    </View>

                    {Number(selectedRequest.paymentAmount) > 0 ? (
                      <View style={styles.paymentAmountRow}>
                        <Text style={styles.paymentAmountLabel}>Amount to send</Text>
                        <Text style={styles.paymentAmountValue}>₱{Number(selectedRequest.paymentAmount).toLocaleString("en-PH")}</Text>
                      </View>
                    ) : null}

                    <View style={[styles.paymentStatusPill, { backgroundColor: getStatusMeta(selectedRequest.status).background }]}>
                      <Text style={[styles.paymentStatusText, { color: getStatusMeta(selectedRequest.status).text }]}>
                        {getStatusMeta(selectedRequest.status).label}
                      </Text>
                    </View>

                    {String(selectedRequest.status || "").toLowerCase() === "awaiting_payment" &&
                    selectedRequest.paymentRejectionReason ? (
                      <View style={styles.rejectReasonCard}>
                        <Text style={styles.rejectReasonTitle}>Your submission was rejected</Text>
                        <Text style={styles.rejectReasonText}>{selectedRequest.paymentRejectionReason}</Text>
                      </View>
                    ) : null}

                    {selectedRequest.paymentProofImageUrl ? (
                      <>
                        <Text style={styles.inputLabel}>Submitted Proof</Text>
                        <TouchableOpacity activeOpacity={0.9} onPress={() => setPaymentViewerUrl(selectedRequest.paymentProofImageUrl || null)}>
                          <Image source={{ uri: selectedRequest.paymentProofImageUrl }} style={styles.paymentProofImage} resizeMode="cover" />
                        </TouchableOpacity>
                        <Text style={styles.photoEnlargeHint}>Tap the photo to enlarge it.</Text>
                      </>
                    ) : null}

                    {selectedRequest.completionProofImageUrl ? (
                      <>
                        <Text style={styles.inputLabel}>Completion Proof</Text>
                        <TouchableOpacity activeOpacity={0.9} onPress={() => setPaymentViewerUrl(selectedRequest.completionProofImageUrl || null)}>
                          <Image source={{ uri: selectedRequest.completionProofImageUrl }} style={styles.paymentProofImage} resizeMode="cover" />
                        </TouchableOpacity>
                        <Text style={styles.photoEnlargeHint}>Tap the photo to enlarge it.</Text>
                      </>
                    ) : null}

                    {String(selectedRequest.status || "").toLowerCase() === "awaiting_payment" ? (
                      <TouchableOpacity
                        style={styles.submitPaymentButton}
                        onPress={() => setXenditRequest(selectedRequest)}
                      >
                        <Ionicons name="flash" size={19} color="#ffffff" />
                        <Text style={styles.submitPaymentButtonText}>1-Click Pay with Xendit</Text>
                      </TouchableOpacity>
                    ) : null}

                    {false && String(selectedRequest!.status || "").toLowerCase() === "awaiting_payment" ? (
                      <>
                        <Text style={styles.inputLabel}>Sender Name *</Text>
                        <TextInput
                          style={styles.input}
                          value={paymentForm.senderName}
                          onChangeText={(value) => setPaymentForm((current) => ({ ...current, senderName: value }))}
                          placeholder="Name of the person sending the payment"
                          placeholderTextColor="#9aa39d"
                        />

                        <Text style={styles.inputLabel}>GCash Name *</Text>
                        <TextInput
                          style={styles.input}
                          value={paymentForm.gcashName}
                          onChangeText={(value) => setPaymentForm((current) => ({ ...current, gcashName: value }))}
                          placeholder="Name registered to the GCash account"
                          placeholderTextColor="#9aa39d"
                        />
                        <Text style={styles.inputLabel}>GCash Number *</Text>
                        <TextInput
                          style={styles.input}
                          value={paymentForm.gcashNumber}
                          onChangeText={(value) => setPaymentForm((current) => ({ ...current, gcashNumber: value }))}
                          placeholder="e.g. 09XX XXX XXXX"
                          placeholderTextColor="#9aa39d"
                          keyboardType="phone-pad"
                        />

                        <Text style={styles.inputLabel}>Transaction Reference *</Text>
                        <TextInput
                          style={styles.input}
                          value={paymentForm.referenceNumber}
                          onChangeText={(value) => setPaymentForm((current) => ({ ...current, referenceNumber: value }))}
                          placeholder="Reference shown on the receipt"
                          placeholderTextColor="#9aa39d"
                          autoCapitalize="characters"
                          maxLength={40}
                        />

                        <Text style={styles.inputLabel}>Proof of Payment *</Text>
                        {paymentForm.proofImageUrl ? (
                          <View style={styles.proofPreviewWrap}>
                            <Image source={{ uri: paymentForm.proofImageUrl! }} style={styles.proofPreview} resizeMode="cover" />
                            <TouchableOpacity style={styles.proofRemoveButton} onPress={() => setPaymentForm((current) => ({ ...current, proofImageUrl: null }))}>
                              <Text style={styles.proofRemoveText}>Remove</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity style={styles.proofPicker} onPress={() => void pickPaymentProof()} disabled={uploadingProof}>
                            {uploadingProof ? (
                              <ActivityIndicator size="small" color="#7f6653" />
                            ) : (
                              <Ionicons name="cloud-upload-outline" size={22} color="#7f6653" />
                            )}
                            <Text style={styles.proofPickerText}>
                              {uploadingProof ? "Uploading..." : "Attach payment screenshot"}
                            </Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={[styles.submitPaymentButton, submittingPayment ? styles.buttonDisabled : null]}
                          onPress={() => void submitPayment(selectedRequest!)}
                          disabled={submittingPayment}
                        >
                          {submittingPayment ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                          <Text style={styles.submitPaymentButtonText}>
                            {submittingPayment ? "Submitting..." : "Submit Payment Details"}
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                ) : null}

                <TouchableOpacity style={styles.closeButton} onPress={() => setSelectedRequest(null)}>
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </KeyboardAwareScrollView>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={Boolean(editingRequest)} transparent animationType="fade" onRequestClose={closeEditRequest}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeEditRequest}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            {editingRequest ? (
              <KeyboardAwareScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                scrollEnabled
                overScrollMode="always"
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.modalTitle}>Edit Request</Text>
                <Text style={styles.modalCaption}>You can update this request while the shop has not accepted it yet.</Text>

                <Text style={styles.inputLabel}>Full Name of the Deceased</Text>
                <TextInput style={styles.input} value={editForm.deceasedFullName} onChangeText={(value) => setEditForm((current) => ({ ...current, deceasedFullName: value }))} />

                <Text style={styles.inputLabel}>Family Coordinator</Text>
                <TextInput style={styles.input} value={editForm.familyCoordinatorName} onChangeText={(value) => setEditForm((current) => ({ ...current, familyCoordinatorName: value }))} />

                <Text style={styles.inputLabel}>Contact Number</Text>
                <TextInput
                  style={styles.input}
                  value={editForm.contactNumber}
                  onChangeText={(value) => setEditForm((current) => ({ ...current, contactNumber: value }))}
                  keyboardType="phone-pad"
                />

                <Text style={styles.inputLabel}>Wake Venue</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={editForm.wakeAddress}
                  onChangeText={(value) => setEditForm((current) => ({ ...current, wakeAddress: value }))}
                  multiline
                />

                <Text style={styles.inputLabel}>Church / Chapel</Text>
                <TextInput
                  style={styles.input}
                  value={editForm.churchName}
                  onChangeText={(value) => setEditForm((current) => ({ ...current, churchName: value }))}
                  placeholder="Name of the church or chapel"
                />

                <Text style={styles.inputLabel}>Cemetery</Text>
                <TextInput
                  style={styles.input}
                  value={editForm.cemeteryName}
                  onChangeText={(value) => setEditForm((current) => ({ ...current, cemeteryName: value }))}
                  placeholder="Name of the cemetery"
                />

                <ServiceRequestScheduleFields
                  wakeStartDate={editForm.wakeStartDate}
                  wakeEndDate={editForm.wakeEndDate}
                  burialTime={editForm.burialTime}
                  onWakeStartDateChange={(value) => setEditForm((current) => ({ ...current, wakeStartDate: value }))}
                  onWakeEndDateChange={(value) => setEditForm((current) => ({ ...current, wakeEndDate: value }))}
                  onBurialTimeChange={(value) => setEditForm((current) => ({ ...current, burialTime: value }))}
                  minimumWakeDate={editingRequest?.deceasedDateOfPassing ? new Date(editingRequest.deceasedDateOfPassing) : null}
                />
                <Text style={styles.inputLabel}>Pickup Address</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={editForm.pickupAddress}
                  onChangeText={(value) => setEditForm((current) => ({ ...current, pickupAddress: value }))}
                  multiline
                />

                <Text style={styles.inputLabel}>Tribute Message</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={editForm.tributeMessage}
                  onChangeText={(value) => setEditForm((current) => ({ ...current, tributeMessage: value }))}
                  multiline
                />

                <View style={styles.actionStack}>
                  <TouchableOpacity style={[styles.editButton, savingEdit ? styles.buttonDisabled : null]} onPress={() => void saveRequestEdits()} disabled={savingEdit}>
                    <Text style={styles.editButtonText}>{savingEdit ? "Saving..." : "Save Changes"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.closeButton} onPress={closeEditRequest} disabled={savingEdit}>
                    <Text style={styles.closeButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </KeyboardAwareScrollView>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={Boolean(paymentRequest)}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setPaymentRequest(null)}
      >
        {paymentRequest ? (
          <View style={styles.paymentSuccessScreen}>
            <StatusBar barStyle="light-content" backgroundColor="#101312" translucent />
            <ScrollView
              style={styles.paymentSuccessScroll}
              contentContainerStyle={styles.paymentSuccessContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={[styles.paymentSuccessHero, { paddingTop: Math.max(46, insets.top + 28) }]}>
                <TouchableOpacity
                  style={[styles.paymentSuccessCloseButton, { top: Math.max(16, insets.top + 8) }]}
                  onPress={() => setPaymentRequest(null)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Close payment details"
                >
                  <Ionicons name="close" size={24} color="#ffffff" />
                </TouchableOpacity>
                <View
                  style={[
                    styles.paymentSuccessBadge,
                    {
                      backgroundColor: ["payment_verified", "awaiting_customer_confirmation", "completed"].includes(
                        String(paymentRequest.status || "").toLowerCase()
                      )
                        ? "#48c978"
                        : String(paymentRequest.status || "").toLowerCase() === "payment_submitted"
                          ? "#69b8e7"
                          : "#e7ad59",
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      ["payment_verified", "awaiting_customer_confirmation", "completed"].includes(
                        String(paymentRequest.status || "").toLowerCase()
                      )
                        ? "checkmark"
                        : String(paymentRequest.status || "").toLowerCase() === "payment_submitted"
                          ? "time-outline"
                          : "wallet-outline"
                    }
                    size={32}
                    color="#10201b"
                    style={styles.paymentSuccessCheck}
                  />
                </View>
                <Text style={styles.paymentSuccessTitle}>{getStatusMeta(paymentRequest.status).label}</Text>
                <Text style={styles.paymentSuccessMessage}>{getStatusMeta(paymentRequest.status).message}</Text>
              </View>

              <View style={[styles.paymentSuccessBody, { paddingBottom: Math.max(24, insets.bottom + 16) }]}>
                <Text style={styles.paymentSuccessSectionTitle}>Order Details</Text>
                <View style={styles.paymentSuccessDetails}>
                  <View style={styles.paymentSuccessDetailRow}>
                    <Text style={styles.paymentSuccessDetailLabel}>Order Date</Text>
                    <Text style={styles.paymentSuccessDetailValue}>
                      {formatTimestamp(paymentRequest.paymentSubmittedAt || paymentRequest.createdAt)}
                    </Text>
                  </View>
                  <View style={styles.paymentSuccessDetailRow}>
                    <Text style={styles.paymentSuccessDetailLabel}>Order ID</Text>
                    <Text style={styles.paymentSuccessDetailValue}>#{paymentRequest.id.slice(0, 10).toUpperCase()}</Text>
                  </View>
                  <View style={styles.paymentSuccessDetailRow}>
                    <Text style={styles.paymentSuccessDetailLabel}>Service Address</Text>
                    <Text style={styles.paymentSuccessDetailValue}>{paymentRequest.wakeAddress}</Text>
                  </View>
                </View>

                <View style={styles.paymentSuccessDivider} />

                <View style={styles.paymentSuccessItemRow}>
                  {paymentRequest.productImageUrl ? (
                    <Image source={{ uri: paymentRequest.productImageUrl }} style={styles.paymentSuccessItemImage} resizeMode="cover" />
                  ) : (
                    <View style={[styles.paymentSuccessItemImage, styles.paymentSuccessItemFallback]}>
                      <Ionicons name="cube-outline" size={25} color="#7a847f" />
                    </View>
                  )}
                  <View style={styles.paymentSuccessItemCopy}>
                    <Text style={styles.paymentSuccessItemName}>{paymentRequest.productName}</Text>
                    <Text style={styles.paymentSuccessItemMeta}>{paymentRequest.variationName || "Funeral service"}</Text>
                    <Text style={styles.paymentSuccessItemMeta}>{paymentRequest.shopName}</Text>
                  </View>
                  <Text style={styles.paymentSuccessItemAmount}>{formatPeso(paymentRequest.paymentAmount)}</Text>
                </View>

                <View style={styles.paymentSuccessDivider} />

                <TouchableOpacity
                  style={styles.paymentDetailsAccordionHeader}
                  onPress={() => setPaymentInfoExpanded((expanded) => !expanded)}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={paymentInfoExpanded ? "Hide receipt information" : "Show receipt information"}
                  accessibilityState={{ expanded: paymentInfoExpanded }}
                >
                  <Text style={styles.paymentDetailsSectionTitle}>Receipt Information</Text>
                  <View style={styles.paymentDetailsAccordionIcon}>
                    <Ionicons name={paymentInfoExpanded ? "chevron-up" : "chevron-down"} size={19} color="#53615d" />
                  </View>
                </TouchableOpacity>

                {paymentInfoExpanded ? (
                  <View style={styles.paymentDetailsAccordionBody}>
                    <View style={styles.paymentSuccessDetailRow}>
                      <Text style={styles.paymentSuccessDetailLabel}>Payment Method</Text>
                      <Text style={styles.paymentSuccessDetailValue}>{paymentRequest.paymentProvider === "xendit" ? "Xendit 1-Click Pay" : paymentRequest.paymentProvider === "paymongo" ? "Online Payment" : "GCash / E-wallet"}</Text>
                    </View>
                    {paymentRequest.paymentPayerName ? (
                      <View style={styles.paymentSuccessDetailRow}>
                        <Text style={styles.paymentSuccessDetailLabel}>Sender</Text>
                        <Text style={styles.paymentSuccessDetailValue}>{paymentRequest.paymentPayerName}</Text>
                      </View>
                    ) : null}
                    {paymentRequest.paymentGcashName ? (
                      <View style={styles.paymentSuccessDetailRow}>
                        <Text style={styles.paymentSuccessDetailLabel}>GCash Name</Text>
                        <Text style={styles.paymentSuccessDetailValue}>{paymentRequest.paymentGcashName}</Text>
                      </View>
                    ) : null}
                    {paymentRequest.paymentGcashNumber ? (
                      <View style={styles.paymentSuccessDetailRow}>
                        <Text style={styles.paymentSuccessDetailLabel}>GCash Number</Text>
                        <Text style={styles.paymentSuccessDetailValue}>{paymentRequest.paymentGcashNumber}</Text>
                      </View>
                    ) : null}
                    {paymentRequest.paymentReferenceNumber ? (
                      <View style={styles.paymentSuccessDetailRow}>
                        <Text style={styles.paymentSuccessDetailLabel}>Reference Number</Text>
                        <Text style={styles.paymentSuccessDetailValue}>{paymentRequest.paymentReferenceNumber}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {String(paymentRequest.status || "").toLowerCase() === "awaiting_payment" && paymentRequest.paymentRejectionReason ? (
                  <View style={styles.rejectReasonCard}>
                    <Text style={styles.rejectReasonTitle}>Your submission was rejected</Text>
                    <Text style={styles.rejectReasonText}>{paymentRequest.paymentRejectionReason}</Text>
                  </View>
                ) : null}

                {paymentRequest.paymentProofImageUrl ? (
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
                        <TouchableOpacity activeOpacity={0.9} onPress={() => setPaymentViewerUrl(paymentRequest.paymentProofImageUrl || null)}>
                          <Image source={{ uri: paymentRequest.paymentProofImageUrl }} style={styles.paymentDetailsProofImage} resizeMode="cover" />
                        </TouchableOpacity>
                        <Text style={styles.paymentDetailsMediaHint}>Tap the photo to enlarge it.</Text>
                      </View>
                    ) : null}
                  </View>
                ) : paymentRequest.paymentQrUrl && !paymentRequest.paymentQrUrl.startsWith("xendit") ? (
                  <>
                    <Text style={styles.paymentDetailsMediaTitle}>Shop Payment QR</Text>
                    <TouchableOpacity activeOpacity={0.9} onPress={() => setPaymentViewerUrl(paymentRequest.paymentQrUrl || null)}>
                      <Image source={{ uri: paymentRequest.paymentQrUrl }} style={styles.paymentDetailsQrImage} resizeMode="contain" />
                    </TouchableOpacity>
                    <Text style={styles.paymentDetailsMediaHint}>Tap the QR code to enlarge it.</Text>
                  </>
                ) : null}

                <View style={styles.paymentSuccessDivider} />

                <View style={styles.paymentSuccessTotalRow}>
                  <Text style={styles.paymentSuccessTotalLabel}>Order Total</Text>
                  <Text style={styles.paymentSuccessTotalValue}>{formatPeso(paymentRequest.paymentAmount)}</Text>
                </View>

                {String(paymentRequest.status || "").toLowerCase() === "awaiting_payment" ? (
                  <TouchableOpacity
                    style={[styles.receiptActionButtonPrimary, { marginTop: 18 }]}
                    onPress={() => setXenditRequest(paymentRequest)}
                  >
                    <Ionicons name="flash" size={18} color="#ffffff" />
                    <Text style={styles.receiptActionButtonPrimaryText}>1-Click Pay with Xendit</Text>
                  </TouchableOpacity>
                ) : null}

              </View>
            </ScrollView>
          </View>
        ) : null}
      </Modal>

      <Modal visible={Boolean(receiptRequest)} transparent animationType="fade" onRequestClose={() => setReceiptRequest(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setReceiptRequest(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            {receiptRequest ? (
              <KeyboardAwareScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                scrollEnabled
                overScrollMode="always"
              >
                <View style={styles.receiptCard}>
                  <View style={styles.receiptBrand}>
                    <View style={styles.receiptBadge}>
                      <Text style={styles.receiptBadgeText}>LC</Text>
                    </View>
                    <View>
                      <Text style={styles.receiptBrandName}>LifeCycle</Text>
                      <Text style={styles.receiptBrandSub}>FUNERAL SERVICES</Text>
                    </View>
                  </View>

                  <Text style={styles.receiptTitle}>Payment Receipt</Text>
                  <View style={[styles.paymentStatusPill, { backgroundColor: getStatusMeta(receiptRequest.status).background }]}>
                    <Text style={[styles.paymentStatusText, { color: getStatusMeta(receiptRequest.status).text }]}>
                      {getStatusMeta(receiptRequest.status).label}
                    </Text>
                  </View>

                  <View style={styles.receiptMetaRow}>
                    <Text style={styles.receiptMetaText}>Receipt No: {buildReceiptNumber(receiptRequest.id)}</Text>
                    <Text style={styles.receiptMetaText}>Issued: {formatTimestamp(receiptRequest.paymentVerifiedAt || receiptRequest.paymentSubmittedAt || receiptRequest.createdAt)}</Text>
                  </View>

                  <View style={styles.receiptDivider} />

                  <View style={styles.receiptAmountRow}>
                    <Text style={styles.receiptAmountLabel}>Amount Paid</Text>
                    <Text style={styles.receiptAmountValue}>{formatPeso(receiptRequest.paymentAmount)}</Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Shop</Text>
                    <Text style={styles.receiptRowValue}>{receiptRequest.shopName}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Service</Text>
                    <Text style={styles.receiptRowValue}>{receiptRequest.productName}{receiptRequest.variationName ? ` (${receiptRequest.variationName})` : ""}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Deceased</Text>
                    <Text style={styles.receiptRowValue}>{receiptRequest.deceasedFullName}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Sender</Text>
                    <Text style={styles.receiptRowValue}>{receiptRequest.paymentPayerName || "—"}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>GCash Name</Text>
                    <Text style={styles.receiptRowValue}>{receiptRequest.paymentGcashName || "—"}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>GCash Number</Text>
                    <Text style={styles.receiptRowValue}>{receiptRequest.paymentGcashNumber || "—"}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>GCash Reference</Text>
                    <Text style={styles.receiptRowValue}>{receiptRequest.paymentReferenceNumber || "—"}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Payment Method</Text>
                    <Text style={styles.receiptRowValue}>GCash / E-wallet</Text>
                  </View>
                  {receiptRequest.shopAddress ? (
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptRowLabel}>Shop Address</Text>
                      <Text style={styles.receiptRowValue}>{receiptRequest.shopAddress}</Text>
                    </View>
                  ) : null}
                  {receiptRequest.shopContactNumber ? (
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptRowLabel}>Shop Contact</Text>
                      <Text style={styles.receiptRowValue}>{receiptRequest.shopContactNumber}</Text>
                    </View>
                  ) : null}

                  {receiptRequest.paymentProofImageUrl ? (
                    <TouchableOpacity
                      style={styles.receiptProofWrap}
                      activeOpacity={0.9}
                      onPress={() => setPaymentViewerUrl(receiptRequest.paymentProofImageUrl || null)}
                    >
                      <Image source={{ uri: receiptRequest.paymentProofImageUrl }} style={styles.receiptProofImage} resizeMode="cover" />
                    </TouchableOpacity>
                  ) : null}

                  <View style={styles.receiptDivider} />
                  <Text style={styles.receiptFooter}>
                    Thank you for your payment. This receipt confirms your payment to {receiptRequest.shopName} through LifeCycle.
                  </Text>
                </View>

                <View style={styles.actionStack}>
                  <TouchableOpacity
                    style={[styles.receiptActionButtonPrimary, generatingReceipt ? styles.buttonDisabled : null]}
                    onPress={() => void printReceipt(receiptRequest)}
                    disabled={generatingReceipt}
                  >
                    <Ionicons name="print-outline" size={16} color="#ffffff" />
                    <Text style={styles.receiptActionButtonPrimaryText}>
                      {generatingReceipt ? "Preparing..." : "Print Receipt"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.receiptActionButtonSecondary, generatingReceipt ? styles.buttonDisabled : null]}
                    onPress={() => void shareReceipt(receiptRequest)}
                    disabled={generatingReceipt}
                  >
                    <Ionicons name="share-outline" size={16} color="#22312d" />
                    <Text style={styles.receiptActionButtonSecondaryText}>Save / Share Receipt PDF</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.closeButton} onPress={() => setReceiptRequest(null)}>
                    <Text style={styles.closeButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </KeyboardAwareScrollView>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={Boolean(paymentViewerUrl)} transparent animationType="fade" onRequestClose={() => setPaymentViewerUrl(null)}>
        <TouchableOpacity style={styles.qrZoomOverlay} activeOpacity={1} onPress={() => setPaymentViewerUrl(null)}>
          <View style={styles.qrZoomCard}>
            <TouchableOpacity style={styles.qrZoomClose} activeOpacity={0.9} onPress={() => setPaymentViewerUrl(null)}>
              <Ionicons name="close" size={22} color="#ffffff" />
            </TouchableOpacity>
            {paymentViewerUrl ? (
              <Image
                source={{ uri: paymentViewerUrl }}
                style={styles.qrZoomImage}
                resizeMode="contain"
              />
            ) : null}
            <Text style={styles.qrZoomCaption}>
              {paymentViewerUrl === selectedRequest?.paymentQrUrl
                ? "Scan this QR code to send the payment."
                : paymentViewerUrl === selectedRequest?.paymentProofImageUrl
                ? "Your submitted proof of payment."
                : paymentViewerUrl === selectedRequest?.productImageUrl
                ? "Product reference image."
                : paymentViewerUrl === selectedRequest?.memorialPhotoUrl
                ? "Memorial photo."
                : ""}
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>

      <ServiceXenditSheet
        visible={Boolean(xenditRequest)}
        request={xenditRequest}
        onClose={() => setXenditRequest(null)}
        onChanged={async () => {
          await loadRequests();
          if (!xenditRequest) return;
          const { data } = await supabase
            .from("funeral_service_requests")
            .select('status, "paymentProvider", "providerPaymentMethod"')
            .eq("id", xenditRequest.id)
            .maybeSingle();
          if (data?.status === "payment_verified") {
            setXenditRequest(null);
            setPaymentRequest((current) => current?.id === xenditRequest.id ? { ...current, ...data } : current);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f3f5f7",
  },
  content: {
    padding: 18,
    paddingBottom: 32,
    gap: 14,
  },
  headerCard: {
    paddingVertical: 4,
  },
  headerTitle: {
    color: "#22312d",
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "900",
  },
  headerSubtitle: {
    color: "#69788b",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  headerStats: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d8e0e8",
    backgroundColor: "#ffffff",
    marginTop: 14,
    paddingVertical: 11,
  },
  headerStat: {
    flex: 1,
    alignItems: "center",
  },
  headerStatValue: {
    color: "#22312d",
    fontSize: 19,
    fontWeight: "900",
  },
  headerStatLabel: {
    color: "#69788b",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  headerStatDivider: {
    width: 1,
    height: 30,
    backgroundColor: "#d8e0e8",
  },
  requestFilterRow: {
    gap: 8,
    paddingRight: 4,
  },
  requestFilterChip: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d6d2c9",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  requestFilterChipActive: {
    borderColor: "#516961",
    backgroundColor: "#516961",
  },
  requestFilterText: {
    color: "#62706b",
    fontSize: 12,
    fontWeight: "900",
  },
  requestFilterTextActive: {
    color: "#ffffff",
  },
  paymentNeededBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f4d0a6",
    backgroundColor: "#fdf3e7",
    padding: 14,
  },
  paymentNeededIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fae3c8",
  },
  paymentNeededCopy: {
    flex: 1,
  },
  paymentNeededTitle: {
    color: "#8a4a13",
    fontSize: 14,
    fontWeight: "900",
  },
  paymentNeededText: {
    color: "#5c4a35",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 42,
  },
  loadingText: {
    color: "#62706b",
    fontSize: 13,
    marginTop: 10,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  refreshButton: {
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  refreshButtonText: {
    color: "#22312d",
    fontSize: 13,
    fontWeight: "900",
  },
  emptyCard: {
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 30,
  },
  emptyTitle: {
    color: "#22312d",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 12,
  },
  emptyText: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 6,
  },
  requestCard: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },
  requestCardPayment: {
    borderColor: "#f4c48f",
  },
  requestImage: {
    width: 78,
    height: 88,
    borderRadius: 10,
    backgroundColor: "#ebf1e8",
  },
  requestImageFallback: {
    width: 78,
    height: 88,
    borderRadius: 10,
    backgroundColor: "#ebf1e8",
    alignItems: "center",
    justifyContent: "center",
  },
  requestBody: {
    flex: 1,
  },
  requestTopRow: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 8,
  },
  requestTextBlock: {
    flex: 1,
  },
  requestName: {
    color: "#22312d",
    fontSize: 16,
    fontWeight: "900",
  },
  requestShop: {
    color: "#8b7255",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  sharedRequestLabel: {
    marginTop: 3,
    color: "#315f50",
    fontSize: 9,
    fontWeight: "800",
  },
  requestMeta: {
    color: "#62706b",
    fontSize: 13,
    marginTop: 8,
  },
  requestMessage: {
    lineHeight: 19,
  },
  payNowBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    backgroundColor: "#b45309",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  payNowBannerText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  viewDetailsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
    marginTop: 12,
  },
  viewDetailsText: {
    color: "#7f6653",
    fontSize: 12,
    fontWeight: "900",
  },
  statusBadge: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "900",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 12, 10, 0.58)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    height: "86%",
    borderRadius: 16,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 18,
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    paddingBottom: 96,
  },
  modalTitle: {
    color: "#22312d",
    fontSize: 22,
    fontWeight: "900",
  },
  modalSubtitle: {
    color: "#8b7255",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
    marginBottom: 14,
  },
  modalCaption: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 14,
  },
  modalImage: {
    width: "100%",
    height: 220,
    borderRadius: 12,
    marginBottom: 14,
  },
  modalItemImage: {
    width: "100%",
    height: 170,
    borderRadius: 12,
    marginBottom: 14,
  },
  payNowModalBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    backgroundColor: "#b45309",
    padding: 14,
    marginBottom: 14,
  },
  payNowModalBannerCopy: {
    flex: 1,
  },
  payNowModalBannerTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  payNowModalBannerText: {
    color: "#fde8c8",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  detailCard: {
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#d8e0e8",
    paddingVertical: 4,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0e6da",
  },
  detailIconWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  detailCopy: {
    flex: 1,
  },
  detailSectionTitle: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 18,
    marginBottom: 2,
  },
  detailLabel: {
    color: "#86654a",
    fontSize: 12,
    fontWeight: "800",
  },
  detailValue: {
    color: "#292524",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
  },
  inputLabel: {
    color: "#53615d",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d2d7d1",
    backgroundColor: "#fcfcfb",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#22312d",
    fontSize: 14,
  },
  multilineInput: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  statusInfoCard: {
    marginTop: 18,
    borderRadius: 16,
    backgroundColor: "#ece9e3",
    padding: 14,
  },
  contactActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  contactActionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#fbfaf7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  contactActionButtonDisabled: {
    opacity: 0.45,
  },
  contactActionButtonText: {
    color: "#22312d",
    fontSize: 13,
    fontWeight: "900",
  },
  actionStack: {
    gap: 10,
    marginTop: 16,
  },
  editButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
  },
  editButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  confirmDoneButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#14532d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  confirmDoneButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  cancelButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    color: "#991b1b",
    fontSize: 14,
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  statusInfoTitle: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "900",
  },
  statusInfoText: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  closeButton: {
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: "#ece9e3",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  closeButtonText: {
    color: "#62706b",
    fontSize: 14,
    fontWeight: "900",
  },
  paymentSection: {
    marginTop: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    padding: 16,
  },
  paymentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  paymentHeaderIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1ebe4",
  },
  paymentHeaderCopy: {
    flex: 1,
  },
  paymentTitle: {
    color: "#22312d",
    fontSize: 17,
    fontWeight: "900",
  },
  paymentAmountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: "#f1ebe4",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  paymentAmountLabel: {
    color: "#62706b",
    fontSize: 13,
    fontWeight: "700",
  },
  paymentAmountValue: {
    color: "#22312d",
    fontSize: 18,
    fontWeight: "900",
  },
  paymentQrImage: {
    width: "100%",
    height: 210,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e6e3da",
  },
  paymentQrHint: {
    color: "#8a948f",
    fontSize: 12,
    textAlign: "center",
    marginTop: 6,
  },
  photoEnlargeHint: {
    color: "#8a948f",
    fontSize: 12,
    textAlign: "center",
    marginTop: -6,
    marginBottom: 14,
  },
  paymentStatusPill: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 12,
  },
  paymentStatusText: {
    fontSize: 12,
    fontWeight: "900",
  },
  rejectReasonCard: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "#fde68a",
    padding: 12,
  },
  rejectReasonTitle: {
    color: "#86654a",
    fontSize: 13,
    fontWeight: "900",
  },
  rejectReasonText: {
    color: "#5c4a35",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  paymentProofImage: {
    width: "100%",
    height: 190,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e6e3da",
  },
  proofPreviewWrap: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e6e3da",
  },
  proofPreview: {
    width: "100%",
    height: 150,
  },
  proofRemoveButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fee2e2",
  },
  proofRemoveText: {
    color: "#991b1b",
    fontSize: 13,
    fontWeight: "900",
  },
  proofPicker: {
    minHeight: 88,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#d2d7d1",
    backgroundColor: "#fcfcfb",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  proofPickerText: {
    color: "#7f6653",
    fontSize: 13,
    fontWeight: "800",
  },
  submitPaymentButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#22312d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
  },
  submitPaymentButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  paymentSuccessScreen: {
    flex: 1,
    backgroundColor: "#101312",
  },
  paymentSuccessScroll: {
    flex: 1,
    backgroundColor: "#101312",
  },
  paymentSuccessContent: {
    flexGrow: 1,
  },
  paymentSuccessHero: {
    position: "relative",
    minHeight: 270,
    paddingHorizontal: 28,
    paddingTop: 46,
    paddingBottom: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101312",
  },
  paymentSuccessCloseButton: {
    position: "absolute",
    top: 16,
    right: 18,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  paymentSuccessBadge: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: "#48c978",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "45deg" }],
    marginBottom: 26,
  },
  paymentSuccessCheck: {
    transform: [{ rotate: "-45deg" }],
  },
  paymentSuccessTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  paymentSuccessMessage: {
    maxWidth: 330,
    color: "#aeb5b1",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 8,
  },
  paymentSuccessBody: {
    flex: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 24,
    paddingTop: 25,
    paddingBottom: 24,
  },
  paymentSuccessSectionTitle: {
    color: "#191c1b",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 16,
  },
  paymentSuccessDetails: {
    gap: 12,
  },
  paymentSuccessDetailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
  },
  paymentSuccessAddressRow: {
    paddingBottom: 2,
  },
  paymentSuccessDetailLabel: {
    flexShrink: 0,
    color: "#686e6b",
    fontSize: 13,
    lineHeight: 19,
  },
  paymentSuccessDetailValue: {
    flex: 1,
    color: "#262a28",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    textAlign: "right",
  },
  paymentSuccessDivider: {
    height: 1,
    backgroundColor: "#e5e7e6",
    marginVertical: 21,
  },
  paymentSuccessItemRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  paymentSuccessItemImage: {
    width: 58,
    height: 70,
    borderRadius: 10,
    backgroundColor: "#f1f3f2",
  },
  paymentSuccessItemFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  paymentSuccessItemCopy: {
    flex: 1,
    paddingHorizontal: 13,
  },
  paymentSuccessItemName: {
    color: "#202422",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
  },
  paymentSuccessItemMeta: {
    color: "#7d8580",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  paymentSuccessItemAmount: {
    color: "#202422",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  paymentSuccessTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  paymentSuccessTotalLabel: {
    color: "#686e6b",
    fontSize: 14,
  },
  paymentSuccessTotalValue: {
    color: "#151817",
    fontSize: 18,
    fontWeight: "900",
  },
  paymentSuccessTrackButton: {
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
  paymentSuccessTrackText: {
    color: "#315f50",
    fontSize: 14,
    fontWeight: "900",
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
    borderRadius: 10,
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
  paymentDetailsMediaTitle: {
    color: "#191c1b",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 24,
    marginBottom: 10,
  },
  paymentDetailsProofImage: {
    width: "100%",
    height: 210,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7e6",
    backgroundColor: "#f1f3f2",
  },
  paymentDetailsQrImage: {
    width: "100%",
    height: 230,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7e6",
    backgroundColor: "#ffffff",
  },
  paymentDetailsMediaHint: {
    color: "#7d8580",
    fontSize: 12,
    textAlign: "center",
    marginTop: 7,
  },
  qrZoomOverlay: {
    flex: 1,
    backgroundColor: "rgba(10, 8, 6, 0.92)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  qrZoomCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
  },
  qrZoomClose: {
    alignSelf: "flex-end",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    marginBottom: 12,
  },
  qrZoomImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#ffffff",
  },
  qrZoomCaption: {
    color: "#ffffff",
    fontSize: 13,
    marginTop: 14,
    textAlign: "center",
  },
  cardPaymentButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#fbfaf7",
    marginTop: 12,
  },
  cardPaymentButtonText: {
    color: "#7f6653",
    fontSize: 13,
    fontWeight: "900",
  },
  receiptCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e3da",
    backgroundColor: "#ffffff",
    padding: 18,
  },
  receiptBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  receiptBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptBadgeText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
  },
  receiptBrandName: {
    color: "#22312d",
    fontSize: 17,
    fontWeight: "900",
  },
  receiptBrandSub: {
    color: "#8b7255",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 1,
  },
  receiptTitle: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 16,
  },
  receiptMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 12,
  },
  receiptMetaText: {
    color: "#62706b",
    fontSize: 12,
    fontWeight: "700",
  },
  receiptDivider: {
    borderTopWidth: 1,
    borderTopColor: "#d9d6cd",
    borderStyle: "dashed",
    marginVertical: 16,
  },
  receiptAmountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: "#f1ebe4",
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 6,
  },
  receiptAmountLabel: {
    color: "#62706b",
    fontSize: 14,
    fontWeight: "700",
  },
  receiptAmountValue: {
    color: "#22312d",
    fontSize: 24,
    fontWeight: "900",
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    paddingVertical: 8,
  },
  receiptRowLabel: {
    color: "#86654a",
    fontSize: 13,
    fontWeight: "800",
  },
  receiptRowValue: {
    color: "#292524",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
    flex: 1,
  },
  receiptProofWrap: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e6e3da",
    marginTop: 12,
  },
  receiptProofImage: {
    width: "100%",
    height: 140,
  },
  receiptFooter: {
    color: "#8a948f",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  receiptActionButtonPrimary: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#22312d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  receiptActionButtonPrimaryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  receiptActionButtonSecondary: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#fbfaf7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  receiptActionButtonSecondaryText: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "900",
  },
});

