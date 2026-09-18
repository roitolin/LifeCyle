import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  type DimensionValue,
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
import { useFocusEffect } from "@react-navigation/native";
import { AppBackButton } from "@/components";
import DeathCertificateRequestCard from "@/components/DeathCertificateRequestCard";
import ServiceXenditSheet from "@/components/ServiceXenditSheet";
import { supabase } from "@/services/supabaseClient";
import { auth, uploadCertificate } from "@/services";
import { acceptFuneralServiceRequest } from '@/utils/serviceRequestFlow';
import { hapticMedium, hapticSuccess } from "@/utils/haptics";
import {
  paymentSubmissionErrorMessage,
  validatePaymentSubmission,
} from '@/utils/paymentValidation';
import {
  createServiceRefund,
  getLatestServiceRefund,
  refundStatusCopy,
  updateServiceRefund,
  type ServiceRefundRequest,
} from '@/utils/serviceRefunds';
import {
  EMPTY_SERVICE_PREPARATION_CHECKLIST,
  getServicePreparationChecklist,
  saveServicePreparationChecklist,
  type ServicePreparationChecklist,
} from '@/utils/servicePreparationChecklist';
import { formatServiceDate, formatServiceTime } from "@/utils/serviceRequestSchedule";

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
  packageItems?: string[] | null;
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
  churchName?: string | null;
  cemeteryName?: string | null;
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
  paymentProvider?: "manual" | "paymongo" | "xendit";
  providerPaymentMethod?: string | null;
  paymentPayerName?: string | null;
  paymentGcashName?: string | null;
  paymentGcashNumber?: string | null;
  paymentReferenceNumber?: string | null;
  paymentProofImageUrl?: string | null;
  paymentSubmittedAt?: any;
  paymentVerifiedAt?: any;
  paymentRejectionReason?: string | null;
  payoutId?: string | null;
  payoutStatus?: string | null;
  payoutAmount?: number | null;
  payoutCompletedAt?: any;
  payoutFailureCode?: string | null;
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
  Number(request.paymentAmount) > 0;

const getStatusMeta = (status: string) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "accepted_by_shop") {
    return {
      label: "Accepted",
      background: "#e7f5ec",
      text: "#166534",
      icon: "checkmark-circle-outline" as IoniconName,
      message: "The shop accepted this request and is preparing its payment details.",
      shopMessage: "You accepted this request. The secure casket checkout will use its saved order price.",
    };
  }
  if (normalized === "awaiting_payment") {
    return {
      label: "Awaiting Payment",
      background: "#e0eefa",
      text: "#1c4f7e",
      icon: "wallet-outline" as IoniconName,
      message: "Open the secure Xendit test checkout to pay for the selected casket.",
      shopMessage: "The Xendit checkout is ready. Waiting for the family to complete payment.",
    };
  }
  if (normalized === "payment_submitted") {
    return {
      label: "Payment Submitted",
      background: "#e0eefa",
      text: "#1c4f7e",
      icon: "receipt-outline" as IoniconName,
      message: "Your payment proof is being reviewed by the shop.",
      shopMessage: "Payment proof is ready for review. Verify its details before accepting it.",
    };
  }
  if (normalized === "paid_waiting_for_split") {
    return {
      label: "Processing Payout",
      background: "#fef3c7",
      text: "#86654a",
      icon: "wallet-outline" as IoniconName,
      message: "Payment received. The order is confirmed and the 70% shop payout is processing.",
      shopMessage: "Payment received. 70% payout to your registered account is processing.",
    };
  }
  if (normalized === "commission_failed") {
    return {
      label: "Payout Review",
      background: "#fde8e8",
      text: "#991b1b",
      icon: "warning-outline" as IoniconName,
      message: "Payment was received, but the shop payout needs administrator review.",
      shopMessage: "Payment was received, but the 70% payout encountered an issue. An administrator will review.",
    };
  }
  if (normalized === "payment_verified") {
    return {
      label: "Payment Confirmed",
      background: "#e7f5ec",
      text: "#166534",
      icon: "shield-checkmark-outline" as IoniconName,
      message: "The shop confirmed your payment and is preparing the service.",
      shopMessage: "Payment is verified. Complete the service and attach delivery proof when it is ready.",
    };
  }
  if (normalized === "awaiting_customer_confirmation") {
    return {
      label: "Awaiting Confirmation",
      background: "#fef3c7",
      text: "#86654a",
      icon: "hourglass-outline" as IoniconName,
      message: "The shop has delivered and attached a completion proof. Review the photo and mark the request as done.",
      shopMessage: "Delivery proof was submitted. Waiting for the family to confirm completion.",
    };
  }
  if (normalized === "completed") {
    return {
      label: "Completed",
      background: "#14532d",
      text: "#ffffff",
      icon: "checkmark-done-circle-outline" as IoniconName,
      message: "This service request has been completed.",
      shopMessage: "The family confirmed that this service request is complete.",
    };
  }
  if (normalized === "declined_by_shop") {
    return {
      label: "Declined",
      background: "#fde8e8",
      text: "#991b1b",
      icon: "close-circle-outline" as IoniconName,
      message: "The shop declined this service request.",
      shopMessage: "This request was declined and no further action is needed.",
    };
  }
  if (normalized === "cancelled_by_requester") {
    return {
      label: "Cancelled",
      background: "#eef1ec",
      text: "#4c5b57",
      icon: "ban-outline" as IoniconName,
      message: "You cancelled this service request.",
      shopMessage: "The family cancelled this service request.",
    };
  }
  return {
    label: "Waiting for Shop",
    background: "#fef3c7",
    text: "#86654a",
    icon: "time-outline" as IoniconName,
    message: "The request is waiting for the shop to accept or decline it.",
    shopMessage: "This new request is waiting for your review.",
  };
};

const formatTimestamp = (value: any) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString(undefined, { hour12: true });
};

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const formatCurrency = (value: number | string | null | undefined) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? "\u20B1" + amount.toLocaleString("en-PH")
    : "Not set";
};

function DetailCard({
  icon,
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  icon: IoniconName;
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.detailCard}>
      <TouchableOpacity
        style={[styles.detailCardHeader, open ? styles.detailCardHeaderOpen : null]}
        onPress={() => setOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Hide" : "Show"} ${title}`}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.detailCardIcon}>
          <Ionicons name={icon} size={19} color="#846a4f" />
        </View>
        <View style={styles.detailCardHeading}>
          <Text style={styles.detailCardTitle}>{title}</Text>
          {subtitle ? <Text style={styles.detailCardSubtitle}>{subtitle}</Text> : null}
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={19} color="#6f7b76" />
      </TouchableOpacity>
      {open ? <View style={styles.detailCardBody}>{children}</View> : null}
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  emphasize = false,
}: {
  icon: IoniconName;
  label: string;
  value: ReactNode;
  emphasize?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color="#7c8a84" style={styles.infoRowIcon} />
      <View style={styles.infoRowCopy}>
        <Text style={styles.infoRowLabel}>{label}</Text>
        <Text style={[styles.infoRowValue, emphasize ? styles.infoRowValueStrong : null]}>{value}</Text>
      </View>
    </View>
  );
}

function TimelineItem({
  label,
  value,
  active,
  last,
}: {
  label: string;
  value: string;
  active?: boolean;
  last?: boolean;
}) {
  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineRail}>
        <View style={[styles.timelineDot, active ? styles.timelineDotActive : null]}>
          <Ionicons name={active ? "checkmark" : "ellipse"} size={active ? 12 : 6} color="#ffffff" />
        </View>
        {!last ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={styles.timelineCopy}>
        <Text style={styles.timelineLabel}>{label}</Text>
        <Text style={styles.timelineValue}>{value}</Text>
      </View>
    </View>
  );
}

const REQUEST_PROGRESS_STAGES: { label: string; icon: IoniconName }[] = [
  { label: "Request", icon: "document-text-outline" },
  { label: "Accepted", icon: "hand-left-outline" },
  { label: "Payment", icon: "wallet-outline" },
  { label: "Delivery", icon: "car-outline" },
  { label: "Complete", icon: "checkmark-done-outline" },
];

const getRequestProgressIndex = (status: string) => {
  switch (String(status || "").toLowerCase()) {
    case "accepted_by_shop":
      return 1;
    case "awaiting_payment":
    case "payment_submitted":
      return 2;
    case "paid_waiting_for_split":
    case "payment_verified":
    case "awaiting_customer_confirmation":
      return 3;
    case "completed":
      return 4;
    default:
      return 0;
  }
};

