import { useCallback, useEffect, useRef, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { AppBackButton } from "@/components";
import ServiceRequestScheduleFields from "@/components/ServiceRequestScheduleFields";
import { supabase } from "@/services/supabaseClient";
import { auth, uploadCertificate } from "@/services";
import { acceptFuneralServiceRequest } from '@/utils/serviceRequestFlow';
import { hapticMedium, hapticSuccess } from "@/utils/haptics";
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
  productId: string;
  productName: string;
  productPrice?: string;
  productImageUrl?: string | null;
  variationName?: string | null;
  requestType?: string;
  customDesignNotes?: string | null;
  memorialPhotoUrl?: string | null;
  referencePhotoUrl?: string | null;
  deceasedFullName: string;
  deceasedDateOfBirth?: string;
  deceasedDateOfPassing?: any;
  deceasedAge?: number | null;
  tributeMessage: string;
  familyCoordinatorName: string;
  wakeAddress: string;
  wakeStartDate?: string | null;
  wakeEndDate?: string | null;
  burialTime?: string | null;
  pickupAddress: string;
  contactNumber: string;
  shopContactNumber?: string | null;
  shopAddress?: string | null;
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
  completionProofImageUrl?: string | null;
  shopMarkedCompletedAt?: any;
  completionProofSeenAt?: any;
  completedAt?: any;
  createdAt?: any;
  acceptedAt?: any;
  declinedAt?: any;
  cancelledAt?: any;
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
  wakeStartDate: Date | null;
  wakeEndDate: Date | null;
  burialTime: Date | null;
  pickupAddress: string;
  contactNumber: string;
};

const EMPTY_PAYMENT_FORM: PaymentSubmissionForm = {
  senderName: "",
  gcashName: "",
  gcashNumber: "",
  referenceNumber: "",
  proofImageUrl: null,
};

const isCancellable = (status: string) =>
  ["pending_shop_acceptance", "accepted_by_shop", "awaiting_payment"].includes(
    String(status || "").toLowerCase()
  );

const hasPaymentSetup = (request: FuneralServiceRequest) =>
  Boolean(request.paymentQrUrl) && Number(request.paymentAmount) > 0;

const getStatusMeta = (status: string) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "accepted_by_shop") {
    return { label: "Accepted", background: "#e7f5ec", text: "#166534", message: "The shop accepted this request and is preparing its payment details." };
  }
  if (normalized === "awaiting_payment") {
    return { label: "Awaiting Payment", background: "#e0eefa", text: "#1c4f7e", message: "Pay the shop using the QR code below, then submit your payment proof." };
  }
  if (normalized === "payment_submitted") {
    return { label: "Payment Submitted", background: "#e0eefa", text: "#1c4f7e", message: "Your payment proof is being reviewed by the shop." };
  }
  if (normalized === "payment_verified") {
    return { label: "Payment Confirmed", background: "#e7f5ec", text: "#166534", message: "The shop confirmed your payment and is preparing the service." };
  }
  if (normalized === "awaiting_customer_confirmation") {
    return { label: "Awaiting Your Confirmation", background: "#fef3c7", text: "#86654a", message: "The shop has delivered and attached a completion proof. Review the photo and mark the request as done." };
  }
  if (normalized === "completed") {
    return { label: "Completed", background: "#14532d", text: "#ffffff", message: "This service request has been completed." };
  }
  if (normalized === "declined_by_shop") {
    return { label: "Declined", background: "#fde8e8", text: "#991b1b", message: "The shop declined this service request." };
  }
  if (normalized === "cancelled_by_requester") {
    return { label: "Cancelled", background: "#eef1ec", text: "#4c5b57", message: "You cancelled this service request." };
  }
  return { label: "Waiting", background: "#fef3c7", text: "#86654a", message: "The request is waiting for the shop to accept or decline it." };
};

const formatTimestamp = (value: any) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString(undefined, { hour12: true });
};

function PhotoFrame({
  uri,
  ratio,
  fallbackHeight,
  wrapperStyle,
  onPress,
}: {
  uri: string;
  ratio?: number;
  fallbackHeight: number;
  wrapperStyle?: object;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.94}
      onPress={onPress}
      style={[
        styles.photoFrame,
        ratio ? styles.photoFrameNatural : { height: fallbackHeight },
        wrapperStyle,
      ]}
    >
      <Image
        source={{ uri }}
        style={[
          styles.photoImage,
          ratio ? { aspectRatio: ratio, maxHeight: 360 } : { height: fallbackHeight },
        ]}
        resizeMode={ratio ? "contain" : "cover"}
      />
    </TouchableOpacity>
  );
}

export default function FuneralServiceRequestDetailsScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const initialRequest = route.params?.request as FuneralServiceRequest;
  const requesterView = Boolean(route.params?.requesterView);
  const [request, setRequest] = useState<FuneralServiceRequest>(initialRequest);
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);

  const [paymentForm, setPaymentForm] = useState<PaymentSubmissionForm>(EMPTY_PAYMENT_FORM);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentSuccessRequest, setPaymentSuccessRequest] = useState<FuneralServiceRequest | null>(null);
  const [completionProofUrl, setCompletionProofUrl] = useState<string | null>(initialRequest.completionProofImageUrl || null);
  const [uploadingCompletionProof, setUploadingCompletionProof] = useState(false);
  const [editingRequest, setEditingRequest] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<RequestEditForm>({
    deceasedFullName: String(initialRequest.deceasedFullName || ""),
    tributeMessage: String(initialRequest.tributeMessage || ""),
    familyCoordinatorName: String(initialRequest.familyCoordinatorName || ""),
    wakeAddress: String(initialRequest.wakeAddress || ""),
    wakeStartDate: parseDateOnly(initialRequest.wakeStartDate),
    wakeEndDate: parseDateOnly(initialRequest.wakeEndDate),
    burialTime: parseTimeOnly(initialRequest.burialTime),
    pickupAddress: String(initialRequest.pickupAddress || ""),
    contactNumber: String(initialRequest.contactNumber || ""),
  });

  const [rejectReasonVisible, setRejectReasonVisible] = useState(false);
  const [rejectReasonRequest, setRejectReasonRequest] = useState<FuneralServiceRequest | null>(null);
  const [rejectReasonText, setRejectReasonText] = useState("");
  const [rejectingPayment, setRejectingPayment] = useState(false);

  const [photoViewerUrl, setPhotoViewerUrl] = useState<string | null>(null);
  const [photoRatios, setPhotoRatios] = useState<Record<string, number>>({});

  const registerPhotoRatio = useCallback((url: string) => {
    if (!url || photoRatios[url]) return;
    Image.getSize(
      url,
      (width, height) => {
        if (height > 0) {
          setPhotoRatios((current) => ({ ...current, [url]: width / height }));
        }
      },
      () => {}
    );
  }, [photoRatios]);

  useEffect(() => {
    const urls = [
      request.productImageUrl,
      request.memorialPhotoUrl,
      request.referencePhotoUrl,
      request.paymentQrUrl,
      request.paymentProofImageUrl,
      request.completionProofImageUrl,
    ].filter((url): url is string => Boolean(url));
    urls.forEach(registerPhotoRatio);
  }, [request, registerPhotoRatio]);

  const requestIdRef = useRef(request.id);
  const markedSeenRef = useRef(false);
  useEffect(() => {
    const isAwaitingConfirmation =
      String(request.status || "").toLowerCase() === "awaiting_customer_confirmation";
    if (!requesterView || !isAwaitingConfirmation || !request.completionProofImageUrl) return;
    if (markedSeenRef.current) return;
    if (request.completionProofSeenAt) return;
    markedSeenRef.current = true;
    void (async () => {
      const { error: updateError } = await supabase
        .from("funeral_service_requests")
        .update({ completionProofSeenAt: new Date().toISOString() })
        .eq("id", requestIdRef.current)
        .eq("status", "awaiting_customer_confirmation")
        .is("completionProofSeenAt", null);
      if (updateError) {
        console.warn("Failed to mark completion proof seen:", updateError);
        return;
      }
      const { error: notifyError } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("userId", auth.currentUser?.uid || "")
        .eq("type", "funeral_request_completed")
        .eq("data->>requestId", requestIdRef.current);
      if (notifyError) console.warn("Failed to mark notification read:", notifyError);
    })();
  }, [requesterView, request.status, request.completionProofImageUrl, request.completionProofSeenAt]);

  const openPhoneLink = useCallback(async (mode: "call" | "sms", rawPhone: string | null | undefined) => {
    const phone = String(rawPhone || "").trim();
    if (!phone) {
      Alert.alert("Unavailable", mode === "call" ? "No contact number available for calling." : "No contact number available for SMS.");
      return;
    }

    try {
      await Linking.openURL(`${mode === "call" ? "tel" : "sms"}:${phone.replace(/\s+/g, "")}`);
    } catch {
      Alert.alert("Unavailable", mode === "call" ? "Call is not available on this device." : "SMS is not available on this device.");
    }
  }, []);

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
      Alert.alert("Upload Failed", error?.message || "Failed to upload your proof of payment.");
    } finally {
      setUploadingProof(false);
    }
  }, []);

  const pickCompletionProof = useCallback(async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.7,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingCompletionProof(true);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setCompletionProofUrl(url);
    } catch (error: any) {
      Alert.alert("Upload Failed", error?.message || "Failed to upload your completion proof.");
    } finally {
      setUploadingCompletionProof(false);
    }
  }, []);

  const submitRequesterPayment = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || submittingPayment) return;

    const senderName = paymentForm.senderName.trim();
    const gcashName = paymentForm.gcashName.trim();
    const gcashNumber = paymentForm.gcashNumber.trim();
    const referenceNumber = paymentForm.referenceNumber.trim();
    if (!senderName || !gcashName || !gcashNumber) {
      Alert.alert("Incomplete", "Enter the sender name, GCash name, and GCash number.");
      return;
    }
    if (!paymentForm.proofImageUrl) {
      Alert.alert("Proof Required", "Attach a screenshot or photo showing that you paid the shop.");
      return;
    }

    setSubmittingPayment(true);
    try {
      const submittedAt = new Date().toISOString();
      const { data, error } = await supabase
        .from("funeral_service_requests")
        .update({
          status: "payment_submitted",
          paymentPayerName: senderName,
          paymentGcashName: gcashName,
          paymentGcashNumber: gcashNumber,
          paymentReferenceNumber: referenceNumber || null,
          paymentProofImageUrl: paymentForm.proofImageUrl,
          paymentSubmittedAt: submittedAt,
          paymentRejectionReason: null,
          updatedAt: submittedAt,
        })
        .eq("id", request.id)
        .eq("requesterId", user.uid)
        .eq("status", "awaiting_payment")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("This request is no longer awaiting payment. Reopen it to see the latest status.");

      const submittedRequest = data as FuneralServiceRequest;
      setRequest(submittedRequest);
      setPaymentForm(EMPTY_PAYMENT_FORM);
      hapticSuccess();

      try {
        await supabase.from("notifications").insert({
          userId: request.shopId,
          type: "funeral_payment_submitted",
          title: "Payment Submitted",
          body: senderName + " submitted payment proof for " + (request.productName || "a service request") + ". Please verify it.",
          data: { requestId: request.id, requesterId: user.uid },
          read: false,
        });
      } catch (notificationError) {
        console.warn("Failed to create payment notification:", notificationError);
      }

      setPaymentSuccessRequest(submittedRequest);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to submit your payment.");
    } finally {
      setSubmittingPayment(false);
    }
  }, [paymentForm, request, submittingPayment]);

  const beginRequesterEdit = useCallback(() => {
    setEditForm({
      deceasedFullName: String(request.deceasedFullName || ""),
      tributeMessage: String(request.tributeMessage || ""),
      familyCoordinatorName: String(request.familyCoordinatorName || ""),
      wakeAddress: String(request.wakeAddress || ""),
      wakeStartDate: parseDateOnly(request.wakeStartDate),
      wakeEndDate: parseDateOnly(request.wakeEndDate),
      burialTime: parseTimeOnly(request.burialTime),
      pickupAddress: String(request.pickupAddress || ""),
      contactNumber: String(request.contactNumber || ""),
    });
    setEditingRequest(true);
  }, [request]);

  const saveRequesterEdits = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || savingEdit) return;

    const values = {
      deceasedFullName: editForm.deceasedFullName.trim(),
      tributeMessage: editForm.tributeMessage.trim(),
      familyCoordinatorName: editForm.familyCoordinatorName.trim(),
      wakeAddress: editForm.wakeAddress.trim(),
      wakeStartDate: serializeDateOnly(editForm.wakeStartDate),
      wakeEndDate: serializeDateOnly(editForm.wakeEndDate),
      burialTime: serializeTimeOnly(editForm.burialTime),
      pickupAddress: editForm.pickupAddress.trim(),
      contactNumber: editForm.contactNumber.trim(),
    };
    const scheduleIssue = validateServiceSchedule({
      wakeStartDate: editForm.wakeStartDate,
      wakeEndDate: editForm.wakeEndDate,
      burialTime: editForm.burialTime,
      dateOfPassing: request.deceasedDateOfPassing ? new Date(request.deceasedDateOfPassing) : null,
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
    if (Object.values(values).some((value) => !value)) {
      Alert.alert("Incomplete", "Complete all request fields before saving.");
      return;
    }

    setSavingEdit(true);
    try {
      const { data, error } = await supabase
        .from("funeral_service_requests")
        .update({ ...values, updatedAt: new Date().toISOString() })
        .eq("id", request.id)
        .eq("requesterId", user.uid)
        .eq("status", "pending_shop_acceptance")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("This request can no longer be edited because the shop already responded.");

      setRequest(data as FuneralServiceRequest);
      setEditingRequest(false);
      Alert.alert("Saved", "Your request details were updated.");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to update your request.");
    } finally {
      setSavingEdit(false);
    }
  }, [editForm, request.deceasedDateOfPassing, request.id, savingEdit]);

  const cancelRequesterRequest = useCallback(() => {
    const user = auth.currentUser;
    if (!user || updatingRequestId || !isCancellable(request.status)) return;

    Alert.alert("Cancel Request", "Are you sure you want to cancel this service request?", [
      { text: "Keep Request", style: "cancel" },
      {
        text: "Cancel Request",
        style: "destructive",
        onPress: async () => {
          setUpdatingRequestId(request.id);
          try {
            const cancelledAt = new Date().toISOString();
            const { data, error } = await supabase
              .from("funeral_service_requests")
              .update({
                status: "cancelled_by_requester",
                cancelledAt,
                updatedAt: cancelledAt,
              })
              .eq("id", request.id)
              .eq("requesterId", user.uid)
              .in("status", ["pending_shop_acceptance", "accepted_by_shop", "awaiting_payment"])
              .select("*")
              .maybeSingle();
            if (error) throw error;
            if (!data) throw new Error("This request can no longer be cancelled.");
            setRequest(data as FuneralServiceRequest);
            setEditingRequest(false);
            Alert.alert("Cancelled", "Your service request has been cancelled.");
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Failed to cancel your request.");
          } finally {
            setUpdatingRequestId(null);
          }
        },
      },
    ]);
  }, [request, updatingRequestId]);

  const updateRequestStatus = useCallback(
    async (requestItem: FuneralServiceRequest, nextStatus: "accepted_by_shop" | "declined_by_shop") => {
      const user = auth.currentUser;
      if (!user) return;

      setUpdatingRequestId(requestItem.id);
      try {
        let acceptedRequest: FuneralServiceRequest | null = null;
        if (nextStatus === "accepted_by_shop") {
          acceptedRequest = await acceptFuneralServiceRequest(requestItem.id) as unknown as FuneralServiceRequest;
        } else {
          const respondedAt = new Date().toISOString();
          const { error: declineError } = await supabase.from("funeral_service_requests").update({
            status: "declined_by_shop",
            updatedAt: respondedAt,
            shopRespondedAt: respondedAt,
            acceptedAt: null,
            declinedAt: respondedAt,
            handledByShopId: user.uid,
          }).eq("id", requestItem.id).eq("status", "pending_shop_acceptance");
          if (declineError) throw declineError;
        }

        try {
          await supabase.from("notifications").insert({
            userId: requestItem.requesterId,
            type: nextStatus === "accepted_by_shop" ? "funeral_payment_ready" : "funeral_request_updated",
            title: nextStatus === "accepted_by_shop" ? "Request Accepted - Payment Ready" : "Request Declined",
            body:
              nextStatus === "accepted_by_shop"
                ? (requestItem.shopName || "The shop") + " accepted your request. The saved QR code and payment amount are ready in your request."
                : `${requestItem.shopName || "The shop"} declined your service request.`,
            data: {
              requestId: requestItem.id,
              shopId: user.uid,
            },
            read: false,
          });
        } catch (notificationError) {
          console.warn("Failed to create notification:", notificationError);
        }

        setRequest((current) =>
          current?.id === requestItem.id
            ? acceptedRequest || {
                ...current,
                status: nextStatus,
                declinedAt: new Date().toISOString(),
              }
            : current
        );
        Alert.alert(
          "Updated",
          nextStatus === "accepted_by_shop"
            ? "Request accepted. Your saved QR code and amount are now visible to the family."
            : "Request declined."
        );
      } catch (error: any) {
        Alert.alert("Error", error?.message || "Failed to update request.");
      } finally {
        setUpdatingRequestId(null);
      }
    },
    []
  );

  const verifyPayment = useCallback(
    async (requestItem: FuneralServiceRequest) => {
      const user = auth.currentUser;
      if (!user) return;

      setUpdatingRequestId(requestItem.id);
      try {
        const { error: verifyError } = await supabase.from("funeral_service_requests").update({
          status: "payment_verified",
          paymentVerifiedAt: new Date().toISOString(),
          paymentRejectionReason: null,
          updatedAt: new Date().toISOString(),
        }).eq("id", requestItem.id).eq("status", "payment_submitted");
        if (verifyError) throw verifyError;

        setRequest((current) =>
          current?.id === requestItem.id
            ? { ...current, status: "payment_verified", paymentVerifiedAt: new Date().toISOString() }
            : current
        );
        Alert.alert("Verified", "Payment verified. You can now prepare the casket and mark the request as completed once delivered.");

        try {
          await supabase.from("notifications").insert({
            userId: requestItem.requesterId,
            type: "funeral_payment_verified",
            title: "Payment Verified",
            body: `${requestItem.shopName || "The shop"} confirmed your payment for "${requestItem.productName || "your request"}".`,
            data: { requestId: requestItem.id, shopId: user.uid },
            read: false,
          });
        } catch (notificationError) {
          console.warn("Failed to create notification:", notificationError);
        }
      } catch (error: any) {
        Alert.alert("Error", error?.message || "Failed to verify the payment.");
      } finally {
        setUpdatingRequestId(null);
      }
    },
    []
  );

  const openRejectReason = useCallback((requestItem: FuneralServiceRequest) => {
    setRejectReasonRequest(requestItem);
    setRejectReasonText("");
    setRejectReasonVisible(true);
  }, []);

  const closeRejectReason = useCallback(() => {
    if (rejectingPayment) return;
    setRejectReasonVisible(false);
    setRejectReasonRequest(null);
    setRejectReasonText("");
  }, [rejectingPayment]);

  const confirmRejectPayment = useCallback(
    async () => {
      const requestItem = rejectReasonRequest;
      const user = auth.currentUser;
      if (!requestItem || !user || rejectingPayment) return;

      const reason = rejectReasonText.trim();
      if (!reason) {
        Alert.alert("Reason Required", "Tell the family why the payment could not be verified.");
        return;
      }

      setRejectingPayment(true);
      try {
        const { error: rejectError } = await supabase.from("funeral_service_requests").update({
          status: "awaiting_payment",
          paymentVerifiedAt: null,
          paymentRejectionReason: reason,
          updatedAt: new Date().toISOString(),
        }).eq("id", requestItem.id).eq("status", "payment_submitted");
        if (rejectError) throw rejectError;

        setRequest((current) =>
          current?.id === requestItem.id
            ? {
                ...current,
                status: "awaiting_payment",
                paymentPayerName: null,
                paymentGcashName: null,
                paymentGcashNumber: null,
                paymentReferenceNumber: null,
                paymentProofImageUrl: null,
                paymentSubmittedAt: null,
                paymentVerifiedAt: null,
                paymentRejectionReason: reason,
              }
            : current
        );
        setRejectReasonVisible(false);
        setRejectReasonRequest(null);
        setRejectReasonText("");
        Alert.alert("Rejected", "The family will be asked to review and resubmit their payment.");

        try {
          await supabase.from("notifications").insert({
            userId: requestItem.requesterId,
            type: "funeral_payment_rejected",
            title: "Payment Needs Review",
            body: rejectReasonText.trim()
              ? `${requestItem.shopName || "The shop"} could not verify your payment: ${rejectReasonText.trim()}`
              : `${requestItem.shopName || "The shop"} could not verify your payment. Please review and resubmit.`,
            data: { requestId: requestItem.id, shopId: user.uid },
            read: false,
          });
        } catch (notificationError) {
          console.warn("Failed to create notification:", notificationError);
        }
      } catch (error: any) {
        Alert.alert("Error", error?.message || "Failed to reject the payment.");
      } finally {
        setRejectingPayment(false);
      }
    },
    [rejectReasonRequest, rejectReasonText, rejectingPayment]
  );

  const markCompleted = useCallback(
    async (requestItem: FuneralServiceRequest) => {
      const user = auth.currentUser;
      if (!user) return;
      if (!completionProofUrl) {
        Alert.alert("Proof Required", "Attach a completion proof photo before marking this request as completed.");
        return;
      }

      Alert.alert("Mark as Completed", "Attach the completion proof and confirm this request has been delivered? The family will review the photo and confirm the request as done.", [
        { text: "Not Yet", style: "cancel" },
        {
          text: "Mark Completed",
          onPress: async () => {
            hapticMedium();
            setUpdatingRequestId(requestItem.id);
            try {
              const { error: completionError } = await supabase.from("funeral_service_requests").update({
                status: "awaiting_customer_confirmation",
                completionProofImageUrl: completionProofUrl,
                shopMarkedCompletedAt: new Date().toISOString(),
                completedAt: null,
                updatedAt: new Date().toISOString(),
              }).eq("id", requestItem.id).eq("status", "payment_verified");
              if (completionError) throw completionError;

              setRequest((current) =>
                current?.id === requestItem.id
                  ? { ...current, status: "awaiting_customer_confirmation", completionProofImageUrl: completionProofUrl, shopMarkedCompletedAt: new Date().toISOString(), completedAt: null }
                  : current
              );
              setCompletionProofUrl(null);
              Alert.alert("Sent for Confirmation", "The family will now review your completion proof and confirm the request as done.");

              try {
                await supabase.from("notifications").insert({
                  userId: requestItem.requesterId,
                  type: "funeral_request_completed",
                  title: "Review Your Completion",
                  body: `${requestItem.shopName || "The shop"} marked your request as delivered and attached a completion proof. Review it and confirm the request as done.`,
                  data: { requestId: requestItem.id, shopId: user.uid },
                  read: false,
                });
              } catch (notificationError) {
                console.warn("Failed to create notification:", notificationError);
              }
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to mark the request as completed.");
            } finally {
              setUpdatingRequestId(null);
            }
          },
        },
      ]);
    },
    [completionProofUrl]
  );

  const confirmRequestDone = useCallback(
    async (requestItem: FuneralServiceRequest) => {
      const user = auth.currentUser;
      if (!user || updatingRequestId) return;

      Alert.alert("Mark as Done", "Confirm this request has been fully delivered and completed?", [
        { text: "Not Yet", style: "cancel" },
        {
          text: "Mark as Done",
          onPress: async () => {
            hapticMedium();
            setUpdatingRequestId(requestItem.id);
            try {
              const { error: confirmError } = await supabase.from("funeral_service_requests").update({
                status: "completed",
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }).eq("id", requestItem.id)
                .eq("requesterId", user.uid)
                .eq("status", "awaiting_customer_confirmation");
              if (confirmError) throw confirmError;

              setRequest((current) =>
                current?.id === requestItem.id
                  ? { ...current, status: "completed", completedAt: new Date().toISOString() }
                  : current
              );
              Alert.alert("Completed", "Thank you! This request is now marked as done.");

              try {
                await supabase.from("notifications").insert({
                  userId: requestItem.shopId,
                  type: "funeral_request_completed",
                  title: "Request Confirmed Done",
                  body: `The family confirmed the request for "${requestItem.productName || "a service request"}" as done.`,
                  data: { requestId: requestItem.id, requesterId: user.uid },
                  read: false,
                });
              } catch (notificationError) {
                console.warn("Failed to create notification:", notificationError);
              }
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to confirm this request as done.");
            } finally {
              setUpdatingRequestId(null);
            }
          },
        },
      ]);
    },
    [updatingRequestId]
  );

  const statusMeta = getStatusMeta(request.status);

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.requestHeaderSafeArea}>
        <View style={styles.requestHeaderBar}>
          <AppBackButton onPress={() => navigation.goBack()} />
          <View style={styles.requestHeaderHeading}>
            <Text style={styles.requestHeaderEyebrow}>SERVICE REQUEST</Text>
            <Text style={styles.requestHeaderTitle} numberOfLines={1}>Request Details</Text>
          </View>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.screenBody}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.headerEyebrow}>{requesterView ? "My Service Request" : "Service Request"}</Text>
            <Text style={styles.headerTitle}>{request.deceasedFullName}</Text>
            <Text style={styles.headerSubtitle}>{request.requestType === "custom_casket" ? "Custom Casket Request" : request.productName}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
            <Text style={[styles.statusBadgeText, { color: statusMeta.text }]}>{statusMeta.label}</Text>
          </View>
        </View>

        {request.productImageUrl ? (
          <PhotoFrame
            uri={request.productImageUrl}
            ratio={photoRatios[request.productImageUrl]}
            fallbackHeight={170}
            onPress={() => setPhotoViewerUrl(request.productImageUrl!)}
          />
        ) : null}
        {request.memorialPhotoUrl ? (
          <PhotoFrame
            uri={request.memorialPhotoUrl}
            ratio={photoRatios[request.memorialPhotoUrl]}
            fallbackHeight={220}
            onPress={() => setPhotoViewerUrl(request.memorialPhotoUrl!)}
          />
        ) : null}

        <Text style={styles.detailLabel}>Requested Item</Text>
        <Text style={styles.detailValue}>
          {request.productName}
          {request.variationName ? ` (${request.variationName})` : ""}
        </Text>

        {requesterView ? (
          <>
            <Text style={styles.detailSectionTitle}>Shop Information</Text>
            <Text style={styles.detailLabel}>Shop</Text>
            <Text style={styles.detailValue}>{request.shopName || "—"}</Text>
            <Text style={styles.detailLabel}>Shop Contact</Text>
            <Text style={styles.detailValue}>{request.shopContactNumber || "Not available"}</Text>
            {request.shopAddress ? (
              <>
                <Text style={styles.detailLabel}>Shop Address</Text>
                <Text style={styles.detailValue}>{request.shopAddress}</Text>
              </>
            ) : null}
          </>
        ) : null}

        {request.customDesignNotes ? (
          <>
            <Text style={styles.detailLabel}>Custom Design Specifications</Text>
            <Text style={styles.detailValue}>{request.customDesignNotes}</Text>
          </>
        ) : null}

        <Text style={styles.detailSectionTitle}>Deceased Information</Text>

        <Text style={styles.detailLabel}>Full Name of the Deceased</Text>
        <Text style={styles.detailValue}>{request.deceasedFullName}</Text>

        {request.deceasedDateOfBirth ? (
          <>
            <Text style={styles.detailLabel}>Date of Birth</Text>
            <Text style={styles.detailValue}>{formatTimestamp(request.deceasedDateOfBirth)}</Text>
          </>
        ) : null}

        {request.deceasedDateOfPassing ? (
          <>
            <Text style={styles.detailLabel}>Date of Passing</Text>
            <Text style={styles.detailValue}>{formatTimestamp(request.deceasedDateOfPassing)}</Text>
          </>
        ) : null}

        <Text style={styles.detailLabel}>Age at Time of Passing</Text>
        <Text style={styles.detailValue}>{request.deceasedAge ?? "Not provided"}</Text>

        {request.tributeMessage ? (
          <>
            <Text style={styles.detailLabel}>Tribute Message</Text>
            <Text style={styles.detailValue}>{request.tributeMessage}</Text>
          </>
        ) : null}

        <Text style={styles.detailSectionTitle}>Family & Contact Information</Text>

        <Text style={styles.detailLabel}>Family Coordinator</Text>
        <Text style={styles.detailValue}>{request.familyCoordinatorName}</Text>

        <Text style={styles.detailLabel}>Contact Number</Text>
        <Text style={styles.detailValue}>{request.contactNumber}</Text>

        <Text style={styles.detailLabel}>Wake Venue</Text>
        <Text style={styles.detailValue}>{request.wakeAddress || "—"}</Text>

        <Text style={styles.detailSectionTitle}>Wake & Burial Schedule</Text>
        <Text style={styles.detailLabel}>From</Text>
        <Text style={styles.detailValue}>{formatServiceDate(request.wakeStartDate)}</Text>
        <Text style={styles.detailLabel}>To</Text>
        <Text style={styles.detailValue}>{formatServiceDate(request.wakeEndDate)}</Text>
        <Text style={styles.detailLabel}>Burial</Text>
        <Text style={styles.detailValue}>
          {request.wakeEndDate && request.burialTime
            ? `${formatServiceDate(request.wakeEndDate)} at ${formatServiceTime(request.burialTime)}`
            : "Not provided"}
        </Text>

        <Text style={styles.detailLabel}>Pickup Address</Text>
        <Text style={styles.detailValue}>{request.pickupAddress || "—"}</Text>

        <View style={styles.contactActionRow}>
          <TouchableOpacity
            style={[styles.contactActionButton, requesterView && !request.shopContactNumber ? styles.buttonDisabled : null]}
            onPress={() => void openPhoneLink("call", requesterView ? request.shopContactNumber : request.contactNumber)}
            disabled={requesterView && !request.shopContactNumber}
          >
            <Ionicons name="call-outline" size={16} color="#22312d" />
            <Text style={styles.contactActionButtonText}>{requesterView ? "Call Shop" : "Call"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.contactActionButton, requesterView && !request.shopContactNumber ? styles.buttonDisabled : null]}
            onPress={() => void openPhoneLink("sms", requesterView ? request.shopContactNumber : request.contactNumber)}
            disabled={requesterView && !request.shopContactNumber}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={16} color="#22312d" />
            <Text style={styles.contactActionButtonText}>{requesterView ? "SMS Shop" : "SMS"}</Text>
          </TouchableOpacity>
        </View>

        {["awaiting_payment", "payment_submitted", "payment_verified", "awaiting_customer_confirmation", "completed"].includes(String(request.status || "").toLowerCase()) &&
        hasPaymentSetup(request) ? (
          <View style={styles.paymentSection}>
            <Text style={styles.paymentTitle}>{requesterView ? "Pay the Shop" : "Family Payment"}</Text>
            {Number(request.paymentAmount) > 0 ? (
              <Text style={styles.paymentAmountText}>
                {requesterView ? "Amount to send" : "Amount to receive"}: <Text style={styles.paymentAmountStrong}>₱{Number(request.paymentAmount).toLocaleString("en-PH")}</Text>
              </Text>
            ) : null}

            {request.paymentQrUrl ? (
              <PhotoFrame
                uri={request.paymentQrUrl}
                ratio={photoRatios[request.paymentQrUrl]}
                fallbackHeight={200}
                wrapperStyle={styles.photoFrameWhite}
                onPress={() => setPhotoViewerUrl(request.paymentQrUrl!)}
              />
            ) : null}

            {requesterView && String(request.status || "").toLowerCase() === "awaiting_payment" ? (
              <>
                {request.paymentRejectionReason ? (
                  <View style={styles.rejectReasonCard}>
                    <Text style={styles.rejectReasonTitle}>Your previous payment was rejected</Text>
                    <Text style={styles.rejectReasonText}>{request.paymentRejectionReason}</Text>
                  </View>
                ) : null}

                <Text style={styles.detailLabel}>Sender Name *</Text>
                <TextInput
                  style={styles.paymentSetupInput}
                  value={paymentForm.senderName}
                  onChangeText={(value) => setPaymentForm((current) => ({ ...current, senderName: value }))}
                  placeholder="Name used for the payment"
                  placeholderTextColor="#9aa39d"
                />

                <Text style={styles.detailLabel}>GCash Name *</Text>
                <TextInput
                  style={styles.paymentSetupInput}
                  value={paymentForm.gcashName}
                  onChangeText={(value) => setPaymentForm((current) => ({ ...current, gcashName: value }))}
                  placeholder="Name registered to the GCash account"
                  placeholderTextColor="#9aa39d"
                />
                <Text style={styles.detailLabel}>GCash Number *</Text>
                <TextInput
                  style={styles.paymentSetupInput}
                  value={paymentForm.gcashNumber}
                  onChangeText={(value) => setPaymentForm((current) => ({ ...current, gcashNumber: value }))}
                  placeholder="e.g. 09XX XXX XXXX"
                  placeholderTextColor="#9aa39d"
                  keyboardType="phone-pad"
                />

                <Text style={styles.detailLabel}>Reference Number (Optional)</Text>
                <TextInput
                  style={styles.paymentSetupInput}
                  value={paymentForm.referenceNumber}
                  onChangeText={(value) => setPaymentForm((current) => ({ ...current, referenceNumber: value }))}
                  placeholder="Enter it if shown on your receipt"
                  placeholderTextColor="#9aa39d"
                />

                <Text style={styles.detailLabel}>Proof of Payment *</Text>
                {paymentForm.proofImageUrl ? (
                  <>
                    <PhotoFrame
                      uri={paymentForm.proofImageUrl}
                      fallbackHeight={190}
                      onPress={() => setPhotoViewerUrl(paymentForm.proofImageUrl)}
                    />
                    <TouchableOpacity
                      style={styles.removeProofButton}
                      onPress={() => setPaymentForm((current) => ({ ...current, proofImageUrl: null }))}
                    >
                      <Text style={styles.removeProofButtonText}>Remove Proof</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.uploadProofButton}
                    onPress={() => void pickPaymentProof()}
                    disabled={uploadingProof}
                  >
                    {uploadingProof ? <ActivityIndicator size="small" color="#7f6653" /> : <Ionicons name="cloud-upload-outline" size={21} color="#7f6653" />}
                    <Text style={styles.uploadProofButtonText}>{uploadingProof ? "Uploading..." : "Attach Payment Screenshot"}</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.acceptButton, submittingPayment ? styles.buttonDisabled : null]}
                  onPress={() => void submitRequesterPayment()}
                  disabled={submittingPayment || uploadingProof}
                >
                  <Text style={styles.acceptButtonText}>{submittingPayment ? "Submitting..." : "Submit Payment Proof"}</Text>
                </TouchableOpacity>
              </>
            ) : null}

            {requesterView &&
            ["payment_submitted", "payment_verified", "awaiting_customer_confirmation", "completed"].includes(String(request.status || "").toLowerCase()) ? (
              <>
                <Text style={styles.detailLabel}>Sender Name</Text>
                <Text style={styles.detailValue}>{request.paymentPayerName || "—"}</Text>
                <Text style={styles.detailLabel}>GCash Name</Text>
                <Text style={styles.detailValue}>{request.paymentGcashName || "—"}</Text>
                <Text style={styles.detailLabel}>GCash Number</Text>
                <Text style={styles.detailValue}>{request.paymentGcashNumber || "—"}</Text>
                <Text style={styles.detailLabel}>Reference Number</Text>
                <Text style={styles.detailValue}>{request.paymentReferenceNumber || "Not provided"}</Text>
                <Text style={styles.detailLabel}>Submitted Proof</Text>
                {request.paymentProofImageUrl ? (
                  <PhotoFrame
                    uri={request.paymentProofImageUrl}
                    ratio={photoRatios[request.paymentProofImageUrl]}
                    fallbackHeight={190}
                    onPress={() => setPhotoViewerUrl(request.paymentProofImageUrl!)}
                  />
                ) : (
                  <Text style={styles.detailValue}>No proof attached.</Text>
                )}

                {request.completionProofImageUrl ? (
                  <>
                    <Text style={styles.detailLabel}>Completion Proof</Text>
                    <PhotoFrame
                      uri={request.completionProofImageUrl}
                      ratio={photoRatios[request.completionProofImageUrl]}
                      fallbackHeight={190}
                      onPress={() => setPhotoViewerUrl(request.completionProofImageUrl!)}
                    />
                  </>
                ) : null}
              </>
            ) : null}

            {!requesterView && String(request.status || "").toLowerCase() === "payment_submitted" ? (
              <>
                <Text style={styles.detailLabel}>Sender Name</Text>
                <Text style={styles.detailValue}>{request.paymentPayerName || "—"}</Text>

                <Text style={styles.detailLabel}>GCash Name</Text>
                <Text style={styles.detailValue}>{request.paymentGcashName || "—"}</Text>
                <Text style={styles.detailLabel}>GCash Number</Text>
                <Text style={styles.detailValue}>{request.paymentGcashNumber || "—"}</Text>

                <Text style={styles.detailLabel}>Reference Number</Text>
                <Text style={styles.detailValue}>{request.paymentReferenceNumber || "—"}</Text>

                <Text style={styles.detailLabel}>Proof of Payment</Text>
                {request.paymentProofImageUrl ? (
                  <PhotoFrame
                    uri={request.paymentProofImageUrl}
                    ratio={photoRatios[request.paymentProofImageUrl]}
                    fallbackHeight={190}
                    onPress={() => setPhotoViewerUrl(request.paymentProofImageUrl!)}
                  />
                ) : (
                  <Text style={styles.detailValue}>No proof attached.</Text>
                )}

                <View style={styles.actionStack}>
                  <TouchableOpacity
                    style={[styles.acceptButton, updatingRequestId === request.id ? styles.buttonDisabled : null]}
                    onPress={() => void verifyPayment(request)}
                    disabled={updatingRequestId === request.id}
                  >
                    <Text style={styles.acceptButtonText}>{updatingRequestId === request.id ? "Updating..." : "Verify Payment"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.declineButton, updatingRequestId === request.id ? styles.buttonDisabled : null]}
                    onPress={() => void openRejectReason(request)}
                    disabled={updatingRequestId === request.id}
                  >
                    <Text style={styles.declineButtonText}>Reject Payment</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}

            {!requesterView && String(request.status || "").toLowerCase() === "payment_verified" ? (
              <Text style={styles.paymentNote}>Payment confirmed. Prepare the casket and mark the request as completed once delivered.</Text>
            ) : null}

            {!requesterView && String(request.status || "").toLowerCase() === "awaiting_payment" ? (
              <>
                {request.paymentRejectionReason ? (
                  <View style={styles.rejectReasonCard}>
                    <Text style={styles.rejectReasonTitle}>Last submission was rejected</Text>
                    <Text style={styles.rejectReasonText}>{request.paymentRejectionReason}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}

        {requesterView ? (
          <>
            <Text style={styles.detailSectionTitle}>Timeline</Text>
            <Text style={styles.detailLabel}>Submitted</Text>
            <Text style={styles.detailValue}>{formatTimestamp(request.createdAt)}</Text>
            {request.acceptedAt ? (
              <>
                <Text style={styles.detailLabel}>Accepted</Text>
                <Text style={styles.detailValue}>{formatTimestamp(request.acceptedAt)}</Text>
              </>
            ) : null}
            {request.paymentSubmittedAt ? (
              <>
                <Text style={styles.detailLabel}>Payment Submitted</Text>
                <Text style={styles.detailValue}>{formatTimestamp(request.paymentSubmittedAt)}</Text>
              </>
            ) : null}
            {request.paymentVerifiedAt ? (
              <>
                <Text style={styles.detailLabel}>Payment Verified</Text>
                <Text style={styles.detailValue}>{formatTimestamp(request.paymentVerifiedAt)}</Text>
              </>
            ) : null}
            {request.shopMarkedCompletedAt ? (
              <>
                <Text style={styles.detailLabel}>Shop Marked Completed</Text>
                <Text style={styles.detailValue}>{formatTimestamp(request.shopMarkedCompletedAt)}</Text>
              </>
            ) : null}
            {request.completedAt ? (
              <>
                <Text style={styles.detailLabel}>Completed</Text>
                <Text style={styles.detailValue}>{formatTimestamp(request.completedAt)}</Text>
              </>
            ) : null}
            {request.declinedAt ? (
              <>
                <Text style={styles.detailLabel}>Declined</Text>
                <Text style={styles.detailValue}>{formatTimestamp(request.declinedAt)}</Text>
              </>
            ) : null}
            {request.cancelledAt ? (
              <>
                <Text style={styles.detailLabel}>Cancelled</Text>
                <Text style={styles.detailValue}>{formatTimestamp(request.cancelledAt)}</Text>
              </>
            ) : null}

            <View style={styles.readonlyStatusCard}>
              <Text style={styles.readonlyStatusTitle}>Current Update</Text>
              <Text style={styles.readonlyStatusText}>{statusMeta.message}</Text>
            </View>

            {requesterView && String(request.status || "").toLowerCase() === "awaiting_customer_confirmation" ? (
              <View style={styles.actionStack}>
                <TouchableOpacity
                  style={[styles.acceptButton, updatingRequestId === request.id ? styles.buttonDisabled : null]}
                  onPress={() => void confirmRequestDone(request)}
                  disabled={updatingRequestId === request.id}
                >
                  <Text style={styles.acceptButtonText}>{updatingRequestId === request.id ? "Confirming..." : "Mark as Done"}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {String(request.status || "").toLowerCase() === "pending_shop_acceptance" && !editingRequest ? (
              <TouchableOpacity style={styles.editPaymentButton} onPress={beginRequesterEdit}>
                <Text style={styles.editPaymentButtonText}>Edit Request</Text>
              </TouchableOpacity>
            ) : null}

            {editingRequest ? (
              <View style={styles.editRequestCard}>
                <Text style={styles.paymentTitle}>Edit Request</Text>
                <Text style={styles.detailLabel}>Full Name of the Deceased *</Text>
                <TextInput style={styles.paymentSetupInput} value={editForm.deceasedFullName} onChangeText={(value) => setEditForm((current) => ({ ...current, deceasedFullName: value }))} />
                <Text style={styles.detailLabel}>Family Coordinator *</Text>
                <TextInput style={styles.paymentSetupInput} value={editForm.familyCoordinatorName} onChangeText={(value) => setEditForm((current) => ({ ...current, familyCoordinatorName: value }))} />
                <Text style={styles.detailLabel}>Contact Number *</Text>
                <TextInput style={styles.paymentSetupInput} value={editForm.contactNumber} onChangeText={(value) => setEditForm((current) => ({ ...current, contactNumber: value }))} keyboardType="phone-pad" />
                <Text style={styles.detailLabel}>Wake Venue *</Text>
                <TextInput style={[styles.paymentSetupInput, styles.multilineInput]} value={editForm.wakeAddress} onChangeText={(value) => setEditForm((current) => ({ ...current, wakeAddress: value }))} multiline />
                <ServiceRequestScheduleFields
                  wakeStartDate={editForm.wakeStartDate}
                  wakeEndDate={editForm.wakeEndDate}
                  burialTime={editForm.burialTime}
                  onWakeStartDateChange={(value) => setEditForm((current) => ({ ...current, wakeStartDate: value }))}
                  onWakeEndDateChange={(value) => setEditForm((current) => ({ ...current, wakeEndDate: value }))}
                  onBurialTimeChange={(value) => setEditForm((current) => ({ ...current, burialTime: value }))}
                  minimumWakeDate={request.deceasedDateOfPassing ? new Date(request.deceasedDateOfPassing) : null}
                />
                <Text style={styles.detailLabel}>Pickup Address *</Text>
                <TextInput style={[styles.paymentSetupInput, styles.multilineInput]} value={editForm.pickupAddress} onChangeText={(value) => setEditForm((current) => ({ ...current, pickupAddress: value }))} multiline />
                <Text style={styles.detailLabel}>Tribute Message *</Text>
                <TextInput style={[styles.paymentSetupInput, styles.multilineInput]} value={editForm.tributeMessage} onChangeText={(value) => setEditForm((current) => ({ ...current, tributeMessage: value }))} multiline />
                <View style={styles.actionStack}>
                  <TouchableOpacity style={[styles.acceptButton, savingEdit ? styles.buttonDisabled : null]} onPress={() => void saveRequesterEdits()} disabled={savingEdit}>
                    <Text style={styles.acceptButtonText}>{savingEdit ? "Saving..." : "Save Changes"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.closeButton} onPress={() => setEditingRequest(false)} disabled={savingEdit}>
                    <Text style={styles.closeButtonText}>Cancel Editing</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {isCancellable(request.status) ? (
              <TouchableOpacity
                style={[styles.declineButton, updatingRequestId === request.id ? styles.buttonDisabled : null]}
                onPress={cancelRequesterRequest}
                disabled={updatingRequestId === request.id}
              >
                <Text style={styles.declineButtonText}>{updatingRequestId === request.id ? "Cancelling..." : "Cancel Request"}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : String(request.status || "").toLowerCase() === "pending_shop_acceptance" ? (
          <View style={styles.actionStack}>
            <TouchableOpacity
              style={[styles.acceptButton, updatingRequestId === request.id ? styles.buttonDisabled : null]}
              onPress={() => void updateRequestStatus(request, "accepted_by_shop")}
              disabled={updatingRequestId === request.id}
            >
              <Text style={styles.acceptButtonText}>{updatingRequestId === request.id ? "Updating..." : "Accept Request"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.declineButton, updatingRequestId === request.id ? styles.buttonDisabled : null]}
              onPress={() => void updateRequestStatus(request, "declined_by_shop")}
              disabled={updatingRequestId === request.id}
            >
              <Text style={styles.declineButtonText}>Decline Request</Text>
            </TouchableOpacity>
          </View>
        ) : String(request.status || "").toLowerCase() === "accepted_by_shop" ? (
          <View style={styles.readonlyStatusCard}>
            <Text style={styles.readonlyStatusTitle}>Shop Payment Setup Required</Text>
            <Text style={styles.readonlyStatusText}>
              Save the shop QR code and default amount in Shop Center settings. They will be applied automatically to this legacy request.
            </Text>
          </View>
        ) : String(request.status || "").toLowerCase() === "payment_verified" ? (
          <View style={styles.actionStack}>
            <Text style={styles.paymentNote}>
              Payment confirmed. Attach a completion proof photo, then mark the request as delivered. The family will review the proof and confirm the request as done.
            </Text>
            {completionProofUrl ? (
              <>
                <PhotoFrame
                  uri={completionProofUrl}
                  fallbackHeight={190}
                  onPress={() => setPhotoViewerUrl(completionProofUrl)}
                />
                <TouchableOpacity
                  style={styles.removeProofButton}
                  onPress={() => setCompletionProofUrl(null)}
                  disabled={uploadingCompletionProof}
                >
                  <Text style={styles.removeProofButtonText}>Remove Proof</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={styles.uploadProofButton}
                onPress={() => void pickCompletionProof()}
                disabled={uploadingCompletionProof}
              >
                {uploadingCompletionProof ? <ActivityIndicator size="small" color="#7f6653" /> : <Ionicons name="cloud-upload-outline" size={21} color="#7f6653" />}
                <Text style={styles.uploadProofButtonText}>{uploadingCompletionProof ? "Uploading..." : "Attach Completion Proof"}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.acceptButton, updatingRequestId === request.id ? styles.buttonDisabled : null]}
              onPress={() => void markCompleted(request)}
              disabled={updatingRequestId === request.id}
            >
              <Text style={styles.acceptButtonText}>{updatingRequestId === request.id ? "Updating..." : "Mark as Completed"}</Text>
            </TouchableOpacity>
          </View>
        ) : String(request.status || "").toLowerCase() === "awaiting_customer_confirmation" ? (
          <View style={styles.actionStack}>
            <View style={styles.readonlyStatusCard}>
              <Text style={styles.readonlyStatusTitle}>Waiting for Customer Confirmation</Text>
              <Text style={styles.readonlyStatusText}>
                The request has been marked as delivered. The family will review your completion proof and confirm the request as done.
              </Text>
            </View>
            <View style={styles.readReceiptCard}>
              <Text style={styles.readReceiptIcon}>{request.completionProofSeenAt ? "👁️" : "🔔"}</Text>
              <View style={styles.readReceiptTextWrap}>
                <Text style={styles.readReceiptTitle}>
                  {request.completionProofSeenAt ? "Seen by the family" : "Delivered but not yet seen"}
                </Text>
                <Text style={styles.readReceiptSubtitle}>
                  {request.completionProofSeenAt
                    ? `The family opened this request and viewed your completion proof on ${formatTimestamp(request.completionProofSeenAt)}.`
                    : "Once the family opens the request and views your completion proof, you will see the exact time here."}
                </Text>
              </View>
            </View>
            {request.completionProofImageUrl ? (
              <>
                <Text style={styles.detailLabel}>Attached Completion Proof</Text>
                <PhotoFrame
                  uri={request.completionProofImageUrl}
                  ratio={photoRatios[request.completionProofImageUrl]}
                  fallbackHeight={190}
                  onPress={() => setPhotoViewerUrl(request.completionProofImageUrl!)}
                />
              </>
            ) : null}
          </View>
        ) : (
          <View style={styles.readonlyStatusCard}>
            <Text style={styles.readonlyStatusTitle}>Response Recorded</Text>
            <Text style={styles.readonlyStatusText}>
              This request has already been {getStatusMeta(request.status).label.toLowerCase()}.
            </Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={Boolean(paymentSuccessRequest)}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setPaymentSuccessRequest(null)}
      >
        {paymentSuccessRequest ? (
          <View style={styles.paymentSuccessScreen}>
            <StatusBar barStyle="light-content" backgroundColor="#101312" translucent />
            <ScrollView
              style={styles.paymentSuccessScroll}
              contentContainerStyle={styles.paymentSuccessContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={[styles.paymentSuccessHero, { paddingTop: Math.max(40, insets.top + 28) }]}>
                <TouchableOpacity
                  style={[styles.paymentSuccessCloseButton, { top: Math.max(16, insets.top + 8) }]}
                  onPress={() => setPaymentSuccessRequest(null)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Close payment success"
                >
                  <Ionicons name="close" size={24} color="#ffffff" />
                </TouchableOpacity>
                <View style={styles.paymentSuccessBadge}>
                  <Ionicons name="checkmark" size={34} color="#10201b" style={styles.paymentSuccessCheck} />
                </View>
                <Text style={styles.paymentSuccessTitle}>Payment Successful</Text>
                <Text style={styles.paymentSuccessMessage}>
                  Thank you for your payment. Your proof was sent to {paymentSuccessRequest.shopName} and is now being reviewed.
                </Text>
              </View>

              <View style={[styles.paymentSuccessBody, { paddingBottom: Math.max(24, insets.bottom + 16) }]}>
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
                  <View style={styles.paymentSuccessDetailRow}>
                    <Text style={styles.paymentSuccessDetailLabel}>Service Address</Text>
                    <Text style={styles.paymentSuccessDetailValue}>{paymentSuccessRequest.wakeAddress}</Text>
                  </View>
                </View>

                <View style={styles.paymentSuccessDivider} />

                <View style={styles.paymentSuccessItemRow}>
                  {paymentSuccessRequest.productImageUrl ? (
                    <Image source={{ uri: paymentSuccessRequest.productImageUrl }} style={styles.paymentSuccessItemImage} resizeMode="cover" />
                  ) : (
                    <View style={[styles.paymentSuccessItemImage, styles.paymentSuccessItemFallback]}>
                      <Ionicons name="cube-outline" size={25} color="#7a847f" />
                    </View>
                  )}
                  <View style={styles.paymentSuccessItemCopy}>
                    <Text style={styles.paymentSuccessItemName}>{paymentSuccessRequest.productName}</Text>
                    <Text style={styles.paymentSuccessItemMeta}>{paymentSuccessRequest.variationName || "Funeral service"}</Text>
                    <Text style={styles.paymentSuccessItemMeta}>{paymentSuccessRequest.shopName}</Text>
                  </View>
                  <Text style={styles.paymentSuccessItemAmount}>
                    {Number(paymentSuccessRequest.paymentAmount) > 0
                      ? `₱${Number(paymentSuccessRequest.paymentAmount).toLocaleString("en-PH")}`
                      : "—"}
                  </Text>
                </View>

                <View style={styles.paymentSuccessDivider} />

                <View style={styles.paymentSuccessTotalRow}>
                  <Text style={styles.paymentSuccessTotalLabel}>Order Total</Text>
                  <Text style={styles.paymentSuccessTotalValue}>
                    {Number(paymentSuccessRequest.paymentAmount) > 0
                      ? `₱${Number(paymentSuccessRequest.paymentAmount).toLocaleString("en-PH")}`
                      : "—"}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.paymentSuccessTrackButton}
                  activeOpacity={0.88}
                  onPress={() => setPaymentSuccessRequest(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Track your order"
                >
                  <Ionicons name="location-outline" size={19} color="#8d4aac" />
                  <Text style={styles.paymentSuccessTrackText}>Track your order</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        ) : null}
      </Modal>

      <Modal visible={rejectReasonVisible} transparent animationType="fade" onRequestClose={closeRejectReason}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeRejectReason}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            {rejectReasonRequest ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalTitle}>Reject Payment</Text>
                <Text style={styles.modalSubtitle}>
                  The family will be asked to review and resubmit. Optionally tell them why their proof was not accepted.
                </Text>

                <Text style={styles.detailLabel}>Reason *</Text>
                <TextInput
                  style={[styles.paymentSetupInput, styles.paymentSetupReasonInput]}
                  value={rejectReasonText}
                  onChangeText={setRejectReasonText}
                  placeholder="e.g. Blurry screenshot, wrong reference number"
                  placeholderTextColor="#9aa39d"
                  multiline
                />

                <View style={styles.actionStack}>
                  <TouchableOpacity
                    style={[styles.declineButton, rejectingPayment ? styles.buttonDisabled : null]}
                    onPress={() => void confirmRejectPayment()}
                    disabled={rejectingPayment}
                  >
                    <Text style={styles.declineButtonText}>{rejectingPayment ? "Rejecting..." : "Reject Payment"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.closeButton} onPress={closeRejectReason} disabled={rejectingPayment}>
                    <Text style={styles.closeButtonText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={Boolean(photoViewerUrl)} transparent animationType="fade" onRequestClose={() => setPhotoViewerUrl(null)}>
        <View style={styles.photoViewerOverlay}>
          <TouchableOpacity style={styles.photoViewerClose} onPress={() => setPhotoViewerUrl(null)}>
            <Ionicons name="close" size={26} color="#ffffff" />
          </TouchableOpacity>
          {photoViewerUrl ? (
            <Image source={{ uri: photoViewerUrl }} style={styles.photoViewerImage} resizeMode="contain" />
          ) : null}
        </View>
      </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef1ec",
  },
  screenBody: {
    flex: 1,
    backgroundColor: "#eef1ec",
  },
  requestHeaderSafeArea: {
    backgroundColor: "#f8f6f2",
  },
  requestHeaderBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#d9d6cd",
    gap: 12,
  },
  requestHeaderHeading: {
    flex: 1,
  },
  requestHeaderEyebrow: {
    color: "#8b7255",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  requestHeaderTitle: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 3,
  },
  content: {
    padding: 18,
    paddingBottom: 40,
    gap: 14,
  },
  headerCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#f8f6f2",
    padding: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  headerTextBlock: {
    flex: 1,
  },
  headerEyebrow: {
    color: "#8b7255",
    fontSize: 12,
    fontWeight: "800",
  },
  headerTitle: {
    color: "#22312d",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 4,
  },
  headerSubtitle: {
    color: "#8b7255",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "900",
  },
  photoFrame: {
    width: "100%",
    borderRadius: 16,
    backgroundColor: "#f0ede5",
    borderWidth: 1,
    borderColor: "#e6e3da",
    marginBottom: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  photoFrameNatural: {
    height: undefined,
  },
  photoFrameWhite: {
    backgroundColor: "#ffffff",
  },
  photoImage: {
    width: "100%",
  },
  photoViewerOverlay: {
    flex: 1,
    backgroundColor: "rgba(12, 10, 8, 0.94)",
    justifyContent: "center",
    alignItems: "center",
  },
  photoViewerClose: {
    position: "absolute",
    top: 54,
    right: 20,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoViewerImage: {
    width: "100%",
    height: "100%",
  },
  detailSectionTitle: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 18,
    marginBottom: 2,
  },
  detailLabel: {
    color: "#53615d",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 10,
    marginBottom: 4,
  },
  detailValue: {
    color: "#22312d",
    fontSize: 14,
    lineHeight: 20,
  },
  actionStack: {
    gap: 10,
    marginTop: 18,
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
  contactActionButtonText: {
    color: "#22312d",
    fontSize: 13,
    fontWeight: "900",
  },
  acceptButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  declineButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
    justifyContent: "center",
  },
  declineButtonText: {
    color: "#991b1b",
    fontSize: 14,
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  readonlyStatusCard: {
    marginTop: 18,
    borderRadius: 16,
    backgroundColor: "#ece9e3",
    padding: 14,
  },
  readonlyStatusTitle: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "900",
  },
  readonlyStatusText: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  readReceiptCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#fbfaf7",
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  readReceiptIcon: {
    fontSize: 20,
    marginRight: 10,
    marginTop: 1,
  },
  readReceiptTextWrap: {
    flex: 1,
  },
  readReceiptTitle: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "900",
  },
  readReceiptSubtitle: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    padding: 16,
  },
  paymentTitle: {
    color: "#22312d",
    fontSize: 17,
    fontWeight: "900",
  },
  paymentAmountText: {
    color: "#62706b",
    fontSize: 14,
    marginTop: 8,
  },
  paymentAmountStrong: {
    color: "#22312d",
    fontWeight: "900",
  },
  paymentNote: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
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
  editPaymentButton: {
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#22312d",
    backgroundColor: "#fbfaf7",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  editPaymentButtonText: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "900",
  },
  paymentSetupQrEmpty: {
    minHeight: 160,
    borderRadius: 16,
    backgroundColor: "#ece9e3",
    borderWidth: 1,
    borderColor: "#e6e3da",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  paymentSetupQrEmptyText: {
    color: "#8a948f",
    fontSize: 13,
    fontWeight: "800",
  },
  paymentSetupClearButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  paymentSetupClearButtonText: {
    color: "#991b1b",
    fontSize: 13,
    fontWeight: "900",
  },
  paymentSetupInput: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d2d7d1",
    backgroundColor: "#fcfcfb",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#22312d",
    fontSize: 14,
    marginTop: 6,
  },
  paymentSetupReasonInput: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  editRequestCard: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    padding: 16,
  },
  uploadProofButton: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#bba995",
    backgroundColor: "#fbfaf7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 6,
    marginBottom: 14,
  },
  uploadProofButtonText: {
    color: "#7f6653",
    fontSize: 13,
    fontWeight: "900",
  },
  removeProofButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -8,
    marginBottom: 12,
  },
  removeProofButtonText: {
    color: "#991b1b",
    fontSize: 13,
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
    minHeight: 250,
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 32,
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
    borderRadius: 20,
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
    marginBottom: 28,
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
    marginTop: "auto",
  },
  paymentSuccessTrackText: {
    color: "#8d4aac",
    fontSize: 14,
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
    maxHeight: "86%",
    borderRadius: 24,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 18,
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
});
