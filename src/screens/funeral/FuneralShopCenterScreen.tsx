import { useCallback, useMemo, useState, type ComponentProps } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton, AdminPaymentModal, KeyboardAwareScrollView, SimpleBarChart } from "@/components";
import { supabase } from "@/services/supabaseClient";
import * as ImagePicker from "expo-image-picker";
import { auth, uploadCertificate } from "@/services";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import {
  computeSalesOverview,
  formatCompactPeso,
  type SalesOverview,
} from "@/utils/salesAnalytics";
import { hapticSuccess } from "@/utils/haptics";

type ShopStatus = "none" | "pending" | "verified" | "live" | "offline" | "rejected";
type ProductTab = "all" | "available" | "soldout";
type CenterSection = "overview" | "payments" | "products";
type IoniconName = ComponentProps<typeof Ionicons>["name"];

type ShopInfo = {
  shopName?: string;
  shopAddress?: string;
  shopPhoneNumber?: string;
  shopImageUrl?: string | null;
  coverImageUrl?: string | null;
  paidUntil?: string | null;
  paymentQrUrl?: string | null;
  serviceFeeAmount?: number | string | null;
};

type ShopPayment = {
  id: string;
  status: string;
  amount: number;
  createdAt: string;
  verifiedAt?: string | null;
  expiresAt?: string | null;
};

type ServiceRequest = {
  id: string;
  requesterId: string;
  shopId: string;
  productId: string;
  productName: string;
  productPrice?: string;
  productImageUrl?: string | null;
  variationName?: string | null;
  requestType?: string;
  deceasedFullName?: string;
  familyCoordinatorName?: string;
  contactNumber?: string;
  wakeStartDate?: string | null;
  wakeEndDate?: string | null;
  burialTime?: string | null;
  status: string;
  createdAt?: string;
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
  completedAt?: string | null;
  acceptedAt?: string | null;
  declinedAt?: string | null;
  cancelledAt?: string | null;
};

type BusinessInfo = {
  individualRegisteredName?: string;
  businessName?: string;
  generalLocation?: string;
  registeredAddress?: string;
  zipCode?: string;
  tin?: string;
  vatRegistrationStatus?: string;
};

type ProductVariation = {
  name: string;
  imageUrl?: string | null;
};

type ShopProduct = {
  id: string;
  name: string;
  description: string;
  price: string;
  stock?: number;
  imageUrl?: string | null;
  galleryImageUrls?: string[];
  hasVariations?: boolean;
  variations?: ProductVariation[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProductCardProps = {
  item: ShopProduct;
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
};

function getProductState(item: ShopProduct): ProductTab {
  if (!item.active || (item.stock ?? 0) <= 0) return "soldout";
  return "available";
}

function getPrimaryProductImage(item?: ShopProduct | null) {
  if (!item) return null;
  return item.imageUrl || item.galleryImageUrls?.[0] || item.variations?.find((entry) => entry.imageUrl)?.imageUrl || null;
}

function getShopStatusMeta(status: ShopStatus, rejectionReason: string | null) {
  if (status === "live") {
    return {
      label: "Live",
      title: "Storefront is live",
      message: "Your shop is live and visible to families. Manage your storefront and catalog here.",
      background: "#e6f7ff",
      border: "#91caff",
      text: "#0958d9",
      chipText: "#0958d9",
      chipBackground: "#f5fbff",
    };
  }

  if (status === "verified") {
    return {
      label: "Verified",
      title: "Storefront ready",
      message: "Your shop is approved. You can edit the storefront and manage your catalog.",
      background: "#e7f5ec",
      border: "#bfe3cc",
      text: "#1e5b3a",
      chipText: "#1e5b3a",
      chipBackground: "#f7fffa",
    };
  }

  if (status === "offline") {
    return {
      label: "Offline",
      title: "Storefront is offline",
      message: "Your shop is currently hidden from buyers. You can still edit the storefront and manage your catalog.",
      background: "#f0f0f0",
      border: "#d9d9d9",
      text: "#595959",
      chipText: "#595959",
      chipBackground: "#fafafa",
    };
  }

  if (status === "pending") {
    return {
      label: "Pending Review",
      title: "Waiting for approval",
      message: "Your shop profile is under review. You can still look around while you wait.",
      background: "#fff4e5",
      border: "#f2d2a2",
      text: "#9a5417",
      chipText: "#8a4a13",
      chipBackground: "#fffaf3",
    };
  }

  if (status === "rejected") {
    return {
      label: "Needs Changes",
      title: "Profile needs updates",
      message: rejectionReason || "Your last submission needs changes before it can be approved again.",
      background: "#fdecec",
      border: "#f3c2c2",
      text: "#8f2525",
      chipText: "#8f2525",
      chipBackground: "#fff8f8",
    };
  }

  return {
    label: "Setup Needed",
    title: "Finish your storefront setup",
    message: "Complete your shop registration so families can view your storefront and products.",
    background: "#f2ede6",
    border: "#dfd4c6",
    text: "#65584d",
    chipText: "#65584d",
    chipBackground: "#fffdfa",
  };
}

function formatUpdatedAt(value: string) {
  if (!value) return "Recently updated";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recently updated";
  return `Updated ${parsed.toLocaleDateString()}`;
}

function formatSubscriptionDate(value?: string | null) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not set";
  return parsed.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function getDaysRemaining(value?: string | null) {
  if (!value) return 0;
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000)));
}