function RequestProgressStepper({ status }: { status: string }) {
  const normalized = String(status || "").toLowerCase();
  const stopped = ["declined_by_shop", "cancelled_by_requester"].includes(normalized);
  const activeIndex = getRequestProgressIndex(normalized);

  return (
    <View style={styles.progressCard}>
      <View style={styles.progressHeader}>
        <View>
          <Text style={styles.progressTitle}>Current stage</Text>
        </View>
        <View style={styles.progressCountBadge}>
          <Text style={styles.progressCountText}>
            {stopped ? "Closed" : "Step " + (activeIndex + 1) + " of " + REQUEST_PROGRESS_STAGES.length}
          </Text>
        </View>
      </View>
      <View style={styles.progressStages}>
        {REQUEST_PROGRESS_STAGES.map((stage, index) => {
          const completed = !stopped && (index < activeIndex || normalized === "completed");
          const current = !stopped && index === activeIndex && normalized !== "completed";
          return (
            <View style={styles.progressStage} key={stage.label}>
              {index < REQUEST_PROGRESS_STAGES.length - 1 ? (
                <View style={[styles.progressConnector, completed ? styles.progressConnectorActive : null]} />
              ) : null}
              <View
                style={[
                  styles.progressNode,
                  completed ? styles.progressNodeComplete : null,
                  current ? styles.progressNodeCurrent : null,
                  stopped && index === 0 ? styles.progressNodeStopped : null,
                ]}
              >
                <Ionicons
                  name={completed ? "checkmark" : stopped && index === 0 ? "close" : stage.icon}
                  size={completed ? 15 : 14}
                  color={completed || current || (stopped && index === 0) ? "#ffffff" : "#929c98"}
                />
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.progressStageLabel,
                  completed || current ? styles.progressStageLabelActive : null,
                ]}
              >
                {stage.label}
              </Text>
            </View>
          );
        })}
      </View>
      {stopped ? (
        <View style={styles.progressStoppedNotice}>
          <Ionicons name="information-circle-outline" size={17} color="#9b403b" />
          <Text style={styles.progressStoppedText}>
            This request journey ended before completion.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

type PreparationChecklistKey = keyof ServicePreparationChecklist;

const SHOP_PREPARATION_ITEMS: {
  key: PreparationChecklistKey;
  label: string;
  description: string;
  icon: IoniconName;
}[] = [
  {
    key: "details_confirmed",
    label: "Confirm service details",
    description: "Review the selected item, variation, and memorial information.",
    icon: "reader-outline",
  },
  {
    key: "family_contacted",
    label: "Contact the family",
    description: "Confirm the coordinator's contact number and availability.",
    icon: "call-outline",
  },
  {
    key: "item_prepared",
    label: "Prepare requested item",
    description: "Prepare the casket or custom design requested by the family.",
    icon: "construct-outline",
  },
  {
    key: "schedule_confirmed",
    label: "Confirm the schedule",
    description: "Double-check wake dates, burial time, and pickup address.",
    icon: "calendar-outline",
  },
  {
    key: "delivery_scheduled",
    label: "Schedule delivery",
    description: "Assign the final delivery or service fulfilment schedule.",
    icon: "car-outline",
  },
];

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
  const focusPaymentOnOpen = Boolean(route.params?.focusPayment);
  const [request, setRequest] = useState<FuneralServiceRequest>(initialRequest);
  const isRequestOwner = requesterView && request.requesterId === auth.currentUser?.uid;
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);

  const [paymentForm, setPaymentForm] = useState<PaymentSubmissionForm>(EMPTY_PAYMENT_FORM);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentExpanded, setPaymentExpanded] = useState(
    focusPaymentOnOpen ||
      ["awaiting_payment", "payment_submitted"].includes(String(initialRequest.status || "").toLowerCase())
  );
  const [paymentSuccessRequest, setPaymentSuccessRequest] = useState<FuneralServiceRequest | null>(null);
  const [xenditVisible, setXenditVisible] = useState(false);
  const [completionProofUrl, setCompletionProofUrl] = useState<string | null>(initialRequest.completionProofImageUrl || null);
  const [uploadingCompletionProof, setUploadingCompletionProof] = useState(false);
  const [rejectReasonVisible, setRejectReasonVisible] = useState(false);
  const [rejectReasonRequest, setRejectReasonRequest] = useState<FuneralServiceRequest | null>(null);
  const [rejectReasonText, setRejectReasonText] = useState("");
  const [rejectingPayment, setRejectingPayment] = useState(false);
  const [refundRequest, setRefundRequest] = useState<ServiceRefundRequest | null>(null);
  const [refundLoading, setRefundLoading] = useState(true);
  const [refundDialog, setRefundDialog] = useState<'request' | 'reject' | 'refunded' | null>(null);
  const [refundDialogText, setRefundDialogText] = useState('');
  const [refundUpdating, setRefundUpdating] = useState(false);
  const [shopChecklist, setShopChecklist] = useState<ServicePreparationChecklist>({
    ...EMPTY_SERVICE_PREPARATION_CHECKLIST,
  });
  const [checklistLoading, setChecklistLoading] = useState(!requesterView);
  const [checklistSavingKey, setChecklistSavingKey] = useState<PreparationChecklistKey | null>(null);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const paymentSectionY = useRef(0);
  const paymentFocusHandledRef = useRef(false);
  const refundSectionY = useRef(0);
  const actionSectionY = useRef(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const { data, error } = await supabase
          .from("funeral_service_requests")
          .select("*")
          .eq("id", request.id)
          .maybeSingle();
        if (!active || error || !data) return;
        const latest = data as FuneralServiceRequest;
        setRequest(latest);
        setCompletionProofUrl(latest.completionProofImageUrl || null);
      })();
      return () => {
        active = false;
      };
    }, [request.id])
  );

  const scrollToSection = useCallback((position: number) => {
    scrollViewRef.current?.scrollTo({ y: Math.max(0, position - 12), animated: true });
  }, []);

  const loadRefundRequest = useCallback(async () => {
    try {
      setRefundRequest(await getLatestServiceRefund(request.id));
    } catch (error) {
      console.warn('Unable to load the refund request:', error);
    } finally {
      setRefundLoading(false);
    }
  }, [request.id]);

  useEffect(() => {
    void loadRefundRequest();
  }, [loadRefundRequest]);

  const loadShopChecklist = useCallback(async () => {
    if (requesterView) {
      setChecklistLoading(false);
      return;
    }
    setChecklistLoading(true);
    setChecklistError(null);
    try {
      setShopChecklist(await getServicePreparationChecklist(request.id));
    } catch (error: any) {
      console.warn('Unable to load the shop preparation checklist:', error);
      setChecklistError(error?.message || 'Unable to load the preparation checklist.');
    } finally {
      setChecklistLoading(false);
    }
  }, [request.id, requesterView]);

  useEffect(() => {
    void loadShopChecklist();
  }, [loadShopChecklist]);

  const toggleShopChecklistItem = useCallback(
    async (key: PreparationChecklistKey) => {
      if (requesterView || checklistSavingKey) return;
      const previous = shopChecklist;
      const next = { ...previous, [key]: !previous[key] };
      setShopChecklist(next);
      setChecklistSavingKey(key);
      setChecklistError(null);
      hapticMedium();
      try {
        setShopChecklist(await saveServicePreparationChecklist(request.id, request.shopId, next));
      } catch (error: any) {
        setShopChecklist(previous);
        setChecklistError(error?.message || 'Unable to save the preparation checklist.');
        Alert.alert(
          'Checklist Not Saved',
          error?.message || 'Unable to save this checklist item. Please try again.'
        );
      } finally {
        setChecklistSavingKey(null);
      }
    },
    [checklistSavingKey, request.id, request.shopId, requesterView, shopChecklist]
  );

  const openRefundDialog = useCallback((mode: 'request' | 'reject' | 'refunded') => {
    setRefundDialogText('');
    setRefundDialog(mode);
  }, []);

  const closeRefundDialog = useCallback(() => {
    if (refundUpdating) return;
    setRefundDialog(null);
    setRefundDialogText('');
  }, [refundUpdating]);

  const submitRefundDialog = useCallback(async () => {
    const user = auth.currentUser;
    const text = refundDialogText.trim();
    if (!user || !refundDialog || refundUpdating) return;

    if ((refundDialog === 'request' || refundDialog === 'reject') && text.length < 10) {
      Alert.alert('More Detail Needed', 'Please enter at least 10 characters.');
      return;
    }
    if (refundDialog === 'refunded' && text.replace(/[^A-Za-z0-9]/g, '').length < 6) {
      Alert.alert('Reference Required', 'Enter the transaction reference for the refund you sent.');
      return;
    }

    setRefundUpdating(true);
    try {
      const updated = refundDialog === 'request'
        ? await createServiceRefund(request.id, user.uid, request.shopId, text)
        : refundDialog === 'reject' && refundRequest
          ? await updateServiceRefund(refundRequest.id, 'rejected', { responseNote: text })
          : refundRequest
            ? await updateServiceRefund(refundRequest.id, 'refunded', { refundReference: text })
            : null;
      if (!updated) throw new Error('The refund request is no longer available.');
      setRefundRequest(updated);
      setRefundDialog(null);
      setRefundDialogText('');
      hapticSuccess();
      Alert.alert(
        refundDialog === 'request' ? 'Refund Requested' : refundDialog === 'reject' ? 'Request Rejected' : 'Refund Recorded',
        refundDialog === 'request'
          ? 'The shop has been notified. You can track the decision on this screen.'
          : refundDialog === 'reject'
            ? 'The family can now review your explanation.'
            : 'The family can now see that the refund was sent.'
      );
    } catch (error: any) {
      Alert.alert('Refund Update Failed', error?.message || 'Unable to update this refund request.');
    } finally {
      setRefundUpdating(false);
    }
  }, [refundDialog, refundDialogText, refundRequest, refundUpdating, request.id, request.shopId]);

  const approveRefund = useCallback(() => {
    if (!refundRequest || refundUpdating) return;
    Alert.alert('Approve Refund', 'Approve this request? Record the refund reference after you send the money.', [
      { text: 'Not Yet', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          setRefundUpdating(true);
          try {
            const updated = await updateServiceRefund(refundRequest.id, 'approved');
            setRefundRequest(updated);
            hapticSuccess();
          } catch (error: any) {
            Alert.alert('Refund Update Failed', error?.message || 'Unable to approve this request.');
          } finally {
            setRefundUpdating(false);
          }
        },
      },
    ]);
  }, [refundRequest, refundUpdating]);

  const cancelRefund = useCallback(() => {
    if (!refundRequest || refundUpdating) return;
    Alert.alert('Cancel Refund Request', 'Withdraw this pending refund request?', [
      { text: 'Keep Request', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          setRefundUpdating(true);
          try {
            const updated = await updateServiceRefund(refundRequest.id, 'cancelled');
            setRefundRequest(updated);
          } catch (error: any) {
            Alert.alert('Refund Update Failed', error?.message || 'Unable to withdraw this request.');
          } finally {
            setRefundUpdating(false);
          }
        },
      },
    ]);
  }, [refundRequest, refundUpdating]);

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
    if (!isRequestOwner || !isAwaitingConfirmation || !request.completionProofImageUrl) return;
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
  }, [isRequestOwner, request.status, request.completionProofImageUrl, request.completionProofSeenAt]);

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

    const validation = validatePaymentSubmission(paymentForm);
    if (!validation.value) {
      Alert.alert('Check Payment Details', validation.message || 'Complete all required payment fields.');
      return;
    }
    const { senderName, gcashName, gcashNumber, referenceNumber, proofImageUrl } = validation.value;

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
          paymentReferenceNumber: referenceNumber,
          paymentProofImageUrl: proofImageUrl,
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
      Alert.alert('Payment Not Submitted', paymentSubmissionErrorMessage(error));
    } finally {
      setSubmittingPayment(false);
    }
  }, [paymentForm, request, submittingPayment]);

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
  const normalizedRequestStatus = String(request.status || '').toLowerCase();
  const shopHasFamilyPayment =
    !requesterView &&
    Boolean(request.paymentSubmittedAt || request.paymentPayerName || request.paymentProofImageUrl) &&
    ["payment_submitted", "payment_verified", "awaiting_customer_confirmation", "completed"].includes(
      normalizedRequestStatus
    );
  const paymentSectionVisible =
    ["awaiting_payment", "payment_submitted", "payment_verified", "awaiting_customer_confirmation", "completed"].includes(
      normalizedRequestStatus
    ) && hasPaymentSetup(request);
  const refundEligible = [
    'payment_submitted',
    'payment_verified',
    'awaiting_customer_confirmation',
    'completed',
  ].includes(normalizedRequestStatus);
  const refundMeta = refundRequest ? refundStatusCopy(refundRequest.status) : null;
  const canCreateRefund =
    isRequestOwner &&
    refundEligible &&
    (!refundRequest || ['rejected', 'cancelled'].includes(refundRequest.status));
  const currentStatusMessage = requesterView ? statusMeta.message : statusMeta.shopMessage;
  const timelineEvents: { label: string; value: string }[] = [
    { label: "Request submitted", value: formatTimestamp(request.createdAt) },
  ];
  if (request.acceptedAt) timelineEvents.push({ label: "Accepted by shop", value: formatTimestamp(request.acceptedAt) });
  if (request.paymentSubmittedAt) timelineEvents.push({ label: "Payment submitted", value: formatTimestamp(request.paymentSubmittedAt) });
  if (request.paymentVerifiedAt) timelineEvents.push({ label: "Payment verified", value: formatTimestamp(request.paymentVerifiedAt) });
  if (request.shopMarkedCompletedAt) timelineEvents.push({ label: "Marked delivered", value: formatTimestamp(request.shopMarkedCompletedAt) });
  if (request.completedAt) timelineEvents.push({ label: "Request completed", value: formatTimestamp(request.completedAt) });
  if (request.declinedAt) timelineEvents.push({ label: "Request declined", value: formatTimestamp(request.declinedAt) });
  if (request.cancelledAt) timelineEvents.push({ label: "Request cancelled", value: formatTimestamp(request.cancelledAt) });
  const checklistCompletedCount = SHOP_PREPARATION_ITEMS.filter(
    (item) => shopChecklist[item.key]
  ).length;
  const checklistLocked = ["completed", "declined_by_shop", "cancelled_by_requester"].includes(
    normalizedRequestStatus
  );
  const requestClosed = ["completed", "declined_by_shop", "cancelled_by_requester"].includes(
    normalizedRequestStatus
  );
  const shopFamilyContactReady = Boolean(request.familyCoordinatorName && request.contactNumber);
  const shopScheduleReady = Boolean(request.wakeStartDate && request.wakeEndDate && request.burialTime);
  let stickyAction: {
    context: string;
    label: string;
    helper: string;
    icon: IoniconName;
    disabled?: boolean;
    onPress: () => void;
  } | null = null;

  if (requesterView && !isRequestOwner) {
    stickyAction = null;
  } else if (isRequestOwner) {
    if (refundRequest?.status === "pending") {
      stickyAction = {
        context: "Refund status",
        label: "Waiting for shop review",
        helper: "No action is needed while the shop reviews your request.",
        icon: "hourglass-outline",
        disabled: true,
        onPress: () => undefined,
      };
    } else if (normalizedRequestStatus === "pending_shop_acceptance") {
      stickyAction = null;
    } else if (normalizedRequestStatus === "accepted_by_shop") {
      stickyAction = {
        context: "Next update",
        label: "Payment setup in progress",
        helper: "The shop is preparing its payment instructions.",
        icon: "hourglass-outline",
        disabled: true,
        onPress: () => undefined,
      };
    } else if (normalizedRequestStatus === "awaiting_payment") {
      stickyAction = {
        context: "Next action",
        label: "Complete payment",
        helper: "Use the shop QR and submit your receipt.",
        icon: "wallet-outline",
        onPress: () => scrollToSection(paymentSectionY.current),
      };
    } else if (normalizedRequestStatus === "payment_submitted") {
      stickyAction = {
        context: "Payment status",
        label: "Waiting for verification",
        helper: "The shop is reviewing your submitted receipt.",
        icon: "receipt-outline",
        disabled: true,
        onPress: () => undefined,
      };
    } else if (normalizedRequestStatus === "paid_waiting_for_split") {
      stickyAction = {
        context: "Payment status",
        label: "Processing payout",
        helper: "Payment confirmed. Preparing your service.",
        icon: "wallet-outline",
        disabled: true,
        onPress: () => undefined,
      };
    } else if (normalizedRequestStatus === "commission_failed") {
      stickyAction = {
        context: "Payment status",
        label: "Payout review required",
        helper: "Administrator is reviewing the payout.",
        icon: "warning-outline",
        disabled: true,
        onPress: () => undefined,
      };
    } else if (normalizedRequestStatus === "payment_verified") {
      stickyAction = {
        context: "Next update",
        label: "Service is being prepared",
        helper: "The shop will upload delivery proof when ready.",
        icon: "construct-outline",
        disabled: true,
        onPress: () => undefined,
      };
    } else if (normalizedRequestStatus === "awaiting_customer_confirmation") {
      stickyAction = {
        context: "Next action",
        label: "Confirm service completion",
        helper: "Review the delivery proof before confirming.",
        icon: "checkmark-done-outline",
        onPress: () => void confirmRequestDone(request),
      };
    }
  } else if (refundRequest?.status === "pending") {
    stickyAction = {
      context: "Next action",
      label: "Review refund request",
      helper: "Approve it or respond with a clear reason.",
      icon: "return-down-back-outline",
      onPress: () => scrollToSection(refundSectionY.current),
    };
  } else if (refundRequest?.status === "approved") {
    stickyAction = {
      context: "Next action",
      label: "Record refund as sent",
      helper: "Add the transaction reference after sending it.",
      icon: "receipt-outline",
      onPress: () => openRefundDialog("refunded"),
    };
  } else if (normalizedRequestStatus === "pending_shop_acceptance") {
    stickyAction = {
      context: "Next action",
      label: "Accept this request",
      helper: "Confirm availability before accepting.",
      icon: "checkmark-circle-outline",
      onPress: () => void updateRequestStatus(request, "accepted_by_shop"),
    };
  } else if (normalizedRequestStatus === "awaiting_payment") {
    stickyAction = {
      context: "Next update",
      label: "Waiting for family payment",
      helper: "You will be notified when proof is submitted.",
      icon: "hourglass-outline",
      disabled: true,
      onPress: () => undefined,
    };
  } else if (normalizedRequestStatus === "payment_submitted") {
    stickyAction = {
      context: "Next action",
      label: "Review payment proof",
      helper: "Check the account and reference before verifying.",
      icon: "shield-checkmark-outline",
      onPress: () => scrollToSection(paymentSectionY.current),
    };
  } else if (normalizedRequestStatus === "paid_waiting_for_split") {
    stickyAction = {
      context: "Payment status",
      label: "Payout processing",
      helper: "Payment received. 70% payout is being dispatched.",
      icon: "wallet-outline",
      disabled: true,
      onPress: () => undefined,
    };
  } else if (normalizedRequestStatus === "commission_failed") {
    stickyAction = {
      context: "Payment status",
      label: "Payout review required",
      helper: "Administrator will review the shop payout.",
      icon: "warning-outline",
      disabled: true,
      onPress: () => undefined,
    };
  } else if (normalizedRequestStatus === "payment_verified") {
    stickyAction = {
      context: "Next action",
      label: "Add delivery proof",
      helper: "Attach a clear photo before marking delivered.",
      icon: "camera-outline",
      onPress: () => scrollToSection(actionSectionY.current),
    };
  } else if (normalizedRequestStatus === "awaiting_customer_confirmation") {
    stickyAction = {
      context: "Next update",
      label: "Waiting for family confirmation",
      helper: "The family has your delivery proof.",
      icon: "hourglass-outline",
      disabled: true,
      onPress: () => undefined,
    };
  }
  const stickyActionBusy =
    updatingRequestId === request.id || refundUpdating || submittingPayment || uploadingCompletionProof;

  const handleRequestBack = () => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    navigation.navigate(
      requesterView
        ? "MyServiceRequests"
        : route.params?.origin === "ShopPayments"
          ? "ShopPayments"
          : "ServiceRequestsInbox"
    );
  };

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.requestHeaderSafeArea}>
        <View style={styles.requestHeaderBar}>
          <AppBackButton onPress={handleRequestBack} />
          <View style={styles.requestHeaderHeading}>
            <Text style={styles.requestHeaderTitle} numberOfLines={1}>Request Details</Text>
          </View>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.screenBody}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.requestScroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Text style={styles.requestIdText}>Request #{request.id.slice(0, 8).toUpperCase()}</Text>
            {isRequestOwner && normalizedRequestStatus === "pending_shop_acceptance" ? (
              <TouchableOpacity
                style={styles.heroEditButton}
                onPress={() => navigation.navigate("EditServiceRequest", { request })}
                accessibilityRole="button"
                accessibilityLabel="Edit service request"
              >
                <Ionicons name="create-outline" size={16} color="#315f50" />
                <Text style={styles.heroEditButtonText}>Edit request</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.heroMainRow}>
            {request.productImageUrl ? (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setPhotoViewerUrl(request.productImageUrl!)}
              >
                <Image source={{ uri: request.productImageUrl }} style={styles.heroImage} resizeMode="cover" />
              </TouchableOpacity>
            ) : (
              <View style={[styles.heroImage, styles.heroImageFallback]}>
                <Ionicons name="cube-outline" size={28} color="#c7d3ce" />
              </View>
            )}
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>
                {request.requestType === "custom_casket" ? "Custom Casket Request" : request.productName}
              </Text>
              <Text style={styles.heroSubtitle}>
                Service request
              </Text>
            </View>
          </View>

          <View style={styles.heroDivider} />
          <View style={styles.heroStatusRow}>
            <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
              <Ionicons name={statusMeta.icon} size={14} color={statusMeta.text} />
              <Text style={[styles.statusBadgeText, { color: statusMeta.text }]}>{statusMeta.label}</Text>
            </View>
            <Text style={styles.heroStatusMessage}>{currentStatusMessage}</Text>
          </View>
        </View>

        <RequestProgressStepper status={request.status} />

        <View>
          <DeathCertificateRequestCard
            serviceRequestId={request.id}
            requesterView={requesterView}
            ownerView={isRequestOwner}
          />
        </View>

        {!requesterView ? (
          <View style={styles.shopOwnerBrief}>
            <View style={styles.shopOwnerBriefHeader}>
              <View style={styles.shopOwnerBriefIcon}>
                <Ionicons name="compass-outline" size={22} color="#ffffff" />
              </View>
              <View style={styles.shopOwnerBriefHeading}>
                <Text style={styles.shopOwnerBriefTitle}>Next shop action</Text>
              </View>
            </View>

            <View style={styles.shopOwnerPriority}>
              <View style={styles.shopOwnerPriorityIcon}>
                <Ionicons name={stickyAction?.icon || "eye-outline"} size={19} color="#2f6b55" />
              </View>
              <View style={styles.shopOwnerPriorityCopy}>
                <Text style={styles.shopOwnerPriorityLabel}>Next step</Text>
                <Text style={styles.shopOwnerPriorityTitle}>{stickyAction?.label || "Monitor this request"}</Text>
                <Text style={styles.shopOwnerPriorityText}>{stickyAction?.helper || currentStatusMessage}</Text>
              </View>
            </View>

            <View style={styles.shopOwnerReadinessRow}>
              {([
                {
                  key: "contact",
                  icon: "call-outline" as IoniconName,
                  label: "Family contact",
                  value: shopFamilyContactReady ? "Ready" : "Missing",
                  ready: shopFamilyContactReady,
                },
                {
                  key: "schedule",
                  icon: "calendar-outline" as IoniconName,
                  label: "Schedule",
                  value: shopScheduleReady ? "Complete" : "Review",
                  ready: shopScheduleReady,
                },
                {
                  key: "checklist",
                  icon: "checkmark-done-outline" as IoniconName,
                  label: "Preparation",
                  value: `${checklistCompletedCount}/${SHOP_PREPARATION_ITEMS.length}`,
                  ready: checklistCompletedCount === SHOP_PREPARATION_ITEMS.length,
                },
              ]).map((item) => (
                <View key={item.key} style={styles.shopOwnerReadinessItem}>
                  <View style={[styles.shopOwnerReadinessIcon, item.ready ? styles.shopOwnerReadinessIconReady : null]}>
                    <Ionicons name={item.icon} size={15} color={item.ready ? "#256047" : "#8a6d4e"} />
                  </View>
                  <Text style={styles.shopOwnerReadinessLabel}>{item.label}</Text>
                  <Text style={[styles.shopOwnerReadinessValue, item.ready ? styles.shopOwnerReadinessValueReady : null]}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <DetailCard
          icon="cube-outline"
          title="Service options"
          subtitle="Variation, amount, and design information"
        >
          {request.variationName ? (
            <InfoRow icon="options-outline" label="Selected variation" value={request.variationName} />
          ) : null}
          {request.packageItems?.length ? (
            <InfoRow icon="gift-outline" label="Package inclusions" value={request.packageItems.join(", ")} />
          ) : null}
          <InfoRow
            icon="cash-outline"
            label="Service amount"
            value={Number(request.paymentAmount) > 0 ? formatCurrency(request.paymentAmount) : request.productPrice || "Not set"}
          />
          {request.customDesignNotes ? (
            <InfoRow icon="create-outline" label="Custom design specifications" value={request.customDesignNotes} />
          ) : null}
          {request.referencePhotoUrl ? (
            <View style={styles.attachmentSection}>
              <View style={styles.attachmentLabelRow}>
                <Ionicons name="image-outline" size={17} color="#7c8a84" />
                <Text style={styles.attachmentLabel}>Design reference photo</Text>
              </View>
              <PhotoFrame
                uri={request.referencePhotoUrl}
                ratio={photoRatios[request.referencePhotoUrl]}
                fallbackHeight={190}
                wrapperStyle={styles.embeddedPhoto}
                onPress={() => setPhotoViewerUrl(request.referencePhotoUrl!)}
              />
              <Text style={styles.attachmentHint}>Tap the photo to view it full screen.</Text>
            </View>
          ) : null}
        </DetailCard>

        <DetailCard
          icon={requesterView ? "storefront-outline" : "people-outline"}
          title={requesterView ? "Shop contact" : "Family contact"}
          subtitle={requesterView ? "Contact the provider handling this request" : "Contact the family coordinator"}
        >
          <InfoRow
            icon={requesterView ? "business-outline" : "person-outline"}
            label={requesterView ? "Shop" : "Family coordinator"}
            value={requesterView ? request.shopName || "Not available" : request.familyCoordinatorName || "Not provided"}
            emphasize
          />
          <InfoRow
            icon="call-outline"
            label="Contact number"
            value={(requesterView ? request.shopContactNumber : request.contactNumber) || "Not available"}
          />
          <InfoRow
            icon="location-outline"
            label={requesterView ? "Shop address" : "Wake venue"}
            value={(requesterView ? request.shopAddress : request.wakeAddress) || "Not available"}
          />
          <View style={styles.contactActionRow}>
            <TouchableOpacity
              style={[styles.contactActionButton, requesterView && !request.shopContactNumber ? styles.buttonDisabled : null]}
              onPress={() => void openPhoneLink("call", requesterView ? request.shopContactNumber : request.contactNumber)}
              disabled={requesterView && !request.shopContactNumber}
            >
              <Ionicons name="call-outline" size={17} color="#22312d" />
              <Text style={styles.contactActionButtonText}>{requesterView ? "Call shop" : "Call family"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.contactActionButton, requesterView && !request.shopContactNumber ? styles.buttonDisabled : null]}
              onPress={() => void openPhoneLink("sms", requesterView ? request.shopContactNumber : request.contactNumber)}
              disabled={requesterView && !request.shopContactNumber}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={17} color="#22312d" />
              <Text style={styles.contactActionButtonText}>Send SMS</Text>
            </TouchableOpacity>
          </View>
        </DetailCard>

        <DetailCard
          icon="heart-outline"
          title="Deceased information"
          subtitle="Personal and memorial details provided by the family"
        >
          {request.memorialPhotoUrl ? (
            <PhotoFrame
              uri={request.memorialPhotoUrl}
              ratio={photoRatios[request.memorialPhotoUrl]}
              fallbackHeight={220}
              wrapperStyle={styles.embeddedPhoto}
              onPress={() => setPhotoViewerUrl(request.memorialPhotoUrl!)}
            />
          ) : null}
          <InfoRow icon="person-outline" label="Full name" value={request.deceasedFullName || "Not provided"} emphasize />
          {request.deceasedDateOfBirth ? (
            <InfoRow icon="calendar-outline" label="Date of birth" value={formatTimestamp(request.deceasedDateOfBirth)} />
          ) : null}
          {request.deceasedDateOfPassing ? (
            <InfoRow icon="flower-outline" label="Date of passing" value={formatTimestamp(request.deceasedDateOfPassing)} />
          ) : null}
          <InfoRow icon="hourglass-outline" label="Age at time of passing" value={request.deceasedAge ?? "Not provided"} />
          {request.tributeMessage ? (
            <View style={styles.tributeBox}>
              <Ionicons name="chatbox-ellipses-outline" size={18} color="#846a4f" />
              <View style={styles.tributeCopy}>
                <Text style={styles.infoRowLabel}>Tribute message</Text>
                <Text style={styles.tributeText}>{request.tributeMessage}</Text>
              </View>
            </View>
          ) : null}
        </DetailCard>

        <DetailCard
          icon="calendar-outline"
          title="Wake & burial schedule"
          subtitle="Review the dates and service locations carefully"
        >
          <InfoRow icon="location-outline" label="Wake venue" value={request.wakeAddress || "Not provided"} />
          <InfoRow icon="business-outline" label="Church / chapel" value={request.churchName || "Not provided"} />
          <InfoRow icon="location-outline" label="Cemetery" value={request.cemeteryName || "Not provided"} />
          <View style={styles.datePairRow}>
            <View style={styles.datePairItem}>
              <Text style={styles.datePairLabel}>WAKE START</Text>
              <Text style={styles.datePairValue}>{formatServiceDate(request.wakeStartDate)}</Text>
            </View>
            <View style={styles.datePairDivider} />
            <View style={styles.datePairItem}>
              <Text style={styles.datePairLabel}>WAKE END</Text>
              <Text style={styles.datePairValue}>{formatServiceDate(request.wakeEndDate)}</Text>
            </View>
          </View>
          <InfoRow
            icon="time-outline"
            label="Burial"
            value={
              request.wakeEndDate && request.burialTime
                ? formatServiceDate(request.wakeEndDate) + " at " + formatServiceTime(request.burialTime)
                : "Not provided"
            }
          />
          <InfoRow icon="navigate-outline" label="Pickup address" value={request.pickupAddress || "Not provided"} />
        </DetailCard>

        {!requesterView ? (
          <>
          <View style={styles.requestSectionIntro}>
            <Text style={styles.requestSectionTitle}>Shop preparation</Text>
            <Text style={styles.requestSectionText}>This checklist is visible only to the shop.</Text>
          </View>
          <DetailCard
            icon="checkmark-done-circle-outline"
            title="Preparation checklist"
            subtitle="Private to your shop and synced across devices"
          >
            <View style={styles.checklistProgressRow}>
              <Text style={styles.checklistProgressText}>
                {checklistCompletedCount} of {SHOP_PREPARATION_ITEMS.length} completed
              </Text>
              <Text style={styles.checklistProgressPercent}>
                {Math.round((checklistCompletedCount / SHOP_PREPARATION_ITEMS.length) * 100)}%
              </Text>
            </View>
            <View style={styles.checklistProgressTrack}>
              <View
                style={[
                  styles.checklistProgressFill,
                  {
                    width:
                      ((checklistCompletedCount / SHOP_PREPARATION_ITEMS.length) * 100 +
                        "%") as DimensionValue,
                  },
                ]}
              />
            </View>

            {checklistLoading ? (
              <View style={styles.checklistLoadingRow}>
                <ActivityIndicator size="small" color="#2f6b55" />
                <Text style={styles.checklistLoadingText}>Loading preparation progress...</Text>
              </View>
            ) : (
              <View style={styles.checklistItems}>
                {SHOP_PREPARATION_ITEMS.map((item) => {
                  const checked = shopChecklist[item.key];
                  const saving = checklistSavingKey === item.key;
                  return (
                    <TouchableOpacity
                      key={item.key}
                      activeOpacity={0.78}
                      style={[
                        styles.checklistItem,
                        checked ? styles.checklistItemChecked : null,
                        checklistLocked ? styles.checklistItemLocked : null,
                      ]}
                      onPress={() => void toggleShopChecklistItem(item.key)}
                      disabled={Boolean(checklistSavingKey) || checklistLocked}
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked,
                        disabled: Boolean(checklistSavingKey) || checklistLocked,
                      }}
                      accessibilityLabel={item.label}
                    >
                      <View
                        style={[
                          styles.checklistCheckbox,
                          checked ? styles.checklistCheckboxChecked : null,
                        ]}
                      >
                        {saving ? (
                          <ActivityIndicator size={14} color={checked ? "#ffffff" : "#2f6b55"} />
                        ) : (
                          <Ionicons
                            name={checked ? "checkmark" : item.icon}
                            size={checked ? 17 : 16}
                            color={checked ? "#ffffff" : "#71807a"}
                          />
                        )}
                      </View>
                      <View style={styles.checklistItemCopy}>
                        <Text
                          style={[
                            styles.checklistItemLabel,
                            checked ? styles.checklistItemLabelChecked : null,
                          ]}
                        >
                          {item.label}
                        </Text>
                        <Text style={styles.checklistItemDescription}>{item.description}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {checklistError ? (
              <View style={styles.checklistErrorCard}>
                <Ionicons name="cloud-offline-outline" size={18} color="#9b403b" />
                <View style={styles.checklistErrorCopy}>
                  <Text style={styles.checklistErrorTitle}>Checklist could not sync</Text>
                  <Text style={styles.checklistErrorText}>{checklistError}</Text>
                </View>
                <TouchableOpacity onPress={() => void loadShopChecklist()} style={styles.checklistRetryButton}>
                  <Text style={styles.checklistRetryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.checklistPrivacyNote}>
              <Ionicons name="lock-closed-outline" size={14} color="#6f7d78" />
              <Text style={styles.checklistPrivacyText}>
                Customers cannot see this operational checklist.
              </Text>
            </View>
          </DetailCard>
          </>
        ) : null}

        {paymentSectionVisible ? (
          <View
            style={styles.paymentSection}
            onLayout={(event) => {
              paymentSectionY.current = event.nativeEvent.layout.y;
              if (focusPaymentOnOpen && !paymentFocusHandledRef.current) {
                paymentFocusHandledRef.current = true;
                requestAnimationFrame(() => scrollToSection(paymentSectionY.current));
              }
            }}
          >
            <TouchableOpacity
              style={styles.paymentHeader}
              onPress={() => setPaymentExpanded((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={paymentExpanded ? "Hide payment details" : "Show payment details"}
              accessibilityState={{ expanded: paymentExpanded }}
            >
              <View style={styles.paymentHeaderIcon}>
                <Ionicons name="wallet-outline" size={20} color="#2d6752" />
              </View>
              <View style={styles.paymentHeaderCopy}>
                <Text style={styles.paymentTitle}>{requesterView ? "Payment details" : "Family payment"}</Text>
                <Text style={styles.paymentSubtitle} numberOfLines={2}>
                  {requesterView
                    ? "Send the exact amount and keep your receipt."
                    : shopHasFamilyPayment
                      ? `${request.paymentPayerName || request.familyCoordinatorName || "Family sender"}${request.paymentSubmittedAt ? ` · ${formatTimestamp(request.paymentSubmittedAt)}` : ""}`
                      : "Waiting for the family to send a receipt."}
                </Text>
              </View>
              {Number(request.paymentAmount) > 0 ? (
                <View style={styles.paymentAmountBadge}>
                  <Text style={styles.paymentAmountCaption}>{requesterView ? "SEND" : shopHasFamilyPayment ? "RECEIVED" : "RECEIVE"}</Text>
                  <Text style={styles.paymentAmountStrong}>{formatCurrency(request.paymentAmount)}</Text>
                </View>
              ) : null}
              <Ionicons name={paymentExpanded ? "chevron-up" : "chevron-down"} size={19} color="#6f7b76" />
            </TouchableOpacity>

            {paymentExpanded ? (
              <>
            {isRequestOwner && String(request.status || "").toLowerCase() === "awaiting_payment" ? (
              <TouchableOpacity
                style={styles.acceptButton}
                onPress={() => setXenditVisible(true)}
              >
                <Ionicons name="flash" size={19} color="#ffffff" />
                <Text style={styles.acceptButtonText}>1-Click Pay with Xendit</Text>
              </TouchableOpacity>
            ) : null}

            {false && isRequestOwner && String(request.status || "").toLowerCase() === "awaiting_payment" ? (
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

                <Text style={styles.detailLabel}>Transaction Reference *</Text>
                <TextInput
                  style={styles.paymentSetupInput}
                  value={paymentForm.referenceNumber}
                  onChangeText={(value) => setPaymentForm((current) => ({ ...current, referenceNumber: value }))}
                  placeholder="Reference shown on the receipt"
                  placeholderTextColor="#9aa39d"
                  autoCapitalize="characters"
                  maxLength={40}
                />

                <Text style={styles.detailLabel}>Proof of Payment *</Text>
                {paymentForm.proofImageUrl ? (
                  <>
                    <PhotoFrame
                      uri={paymentForm.proofImageUrl!}
                      fallbackHeight={190}
                      onPress={() => setPhotoViewerUrl(paymentForm.proofImageUrl!)}
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

            {shopHasFamilyPayment ? (
              <View style={styles.familyPaymentDetails}>
                <View style={styles.familyPaymentSafetyNote}>
                  <Ionicons name="shield-checkmark-outline" size={17} color="#2d6752" />
                  <Text style={styles.familyPaymentSafetyText}>
                    Open the receipt and check its sender, reference, amount, and proof before verifying.
                  </Text>
                </View>

                <TouchableOpacity
                  activeOpacity={0.88}
                  style={[styles.viewFamilyReceiptButton, !request.paymentProofImageUrl ? styles.viewFamilyReceiptButtonDisabled : null]}
                  onPress={() => navigation.navigate("ShopPaymentReceipt", { request })}
                  disabled={!request.paymentProofImageUrl}
                  accessibilityRole="button"
                  accessibilityLabel="View family payment receipt"
                >
                  <Ionicons name="receipt-outline" size={19} color="#ffffff" />
                  <Text style={styles.viewFamilyReceiptButtonText}>
                    {request.paymentProofImageUrl ? "View receipt" : "Receipt unavailable"}
                  </Text>
                  <Ionicons name="arrow-forward" size={17} color="#ffffff" />
                </TouchableOpacity>

                {normalizedRequestStatus === "payment_submitted" ? (
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
                ) : null}
              </View>
            ) : null}

            {!requesterView && String(request.status || "").toLowerCase() === "payment_verified" ? (
              <View>
                <Text style={styles.paymentNote}>Payment confirmed. Prepare the casket and mark the request as completed once delivered.</Text>
                <View style={styles.payoutStatusContainer}>
                  <Text style={styles.payoutStatusHeader}>Shop Payout (70%):</Text>
                  <Text style={styles.payoutStatusBody}>
                    {request.payoutStatus === "succeeded"
                      ? `₱${Number(request.payoutAmount || 0).toLocaleString()} sent to your registered account${request.payoutCompletedAt ? ` on ${formatTimestamp(request.payoutCompletedAt)}` : ""}.`
                      : request.payoutStatus === "failed"
                      ? `Payout of ₱${Number(request.payoutAmount || 0).toLocaleString()} failed (${request.payoutFailureCode || "Contact admin"}). Admin will review.`
                      : request.payoutStatus === "pending"
                      ? `Payout of ₱${Number(request.payoutAmount || 0).toLocaleString()} is being processed by Xendit.`
                      : "Payment confirmed. 70% payout will be sent to your registered GCash/bank account."}
                  </Text>
                </View>
              </View>
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
              </>
            ) : null}
          </View>
        ) : null}

        {!refundLoading && (refundRequest || canCreateRefund) ? (
          <View
            style={styles.refundCard}
            onLayout={(event) => {
              refundSectionY.current = event.nativeEvent.layout.y;
            }}
          >
            <View style={styles.refundHeaderRow}>
              <View style={styles.refundHeaderIcon}>
                <Ionicons name="return-down-back-outline" size={20} color="#9a4d45" />
              </View>
              <View style={styles.refundHeaderCopy}>
                <Text style={styles.refundTitle}>Cancellation & Refund</Text>
                <Text style={styles.refundSubtitle}>
                  Paid requests use a tracked refund review instead of changing the payment record.
                </Text>
              </View>
              {refundMeta ? (
                <View style={[styles.refundBadge, { backgroundColor: refundMeta.background }]}>
                  <Text style={[styles.refundBadgeText, { color: refundMeta.color }]}>{refundMeta.label}</Text>
                </View>
              ) : null}
            </View>

            {refundRequest ? (
              <View style={styles.refundDetails}>
                <Text style={styles.detailLabel}>Reason</Text>
                <Text style={styles.detailValue}>{refundRequest.reason}</Text>
                {refundRequest.response_note ? (
                  <>
                    <Text style={styles.detailLabel}>Shop Response</Text>
                    <Text style={styles.detailValue}>{refundRequest.response_note}</Text>
                  </>
                ) : null}
                {refundRequest.refund_reference_number ? (
                  <>
                    <Text style={styles.detailLabel}>Refund Reference</Text>
                    <Text style={styles.detailValue}>{refundRequest.refund_reference_number}</Text>
                  </>
                ) : null}
                <Text style={styles.refundTimestamp}>Requested {formatTimestamp(refundRequest.requested_at)}</Text>
              </View>
            ) : null}

            {canCreateRefund ? (
              <TouchableOpacity style={styles.declineButton} onPress={() => openRefundDialog('request')}>
                <Text style={styles.declineButtonText}>Request a Refund</Text>
              </TouchableOpacity>
            ) : null}

            {isRequestOwner && refundRequest?.status === 'pending' ? (
              <TouchableOpacity style={styles.closeButton} onPress={cancelRefund} disabled={refundUpdating}>
                <Text style={styles.closeButtonText}>{refundUpdating ? 'Updating...' : 'Withdraw Refund Request'}</Text>
              </TouchableOpacity>
            ) : null}

            {!requesterView && refundRequest?.status === 'pending' ? (
              <View style={styles.actionStack}>
                <TouchableOpacity style={styles.acceptButton} onPress={approveRefund} disabled={refundUpdating}>
                  <Text style={styles.acceptButtonText}>{refundUpdating ? 'Updating...' : 'Approve Refund'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.declineButton} onPress={() => openRefundDialog('reject')} disabled={refundUpdating}>
                  <Text style={styles.declineButtonText}>Reject With Reason</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {!requesterView && refundRequest?.status === 'approved' ? (
              <TouchableOpacity style={styles.acceptButton} onPress={() => openRefundDialog('refunded')} disabled={refundUpdating}>
                <Text style={styles.acceptButtonText}>Record Refund as Sent</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <DetailCard
          icon="time-outline"
          title="Activity history"
          subtitle="Past request updates with their recorded date and time"
        >
          <View style={styles.timelineList}>
            {timelineEvents.map((event, index) => (
              <TimelineItem
                key={event.label}
                label={event.label}
                value={event.value}
                active
                last={index === timelineEvents.length - 1}
              />
            ))}
          </View>
        </DetailCard>

        {requestClosed ? <Text style={styles.requestSectionTitle}>Request outcome</Text> : null}

        <View
          onLayout={(event) => {
            actionSectionY.current = event.nativeEvent.layout.y;
          }}
        >
        {requesterView ? (
          <>

            {isRequestOwner && String(request.status || "").toLowerCase() === "awaiting_customer_confirmation" ? (
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

            {isRequestOwner && isCancellable(request.status) ? (
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
            <Text style={styles.readonlyStatusTitle}>Payout Account Setup Required</Text>
            <Text style={styles.readonlyStatusText}>
              An administrator must verify this shop’s payout account before customer checkout can open.
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
        </View>
      </ScrollView>

      {stickyAction ? (
        <View style={styles.stickyActionContainer}>
          <View style={styles.stickyActionSummary}>
            <View style={styles.stickyActionIcon}>
              <Ionicons name={stickyAction.icon} size={20} color="#2f6b55" />
            </View>
            <View style={styles.stickyActionCopy}>
              <Text style={styles.stickyActionContext}>{stickyAction.context}</Text>
              <Text style={styles.stickyActionHelper}>{stickyAction.helper}</Text>
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[
              styles.stickyActionButton,
              stickyAction.disabled || stickyActionBusy ? styles.stickyActionButtonDisabled : null,
            ]}
            onPress={() => {
              hapticMedium();
              stickyAction?.onPress();
            }}
            disabled={stickyAction.disabled || stickyActionBusy}
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(stickyAction.disabled || stickyActionBusy) }}
            accessibilityLabel={stickyAction.label}
          >
            {stickyActionBusy ? <ActivityIndicator size="small" color="#ffffff" /> : null}
            <Text style={styles.stickyActionButtonText}>
              {stickyActionBusy ? "Updating..." : stickyAction.label}
            </Text>
            {!stickyAction.disabled && !stickyActionBusy ? (
              <Ionicons name="arrow-forward" size={18} color="#ffffff" />
            ) : null}
          </TouchableOpacity>
        </View>
      ) : null}

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
                  <Ionicons name="location-outline" size={19} color="#315f50" />
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

      <Modal visible={Boolean(refundDialog)} transparent animationType="fade" onRequestClose={closeRefundDialog}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeRefundDialog}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {refundDialog === 'request'
                ? 'Request a Refund'
                : refundDialog === 'reject'
                  ? 'Reject Refund Request'
                  : 'Record Refund as Sent'}
            </Text>
            <Text style={styles.modalSubtitle}>
              {refundDialog === 'request'
                ? 'Explain why you are requesting the cancellation and refund. The original payment record will remain available for review.'
                : refundDialog === 'reject'
                  ? 'Give the family a clear reason they can review.'
                  : 'Enter the transaction reference from the refund receipt.'}
            </Text>
            <Text style={styles.detailLabel}>
              {refundDialog === 'refunded' ? 'Refund Transaction Reference *' : 'Explanation *'}
            </Text>
            <TextInput
              style={[
                styles.paymentSetupInput,
                refundDialog === 'refunded' ? null : styles.paymentSetupReasonInput,
              ]}
              value={refundDialogText}
              onChangeText={setRefundDialogText}
              placeholder={refundDialog === 'refunded' ? 'Reference shown on the refund receipt' : 'Enter at least 10 characters'}
              placeholderTextColor="#9aa39d"
              autoCapitalize={refundDialog === 'refunded' ? 'characters' : 'sentences'}
              multiline={refundDialog !== 'refunded'}
              maxLength={refundDialog === 'refunded' ? 40 : 500}
            />
            <View style={styles.actionStack}>
              <TouchableOpacity style={[styles.acceptButton, refundUpdating ? styles.buttonDisabled : null]} onPress={() => void submitRefundDialog()} disabled={refundUpdating}>
                <Text style={styles.acceptButtonText}>{refundUpdating ? 'Saving...' : 'Confirm'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeButton} onPress={closeRefundDialog} disabled={refundUpdating}>
                <Text style={styles.closeButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
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
      <ServiceXenditSheet
        visible={xenditVisible}
        request={xenditVisible ? request : null}
        onClose={() => setXenditVisible(false)}
        onChanged={async () => {
          const { data } = await supabase
            .from("funeral_service_requests")
            .select("*")
            .eq("id", request.id)
            .maybeSingle();
          if (!data) return;
          const latest = data as FuneralServiceRequest;
          setRequest(latest);
          if (String(latest.status || "").toLowerCase() === "payment_verified") {
            setXenditVisible(false);
          }
        }}
      />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f3f5f7",
  },
  screenBody: {
    flex: 1,
    backgroundColor: "#f3f5f7",
  },
  requestScroll: {
    flex: 1,
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
  requestHeaderTitle: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 3,
  },
  content: {
    padding: 16,
    paddingBottom: 44,
    gap: 14,
  },
  heroCard: {
    overflow: "hidden",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d8e0e8",
    backgroundColor: "#ffffff",
    padding: 16,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  requestIdText: {
    color: "#69788b",
    fontSize: 11,
    fontWeight: "800",
  },
  heroEditButton: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#bfcac5",
    borderRadius: 5,
    backgroundColor: "#ffffff",
  },
  heroEditButtonText: {
    color: "#315f50",
    fontSize: 12,
    fontWeight: "800",
  },
  heroMainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 18,
  },
  heroImage: {
    width: 76,
    height: 82,
    borderRadius: 10,
    backgroundColor: "#eef1ec",
  },
  heroImageFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d8e0e8",
  },
  heroCopy: {
    flex: 1,
  },
  heroTitle: {
    color: "#22312d",
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "900",
    marginTop: 4,
  },
  heroSubtitle: {
    color: "#69788b",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 4,
  },
  heroDivider: {
    height: 1,
    backgroundColor: "#d8e0e8",
    marginVertical: 17,
  },
  heroStatusRow: {
    alignItems: "flex-start",
    gap: 9,
  },
  heroStatusMessage: {
    color: "#52615c",
    fontSize: 13,
    lineHeight: 19,
  },
  progressCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dedbd3",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingTop: 15,
    paddingBottom: 14,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  progressTitle: {
    color: "#22312d",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 2,
  },
  progressCountBadge: {
    borderRadius: 8,
    backgroundColor: "#edf4f1",
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  progressCountText: {
    color: "#2f6b55",
    fontSize: 9,
    fontWeight: "900",
  },
  progressStages: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 17,
  },
  progressStage: {
    flex: 1,
    alignItems: "center",
    position: "relative",
  },
  progressConnector: {
    position: "absolute",
    top: 14,
    left: "50%",
    width: "100%",
    height: 2,
    backgroundColor: "#e1e5e3",
  },
  progressConnectorActive: {
    backgroundColor: "#4b806b",
  },
  progressNode: {
    zIndex: 1,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: "#dde2df",
    backgroundColor: "#f5f7f6",
    alignItems: "center",
    justifyContent: "center",
  },
  progressNodeComplete: {
    borderColor: "#2f6b55",
    backgroundColor: "#2f6b55",
  },
  progressNodeCurrent: {
    borderColor: "#8a6d4e",
    backgroundColor: "#8a6d4e",
  },
  progressNodeStopped: {
    borderColor: "#a84d48",
    backgroundColor: "#a84d48",
  },
  progressStageLabel: {
    color: "#949d99",
    fontSize: 8,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 6,
  },
  progressStageLabelActive: {
    color: "#35443f",
  },
  progressStoppedNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 12,
    backgroundColor: "#fff1f0",
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 12,
  },
  progressStoppedText: {
    flex: 1,
    color: "#84423d",
    fontSize: 11,
    lineHeight: 16,
  },
  shopOwnerBrief: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cfd9d4",
    backgroundColor: "#ffffff",
    padding: 16,
  },
  shopOwnerBriefHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  shopOwnerBriefIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#315f50",
    alignItems: "center",
    justifyContent: "center",
  },
  shopOwnerBriefHeading: {
    flex: 1,
  },
  shopOwnerBriefTitle: {
    color: "#22312d",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 3,
  },
  shopOwnerPriority: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#d8e0e8",
    paddingTop: 12,
    marginTop: 14,
  },
  shopOwnerPriorityIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  shopOwnerPriorityCopy: {
    flex: 1,
  },
  shopOwnerPriorityLabel: {
    color: "#5d766c",
    fontSize: 9,
    fontWeight: "900",
  },
  shopOwnerPriorityTitle: {
    color: "#224c3c",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 2,
  },
  shopOwnerPriorityText: {
    color: "#63756e",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  shopOwnerReadinessRow: {
    flexDirection: "row",
    gap: 7,
    marginTop: 12,
  },
  shopOwnerReadinessItem: {
    flex: 1,
    minWidth: 0,
    borderTopWidth: 1,
    borderColor: "#d8e0e8",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  shopOwnerReadinessIcon: {
    width: 29,
    height: 29,
    borderRadius: 10,
    backgroundColor: "#f5e9dd",
    alignItems: "center",
    justifyContent: "center",
  },
  shopOwnerReadinessIconReady: {
    backgroundColor: "#e1f1e7",
  },
  shopOwnerReadinessLabel: {
    color: "#7a8580",
    fontSize: 8,
    fontWeight: "800",
    marginTop: 8,
  },
  shopOwnerReadinessValue: {
    color: "#8a6d4e",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 2,
  },
  shopOwnerReadinessValueReady: {
    color: "#256047",
  },
  requestSectionIntro: {
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  requestSectionTitle: {
    color: "#22312d",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 3,
  },
  requestSectionText: {
    color: "#6e7b76",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  detailCard: {
    borderBottomWidth: 1,
    borderBottomColor: "#d8e0e8",
    paddingVertical: 14,
  },
  detailCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 2,
  },
  detailCardHeaderOpen: {
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#efede7",
  },
  detailCardIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  detailCardHeading: {
    flex: 1,
  },
  detailCardTitle: {
    color: "#22312d",
    fontSize: 16,
    fontWeight: "900",
  },
  detailCardSubtitle: {
    color: "#7a8580",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  detailCardBody: {
    paddingTop: 6,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    gap: 10,
  },
  infoRowIcon: {
    width: 22,
    marginTop: 3,
    textAlign: "center",
  },
  infoRowCopy: {
    flex: 1,
  },
  infoRowLabel: {
    color: "#7a8580",
    fontSize: 10,
    fontWeight: "900",
  },
  infoRowValue: {
    color: "#33413d",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
  },
  infoRowValueStrong: {
    color: "#1d2d28",
    fontSize: 15,
    fontWeight: "800",
  },
  attachmentSection: {
    borderTopWidth: 1,
    borderTopColor: "#efede7",
    paddingTop: 13,
    marginTop: 3,
  },
  attachmentLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  attachmentLabel: {
    color: "#52615c",
    fontSize: 12,
    fontWeight: "900",
  },
  attachmentHint: {
    color: "#88918d",
    fontSize: 11,
    textAlign: "center",
    marginTop: -7,
  },
  embeddedPhoto: {
    marginBottom: 10,
  },
  tributeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 16,
    backgroundColor: "#faf5ee",
    padding: 13,
    marginTop: 5,
  },
  tributeCopy: {
    flex: 1,
  },
  tributeText: {
    color: "#4d463d",
    fontSize: 14,
    lineHeight: 21,
    fontStyle: "italic",
    marginTop: 4,
  },
  datePairRow: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 16,
    backgroundColor: "#f4f7f5",
    paddingVertical: 13,
    paddingHorizontal: 10,
    marginVertical: 5,
  },
  datePairItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  datePairDivider: {
    width: 1,
    backgroundColor: "#d9e0dc",
  },
  datePairLabel: {
    color: "#7b8782",
    fontSize: 9,
    fontWeight: "900",
  },
  datePairValue: {
    color: "#24332f",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 4,
  },
  checklistProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    marginBottom: 7,
  },
  checklistProgressText: {
    color: "#4c5c56",
    fontSize: 12,
    fontWeight: "800",
  },
  checklistProgressPercent: {
    color: "#2f6b55",
    fontSize: 12,
    fontWeight: "900",
  },
  checklistProgressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: "#e6ece9",
    overflow: "hidden",
  },
  checklistProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#3c7b61",
  },
  checklistLoadingRow: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  checklistLoadingText: {
    color: "#71807a",
    fontSize: 12,
    fontWeight: "700",
  },
  checklistItems: {
    gap: 8,
    marginTop: 14,
  },
  checklistItem: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e5e2",
    backgroundColor: "#fbfcfb",
    padding: 11,
  },
  checklistItemChecked: {
    borderColor: "#cce0d6",
    backgroundColor: "#f0f8f4",
  },
  checklistItemLocked: {
    opacity: 0.66,
  },
  checklistCheckbox: {
    width: 32,
    height: 32,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#d4dbd7",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  checklistCheckboxChecked: {
    borderColor: "#2f6b55",
    backgroundColor: "#2f6b55",
  },
  checklistItemCopy: {
    flex: 1,
  },
  checklistItemLabel: {
    color: "#33423d",
    fontSize: 13,
    fontWeight: "900",
  },
  checklistItemLabelChecked: {
    color: "#245541",
  },
  checklistItemDescription: {
    color: "#7b8782",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  checklistErrorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#f0c9c5",
    backgroundColor: "#fff3f1",
    padding: 10,
    marginTop: 12,
  },
  checklistErrorCopy: {
    flex: 1,
  },
  checklistErrorTitle: {
    color: "#873f3a",
    fontSize: 11,
    fontWeight: "900",
  },
  checklistErrorText: {
    color: "#9a5c56",
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  checklistRetryButton: {
    borderRadius: 10,
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  checklistRetryText: {
    color: "#873f3a",
    fontSize: 10,
    fontWeight: "900",
  },
  checklistPrivacyNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  checklistPrivacyText: {
    color: "#77847f",
    fontSize: 10,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    borderRadius: 8,
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6e2dc",
    backgroundColor: "#ffffff",
    padding: 16,
  },
  paymentHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingBottom: 15,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#edf1ef",
  },
  paymentHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#e7f3ed",
    alignItems: "center",
    justifyContent: "center",
  },
  paymentHeaderCopy: {
    flex: 1,
  },
  familyPaymentHeaderChevron: {
    width: 30,
    height: 30,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#edf3f0",
  },
  paymentTitle: {
    color: "#22312d",
    fontSize: 17,
    fontWeight: "900",
  },
  paymentSubtitle: {
    color: "#74817c",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  paymentAmountBadge: {
    alignItems: "flex-end",
    borderRadius: 12,
    backgroundColor: "#eff7f3",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  paymentAmountCaption: {
    color: "#668174",
    fontSize: 8,
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
  familyPaymentCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d8e4de",
    backgroundColor: "#f8fbf9",
    overflow: "hidden",
    marginTop: 4,
  },
  familyPaymentToggle: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  familyPaymentToggleIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e3f1ea",
  },
  familyPaymentToggleCopy: {
    flex: 1,
    minWidth: 0,
  },
  familyPaymentToggleTitle: {
    color: "#244b3d",
    fontSize: 13,
    fontWeight: "900",
  },
  familyPaymentToggleText: {
    color: "#728079",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  familyPaymentDetails: {
    borderTopWidth: 1,
    borderTopColor: "#dce7e1",
    padding: 12,
    backgroundColor: "#ffffff",
  },
  familyReceiptSection: {
    borderTopWidth: 1,
    borderTopColor: "#e1e8e4",
    marginTop: 12,
    paddingTop: 6,
  },
  familyReceiptHeader: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
  },
  familyReceiptIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e6f2ec",
  },
  familyReceiptIconMissing: {
    backgroundColor: "#fff0ee",
  },
  familyReceiptCopy: {
    flex: 1,
    minWidth: 0,
  },
  familyReceiptTitle: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "900",
  },
  familyReceiptSubtitle: {
    color: "#74817c",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  familyReceiptChevron: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f3f2",
  },
  familyReceiptBody: {
    borderRadius: 15,
    backgroundColor: "#f7f8f7",
    padding: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  familyReceiptHint: {
    color: "#7d8580",
    fontSize: 11,
    textAlign: "center",
    marginTop: 7,
  },
  familyPaymentSafetyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 14,
    backgroundColor: "#eaf5ef",
    padding: 11,
    marginBottom: 5,
  },
  familyPaymentSafetyText: {
    flex: 1,
    color: "#3d6757",
    fontSize: 11,
    lineHeight: 16,
  },
  viewFamilyReceiptButton: {
    minHeight: 50,
    borderRadius: 15,
    backgroundColor: "#22312d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 14,
  },
  viewFamilyReceiptButtonDisabled: {
    opacity: 0.48,
  },
  viewFamilyReceiptButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  familyPaymentProofLabel: {
    color: "#806b55",
    fontSize: 10,
    fontWeight: "900",
    marginTop: 14,
    marginBottom: 8,
  },
  familyPaymentMissingProof: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#efceca",
    backgroundColor: "#fff7f6",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  familyPaymentMissingProofText: {
    color: "#91463f",
    fontSize: 12,
    fontWeight: "800",
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
  refundCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ead8d5',
    backgroundColor: '#ffffff',
    padding: 16,
  },
  refundHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  refundHeaderCopy: {
    flex: 1,
  },
  refundHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: '#faece9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refundTitle: {
    color: '#22312d',
    fontSize: 16,
    fontWeight: '900',
  },
  refundSubtitle: {
    color: '#62706b',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  refundBadge: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  refundBadgeText: {
    fontSize: 10,
    fontWeight: '900',
  },
  refundDetails: {
    borderRadius: 14,
    backgroundColor: '#f8f6f2',
    padding: 12,
    marginTop: 14,
    marginBottom: 12,
  },
  refundTimestamp: {
    color: '#7a847f',
    fontSize: 11,
    marginTop: 10,
  },
  timelineList: {
    paddingTop: 10,
  },
  timelineItem: {
    minHeight: 56,
    flexDirection: "row",
  },
  timelineRail: {
    width: 26,
    alignItems: "center",
  },
  timelineDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#8c9994",
    alignItems: "center",
    justifyContent: "center",
  },
  timelineDotActive: {
    backgroundColor: "#2f6b55",
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: "#dce5e1",
  },
  timelineCopy: {
    flex: 1,
    paddingLeft: 8,
    paddingBottom: 14,
  },
  timelineLabel: {
    color: "#263631",
    fontSize: 13,
    fontWeight: "900",
  },
  timelineValue: {
    color: "#7b8782",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
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
    color: "#315f50",
    fontSize: 14,
    fontWeight: "900",
  },
  stickyActionContainer: {
    borderTopWidth: 1,
    borderTopColor: "#d9dfdc",
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 10,
  },
  stickyActionSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 9,
  },
  stickyActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 13,
    backgroundColor: "#eaf3ef",
    alignItems: "center",
    justifyContent: "center",
  },
  stickyActionCopy: {
    flex: 1,
  },
  stickyActionContext: {
    color: "#466458",
    fontSize: 11,
    fontWeight: "800",
  },
  stickyActionHelper: {
    color: "#717e79",
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  stickyActionButton: {
    minHeight: 48,
    borderRadius: 15,
    backgroundColor: "#223f36",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  stickyActionButtonDisabled: {
    backgroundColor: "#85918c",
  },
  stickyActionButtonText: {
    color: "#ffffff",
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
    borderRadius: 16,
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
  payoutStatusContainer: {
    marginTop: 8,
    padding: 12,
    backgroundColor: "#f0fdf4",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  payoutStatusHeader: {
    fontWeight: "700",
    color: "#166534",
    fontSize: 13,
  },
  payoutStatusBody: {
    color: "#15803d",
    fontSize: 12,
    marginTop: 3,
  },
});