function getRequestStatusLabel(status?: string) {
  return String(status || "pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ProductStateBadge({ state }: { state: ProductTab }) {
  const label = state === "available" ? "AVAILABLE" : "SOLD OUT";
  const toneStyle = state === "available" ? styles.stateLive : styles.stateSold;

  return (
    <View style={[styles.stateBadge, toneStyle]}>
      <Text style={styles.stateBadgeText}>{label}</Text>
    </View>
  );
}

function ProductCard({ item, onPress, onEdit, onDelete, onToggle }: ProductCardProps) {
  const productState = getProductState(item);
  const productImage = getPrimaryProductImage(item);

  return (
    <TouchableOpacity activeOpacity={0.92} style={styles.productCard} onPress={onPress}>
      <View style={styles.productSummaryRow}>
        {productImage ? (
          <Image source={{ uri: productImage }} style={styles.productImage} resizeMode="cover" />
        ) : (
          <View style={styles.productImageFallback}>
            <Ionicons name="image-outline" size={24} color="#9aa39d" />
          </View>
        )}

        <View style={styles.productBody}>
          <View style={styles.productTopRow}>
            <Text style={styles.productName} numberOfLines={1}>
              {item.name}
            </Text>
            <ProductStateBadge state={productState} />
          </View>

          <Text style={styles.productPrice}>{formatPhilippinePeso(item.price)}</Text>
          <Text style={styles.productMeta}>
            Stock {item.stock ?? 0}
            {item.hasVariations && item.variations?.length ? ` | ${item.variations.length} variations` : ""}
          </Text>
          <Text style={styles.productDescription} numberOfLines={2}>
            {item.description || "No description yet."}
          </Text>
          <Text style={styles.productUpdatedText}>{formatUpdatedAt(item.updatedAt)}</Text>
        </View>
      </View>

      <View style={styles.productActionRow}>
        <TouchableOpacity style={styles.inlinePrimaryButton} onPress={onEdit}>
          <Ionicons name="create-outline" size={14} color="#ffffff" />
          <Text style={styles.inlinePrimaryButtonText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.inlineToggleButton} onPress={onToggle}>
          <Ionicons name={item.active ? "pause-outline" : "play-outline"} size={14} color="#58645f" />
          <Text style={styles.inlineToggleButtonText}>{item.active ? "Pause" : "Activate"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Delete ${item.name}`}
          style={styles.inlineDangerButton}
          onPress={onDelete}
        >
          <Ionicons name="trash-outline" size={16} color="#991b1b" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

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

export default function FuneralShopCenterScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [savingShop, setSavingShop] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);
  const [uploadingShopImage, setUploadingShopImage] = useState(false);
  const [uploadingShopCover, setUploadingShopCover] = useState(false);

  const [shopStatus, setShopStatus] = useState<ShopStatus>("none");
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [shopInfo, setShopInfo] = useState<ShopInfo | null>(null);
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [payment, setPayment] = useState<ShopPayment | null>(null);
  const [analytics, setAnalytics] = useState<SalesOverview | null>(null);

  const [shopNameInput, setShopNameInput] = useState("");
  const [shopAddressInput, setShopAddressInput] = useState("");
  const [shopPhoneInput, setShopPhoneInput] = useState("");
  const [shopImageUrl, setShopImageUrl] = useState<string | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);

  const [paymentSettingsVisible, setPaymentSettingsVisible] = useState(false);
  const [paymentQrDraftUrl, setPaymentQrDraftUrl] = useState<string | null>(null);
  const [paymentFeeInput, setPaymentFeeInput] = useState("");
  const [uploadingPaymentQr, setUploadingPaymentQr] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);

  const [productTab, setProductTab] = useState<ProductTab>("all");
  const [centerSection] = useState<CenterSection>("overview");

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [adminPaymentsVisible, setAdminPaymentsVisible] = useState(false);
  const [shopDetailsVisible, setShopDetailsVisible] = useState(false);
  const [shopDetailsEditable, setShopDetailsEditable] = useState(false);

  const [rejectPaymentVisible, setRejectPaymentVisible] = useState(false);
  const [rejectPaymentRequest, setRejectPaymentRequest] = useState<ServiceRequest | null>(null);
  const [rejectPaymentText, setRejectPaymentText] = useState("");
  const [rejectingPayment, setRejectingPayment] = useState(false);
  const [receiptRequest, setReceiptRequest] = useState<ServiceRequest | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let userId = auth.currentUser?.uid || null;

      if (!userId) {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        userId = sessionData.session?.user?.id || null;
      }

      if (!userId) {
        setShopStatus("none");
        setShopInfo(null);
        setBusinessInfo(null);
        setProducts([]);
        setRequests([]);
        setPayment(null);
        setAnalytics(null);
        return;
      }

      const { data: shopData } = await supabase
        .from("funeral_shops")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      const nextShopInfo: ShopInfo | null = shopData
        ? {
            shopName: shopData.shopName,
            shopAddress: shopData.shopAddress,
            shopPhoneNumber: shopData.shopPhoneNumber,
            shopImageUrl: shopData.shopImageUrl,
            coverImageUrl: shopData.coverImageUrl,
            paidUntil: shopData.paidUntil,
            paymentQrUrl: shopData.paymentQrUrl || null,
            serviceFeeAmount: shopData.serviceFeeAmount ?? null,
          }
        : null;

      const nextBusinessInfo: BusinessInfo | null = shopData
        ? {
            individualRegisteredName: shopData.individualRegisteredName,
            businessName: shopData.businessName,
            generalLocation: shopData.generalLocation,
            registeredAddress: shopData.registeredAddress,
            zipCode: shopData.zipCode,
            tin: shopData.tin,
            vatRegistrationStatus: shopData.vatRegistrationStatus ? "VAT Registered" : "Non Registered",
          }
        : null;

      setShopStatus((shopData?.status || "none") as ShopStatus);
      setRejectionReason(shopData?.rejectionReason || null);
      setShopInfo(nextShopInfo);
      setBusinessInfo(nextBusinessInfo);

      const { data: productRows } = await supabase
        .from("funeral_products")
        .select(`
          *,
          funeral_product_variations ( name, imageUrl ),
          funeral_product_images ( imageUrl, displayOrder )
        `)
        .eq("shopId", userId);

      const nextProducts: ShopProduct[] = (productRows || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description || "",
        price: String(row.price),
        stock: row.stock,
        imageUrl: row.imageUrl,
        galleryImageUrls: (row.funeral_product_images || [])
          .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
          .map((img: any) => img.imageUrl),
        hasVariations: row.hasVariations,
        variations: (row.funeral_product_variations || []).map((v: any) => ({
          name: v.name,
          imageUrl: v.imageUrl,
        })),
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
      setProducts(nextProducts);

      const { data: requestRows } = await supabase
        .from("funeral_service_requests")
        .select("*")
        .eq("shopId", userId)
        .order("createdAt", { ascending: false })
        .limit(50);
      setRequests((requestRows || []) as ServiceRequest[]);

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      sixMonthsAgo.setHours(0, 0, 0, 0);

      const { data: analyticsRows } = await supabase
        .from("funeral_service_requests")
        .select("id, status, productPrice, paymentAmount, createdAt, paymentVerifiedAt, completedAt, acceptedAt, declinedAt, cancelledAt")
        .eq("shopId", userId)
        .gte("createdAt", sixMonthsAgo.toISOString())
        .limit(2000);
      setAnalytics(computeSalesOverview((analyticsRows || []) as ServiceRequest[]));

      const { data: paymentData } = await supabase
        .from("shop_payments")
        .select('id, status, amount, "createdAt", "verifiedAt", "expiresAt"')
        .eq("shopId", userId)
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      setPayment((paymentData as ShopPayment | null) || null);

      setShopNameInput(String(nextShopInfo?.shopName || ""));
      setShopAddressInput(String(nextShopInfo?.shopAddress || ""));
      setShopPhoneInput(String(nextShopInfo?.shopPhoneNumber || ""));
      setShopImageUrl((nextShopInfo?.shopImageUrl as string | null) || null);
      setCoverImageUrl((nextShopInfo?.coverImageUrl as string | null) || null);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load shop center.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const isVerified = shopStatus === "verified" || shopStatus === "live" || shopStatus === "offline";
  const statusMeta = getShopStatusMeta(shopStatus, rejectionReason);
  const paymentVerified = payment?.status === "verified";
  const subscriptionEnd = shopInfo?.paidUntil || null;
  const subscriptionExpired = Boolean(
    paymentVerified && subscriptionEnd && new Date(subscriptionEnd).getTime() <= Date.now()
  );
  const subscriptionActive = Boolean(
    paymentVerified && subscriptionEnd && new Date(subscriptionEnd).getTime() > Date.now()
  );
  const subscriptionDaysLeft = getDaysRemaining(subscriptionEnd);
  const paymentSubmissions = useMemo(
    () =>
      requests.filter((item) => {
        const status = String(item.status || "").toLowerCase();
        return ["payment_submitted", "payment_verified"].includes(status) || Boolean(item.paymentProofImageUrl);
      }),
    [requests]
  );
  const sortedProducts = useMemo(
    () => [...products].sort((a: any, b: any) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [products]
  );
  const availableProducts = useMemo(() => sortedProducts.filter((item: any) => getProductState(item) === "available"), [sortedProducts]);
  const soldOutProducts = useMemo(() => sortedProducts.filter((item: any) => getProductState(item) === "soldout"), [sortedProducts]);
  const visibleProducts = productTab === "all" ? sortedProducts : productTab === "available" ? availableProducts : soldOutProducts;
  const todoStats = useMemo(
    () => ({
      waitingForFamilyPayment: requests.filter((item) => String(item.status || "").toLowerCase() === "awaiting_payment").length,
      requestsToReview: requests.filter((item) => String(item.status || "").toLowerCase() === "pending_shop_acceptance").length,
      servicesToPrepare: requests.filter((item) => String(item.status || "").toLowerCase() === "payment_verified").length,
      paymentsToVerify: requests.filter((item) => String(item.status || "").toLowerCase() === "payment_submitted").length,
      completed: requests.filter((item) => String(item.status || "").toLowerCase() === "completed").length,
      soldOut: soldOutProducts.length,
    }),
    [requests, soldOutProducts]
  );
  const scheduledRequestCount = useMemo(
    () =>
      requests.filter((item) => {
        const status = String(item.status || "").toLowerCase();
        return Boolean(item.wakeStartDate || item.wakeEndDate) && !["declined_by_shop", "cancelled", "completed"].includes(status);
      }).length,
    [requests]
  );
  const attentionTotal =
    todoStats.requestsToReview + todoStats.paymentsToVerify + todoStats.servicesToPrepare + todoStats.soldOut;
  const shopDisplayName = shopInfo?.shopName || businessInfo?.businessName || "My Shop";
  const shopLocation = shopInfo?.shopAddress || businessInfo?.generalLocation || "Add your storefront location";
  const shopContact = shopInfo?.shopPhoneNumber || "Add your contact number";
  const paymentDraftReady = Boolean(paymentQrDraftUrl && Number(paymentFeeInput) > 0);

  const handleBack = () => {
    if (typeof navigation?.canGoBack === "function" && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate("ProfileMain");
  };

  const resetShopDetailsDraft = () => {
    setShopNameInput(String(shopInfo?.shopName || ""));
    setShopAddressInput(String(shopInfo?.shopAddress || ""));
    setShopPhoneInput(String(shopInfo?.shopPhoneNumber || ""));
    setShopImageUrl(shopInfo?.shopImageUrl || null);
    setCoverImageUrl(shopInfo?.coverImageUrl || null);
  };

  const openVerifiedScreen = (
    routeName: "ServiceRequestsInbox" | "ServiceSchedule" | "ShopPayments" | "ShopCatalog" | "ShopCustomers" | "ShopReports",
    featureName: string
  ) => {
    if (!isVerified) {
      Alert.alert("Shop Approval Required", `Your shop must be approved before you can use ${featureName}.`);
      return;
    }

    navigation.navigate(routeName);
  };

  const closeShopDetails = () => {
    resetShopDetailsDraft();
    setShopDetailsVisible(false);
    setShopDetailsEditable(false);
  };

  const returnToMarketplace = () => {
    setSettingsVisible(false);
    const tabNavigator = navigation?.getParent?.();

    if (typeof tabNavigator?.navigate === "function") {
      tabNavigator.navigate("Home");
      return;
    }

    handleBack();
  };

  const handleGoLive = () => {
    const user = auth.currentUser;
    if (!user || shopStatus === "live" || savingStatus) return;

    if (!paymentVerified) {
      Alert.alert(
        "Payment Required",
        payment?.status === "pending"
          ? "Your registration payment is still under review. You can go live after an administrator verifies it."
          : "A verified registration payment is required before your shop can go live."
      );
      return;
    }

    if (subscriptionExpired) {
      Alert.alert(
        "Subscription Expired",
        "Your subscription expired on " + formatSubscriptionDate(subscriptionEnd) + ". Renew your registration payment before going live again."
      );
      return;
    }

    const now = new Date();
    const currentEnd = subscriptionEnd ? new Date(subscriptionEnd) : null;
    const nextEnd = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : new Date(now);
    if (!currentEnd || currentEnd.getTime() <= now.getTime()) {
      nextEnd.setMonth(nextEnd.getMonth() + 1);
    }
    const paidUntil = nextEnd.toISOString();

    Alert.alert(
      "Go Live?",
      "Buyers will be able to see your shop and products until " + formatSubscriptionDate(paidUntil) + ".",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Go Live",
          onPress: async () => {
            setSavingStatus(true);
            try {
              const { error } = await supabase
                .from("funeral_shops")
                .update({ status: "live", paidUntil, updatedAt: new Date().toISOString() })
                .eq("id", user.uid);
              if (error) throw error;
              setShopStatus("live");
              setShopInfo((current) => ({ ...(current || {}), paidUntil }));
              Alert.alert("Shop is Live", "Your storefront is now visible to buyers.");
            } catch (error: any) {
              Alert.alert("Action Failed", error?.message || "Unable to make your shop live.");
            } finally {
              setSavingStatus(false);
            }
          },
        },
      ]
    );
  };

  const handleGoOffline = () => {
    const user = auth.currentUser;
    if (!user || shopStatus !== "live" || savingStatus) return;

    Alert.alert(
      "Go Offline?",
      "Your shop and products will be hidden from buyers. Your subscription time will continue to run.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Go Offline",
          style: "destructive",
          onPress: async () => {
            setSavingStatus(true);
            try {
              const { error } = await supabase
                .from("funeral_shops")
                .update({ status: "offline", updatedAt: new Date().toISOString() })
                .eq("id", user.uid);
              if (error) throw error;
              setShopStatus("offline");
              Alert.alert("Shop is Offline", "Your storefront is now hidden from buyers.");
            } catch (error: any) {
              Alert.alert("Action Failed", error?.message || "Unable to take your shop offline.");
            } finally {
              setSavingStatus(false);
            }
          },
        },
      ]
    );
  };

  const toggleProductAvailability = (item: ShopProduct) => {
    if (!item.active && (item.stock ?? 0) <= 0) {
      Alert.alert("Stock Required", "Add stock before activating this product.");
      return;
    }

    const nextActive = !item.active;
    Alert.alert(
      nextActive ? "Activate Product?" : "Pause Product?",
      nextActive
        ? item.name + " will be available to buyers while your shop is live."
        : item.name + " will be hidden from buyers until you activate it again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: nextActive ? "Activate" : "Pause",
          style: nextActive ? "default" : "destructive",
          onPress: async () => {
            try {
              const updatedAt = new Date().toISOString();
              const { error } = await supabase
                .from("funeral_products")
                .update({ active: nextActive, updatedAt })
                .eq("id", item.id);
              if (error) throw error;
              setProducts((current) =>
                current.map((product) =>
                  product.id === item.id ? { ...product, active: nextActive, updatedAt } : product
                )
              );
            } catch (error: any) {
              Alert.alert("Update Failed", error?.message || "Unable to update the product.");
            }
          },
        },
      ]
    );
  };

  const verifyPayment = async (request: ServiceRequest) => {
    const user = auth.currentUser;
    if (!user || updatingRequestId) return;

    setUpdatingRequestId(request.id);
    try {
      const verifiedAt = new Date().toISOString();
      const { error } = await supabase
        .from("funeral_service_requests")
        .update({
          status: "payment_verified",
          paymentVerifiedAt: verifiedAt,
          paymentRejectionReason: null,
          updatedAt: verifiedAt,
        })
        .eq("id", request.id)
        .eq("status", "payment_submitted");
      if (error) throw error;

      setRequests((current) =>
        current.map((entry) =>
          entry.id === request.id
            ? { ...entry, status: "payment_verified", paymentVerifiedAt: verifiedAt, paymentRejectionReason: null }
            : entry
        )
      );

      try {
        await supabase.from("notifications").insert({
          userId: request.requesterId,
          type: "funeral_payment_verified",
          title: "Payment Verified",
          body: `${shopDisplayName} confirmed your payment for "${request.productName || "your request"}".`,
          data: { requestId: request.id, shopId: user.uid },
          read: false,
        });
      } catch (notificationError) {
        console.warn("Failed to create payment notification:", notificationError);
      }

      hapticSuccess();
      Alert.alert("Verified", "Payment verified. You can now prepare the casket and mark the request as completed once delivered.");
    } catch (error: any) {
      Alert.alert("Update Failed", error?.message || "Unable to verify this payment.");
    } finally {
      setUpdatingRequestId(null);
    }
  };

  const openRejectPayment = (request: ServiceRequest) => {
    setRejectPaymentRequest(request);
    setRejectPaymentText("");
    setRejectPaymentVisible(true);
  };

  const closeRejectPayment = () => {
    if (rejectingPayment) return;
    setRejectPaymentVisible(false);
    setRejectPaymentRequest(null);
    setRejectPaymentText("");
  };

  const confirmRejectPayment = async () => {
    const request = rejectPaymentRequest;
    const user = auth.currentUser;
    if (!request || !user || rejectingPayment) return;

    const reason = rejectPaymentText.trim();
    if (!reason) {
      Alert.alert("Reason Required", "Tell the family why the payment could not be verified.");
      return;
    }

    setRejectingPayment(true);
    try {
      const updatedAt = new Date().toISOString();
      const { error } = await supabase
        .from("funeral_service_requests")
        .update({
          status: "awaiting_payment",
          paymentVerifiedAt: null,
          paymentRejectionReason: reason,
          updatedAt,
        })
        .eq("id", request.id)
        .eq("status", "payment_submitted");
      if (error) throw error;

      setRequests((current) =>
        current.map((entry) =>
          entry.id === request.id
            ? {
                ...entry,
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
            : entry
        )
      );
      setRejectPaymentVisible(false);
      setRejectPaymentRequest(null);
      setRejectPaymentText("");
      Alert.alert("Rejected", "The family will be asked to review and resubmit their payment.");

      try {
        await supabase.from("notifications").insert({
          userId: request.requesterId,
          type: "funeral_payment_rejected",
          title: "Payment Needs Review",
          body: reason
            ? `${shopDisplayName} could not verify your payment: ${reason}`
            : `${shopDisplayName} could not verify your payment. Please review and resubmit.`,
          data: { requestId: request.id, shopId: user.uid },
          read: false,
        });
      } catch (notificationError) {
        console.warn("Failed to create rejection notification:", notificationError);
      }
    } catch (error: any) {
      Alert.alert("Update Failed", error?.message || "Unable to reject this payment.");
    } finally {
      setRejectingPayment(false);
    }
  };

  const saveShopDetails = async () => {
    const user = auth.currentUser;
    if (!user) return;


    if (!shopNameInput.trim() || !shopAddressInput.trim() || !shopPhoneInput.trim()) {
      Alert.alert("Missing fields", "Shop name, address, and phone number are required.");
      return;
    }

    setSavingShop(true);
    try {
      const { error } = await supabase
        .from("funeral_shops")
        .update({
          shopName: shopNameInput.trim(),
          shopAddress: shopAddressInput.trim(),
          shopPhoneNumber: shopPhoneInput.trim(),
          shopImageUrl: shopImageUrl || null,
          coverImageUrl: coverImageUrl || null,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", user.uid);
      if (error) throw error;

      setShopInfo((prev) => ({
        ...(prev || {}),
        shopName: shopNameInput.trim(),
        shopAddress: shopAddressInput.trim(),
        shopPhoneNumber: shopPhoneInput.trim(),
        shopImageUrl: shopImageUrl || null,
        coverImageUrl: coverImageUrl || null,
      }));
      setShopDetailsVisible(false);
      setShopDetailsEditable(false);
      Alert.alert("Saved", "Shop details updated.");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to save shop details.");
    } finally {
      setSavingShop(false);
    }
  };

  const pickAndUploadShopImage = async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.75,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingShopImage(true);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setShopImageUrl(url);
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Failed to upload shop image.");
    } finally {
      setUploadingShopImage(false);
    }
  };

  const pickAndUploadShopCover = async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.75,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingShopCover(true);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setCoverImageUrl(url);
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Failed to upload cover photo.");
    } finally {
      setUploadingShopCover(false);
    }
  };

  const resetPaymentSettingsDraft = () => {
    setPaymentQrDraftUrl(shopInfo?.paymentQrUrl || null);
    setPaymentFeeInput(
      shopInfo?.serviceFeeAmount != null && Number(shopInfo.serviceFeeAmount) > 0
        ? String(Number(shopInfo.serviceFeeAmount))
        : ""
    );
  };

  const openPaymentSettingsFromSettings = () => {
    setSettingsVisible(false);
    resetPaymentSettingsDraft();
    setTimeout(() => setPaymentSettingsVisible(true), 180);
  };

  const closePaymentSettings = () => {
    resetPaymentSettingsDraft();
    setPaymentSettingsVisible(false);
  };

  const pickAndUploadPaymentQr = async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.9,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingPaymentQr(true);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setPaymentQrDraftUrl(url);
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Failed to upload the payment QR code.");
    } finally {
      setUploadingPaymentQr(false);
    }
  };

  const savePaymentSettings = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const trimmed = paymentFeeInput.trim().replace(/[^\d.]/g, "");
    const parsedFee = Number(trimmed);
    if (!paymentFeeInput.trim() || !Number.isFinite(parsedFee) || parsedFee <= 0) {
      Alert.alert("Invalid Amount", "Enter a valid service fee amount your requesters must send.");
      return;
    }
    if (!paymentQrDraftUrl) {
      Alert.alert("QR Required", "Upload the QR code requesters will scan to pay you.");
      return;
    }

    setSavingPayment(true);
    try {
      const { error } = await supabase
        .from("funeral_shops")
        .update({
          paymentQrUrl: paymentQrDraftUrl,
          serviceFeeAmount: parsedFee,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", user.uid);
      if (error) throw error;

      setShopInfo((prev) => ({
        ...(prev || {}),
        paymentQrUrl: paymentQrDraftUrl,
        serviceFeeAmount: parsedFee,
      }));
      await loadData();
      setPaymentSettingsVisible(false);
      Alert.alert(
        "Payment Settings Saved",
        "When you accept a service request, the family will be shown this QR code and the amount to send you."
      );
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to save payment settings.");
    } finally {
      setSavingPayment(false);
    }
  };

  const removePaymentQr = () => {
    Alert.alert("Remove Payment QR?", "Requesters will no longer be shown a QR code to pay you. The fee amount will be kept.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove QR",
        style: "destructive",
        onPress: () => setPaymentQrDraftUrl(null),
      },
    ]);
  };

  const openAddProductPage = () => {
    navigation.navigate("ProductEditor");
  };

  const openEditProductPage = (item: ShopProduct) => {
    navigation.navigate("ProductEditor", { productId: item.id });
  };

  const openProductDetailsPage = (item: ShopProduct) => {
    navigation.navigate("ProductDetails", { productId: item.id });
  };

  const removeProduct = (item: ShopProduct) => {
    Alert.alert("Delete Product", `Remove ${item.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await supabase.from("funeral_products").delete().eq("id", item.id);
            setProducts(products.filter((entry) => entry.id !== item.id));
            Alert.alert("Deleted", "Product removed.");
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Failed to delete product.");
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <LoadingBird fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.screenBody}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroSection}>
            {coverImageUrl || shopImageUrl ? (
              <Image source={{ uri: coverImageUrl || shopImageUrl || "" }} style={styles.heroImage} resizeMode="cover" />
            ) : null}
            <View style={styles.heroOverlay} />
            <View style={styles.heroGlowTop} />
            <View style={styles.heroGlowBottom} />

            <View style={styles.topBar}>
              <AppBackButton onPress={handleBack} />

              <View style={styles.topBarText}>

                <Text style={styles.topBarTitle}>Shop Center</Text>
                </View>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open shop settings"
                activeOpacity={0.85}
                style={styles.settingsButton}
                onPress={() => navigation.navigate("ShopSettings")}
              >
                <Ionicons name="settings-outline" size={21} color="#22312d" />
              </TouchableOpacity>
             </View>

            <View style={styles.heroContent}>
              <View style={styles.heroAvatarWrap}>
                {shopImageUrl ? (
                  <Image source={{ uri: shopImageUrl }} style={styles.heroAvatarImage} resizeMode="cover" />
                ) : (
                  <View style={styles.heroAvatarFallback}>
                    <Ionicons name="storefront-outline" size={30} color="#22312d" />
                    </View>
                )}
                </View>

              <View style={styles.heroTextBlock}>
                <Text style={styles.heroTitle}>{shopDisplayName}</Text>
                <Text style={styles.heroSubtitle}>{shopLocation}</Text>
                <View style={styles.heroMetaRow}>
                  <Ionicons name="call-outline" size={14} color="#53615d" />
                  <Text style={styles.heroMetaText}>{shopContact}</Text>
                  </View>
               </View>
             </View>

          </View>

          <View style={[styles.statusBanner, { backgroundColor: statusMeta.background, borderColor: statusMeta.border }]}>
            <Ionicons name={shopStatus === "live" ? "checkmark-circle-outline" : shopStatus === "verified" ? "shield-checkmark-outline" : shopStatus === "offline" ? "moon-outline" : shopStatus === "rejected" ? "alert-circle-outline" : "time-outline"} size={18} color={statusMeta.text} />
            <View style={styles.statusBannerCopy}>
              <Text style={[styles.statusBannerTitle, { color: statusMeta.text }]}>{statusMeta.title}</Text>
              <Text style={[styles.statusBannerText, { color: statusMeta.text }]}>{statusMeta.message}</Text>
             </View>
          </View>

          <View style={styles.shopToolsSection}>
            <View style={styles.shopToolsHeader}>
              <View style={styles.sectionHeadingBlock}>
                <Text style={styles.shopToolsTitle}>Manage your shop</Text>
                <Text style={styles.shopToolsSubtitle}>Cases, customers, schedule, catalog, payments, and reports in one place.</Text>
              </View>
              {attentionTotal > 0 ? (
                <View style={styles.attentionCountBadge}>
                  <Text style={styles.attentionCountBadgeText}>{attentionTotal}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.shopToolsGrid}>
              {([
                {
                  key: "products",
                  label: "Product catalog",
                  description:
                    todoStats.soldOut > 0 ? `${todoStats.soldOut} unavailable listings` : `${sortedProducts.length} listings`,
                  icon: "cube-outline",
                  badge: todoStats.soldOut,
                  urgent: todoStats.soldOut > 0,
                  onPress: () => openVerifiedScreen("ShopCatalog", "the product catalog"),
                },
                {
                  key: "requests",
                  label: "Arrangement cases",
                  description: isVerified
                    ? todoStats.requestsToReview > 0
                      ? `${todoStats.requestsToReview} waiting for review`
                      : "Open the full inbox"
                    : "Available after approval",
                  icon: isVerified ? "mail-open-outline" : "lock-closed-outline",
                  badge: todoStats.requestsToReview,
                  urgent: todoStats.requestsToReview > 0,
                  onPress: () => openVerifiedScreen("ServiceRequestsInbox", "arrangement cases"),
                },
                {
                  key: "customers",
                  label: "Customers",
                  description: isVerified ? "Family contacts and case history" : "Available after approval",
                  icon: isVerified ? "people-outline" : "lock-closed-outline",
                  badge: 0,
                  urgent: false,
                  onPress: () => openVerifiedScreen("ShopCustomers", "customers"),
                },
                {
                  key: "payments",
                  label: "Family payments",
                  description:
                    todoStats.paymentsToVerify > 0 ? `${todoStats.paymentsToVerify} receipts to verify` : "Review payment history",
                  icon: isVerified ? "wallet-outline" : "lock-closed-outline",
                  badge: todoStats.paymentsToVerify,
                  urgent: todoStats.paymentsToVerify > 0,
                  onPress: () => openVerifiedScreen("ShopPayments", "family payments"),
                },
                {
                  key: "schedule",
                  label: "Service schedule",
                  description: isVerified
                    ? scheduledRequestCount > 0
                      ? `${scheduledRequestCount} services planned`
                      : "Plan services and events"
                    : "Available after approval",
                  icon: isVerified ? "calendar-clear-outline" : "lock-closed-outline",
                  badge: 0,
                  urgent: false,
                  onPress: () => openVerifiedScreen("ServiceSchedule", "the service schedule"),
                },
                {
                  key: "reports",
                  label: "Reports",
                  description: isVerified ? "Sales, cases, and inventory health" : "Available after approval",
                  icon: isVerified ? "bar-chart-outline" : "lock-closed-outline",
                  badge: 0,
                  urgent: false,
                  onPress: () => openVerifiedScreen("ShopReports", "shop reports"),
                },
              ] as {
                key: string;
                label: string;
                description: string;
                icon: IoniconName;
                badge: number;
                urgent: boolean;
                onPress: () => void;
              }[]).map((entry, index) => (
                <View key={entry.key} style={styles.shopToolGroupEntry}>
                  {index === 0 || index === 1 ? (
                    <View style={styles.shopToolGroupHeader}>
                      <Text style={styles.shopToolGroupLabel}>{index === 0 ? "STORE MANAGEMENT" : "OPERATIONS"}</Text>
                      <Text style={styles.shopToolGroupDescription}>
                        {index === 0
                          ? "Keep your product listings accurate and available."
                          : "Cases, customers, payments, schedules, and reporting."}
                      </Text>
                    </View>
                  ) : null}
                  <TouchableOpacity
                    activeOpacity={0.88}
                    accessibilityRole="button"
                    accessibilityLabel={`${entry.label}. ${entry.description}`}
                    style={[styles.shopToolCard, entry.urgent ? styles.shopToolCardUrgent : null]}
                    onPress={entry.onPress}
                  >
                    <View style={styles.shopToolIcon}>
                      <Ionicons name={entry.icon} size={21} color="#42534d" />
                    </View>
                    <View style={styles.shopToolCopy}>
                      <Text style={styles.shopToolLabel}>{entry.label}</Text>
                      <Text style={styles.shopToolDescription} numberOfLines={2}>
                        {entry.description}
                      </Text>
                    </View>
                    <View style={styles.shopToolTrailing}>
                      {entry.badge > 0 ? (
                        <View style={styles.shopToolBadge}>
                          <Text style={styles.shopToolBadgeText}>{entry.badge > 99 ? "99+" : entry.badge}</Text>
                        </View>
                      ) : null}
                      <View style={styles.shopToolArrow}>
                        <Ionicons name="chevron-forward" size={16} color="#61706b" />
                      </View>
                    </View>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>

          <View>
          {centerSection === "overview" && attentionTotal > 0 ? (
            <View style={styles.sectionCard}>
              <View style={styles.attentionHeader}>
                <View style={styles.attentionHeaderIcon}>
                  <Ionicons name={attentionTotal > 0 ? "sparkles-outline" : "checkmark-circle-outline"} size={20} color="#ffffff" />
                </View>
                <View style={styles.sectionHeadingBlock}>
                  <Text style={styles.sectionTitle}>Needs your attention</Text>
                  <Text style={styles.sectionSubtitle}>
                    Start with these items. They are sorted by the action your shop needs to take.
                  </Text>
                </View>
              </View>

              {todoStats.requestsToReview > 0 ? (
                <TouchableOpacity style={styles.attentionRow} onPress={() => openVerifiedScreen("ServiceRequestsInbox", "the request inbox")}>
                  <View style={styles.attentionNumber}><Text style={styles.attentionNumberText}>{todoStats.requestsToReview}</Text></View>
                  <View style={styles.attentionRowCopy}>
                    <Text style={styles.attentionRowTitle}>Review new service requests</Text>
                    <Text style={styles.attentionRowText}>Accept or decline requests from families.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#89938e" />
                </TouchableOpacity>
              ) : null}

              {todoStats.paymentsToVerify > 0 ? (
                <TouchableOpacity style={styles.attentionRow} onPress={() => openVerifiedScreen("ShopPayments", "family payments")}>
                  <View style={styles.attentionNumber}><Text style={styles.attentionNumberText}>{todoStats.paymentsToVerify}</Text></View>
                  <View style={styles.attentionRowCopy}>
                    <Text style={styles.attentionRowTitle}>Verify payment receipts</Text>
                    <Text style={styles.attentionRowText}>Confirm or reject submitted payment proof.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#89938e" />
                </TouchableOpacity>
              ) : null}

              {todoStats.servicesToPrepare > 0 ? (
                <TouchableOpacity style={styles.attentionRow} onPress={() => openVerifiedScreen("ServiceSchedule", "the service schedule")}>
                  <View style={styles.attentionNumber}><Text style={styles.attentionNumberText}>{todoStats.servicesToPrepare}</Text></View>
                  <View style={styles.attentionRowCopy}>
                    <Text style={styles.attentionRowTitle}>Prepare confirmed services</Text>
                    <Text style={styles.attentionRowText}>Check dates and coordinate the next service steps.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#89938e" />
                </TouchableOpacity>
              ) : null}

              {todoStats.soldOut > 0 ? (
                <TouchableOpacity
                  style={styles.attentionRow}
                  onPress={() => {
                    if (!isVerified) {
                      Alert.alert("Shop Approval Required", "Your shop must be approved before you can use the product catalog.");
                      return;
                    }
                    navigation.navigate("ShopCatalog", { initialFilter: "soldout" });
                  }}
                >
                  <View style={styles.attentionNumber}><Text style={styles.attentionNumberText}>{todoStats.soldOut}</Text></View>
                  <View style={styles.attentionRowCopy}>
                    <Text style={styles.attentionRowTitle}>Restock unavailable products</Text>
                    <Text style={styles.attentionRowText}>Update stock before making these listings available.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#89938e" />
                </TouchableOpacity>
              ) : null}

            </View>
          ) : null}

          {centerSection === "overview" && analytics ? (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionHeadingBlock}>
                  <Text style={styles.sectionTitle}>Sales Analytics</Text>
                  <Text style={styles.sectionSubtitle}>Last 6 months</Text>
                  </View>
                <TouchableOpacity style={styles.refreshButton} onPress={() => void loadData()}>
                  <Ionicons name="refresh-outline" size={16} color="#22312d" />
                </TouchableOpacity>
                </View>

              <View style={styles.analyticsGrid}>
                <View style={styles.analyticsItem}>
                  <Text style={styles.analyticsValue}>{formatPhilippinePeso(analytics.totalRevenue)}</Text>
                  <Text style={styles.analyticsLabel}>Total Revenue</Text>
                </View>
                <View style={styles.analyticsItem}>
                  <Text style={styles.analyticsValue}>{formatPhilippinePeso(analytics.revenueThisMonth)}</Text>
                  <Text style={styles.analyticsLabel}>This Month ({analytics.salesThisMonth})</Text>
                </View>
                <View style={styles.analyticsItem}>
                  <Text style={styles.analyticsValue}>{analytics.totalSales}</Text>
                  <Text style={styles.analyticsLabel}>Confirmed Sales</Text>
                </View>
                <View style={styles.analyticsItem}>
                  <Text style={styles.analyticsValue}>{formatPhilippinePeso(analytics.avgOrderValue)}</Text>
                  <Text style={styles.analyticsLabel}>Avg. Order Value</Text>
                </View>
              </View>

              <View style={styles.analyticsChartBlock}>
                <Text style={styles.analyticsChartTitle}>Revenue — Last 6 Months</Text>
                <SimpleBarChart
                  data={analytics.monthlyRevenue}
                  formatValue={formatCompactPeso}
                  showValues
                  barColor="#0958d9"
                  height={150}
                />
              </View>

              <View style={styles.analyticsChartBlock}>
                <Text style={styles.analyticsChartTitle}>Confirmed Sales — Last 6 Months</Text>
                <SimpleBarChart
                  data={analytics.monthlySales}
                  showValues
                  barColor="#166534"
                  height={150}
                />
              </View>

              {analytics.breakdown.length > 0 ? (
                <View style={styles.analyticsChartBlock}>
                  <Text style={styles.analyticsChartTitle}>Request Status</Text>
                  {analytics.breakdown.map((item) => {
                    const max = analytics.breakdown.reduce((m, b) => Math.max(m, b.value), 1);
                    const ratio = item.value / max;
                    return (
                      <View key={item.label} style={styles.analyticsRow}>
                        <Text style={styles.analyticsRowLabel}>{item.label}</Text>
                        <View style={styles.analyticsTrack}>
                          <View
                            style={[
                              styles.analyticsFill,
                              {
                                width: `${Math.max(2, Math.round(ratio * 100))}%`,
                                backgroundColor: item.color,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.analyticsRowValue}>{item.value}</Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

          {centerSection === "payments" ? (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionHeadingBlock}>
                  <Text style={styles.sectionTitle}>Payments</Text>
                  <Text style={styles.sectionSubtitle}>Review submitted payment proof.</Text>
                  </View>
                <TouchableOpacity style={styles.refreshButton} onPress={() => void loadData()}>
                  <Ionicons name="refresh-outline" size={16} color="#22312d" />
                </TouchableOpacity>
                </View>

              {paymentSubmissions.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="cash-outline" size={24} color="#8b938c" />
                  <Text style={styles.emptyStateTitle}>No payments yet</Text>
                  <Text style={styles.emptyStateText}>
                    When a user submits a payment for one of your requests, it will appear here for review and verification.
                  </Text>
                  </View>
              ) : (
                paymentSubmissions.map((item) => {
                  const status = String(item.status || "").toLowerCase();
                  const submitted = status === "payment_submitted";
                  const verified = status === "payment_verified";
                  const rejected = status === "awaiting_payment" && Boolean(item.paymentRejectionReason);

                  return (
                    <View key={item.id} style={styles.paymentCard}>
                      <View style={styles.orderCardTop}>
                        <View style={styles.orderCardTitleBlock}>
                          <Text style={styles.orderProductName} numberOfLines={1}>
                            {item.productName || "Custom Casket"}
                          </Text>
                          </View>
                        <View style={[styles.orderStatusBadge, verified ? styles.orderStatusDone : submitted ? styles.paymentStatusPending : styles.orderStatusWaiting]}>
                          <Text style={styles.orderStatusText}>
                            {submitted ? "Awaiting Verification" : verified ? "Verified" : rejected ? "Rejected" : getRequestStatusLabel(item.status)}
                          </Text>
                          </View>
                        </View>

                      <View style={styles.paymentCompactSummary}>
                        <Text style={styles.paymentCompactAmount}>
                          {Number(item.paymentAmount) > 0
                            ? formatPhilippinePeso(String(item.paymentAmount))
                            : "Amount not provided"}
                        </Text>
                        <Text style={styles.paymentCompactMeta} numberOfLines={1}>
                          {item.paymentPayerName || "Unknown sender"}
                          {item.paymentSubmittedAt
                            ? ` | ${new Date(item.paymentSubmittedAt).toLocaleDateString()}`
                            : ""}
                        </Text>
                        </View>

                      {item.paymentProofImageUrl ? (
                        <TouchableOpacity
                          activeOpacity={0.85}
                          style={styles.receiptCompactButton}
                          onPress={() => setReceiptRequest(item)}
                          accessibilityRole="button"
                          accessibilityLabel={`View payment receipt for ${item.productName || "service request"}`}
                        >
                          <View style={styles.receiptCompactIcon}>
                            <Ionicons name="receipt-outline" size={18} color="#7f6653" />
                            </View>
                          <View style={styles.receiptCompactCopy}>
                            <Text style={styles.receiptCompactTitle}>View receipt</Text>
                            <Text style={styles.receiptCompactCaption}>Payment proof and complete details</Text>
                            </View>
                          <Ionicons name="chevron-forward" size={18} color="#8a948f" />
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.receiptUnavailableRow}>
                          <Ionicons name="image-outline" size={17} color="#8a948f" />
                          <Text style={styles.receiptUnavailableText}>Receipt image unavailable</Text>
                          </View>
                      )}

                      {submitted ? (
                        <View style={styles.orderActionRow}>
                          <TouchableOpacity
                            style={[styles.orderAcceptButton, updatingRequestId === item.id ? styles.heroButtonDisabled : null]}
                            onPress={() => verifyPayment(item)}
                            disabled={updatingRequestId === item.id}
                          >
                            <Text style={styles.orderAcceptButtonText}>
                              {updatingRequestId === item.id ? "Updating..." : "Verify Payment"}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.orderDeclineButton, updatingRequestId === item.id ? styles.heroButtonDisabled : null]}
                            onPress={() => openRejectPayment(item)}
                            disabled={updatingRequestId === item.id}
                          >
                            <Text style={styles.orderDeclineButtonText}>Reject Payment</Text>
                          </TouchableOpacity>
                          </View>
                      ) : null}
                      </View>
                  );
                })
              )}
             </View>
          ) : null}

          {centerSection === "products" ? (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeadingBlock}>
                <Text style={styles.sectionTitle}>Browse Products</Text>
                <Text style={styles.sectionSubtitle}>Update stock, availability, and listing details.</Text>
                </View>
              <View style={styles.catalogActions}>
                <TouchableOpacity style={styles.refreshButton} onPress={() => void loadData()}>
                  <Ionicons name="refresh-outline" size={16} color="#22312d" />
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.92}
                  style={[styles.catalogAddButton, !isVerified ? styles.catalogAddButtonDisabled : null]}
                  onPress={openAddProductPage}
                  disabled={!isVerified}
                >
                  <Ionicons name="add" size={16} color={isVerified ? "#22312d" : "#8b938c"} />
                  <Text style={[styles.catalogAddButtonText, !isVerified ? styles.catalogAddButtonTextDisabled : null]}>Add Product</Text>
                </TouchableOpacity>
                </View>
             </View>

            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tabButton, productTab === "all" ? styles.tabButtonActive : null]}
                onPress={() => setProductTab("all")}
              >
                <Text style={[styles.tabButtonText, productTab === "all" ? styles.tabButtonTextActive : null]}>All ({sortedProducts.length})</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, productTab === "available" ? styles.tabButtonActive : null]}
                onPress={() => setProductTab("available")}
              >
                <Text style={[styles.tabButtonText, productTab === "available" ? styles.tabButtonTextActive : null]}>Available ({availableProducts.length})</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, productTab === "soldout" ? styles.tabButtonActive : null]}
                onPress={() => setProductTab("soldout")}
              >
                <Text style={[styles.tabButtonText, productTab === "soldout" ? styles.tabButtonTextActive : null]}>
                  Sold Out ({soldOutProducts.length})
                </Text>
              </TouchableOpacity>
             </View>

            {visibleProducts.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="albums-outline" size={22} color="#8b938c" />
                <Text style={styles.emptyStateTitle}>Nothing in this tab yet</Text>
                <Text style={styles.emptyStateText}>Add a product or switch tabs to review the rest of your catalog.</Text>
                </View>
            ) : (
              visibleProducts.map((item: any) => (
                <ProductCard
                  key={item.id}
                  item={item}
                  onPress={() => openProductDetailsPage(item)}
                  onEdit={() => openEditProductPage(item)}
                  onToggle={() => toggleProductAvailability(item)}
                  onDelete={() => removeProduct(item)}
                />
              ))
            )}
          </View>
          ) : null}
          </View>
        </ScrollView>
      </View>

      <Modal visible={settingsVisible} transparent animationType="fade" onRequestClose={() => setSettingsVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSettingsVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.settingsCard}>
            <View style={styles.settingsHeader}>
              <View style={styles.settingsTitleRow}>
                <View style={styles.settingsTitleIcon}>
                  <Ionicons name="settings-outline" size={20} color="#22312d" />
                  </View>
                <View style={styles.settingsTitleCopy}>
                  <Text style={styles.modalTitle}>Settings</Text>
                  <Text style={styles.settingsCaption}>Manage payment preferences or return to the marketplace.</Text>
                  </View>
                </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close settings"
                style={styles.settingsCloseButton}
                onPress={() => setSettingsVisible(false)}
              >
                <Ionicons name="close" size={21} color="#53615d" />
              </TouchableOpacity>
             </View>


            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.settingsRow, !isVerified ? styles.settingsRowDisabled : null]}
              onPress={openPaymentSettingsFromSettings}
              disabled={!isVerified}
            >
              <View style={styles.settingsRowIcon}>
                <Ionicons name="qr-code-outline" size={20} color={isVerified ? "#7f6653" : "#9ba19d"} />
                </View>
              <View style={styles.settingsRowCopy}>
                <Text style={[styles.settingsRowTitle, !isVerified ? styles.settingsRowTextDisabled : null]}>
                  Payment QR & Amount
                </Text>
                <Text style={styles.settingsRowDescription}>
                  {shopInfo?.paymentQrUrl
                    ? "Set the QR code and fee families send you after you accept a request."
                    : "Add the QR code and fee families send after you accept a request."}
                </Text>
                </View>
              <Ionicons name="chevron-forward" size={18} color="#9aa39d" />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.settingsRow, !isVerified ? styles.settingsRowDisabled : null]}
              onPress={() => {
                setSettingsVisible(false);
                setTimeout(() => setAdminPaymentsVisible(true), 180);
              }}
              disabled={!isVerified}
            >
              <View style={styles.settingsRowIcon}>
                <Ionicons name="card-outline" size={20} color={isVerified ? "#7f6653" : "#9ba19d"} />
                </View>
              <View style={styles.settingsRowCopy}>
                <Text style={[styles.settingsRowTitle, !isVerified ? styles.settingsRowTextDisabled : null]}>
                  Payments to Admin
                </Text>
                <Text style={styles.settingsRowDescription}>
                  View your registration payments to LifeCycle and submit a new payment or renewal.
                </Text>
                </View>
              <Ionicons name="chevron-forward" size={18} color="#9aa39d" />
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.85} style={styles.settingsRow} onPress={returnToMarketplace}>
              <View style={styles.settingsRowIcon}>
                <Ionicons name="arrow-back-outline" size={20} color="#7f6653" />
                </View>
              <View style={styles.settingsRowCopy}>
                <Text style={styles.settingsRowTitle}>Back to Marketplace</Text>
                <Text style={styles.settingsRowDescription}>Leave Shop Center and browse the funeral marketplace.</Text>
                </View>
              <Ionicons name="chevron-forward" size={18} color="#9aa39d" />
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <AdminPaymentModal
        visible={adminPaymentsVisible}
        onClose={() => setAdminPaymentsVisible(false)}
        onChanged={() => void loadData()}
      />

      <Modal visible={shopDetailsVisible} transparent animationType="fade" onRequestClose={closeShopDetails}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeShopDetails} />
          <View style={[styles.modalCard, styles.shopDetailsModalCard]}>
            <KeyboardAwareScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              scrollEnabled
              overScrollMode="always"
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.modalTitle}>{shopDetailsEditable ? "Shop Profile" : "Shop Details"}</Text>
              <Text style={styles.modalCaption}>
                {shopDetailsEditable
                  ? "Update the storefront image and core business details that customers see first."
                  : "Review your storefront and registered business information."}
              </Text>

              {shopDetailsEditable && isVerified ? (
                <View style={[styles.shopStatusCard, subscriptionExpired ? styles.statusControlExpired : null]}>
                  <View style={styles.statusControlHeader}>
                    <View style={styles.sectionHeadingBlock}>
                      <Text style={styles.shopStatusCardTitle}>Shop Status</Text>
                      <Text style={styles.shopStatusCardDesc}>
                        {subscriptionExpired
                          ? "Your subscription has expired and your storefront is hidden from buyers."
                          : shopStatus === "live"
                            ? "Your shop is online and buyers can browse products and send requests."
                            : paymentVerified
                              ? "Your shop is offline and hidden from buyers. Use Go Live when you are ready."
                              : payment?.status === "pending"
                                ? "Your payment is under review. Status control unlocks after verification."
                                : "A verified registration payment is required to go live."}
                      </Text>
                      </View>
                    <View style={[styles.statusChip, { backgroundColor: statusMeta.chipBackground }]}>
                      <Text style={[styles.statusChipText, { color: statusMeta.chipText }]}>{statusMeta.label}</Text>
                      </View>
                    </View>

                  {subscriptionActive ? (
                    <View style={styles.subscriptionPill}>
                      <Ionicons name="calendar-outline" size={15} color="#1e5b3a" />
                      <Text style={styles.subscriptionPillText}>
                        Active until {formatSubscriptionDate(subscriptionEnd)} · {subscriptionDaysLeft} day{subscriptionDaysLeft === 1 ? "" : "s"} left
                      </Text>
                      </View>
                  ) : subscriptionExpired ? (
                    <View style={[styles.subscriptionPill, styles.subscriptionPillExpired]}>
                      <Ionicons name="alert-circle-outline" size={15} color="#8f2525" />
                      <Text style={[styles.subscriptionPillText, styles.subscriptionPillTextExpired]}>
                        Expired on {formatSubscriptionDate(subscriptionEnd)}
                      </Text>
                      </View>
                  ) : null}

                  <TouchableOpacity
                    style={[
                      styles.statusControlButton,
                      shopStatus === "live" ? styles.statusControlButtonOffline : null,
                      savingStatus ? styles.heroButtonDisabled : null,
                    ]}
                    onPress={shopStatus === "live" ? handleGoOffline : handleGoLive}
                    disabled={savingStatus}
                  >
                    {savingStatus ? <ActivityIndicator size="small" color="#ffffff" /> : (
                      <Ionicons name={shopStatus === "live" ? "moon-outline" : "radio-outline"} size={18} color="#ffffff" />
                    )}
                    <Text style={styles.statusControlButtonText}>
                      {savingStatus ? "Updating..." : subscriptionExpired ? "Renewal Required" : shopStatus === "live" ? "Go Offline" : "Go Live"}
                    </Text>
                  </TouchableOpacity>
                  </View>
              ) : null}

              {shopDetailsEditable ? (
                <>
                  <View style={styles.editPhotoCard}>
                    {coverImageUrl ? (
                      <Image source={{ uri: coverImageUrl }} style={styles.editCoverPreview} resizeMode="cover" />
                    ) : (
                      <View style={styles.editCoverFallback}>
                        <Ionicons name="image-outline" size={30} color="#c2c9c3" />
                        <Text style={styles.editCoverFallbackText}>No cover photo</Text>
                        </View>
                    )}

                    <View style={styles.editAvatarWrap}>
                      {shopImageUrl ? (
                        <Image source={{ uri: shopImageUrl }} style={styles.editAvatar} resizeMode="cover" />
                      ) : (
                        <View style={styles.editAvatarFallback}>
                          <Ionicons name="storefront-outline" size={30} color="#22312d" />
                          </View>
                      )}
                      </View>
                    </View>

                  <View style={styles.editPhotoButtons}>
                    <TouchableOpacity style={styles.modalOutlineButton} onPress={pickAndUploadShopCover} disabled={uploadingShopCover}>
                      {uploadingShopCover ? <ActivityIndicator size="small" color="#7f6653" /> : <Ionicons name="image-outline" size={18} color="#7f6653" />}
                      <Text style={styles.modalOutlineButtonText}>{uploadingShopCover ? "Uploading..." : "Edit Cover Photo"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.modalOutlineButton} onPress={pickAndUploadShopImage} disabled={uploadingShopImage}>
                      {uploadingShopImage ? <ActivityIndicator size="small" color="#7f6653" /> : <Ionicons name="camera-outline" size={18} color="#7f6653" />}
                      <Text style={styles.modalOutlineButtonText}>{uploadingShopImage ? "Uploading..." : "Edit Profile Picture"}</Text>
                    </TouchableOpacity>
                    </View>

                  <Text style={styles.inputLabel}>Shop Name</Text>
                  <TextInput style={styles.input} value={shopNameInput} onChangeText={setShopNameInput} />

                  <Text style={styles.inputLabel}>Shop Address</Text>
                  <TextInput style={styles.input} value={shopAddressInput} onChangeText={setShopAddressInput} />

                  <Text style={styles.inputLabel}>Phone Number</Text>
                  <TextInput
                    style={styles.input}
                    value={shopPhoneInput}
                    onChangeText={setShopPhoneInput}
                    keyboardType="phone-pad"
                  />

                  <View style={styles.modalActionStack}>
                    <TouchableOpacity style={styles.modalPrimaryButton} onPress={saveShopDetails} disabled={savingShop}>
                      {savingShop ? <ActivityIndicator size="small" color="#fff8f1" /> : null}
                      <Text style={styles.modalPrimaryButtonText}>Save Details</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.modalGhostButton} onPress={closeShopDetails}>
                      <Text style={styles.modalGhostButtonText}>Close</Text>
                    </TouchableOpacity>
                    </View>
                </>
              ) : (
                <>
                  <View style={styles.readOnlyDetailsSection}>
                    <Text style={styles.readOnlySectionTitle}>Storefront Information</Text>
                    <DetailRow icon="storefront-outline" label="Shop Name" value={shopInfo?.shopName || "Not provided"} />
                    <DetailRow icon="location-outline" label="Shop Address" value={shopInfo?.shopAddress || "Not provided"} />
                    <DetailRow icon="call-outline" label="Phone Number" value={shopInfo?.shopPhoneNumber || "Not provided"} />
                    </View>

                  <View style={styles.readOnlyDetailsSection}>
                    <Text style={styles.readOnlySectionTitle}>Registered Business Information</Text>
                    <DetailRow icon="business-outline" label="Business Name" value={businessInfo?.businessName || "Not provided"} />
                    <DetailRow icon="person-outline" label="Registered Owner" value={businessInfo?.individualRegisteredName || "Not provided"} />
                    <DetailRow icon="map-outline" label="General Location" value={businessInfo?.generalLocation || "Not provided"} />
                    <DetailRow icon="navigate-outline" label="Registered Address" value={businessInfo?.registeredAddress || "Not provided"} />
                    <DetailRow icon="mail-outline" label="ZIP Code" value={businessInfo?.zipCode || "Not provided"} />
                    <DetailRow icon="document-text-outline" label="TIN" value={businessInfo?.tin || "Not provided"} />
                    <DetailRow icon="receipt-outline" label="VAT Status" value={businessInfo?.vatRegistrationStatus || "Not provided"} />
                    </View>

                  <View style={styles.readOnlyActions}>
                    <TouchableOpacity style={styles.modalPrimaryButton} onPress={() => setShopDetailsEditable(true)}>
                      <Ionicons name="create-outline" size={17} color="#ffffff" />
                      <Text style={styles.modalPrimaryButtonText}>Edit Shop Profile</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.modalGhostButton} onPress={closeShopDetails}>
                      <Text style={styles.modalGhostButtonText}>Close</Text>
                    </TouchableOpacity>
                    </View>
                </>
              )}
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={paymentSettingsVisible} transparent animationType="fade" onRequestClose={closePaymentSettings}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closePaymentSettings} />
          <View style={[styles.modalCard, styles.shopDetailsModalCard]}>
            <KeyboardAwareScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              scrollEnabled
              overScrollMode="always"
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.paymentSettingsHeader}>
                <View style={styles.paymentSettingsHeaderIcon}>
                  <Ionicons name="qr-code-outline" size={22} color="#22312d" />
                </View>
                <View style={styles.paymentSettingsHeaderCopy}>
                  <Text style={styles.modalTitle}>Payment QR & Amount</Text>
                  <Text style={styles.paymentSettingsHeaderCaption}>Set how families pay after you accept a request.</Text>
                </View>
                <TouchableOpacity style={styles.paymentSettingsClose} onPress={closePaymentSettings} accessibilityLabel="Close payment settings">
                  <Ionicons name="close" size={20} color="#53615d" />
                </TouchableOpacity>
              </View>

              <View style={[styles.paymentSetupSummary, paymentDraftReady ? styles.paymentSetupSummaryReady : null]}>
                <View style={[styles.paymentSetupStatusDot, paymentDraftReady ? styles.paymentSetupStatusDotReady : null]} />
                <View style={styles.paymentSetupSummaryCopy}>
                  <Text style={styles.paymentSetupSummaryTitle}>{paymentDraftReady ? "Ready to receive payments" : "Finish payment setup"}</Text>
                  <Text style={styles.paymentSetupSummaryText}>
                    {paymentDraftReady
                      ? "Your QR code and default amount are ready for accepted requests."
                      : "Add both a QR code and an amount before saving."}
                  </Text>
                </View>
              </View>

              <View style={styles.paymentSetupSection}>
                <View style={styles.paymentSetupSectionHeader}>
                  <View style={styles.paymentSetupStep}><Text style={styles.paymentSetupStepText}>1</Text></View>
                  <View style={styles.paymentSetupSectionCopy}>
                    <Text style={styles.paymentSetupSectionTitle}>Payment QR Code</Text>
                    <Text style={styles.paymentSetupSectionText}>Upload the GCash or e-wallet QR families will scan.</Text>
                  </View>
                </View>
              {paymentQrDraftUrl ? (
                <View style={styles.paymentQrPreviewWrap}>
                  <Image source={{ uri: paymentQrDraftUrl }} style={styles.paymentQrPreview} resizeMode="contain" />
                  <View style={styles.paymentQrPreviewActions}>
                    <TouchableOpacity
                      style={[styles.modalOutlineButton, styles.paymentQrInlineButton]}
                      onPress={pickAndUploadPaymentQr}
                      disabled={uploadingPaymentQr}
                    >
                      {uploadingPaymentQr ? <ActivityIndicator size="small" color="#7f6653" /> : <Ionicons name="image-outline" size={18} color="#7f6653" />}
                      <Text style={styles.modalOutlineButtonText}>Replace QR</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.modalOutlineButton, styles.paymentQrInlineButton]} onPress={removePaymentQr} disabled={savingPayment}>
                      <Ionicons name="trash-outline" size={18} color="#912929" />
                      <Text style={[styles.modalOutlineButtonText, styles.paymentQrRemoveText]}>Remove QR</Text>
                    </TouchableOpacity>
                    </View>
                  </View>
              ) : (
                <TouchableOpacity style={styles.paymentQrEmpty} onPress={pickAndUploadPaymentQr} disabled={uploadingPaymentQr}>
                  {uploadingPaymentQr ? (
                    <ActivityIndicator size="small" color="#7f6653" />
                  ) : (
                    <Ionicons name="qr-code-outline" size={34} color="#c2c9c3" />
                  )}
                  <Text style={styles.paymentQrEmptyText}>
                    {uploadingPaymentQr ? "Uploading..." : "Tap to upload your QR code image"}
                  </Text>
                </TouchableOpacity>
              )}

              </View>

              <View style={styles.paymentSetupSection}>
                <View style={styles.paymentSetupSectionHeader}>
                  <View style={styles.paymentSetupStep}><Text style={styles.paymentSetupStepText}>2</Text></View>
                  <View style={styles.paymentSetupSectionCopy}>
                    <Text style={styles.paymentSetupSectionTitle}>Default Payment Amount</Text>
                    <Text style={styles.paymentSetupSectionText}>This amount is shown when a service request is accepted.</Text>
                  </View>
                </View>

              <Text style={styles.inputLabel}>Amount Requesters Must Send (₱)</Text>
              <TextInput
                style={[styles.input, styles.paymentAmountInput]}
                value={paymentFeeInput}
                onChangeText={setPaymentFeeInput}
                placeholder="e.g. 2000"
                keyboardType="decimal-pad"
              />
              </View>

              <View style={styles.paymentQrInfoCard}>
                <Ionicons name="information-circle-outline" size={18} color="#7f6653" />
                <Text style={styles.paymentQrInfoText}>
                  Families will only see this QR code and amount after you accept their request.
                </Text>
                </View>

              <View style={styles.modalActionStack}>
                <TouchableOpacity
                  style={[styles.modalPrimaryButton, !paymentDraftReady || savingPayment ? styles.paymentSetupSaveDisabled : null]}
                  onPress={savePaymentSettings}
                  disabled={savingPayment || !paymentDraftReady}
                >
                  {savingPayment ? (
                    <ActivityIndicator size="small" color="#fff8f1" />
                  ) : (
                    <Ionicons name="checkmark-circle-outline" size={18} color="#ffffff" />
                  )}
                  <Text style={styles.modalPrimaryButtonText}>{savingPayment ? "Saving..." : "Save Payment Settings"}</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(receiptRequest)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setReceiptRequest(null)}
      >
        <SafeAreaView style={styles.receiptModalSafeArea}>
          <View style={styles.receiptModalHeader}>
            <AppBackButton
              onPress={() => setReceiptRequest(null)}
              accessibilityLabel="Back from payment receipt"
            />
            <View style={styles.receiptModalHeading}>
              <Text style={styles.receiptModalTitle} numberOfLines={1}>
                {receiptRequest?.productName || "Service Request"}
              </Text>
            </View>
          </View>

          <ScrollView
            style={styles.receiptModalScroll}
            contentContainerStyle={styles.receiptModalContent}
            showsVerticalScrollIndicator={false}
          >
            {receiptRequest?.paymentProofImageUrl ? (
              <Image
                source={{ uri: receiptRequest.paymentProofImageUrl }}
                style={styles.receiptModalImage}
                resizeMode="contain"
                accessibilityLabel="Uploaded payment receipt"
              />
            ) : null}

            <View style={styles.receiptInfoCard}>
              <View style={styles.receiptInfoHeader}>
                <View>
                  <Text style={styles.receiptInfoLabel}>AMOUNT PAID</Text>
                  <Text style={styles.receiptInfoAmount}>
                    {Number(receiptRequest?.paymentAmount) > 0
                      ? formatPhilippinePeso(String(receiptRequest?.paymentAmount))
                      : "Not provided"}
                  </Text>
                  </View>
                <View
                  style={[
                    styles.receiptStatusBadge,
                    String(receiptRequest?.status || "").toLowerCase() === "payment_verified"
                      ? styles.receiptStatusVerified
                      : styles.receiptStatusPending,
                  ]}
                >
                  <Text style={styles.receiptStatusText}>
                    {String(receiptRequest?.status || "").toLowerCase() === "payment_verified" ? "Verified" : "For review"}
                  </Text>
                  </View>
                </View>

              <View style={styles.receiptDivider} />
              <View style={styles.receiptDetailLine}>
                <Text style={styles.receiptDetailKey}>Sender</Text>
                <Text style={styles.receiptDetailValue}>{receiptRequest?.paymentPayerName || "Not provided"}</Text>
                </View>
              <View style={styles.receiptDetailLine}>
                <Text style={styles.receiptDetailKey}>GCash name</Text>
                <Text style={styles.receiptDetailValue}>{receiptRequest?.paymentGcashName || "Not provided"}</Text>
                </View>
              <View style={styles.receiptDetailLine}>
                <Text style={styles.receiptDetailKey}>GCash number</Text>
                <Text style={styles.receiptDetailValue}>{receiptRequest?.paymentGcashNumber || "Not provided"}</Text>
                </View>
              <View style={styles.receiptDetailLine}>
                <Text style={styles.receiptDetailKey}>Reference no.</Text>
                <Text style={styles.receiptDetailValue}>{receiptRequest?.paymentReferenceNumber || "Not provided"}</Text>
                </View>
              <View style={styles.receiptDetailLine}>
                <Text style={styles.receiptDetailKey}>Submitted</Text>
                <Text style={styles.receiptDetailValue}>
                  {receiptRequest?.paymentSubmittedAt
                    ? new Date(receiptRequest.paymentSubmittedAt).toLocaleString(undefined, { hour12: true })
                    : "Not provided"}
                </Text>
                </View>
             </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal visible={rejectPaymentVisible} transparent animationType="fade" onRequestClose={closeRejectPayment}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeRejectPayment}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Reject Payment</Text>
              <Text style={styles.modalCaption}>
                The family will be asked to review and resubmit their payment. Optionally tell them why their proof was
                not accepted.
              </Text>

              <Text style={styles.inputLabel}>Reason *</Text>
              <TextInput
                style={[styles.input, styles.paymentSetupReasonInput]}
                value={rejectPaymentText}
                onChangeText={setRejectPaymentText}
                placeholder="e.g. Blurry screenshot, wrong reference number"
                placeholderTextColor="#9aa39d"
                multiline
              />

              <View style={styles.modalActionStack}>
                <TouchableOpacity
                  style={[styles.modalDangerButton, rejectingPayment ? styles.heroButtonDisabled : null]}
                  onPress={() => void confirmRejectPayment()}
                  disabled={rejectingPayment}
                >
                  <Text style={styles.modalDangerButtonText}>
                    {rejectingPayment ? "Rejecting..." : "Reject Payment"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalGhostButton} onPress={closeRejectPayment} disabled={rejectingPayment}>
                  <Text style={styles.modalGhostButtonText}>Cancel</Text>
                </TouchableOpacity>
                </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef1ec",
  },
  screenBody: {
    flex: 1,
    position: "relative",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 24,
  },
  loadingText: {
    color: "#77827d",
    fontSize: 14,
    fontWeight: "700",
  },
  content: {
    paddingBottom: 32,
  },
  heroSection: {
    minHeight: 244,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 34,
    backgroundColor: "#d6e2d2",
    overflow: "hidden",
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.52,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(214, 226, 210, 0.62)",
  },
  heroGlowTop: {
    position: "absolute",
    top: -50,
    right: -30,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(255, 255, 255, 0.34)",
  },
  heroGlowBottom: {
    position: "absolute",
    bottom: -90,
    left: -40,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(126, 144, 128, 0.18)",
  },
  topBar: {
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.58)",
    borderWidth: 1,
    borderColor: "rgba(23, 23, 23, 0.08)",
  },
  settingsButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.58)",
    borderWidth: 1,
    borderColor: "rgba(23, 23, 23, 0.08)",
  },
  topBarText: {
    flex: 1,
  },
  topBarTitle: {
    color: "#22312d",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 2,
  },
  statusChip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  heroContent: {
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginTop: 24,
  },
  heroAvatarWrap: {
    flexShrink: 0,
    alignSelf: "center",
  },
  heroAvatarImage: {
    width: 92,
    height: 92,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.68)",
  },
  heroAvatarFallback: {
    width: 92,
    height: 92,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.44)",
    borderWidth: 1,
    borderColor: "rgba(23, 23, 23, 0.08)",
  },
  heroTextBlock: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  heroTitle: {
    color: "#22312d",
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "900",
    marginTop: 6,
  },
  heroSubtitle: {
    color: "#53615d",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  heroMetaText: {
    flexShrink: 1,
    color: "#292524",
    fontSize: 13,
    fontWeight: "700",
  },
  shopStatusCard: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 18,
    backgroundColor: "#ffffff",
    padding: 14,
    marginBottom: 16,
  },
  shopStatusCardTitle: {
    color: "#22312d",
    fontSize: 18,
    fontWeight: "900",
  },
  shopStatusCardDesc: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  heroButtonDisabled: {
    opacity: 0.48,
  },
  statusBanner: {
    marginHorizontal: 20,
    marginTop: -18,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  statusBannerCopy: {
    flex: 1,
  },
  statusBannerTitle: {
    fontSize: 15,
    fontWeight: "900",
  },
  statusBannerText: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  readOnlyDetailsSection: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 18,
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  readOnlySectionTitle: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 4,
  },
  readOnlyActions: {
    gap: 10,
    marginTop: 2,
  },
  shopToolsSection: {
    marginHorizontal: 20,
    marginTop: 16,
  },
  shopToolsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  shopToolsTitle: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
  },
  shopToolsSubtitle: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  attentionCountBadge: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 8,
    backgroundColor: "#9f2f2f",
    alignItems: "center",
    justifyContent: "center",
  },
  attentionCountBadgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  shopToolsGrid: {
    gap: 8,
  },
  shopToolGroupEntry: {
    gap: 9,
  },
  shopToolGroupHeader: {
    paddingHorizontal: 2,
    paddingTop: 7,
  },
  shopToolGroupLabel: {
    color: "#8a745b",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  shopToolGroupDescription: {
    color: "#7a8580",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  shopToolCard: {
    minHeight: 76,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  shopToolCardActive: {
    backgroundColor: "#22312d",
    borderColor: "#22312d",
  },
  shopToolCardUrgent: {
    borderColor: "#d8a77d",
    backgroundColor: "#fffaf4",
  },
  shopToolIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e7eee4",
  },
  shopToolIconActive: {
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  shopToolBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    backgroundColor: "#a43535",
    alignItems: "center",
    justifyContent: "center",
  },
  shopToolBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "900",
  },
  shopToolLabel: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "900",
  },
  shopToolLabelActive: {
    color: "#ffffff",
  },
  shopToolDescription: {
    color: "#6c7772",
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  shopToolDescriptionActive: {
    color: "#d8e2de",
  },
  shopToolArrow: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#edf1ec",
  },
  shopToolArrowActive: {
    backgroundColor: "rgba(255, 255, 255, 0.14)",
  },
  shopToolCopy: {
    flex: 1,
    minWidth: 0,
  },
  shopToolTrailing: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  attentionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    marginBottom: 12,
  },
  attentionHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#516961",
    alignItems: "center",
    justifyContent: "center",
  },
  attentionRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderTopWidth: 1,
    borderTopColor: "#e6e1d8",
    paddingVertical: 11,
  },
  attentionNumber: {
    minWidth: 34,
    height: 34,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1dfd5",
  },
  attentionNumberText: {
    color: "#8b3d2f",
    fontSize: 13,
    fontWeight: "900",
  },
  attentionRowCopy: {
    flex: 1,
  },
  attentionRowTitle: {
    color: "#22312d",
    fontSize: 13,
    fontWeight: "900",
  },
  attentionRowText: {
    color: "#6c7772",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  waitingNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 14,
    backgroundColor: "#f2ece5",
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 10,
  },
  waitingNoteText: {
    flex: 1,
    color: "#6f5a48",
    fontSize: 11,
    lineHeight: 16,
  },
  completedSummaryText: {
    color: "#62706b",
    fontSize: 11,
    textAlign: "center",
  },
  analyticsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  analyticsItem: {
    flexBasis: "45%",
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  analyticsValue: {
    color: "#22312d",
    fontSize: 18,
    fontWeight: "900",
  },
  analyticsLabel: {
    color: "#62706b",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  analyticsChartBlock: {
    marginTop: 18,
  },
  analyticsChartTitle: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 10,
  },
  analyticsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 4,
  },
  analyticsRowLabel: {
    width: 118,
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  analyticsTrack: {
    flex: 1,
    height: 11,
    borderRadius: 999,
    backgroundColor: "#e8e5dd",
    overflow: "hidden",
  },
  analyticsFill: {
    height: "100%",
    borderRadius: 999,
  },
  analyticsRowValue: {
    width: 32,
    textAlign: "right",
    fontSize: 12,
    fontWeight: "800",
    color: "#0f172a",
  },
  statusControlExpired: {
    borderColor: "#efb8b8",
    backgroundColor: "#fff8f8",
  },
  statusControlHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  subscriptionPill: {
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: "#e7f5ec",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  subscriptionPillExpired: {
    backgroundColor: "#fdecec",
  },
  subscriptionPillText: {
    flex: 1,
    color: "#1e5b3a",
    fontSize: 12,
    fontWeight: "800",
  },
  subscriptionPillTextExpired: {
    color: "#8f2525",
  },
  statusControlButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#1e5b3a",
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  statusControlButtonOffline: {
    backgroundColor: "#7c4a35",
  },
  statusControlButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  orderCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    padding: 12,
    marginTop: 10,
    flexDirection: "row",
    gap: 12,
  },
  orderImage: {
    width: 66,
    height: 66,
    borderRadius: 15,
  },
  orderImageFallback: {
    width: 66,
    height: 66,
    borderRadius: 15,
    backgroundColor: "#f1ebe4",
    alignItems: "center",
    justifyContent: "center",
  },
  orderCardCopy: {
    flex: 1,
  },
  orderCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  orderCardTitleBlock: {
    flex: 1,
  },
  orderProductName: {
    flex: 1,
    color: "#22312d",
    fontSize: 14,
    fontWeight: "900",
  },
  orderPrice: {
    color: "#7f6653",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 5,
  },
  orderStatusBadge: {
    maxWidth: 112,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  orderStatusWaiting: {
    backgroundColor: "#fef3c7",
  },
  orderStatusDone: {
    backgroundColor: "#e7f5ec",
  },
  orderStatusText: {
    color: "#53615d",
    fontSize: 9,
    fontWeight: "900",
  },
  orderMeta: {
    color: "#62706b",
    fontSize: 11,
    marginTop: 5,
  },
  orderDate: {
    color: "#8f9891",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 6,
  },
  requestViewHint: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 3,
    marginTop: 8,
  },
  requestViewHintText: {
    color: "#7f6653",
    fontSize: 11,
    fontWeight: "900",
  },
  orderActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  orderAcceptButton: {
    minHeight: 32,
    borderRadius: 10,
    backgroundColor: "#1e5b3a",
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  orderAcceptButtonText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "900",
  },
  orderDeclineButton: {
    minHeight: 32,
    borderRadius: 10,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  orderDeclineButtonText: {
    color: "#991b1b",
    fontSize: 10,
    fontWeight: "900",
  },
  sectionCard: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 24,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  sectionTitle: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
  },
  sectionSubtitle: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  sectionHeadingBlock: {
    flex: 1,
  },
  catalogActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ebf1e8",
    borderWidth: 1,
    borderColor: "#cfdacb",
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
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#e4ece0",
    alignItems: "center",
    justifyContent: "center",
  },
  detailCopy: {
    flex: 1,
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
  emptyState: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#fff",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  emptyStateTitle: {
    color: "#22312d",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 10,
  },
  emptyStateText: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 6,
  },
  emptyStateButton: {
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 16,
  },
  emptyStateButtonText: {
    color: "#fff8f1",
    fontSize: 13,
    fontWeight: "900",
  },
  productCard: {
    padding: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#fff",
    marginTop: 12,
  },
  productSummaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  productImage: {
    width: 88,
    height: 88,
    borderRadius: 16,
  },
  productImageFallback: {
    width: 88,
    height: 88,
    borderRadius: 16,
    backgroundColor: "#ebf1e8",
    alignItems: "center",
    justifyContent: "center",
  },
  productBody: {
    flex: 1,
  },
  productTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  productName: {
    flex: 1,
    color: "#22312d",
    fontSize: 16,
    fontWeight: "900",
  },
  productPrice: {
    color: "#9a7c5d",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 8,
  },
  productMeta: {
    color: "#62706b",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },
  productDescription: {
    color: "#62706b",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  productActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 12,
  },
  inlinePrimaryButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 13,
    backgroundColor: "#22312d",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  inlinePrimaryButtonText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
  },
  inlineToggleButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 13,
    backgroundColor: "#f1ebe4",
    borderWidth: 1,
    borderColor: "#dfd1c2",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  inlineToggleButtonText: {
    color: "#7f6653",
    fontSize: 11,
    fontWeight: "900",
  },
  inlineDangerButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
    justifyContent: "center",
  },
  productUpdatedText: {
    color: "#8f9891",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 10,
  },
  stateBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  stateLive: {
    backgroundColor: "#fef08a",
  },
  stateSold: {
    backgroundColor: "#fde5e5",
  },
  stateBadgeText: {
    color: "#22312d",
    fontSize: 10,
    fontWeight: "900",
  },
  catalogAddButton: {
    minHeight: 40,
    borderRadius: 14,
    backgroundColor: "#d6e2d2",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#c3d0bf",
  },
  catalogAddButtonDisabled: {
    backgroundColor: "#ece9e3",
    borderColor: "#e7e5e4",
  },
  catalogAddButtonText: {
    color: "#22312d",
    fontSize: 13,
    fontWeight: "900",
  },
  catalogAddButtonTextDisabled: {
    color: "#8b938c",
  },
  tabRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 6,
  },
  tabButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabButtonActive: {
    backgroundColor: "#22312d",
    borderColor: "#22312d",
  },
  tabButtonText: {
    color: "#62706b",
    fontSize: 12,
    fontWeight: "900",
  },
  tabButtonTextActive: {
    color: "#ffffff",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(16, 10, 8, 0.58)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "84%",
    borderRadius: 24,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 18,
  },
  shopDetailsModalCard: {
    height: "84%",
  },
  settingsCard: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 24,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 18,
    gap: 10,
  },
  settingsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 6,
  },
  settingsTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  settingsTitleIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dfe8db",
  },
  settingsTitleCopy: {
    flex: 1,
  },
  settingsCaption: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  settingsCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ece9e3",
  },
  settingsRow: {
    minHeight: 76,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  settingsRowDisabled: {
    backgroundColor: "#f0efeb",
    opacity: 0.72,
  },
  settingsRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1ebe4",
  },
  settingsRowCopy: {
    flex: 1,
  },
  settingsRowTitle: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "900",
  },
  settingsRowTextDisabled: {
    color: "#777f7a",
  },
  settingsRowDescription: {
    color: "#62706b",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    flexGrow: 1,
    paddingBottom: 96,
  },
  modalTitle: {
    color: "#22312d",
    fontSize: 22,
    fontWeight: "900",
  },
  modalCaption: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 14,
  },
  inputLabel: {
    color: "#53615d",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 6,
    marginTop: 6,
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
  multilineInput: {
    minHeight: 104,
    textAlignVertical: "top",
  },
  editPhotoCard: {
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#e6e3da",
  },
  editCoverPreview: {
    width: "100%",
    height: 140,
  },
  editCoverFallback: {
    width: "100%",
    height: 140,
    backgroundColor: "#eef1ec",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  editCoverFallbackText: {
    color: "#a6afa9",
    fontSize: 12,
    fontWeight: "600",
  },
  editAvatarWrap: {
    alignSelf: "center",
    marginTop: -40,
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: "#f8f6f2",
    borderWidth: 3,
    borderColor: "#ffffff",
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    overflow: "hidden",
  },
  editAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  editAvatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ebf1e8",
  },
  editPhotoButtons: {
    gap: 10,
    marginBottom: 6,
  },
  modalOutlineButton: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#fbfaf7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
  },
  modalOutlineButtonText: {
    color: "#8b7255",
    fontSize: 13,
    fontWeight: "900",
  },
  modalActionStack: {
    gap: 10,
    marginTop: 16,
  },
  modalPrimaryButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#22312d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  modalPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  modalDangerButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#efc4c4",
    alignItems: "center",
    justifyContent: "center",
  },
  modalDangerButtonText: {
    color: "#912929",
    fontSize: 14,
    fontWeight: "900",
  },
  modalGhostButton: {
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: "#ece9e3",
    alignItems: "center",
    justifyContent: "center",
  },
  modalGhostButtonText: {
    color: "#62706b",
    fontSize: 14,
    fontWeight: "900",
  },
  paymentSettingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e6e3da",
  },
  paymentSettingsHeaderIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dfe8db",
  },
  paymentSettingsHeaderCopy: {
    flex: 1,
  },
  paymentSettingsHeaderCaption: {
    color: "#6b7671",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  paymentSettingsClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ece9e3",
  },
  paymentSetupSummary: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f2d2a2",
    backgroundColor: "#fffaf3",
    padding: 13,
    marginTop: 16,
  },
  paymentSetupSummaryReady: {
    borderColor: "#bfe3cc",
    backgroundColor: "#f4fbf6",
  },
  paymentSetupStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#e7ad59",
    marginTop: 4,
  },
  paymentSetupStatusDotReady: {
    backgroundColor: "#48a868",
  },
  paymentSetupSummaryCopy: {
    flex: 1,
  },
  paymentSetupSummaryTitle: {
    color: "#22312d",
    fontSize: 13,
    fontWeight: "900",
  },
  paymentSetupSummaryText: {
    color: "#62706b",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  paymentSetupSection: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    padding: 14,
    marginTop: 14,
  },
  paymentSetupSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  paymentSetupStep: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#22312d",
  },
  paymentSetupStepText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  paymentSetupSectionCopy: {
    flex: 1,
  },
  paymentSetupSectionTitle: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "900",
  },
  paymentSetupSectionText: {
    color: "#77827d",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  paymentAmountInput: {
    minHeight: 54,
    backgroundColor: "#f7f9f6",
    fontSize: 18,
    fontWeight: "800",
  },
  paymentSetupSaveDisabled: {
    opacity: 0.5,
  },
  paymentQrPreviewWrap: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e6e3da",
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  paymentQrPreview: {
    width: "100%",
    height: 220,
    backgroundColor: "#ffffff",
  },
  paymentQrPreviewActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  paymentQrInlineButton: {
    flex: 1,
  },
  paymentQrRemoveText: {
    color: "#912929",
  },
  paymentQrEmpty: {
    height: 180,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#d9d6cd",
    backgroundColor: "#fbfaf7",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  paymentQrEmptyText: {
    color: "#8a948f",
    fontSize: 13,
    fontWeight: "700",
  },
  paymentQrInfoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    backgroundColor: "#f1ebe4",
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 10,
  },
  paymentQrInfoText: {
    flex: 1,
    color: "#62706b",
    fontSize: 12,
    lineHeight: 18,
  },
  paymentCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    padding: 14,
    marginTop: 10,
  },
  paymentStatusPending: {
    backgroundColor: "#fef3c7",
  },
  paymentCompactSummary: {
    marginTop: 8,
  },
  paymentCompactAmount: {
    color: "#22312d",
    fontSize: 17,
    fontWeight: "900",
  },
  paymentCompactMeta: {
    color: "#7b8782",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  receiptCompactButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 11,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#ded9ce",
    backgroundColor: "#faf8f3",
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  receiptCompactIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eee7de",
  },
  receiptCompactCopy: {
    flex: 1,
  },
  receiptCompactTitle: {
    color: "#33433e",
    fontSize: 13,
    fontWeight: "900",
  },
  receiptCompactCaption: {
    color: "#7b8782",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
  },
  receiptUnavailableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: "#f1efea",
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  receiptUnavailableText: {
    color: "#8a948f",
    fontSize: 11,
    fontWeight: "800",
  },
  paymentDetails: {
    borderRadius: 14,
    backgroundColor: "#f4f1ea",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  paymentDetailRow: {
    color: "#62706b",
    fontSize: 12,
    lineHeight: 19,
  },
  paymentDetailLabel: {
    color: "#53615d",
    fontWeight: "900",
  },
  receiptPreviewButton: {
    marginTop: 10,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e6e3da",
    backgroundColor: "#22312d",
  },
  receiptPreviewFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#22312d",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  receiptPreviewFooterText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  receiptModalSafeArea: {
    flex: 1,
    backgroundColor: "#eef1ec",
  },
  receiptModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#f8f6f2",
    borderBottomWidth: 1,
    borderBottomColor: "#d9d6cd",
  },
  receiptModalHeading: {
    flex: 1,
  },
  receiptModalTitle: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 3,
  },
  receiptModalClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef1ec",
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },
  receiptModalScroll: {
    flex: 1,
  },
  receiptModalContent: {
    padding: 16,
    paddingBottom: 36,
  },
  receiptModalImage: {
    width: "100%",
    height: 460,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },
  receiptInfoCard: {
    marginTop: 16,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    padding: 16,
  },
  receiptInfoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  receiptInfoLabel: {
    color: "#7b8782",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  receiptInfoAmount: {
    color: "#1f2e2a",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 3,
  },
  receiptStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  receiptStatusVerified: {
    backgroundColor: "#dff3e6",
  },
  receiptStatusPending: {
    backgroundColor: "#fef3c7",
  },
  receiptStatusText: {
    color: "#33433e",
    fontSize: 11,
    fontWeight: "900",
  },
  receiptDivider: {
    height: 1,
    backgroundColor: "#ece9e3",
    marginVertical: 14,
  },
  receiptDetailLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
    paddingVertical: 6,
  },
  receiptDetailKey: {
    color: "#7b8782",
    fontSize: 12,
    fontWeight: "700",
  },
  receiptDetailValue: {
    flex: 1,
    color: "#33433e",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
  },
  paymentProofImage: {
    width: "100%",
    height: 190,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e6e3da",
  },
  paymentProofFallback: {
    minHeight: 96,
    borderRadius: 16,
    backgroundColor: "#ece9e3",
    borderWidth: 1,
    borderColor: "#e6e3da",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  paymentProofFallbackText: {
    color: "#8a948f",
    fontSize: 12,
    fontWeight: "800",
  },
  verifiedNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 14,
    backgroundColor: "#e7f5ec",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  verifiedNoteText: {
    flex: 1,
    color: "#1e5b3a",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  rejectReasonCard: {
    marginTop: 10,
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
  paymentSetupReasonInput: {
    minHeight: 96,
    textAlignVertical: "top",
  },
});

