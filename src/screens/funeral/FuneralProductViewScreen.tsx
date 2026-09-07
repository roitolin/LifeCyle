import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton, KeyboardAwareScrollView } from "@/components";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { auth } from "@/services";
import { supabase } from "@/services/supabaseClient";
import { createAdminNotification } from "@/utils/createAdminNotification";
import { addFuneralCartItem } from "@/utils/funeralCart";
import { hapticMedium } from "@/utils/haptics";
import { colors, radii, spacing } from "@/theme";

type ProductVariation = {
  name: string;
  imageUrl?: string | null;
};

type ProductReview = {
  id?: string;
  reviewerName?: string;
  rating?: number;
  comment?: string;
  itemLabel?: string;
  imageUrl?: string | null;
  createdLabel?: string;
};

type ProductRatingDoc = {
  id: string;
  userId: string;
  userEmail?: string | null;
  displayName?: string | null;
  rating: number;
  createdAt?: any;
  updatedAt?: any;
};

type ProductFeedbackDoc = {
  id: string;
  productKey: string;
  productId: string;
  shopId?: string | null;
  userId: string;
  userEmail?: string | null;
  displayName?: string | null;
  feedback: string;
  ratingSnapshot?: number;
  createdAt?: any;
  updatedAt?: any;
};

type ProductViewItem = {
  id: string;
  name: string;
  description: string;
  price: string;
  stock?: number;
  rating?: number;
  soldCount?: number;
  imageUrl?: string | null;
  galleryImageUrls?: string[];
  shopName?: string;
  shopId?: string;
  hasVariations?: boolean;
  variations?: ProductVariation[];
  reviewCount?: number;
  reviews?: ProductReview[];
};

type ShopSummary = {
  shopName?: string | null;
  shopAddress?: string | null;
  generalLocation?: string | null;
  shopImageUrl?: string | null;
  status?: string | null;
};

function getGallery(item: ProductViewItem) {
  if (item.galleryImageUrls?.length) return item.galleryImageUrls;
  if (item.imageUrl) return [item.imageUrl];
  const variations = Array.isArray(item.variations) ? item.variations : [];
  const variationImages = variations.map((entry) => entry.imageUrl).filter((entry): entry is string => Boolean(entry));
  return variationImages;
}

function mapCatalogProduct(row: any, fallbackShopName = "Funeral shop"): ProductViewItem {
  return {
    id: String(row.id),
    name: String(row.name || "Untitled Product"),
    description: String(row.description || ""),
    price: String(row.price || 0),
    stock: Number(row.stock) || 0,
    imageUrl: row.imageUrl || null,
    galleryImageUrls: (row.funeral_product_images || [])
      .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map((image: any) => image.imageUrl)
      .filter(Boolean),
    shopId: String(row.shopId || ""),
    shopName: String(row.funeral_shops?.shopName || fallbackShopName),
    hasVariations: Boolean(row.hasVariations) || (row.funeral_product_variations || []).length > 0,
    variations: (row.funeral_product_variations || []).map((variation: any) => ({
      name: String(variation.name || "Standard"),
      imageUrl: variation.imageUrl || null,
    })),
  };
}

function getNumericPrice(value: string | number | null | undefined) {
  const raw = typeof value === "number" ? String(value) : String(value || "");
  const cleaned = raw.replace(/[^\d.]/g, "");
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
}

function renderStars(value: number) {
  const safeValue = Math.max(0, Math.min(5, Math.round(value)));
  return `${"\u2605".repeat(safeValue)}${"\u2606".repeat(5 - safeValue)}`;
}

function formatTimestamp(timestamp: any) {
  if (!timestamp) return "Just now";
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleDateString();
}

const RATING_VALUES = [1, 2, 3, 4, 5];
const REVIEW_ELIGIBLE_ORDER_STATUSES = ["payment_verified", "awaiting_customer_confirmation", "completed"];
type VariationSheetMode = "browse" | "cart" | "buy";
type VariationPreviewState = {
  name: string;
  imageUrl?: string | null;
} | null;

export default function FuneralProductViewScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const sheetBottomPadding = Math.max(insets.bottom + 20, 28);
  const bottomBarPadding = Math.max(insets.bottom + 8, 16);
  const { width } = useWindowDimensions();
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [variationsVisible, setVariationsVisible] = useState(false);
  const [variationSheetMode, setVariationSheetMode] = useState<VariationSheetMode>("browse");
  const [cartConfirmVisible, setCartConfirmVisible] = useState(false);
  const [addedToCartVisible, setAddedToCartVisible] = useState(false);
  const [variationPreviewVisible, setVariationPreviewVisible] = useState(false);
  const [previewVariation, setPreviewVariation] = useState<VariationPreviewState>(null);
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [selectedVariationName, setSelectedVariationName] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [savingRating, setSavingRating] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [postingFeedback, setPostingFeedback] = useState(false);
  const [ratings, setRatings] = useState<ProductRatingDoc[]>([]);
  const [feedbacks, setFeedbacks] = useState<ProductFeedbackDoc[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [hasPurchased, setHasPurchased] = useState(false);
  const [purchaseChecked, setPurchaseChecked] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [shopDetails, setShopDetails] = useState<ShopSummary | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<ProductViewItem[]>([]);
  const [relatedFavoriteIds, setRelatedFavoriteIds] = useState<Set<string>>(() => new Set());
  const [recommendedProducts, setRecommendedProducts] = useState<ProductViewItem[]>([]);
  const [shopProductCount, setShopProductCount] = useState(1);
  const variationBackdropOpacity = useRef(new Animated.Value(0)).current;
  const variationSheetProgress = useRef(new Animated.Value(0)).current;
  const cartConfirmBackdropOpacity = useRef(new Animated.Value(0)).current;
  const cartConfirmSheetProgress = useRef(new Animated.Value(0)).current;

  const product = (route?.params?.product || null) as ProductViewItem | null;
  const gallery = product ? getGallery(product) : [];

  const imageWidth = Math.max(width, 1);
  const imageHeight = Math.min(imageWidth, 420);

  const priceValue = useMemo(() => getNumericPrice(product?.price), [product?.price]);
  const stockCount = product?.stock ?? 0;
  const isSoldOut = stockCount <= 0;
  const priceLabel = product?.name || "Funeral product";
  const defaultRatingValue = Math.max(0, Math.min(5, Number(product?.rating) || 0));
  const soldCount = Math.max(0, Number(product?.soldCount) || 0);
  const variations = Array.isArray(product?.variations) ? product.variations : [];
  const variationCount = variations.length;
  const selectedVariation = variations.find((item) => item.name === selectedVariationName) || null;
  const fallbackItemLabel = variations[0]?.name ? `Item: ${variations[0].name}` : "Item: Standard";
  const productKey = product ? `${product.shopId || "shop"}:${product.id}` : "";

  const getIdentity = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    const { data: userDoc } = await supabase.from("users").select("*").eq("id", currentUser.uid).single();
    const data = userDoc || {};
    return {
      userId: currentUser.uid,
      userEmail: currentUser.email || null,
      displayName: data.fullName || currentUser.email || "User",
    };
  }, []);

  const hasVerifiedCasketOrder = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser || !product?.id) return false;
    const { data, error } = await supabase
      .from("funeral_service_requests")
      .select("id")
      .eq("requesterId", currentUser.uid)
      .eq("productId", product.id)
      .eq("requestType", "catalog_product")
      .in("status", REVIEW_ELIGIBLE_ORDER_STATUSES)
      .limit(1);
    if (error) return false;
    return Boolean(data && data.length > 0);
  }, [product?.id]);

  const checkPurchaseEligibility = useCallback(async () => {
    const bought = await hasVerifiedCasketOrder();
    setHasPurchased(bought);
    setPurchaseChecked(true);
  }, [hasVerifiedCasketOrder]);

  const loadReviews = useCallback(async () => {
    if (!productKey) {
      setRatings([]);
      setFeedbacks([]);
      setLoadingReviews(false);
      return;
    }

    setLoadingReviews(true);
    try {
      const [ratingsSnap, feedbacksSnap] = await Promise.all([
        supabase.from("funeral_product_ratings").select("*").eq("productKey", productKey),
        supabase.from("funeral_product_feedback").select("*").eq("productKey", productKey),
      ]);

      const nextRatings = (ratingsSnap.data || []) as ProductRatingDoc[];
      const nextFeedbacks = (feedbacksSnap.data || [])
        .sort((a: any, b: any) => {
          const aTime = new Date(a.createdAt || 0).getTime();
          const bTime = new Date(b.createdAt || 0).getTime();
          return bTime - aTime;
        }) as ProductFeedbackDoc[];

      setRatings(nextRatings);
      setFeedbacks(nextFeedbacks);

      const currentUser = auth.currentUser;
      const myRating = currentUser ? nextRatings.find((item) => item.userId === currentUser.uid) : null;
      setRating(myRating?.rating || 0);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to load product reviews.");
    } finally {
      setLoadingReviews(false);
    }
  }, [productKey]);

  useEffect(() => {
    setSelectedVariationName(null);
    setPurchaseChecked(false);
    setHasPurchased(false);
    void checkPurchaseEligibility();
  }, [productKey, checkPurchaseEligibility]);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  useEffect(() => {
    let cancelled = false;

    const loadShopContext = async () => {
      if (!product?.shopId) {
        setShopDetails(null);
        setRelatedProducts([]);
        setRecommendedProducts([]);
        return;
      }

      const [shopResult, relatedResult, recommendationsResult] = await Promise.all([
        supabase
          .from("funeral_shops")
          .select("shopName, shopAddress, generalLocation, shopImageUrl, status")
          .eq("id", product.shopId)
          .maybeSingle(),
        supabase
          .from("funeral_products")
          .select(`
            *,
            funeral_product_variations ( name, imageUrl ),
            funeral_product_images ( imageUrl, displayOrder )
          `, { count: "exact" })
          .eq("shopId", product.shopId)
          .eq("active", true)
          .neq("id", product.id)
          .order("createdAt", { ascending: false })
          .limit(8),
        supabase
          .from("funeral_products")
          .select(`
            *,
            funeral_product_variations ( name, imageUrl ),
            funeral_product_images ( imageUrl, displayOrder ),
            funeral_shops!inner ( shopName, status )
          `)
          .eq("active", true)
          .gt("stock", 0)
          .eq("funeral_shops.status", "live")
          .neq("id", product.id)
          .neq("shopId", product.shopId)
          .order("createdAt", { ascending: false })
          .limit(8),
      ]);

      if (cancelled) return;
      if (!shopResult.error) setShopDetails((shopResult.data as ShopSummary | null) ?? null);
      if (!relatedResult.error) {
        const nextRelated = (relatedResult.data || []).map((row: any) =>
          mapCatalogProduct(row, shopResult.data?.shopName || product.shopName || "Funeral shop")
        );
        setRelatedProducts(nextRelated);
        setShopProductCount((relatedResult.count ?? nextRelated.length) + 1);
      }
      if (!recommendationsResult.error) {
        setRecommendedProducts((recommendationsResult.data || []).map((row: any) => mapCatalogProduct(row)));
      }
    };

    void loadShopContext();
    return () => {
      cancelled = true;
    };
  }, [product?.id, product?.shopId, product?.shopName]);

  const averageRating = useMemo(() => {
    if (!ratings.length) return defaultRatingValue;
    const total = ratings.reduce((sum, item) => sum + (Number(item.rating) || 0), 0);
    return total / ratings.length;
  }, [defaultRatingValue, ratings]);

  const reviews = useMemo(() => {
    const mappedReviews = feedbacks.map((item: any) => ({
      id: item.id,
      reviewerName: item.displayName || item.userEmail || "User",
      rating: item.ratingSnapshot || averageRating || defaultRatingValue,
      itemLabel: fallbackItemLabel,
      comment: item.feedback,
      createdLabel: formatTimestamp(item.updatedAt || item.createdAt),
    })) as ProductReview[];

    if (mappedReviews.length) return mappedReviews;
    return Array.isArray(product?.reviews) ? product.reviews : [];
  }, [averageRating, defaultRatingValue, fallbackItemLabel, feedbacks, product?.reviews]);

  const reviewCount = Math.max(reviews.length, ratings.length, Number(product?.reviewCount) || 0);
  const visibleReviews = reviews.slice(0, 2);

  const handleGalleryScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!gallery.length) return;
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
    setActiveImageIndex(Math.min(Math.max(nextIndex, 0), gallery.length - 1));
  };

  const handleHeroGalleryScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!gallery.length) return;
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / imageWidth);
    setActiveImageIndex(Math.min(Math.max(nextIndex, 0), gallery.length - 1));
  };

  if (!product) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Product not found</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const saveMyRating = async () => {
    const identity = await getIdentity();
    if (!identity) {
      Alert.alert("Login Required", "You need to be logged in to rate this product.");
      return;
    }

    const bought = await hasVerifiedCasketOrder();
    if (!bought) {
      Alert.alert("Verified Order Required", "Only the customer who placed and paid for this exact casket order can rate it.");
      return;
    }

    setSavingRating(true);
    try {
      await supabase.from("funeral_product_ratings").upsert(
        {
          id: `${productKey}_${identity.userId}`,
          productKey,
          productId: product.id,
          shopId: product.shopId || null,
          userId: identity.userId,
          userEmail: identity.userEmail,
          displayName: identity.displayName,
          rating,
          updatedAt: new Date().toISOString(),
        }
      );

      await createAdminNotification(
        "rating_update",
        "Funeral Product Rating",
        `${identity.displayName || "A user"} rated ${product.name} ${rating}/5.`,
        { productId: product.id, shopId: product.shopId || null, rating }
      );

      Alert.alert("Saved", "Your rating has been saved.");
      await loadReviews();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to save your rating.");
    } finally {
      setSavingRating(false);
    }
  };

  const submitFeedback = async () => {
    if (!feedbackText.trim()) {
      Alert.alert("Feedback Required", "Please write your comment before posting.");
      return;
    }

    const identity = await getIdentity();
    if (!identity) {
      Alert.alert("Login Required", "You need to be logged in to comment on this product.");
      return;
    }

    const bought = await hasVerifiedCasketOrder();
    if (!bought) {
      Alert.alert("Verified Order Required", "Only the customer who placed and paid for this exact casket order can post feedback.");
      return;
    }

    setPostingFeedback(true);
    try {
      await supabase.from("funeral_product_feedback").insert({
        productKey,
        productId: product.id,
        shopId: product.shopId || null,
        userId: identity.userId,
        userEmail: identity.userEmail,
        displayName: identity.displayName,
        feedback: feedbackText.trim(),
        ratingSnapshot: rating > 0 ? rating : averageRating,
      });

      await createAdminNotification(
        "feedback_new",
        "New Funeral Product Feedback",
        `${identity.displayName || "A user"} posted feedback for ${product.name}.`,
        { productId: product.id, shopId: product.shopId || null }
      );

      setFeedbackText("");
      Alert.alert("Posted", "Your feedback has been posted.");
      await loadReviews();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to post feedback.");
    } finally {
      setPostingFeedback(false);
    }
  };

  const handleOpenShop = () => {
    if (product.shopId) {
      navigation.navigate("ShopProducts", {
        shopId: product.shopId,
        shopName: product.shopName || "Funeral shop",
      });
      return;
    }

    navigation.navigate("FuneralTabs", { screen: "Shops" });
  };

  const handleOpenChat = () => {
    if (!product.shopId) {
      Alert.alert("Chat unavailable", "This product is missing its shop information.");
      return;
    }
    if (!auth.currentUser) {
      Alert.alert("Sign in required", "Please sign in before chatting with this shop.");
      return;
    }
    if (auth.currentUser.uid === product.shopId) {
      Alert.alert("Your product", "You cannot start a chat with your own shop account.");
      return;
    }
    navigation.navigate("ShopChat", {
      otherUserId: product.shopId,
      otherUserName: product.shopName || "Funeral Shop",
    });
  };

  const shareProduct = async () => {
    await Share.share({
      title: product.name,
      message: `${product.name} — ${formatPhilippinePeso(priceValue || product.price)} from ${product.shopName || "LifeCycle"}`,
    });
  };

  const openRelatedProduct = (item: ProductViewItem) => {
    navigation.push("ProductView", { product: item });
  };

  const renderProductTile = (item: ProductViewItem, showShopName = false) => {
    const imageUrl = getGallery(item)[0] || item.imageUrl;
    return (
      <TouchableOpacity
        key={`suggested_${item.shopId || "shop"}_${item.id}`}
        accessibilityLabel={`${item.name}, ${formatPhilippinePeso(item.price)}`}
        accessibilityRole="button"
        activeOpacity={0.82}
        style={styles.productRailItem}
        onPress={() => openRelatedProduct(item)}
      >
        <View style={styles.productRailImageFrame}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.productRailImage} resizeMode="cover" />
          ) : (
            <View style={styles.productRailImageFallback}>
              <Ionicons name="cube-outline" size={24} color={colors.textMuted} />
            </View>
          )}
        </View>
        <Text style={styles.productRailName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.productRailPrice}>{formatPhilippinePeso(item.price)}</Text>
        {showShopName ? (
          <View style={styles.productRailShopRow}>
            <Ionicons name="storefront-outline" size={14} color={colors.warning} />
            <Text style={styles.productRailShopName} numberOfLines={1}>{item.shopName || "Funeral shop"}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  const renderHomeProductCard = (item: ProductViewItem) => {
    const imageUrl = getGallery(item)[0] || item.imageUrl;
    const itemIsFavorite = relatedFavoriteIds.has(item.id);
    return (
      <TouchableOpacity
        key={`same_shop_${item.shopId}_${item.id}`}
        accessibilityLabel={`${item.name}, ${formatPhilippinePeso(item.price)}, from ${item.shopName}`}
        accessibilityRole="button"
        activeOpacity={0.78}
        style={styles.homeProductCard}
        onPress={() => openRelatedProduct(item)}
      >
        <View style={styles.homeProductImageFrame}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.homeProductImage} resizeMode="cover" />
          ) : (
            <View style={styles.homeProductImageFallback}>
              <Ionicons name="cube-outline" size={27} color={colors.textMuted} />
            </View>
          )}
          <TouchableOpacity
            accessibilityLabel={itemIsFavorite ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`}
            accessibilityRole="button"
            activeOpacity={0.72}
            style={styles.homeProductFavoriteButton}
            onPress={(event) => {
              event.stopPropagation();
              setRelatedFavoriteIds((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
            }}
          >
            <Ionicons
              name={itemIsFavorite ? "heart" : "heart-outline"}
              size={17}
              color={itemIsFavorite ? colors.accent : colors.text}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.homeProductDetails}>
          <Text style={styles.homeProductShopName} numberOfLines={1}>{item.shopName}</Text>
          <Text style={styles.homeProductName} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.homeProductPrice}>{formatPhilippinePeso(item.price)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const openVariationSheet = (mode: VariationSheetMode) => {
    setVariationSheetMode(mode);
    variationBackdropOpacity.stopAnimation();
    variationSheetProgress.stopAnimation();
    variationBackdropOpacity.setValue(0);
    variationSheetProgress.setValue(0);
    setVariationsVisible(true);

    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(variationBackdropOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(variationSheetProgress, {
          toValue: 1,
          damping: 19,
          stiffness: 210,
          mass: 0.85,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const closeVariationSheet = (onClosed?: () => void) => {
    variationBackdropOpacity.stopAnimation();
    variationSheetProgress.stopAnimation();
    Animated.parallel([
      Animated.timing(variationBackdropOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(variationSheetProgress, {
        toValue: 0,
        duration: 210,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setVariationsVisible(false);
      onClosed?.();
    });
  };

  const confirmAddToCart = () => {
    cartConfirmBackdropOpacity.stopAnimation();
    cartConfirmSheetProgress.stopAnimation();
    cartConfirmBackdropOpacity.setValue(0);
    cartConfirmSheetProgress.setValue(0);
    setCartConfirmVisible(true);

    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(cartConfirmBackdropOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(cartConfirmSheetProgress, {
          toValue: 1,
          damping: 19,
          stiffness: 210,
          mass: 0.85,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const closeCartConfirm = (onClosed?: () => void) => {
    cartConfirmBackdropOpacity.stopAnimation();
    cartConfirmSheetProgress.stopAnimation();
    Animated.parallel([
      Animated.timing(cartConfirmBackdropOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cartConfirmSheetProgress, {
        toValue: 0,
        duration: 210,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setCartConfirmVisible(false);
      onClosed?.();
    });
  };

  const proceedToCheckout = () => {
    if (isSoldOut) {
      Alert.alert("Sold Out", "This product is sold out. Please contact the shop or choose another product.");
      return;
    }

    if (!product.shopId) {
      Alert.alert("Unavailable", "This product is missing its shop details.");
      return;
    }

    if (variationCount > 0 && !selectedVariation) {
      Alert.alert("Select a Variation", "Please select a variation before continuing to checkout.");
      return;
    }

    navigation.navigate("FuneralCheckout", {
      cartItem: {
        cartId: `buy_now_${product.shopId}_${product.id}_${selectedVariationName || "standard"}_${Date.now()}`,
        productId: product.id,
        shopId: product.shopId,
        shopName: product.shopName || "Funeral shop",
        name: product.name,
        price: String(product.price || ""),
        imageUrl: selectedVariation?.imageUrl || gallery[0] || product.imageUrl || null,
        variationName: selectedVariationName,
        quantity: 1,
      },
    });
  };

  const addToCart = async () => {
    if (isSoldOut) {
      Alert.alert("Sold Out", "This product is sold out and can no longer be added to your cart.");
      return;
    }

    if (!product.shopId) {
      Alert.alert("Unavailable", "This product is missing its shop details.");
      return;
    }

    if (variationCount > 0 && !selectedVariation) {
      Alert.alert("Select a Variation", "Please select a variation before adding this product to your cart.");
      return;
    }

    try {
      await addFuneralCartItem({
        productId: product.id,
        shopId: product.shopId,
        shopName: product.shopName || "Funeral shop",
        name: product.name,
        price: String(product.price || ""),
        imageUrl: selectedVariation?.imageUrl || gallery[0] || product.imageUrl || null,
        variationName: selectedVariationName,
      });

      setAddedToCartVisible(true);
      setTimeout(() => {
        setAddedToCartVisible(false);
        navigation.navigate("FuneralTabs", { screen: "Carts" });
      }, 1600);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to add this item to your cart.");
    }
  };

  const handleAddToCart = () => {
    if (variationCount > 0) {
      openVariationSheet("cart");
      return;
    }

    confirmAddToCart();
  };

  const handleBuyNow = () => {
    if (variationCount > 0) {
      openVariationSheet("buy");
      return;
    }

    proceedToCheckout();
  };

  const openVariationPreview = (variation: ProductVariation, index: number) => {
    setSelectedVariationName(variation.name || `Option ${index + 1}`);
    if (!variation.imageUrl) return;
    setPreviewVariation({
      name: variation.name || `Option ${index + 1}`,
      imageUrl: variation.imageUrl,
    });
    setVariationPreviewVisible(true);
  };

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <AppBackButton style={styles.topBackButton} onPress={() => navigation.goBack()} />
        <View style={styles.topActions}>
          <TouchableOpacity
            accessibilityLabel="Share product"
            accessibilityRole="button"
            style={styles.topIconButton}
            onPress={() => void shareProduct()}
          >
            <Ionicons name="share-social-outline" size={19} color={colors.surface} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel={isFavorite ? "Remove from favorites" : "Add to favorites"}
            accessibilityRole="button"
            style={styles.topIconButton}
            onPress={() => setIsFavorite((favorite) => !favorite)}
          >
            <Ionicons name={isFavorite ? "heart" : "heart-outline"} size={20} color={isFavorite ? colors.accent : colors.surface} />
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: 64 + bottomBarPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
            {gallery.length ? (
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={handleHeroGalleryScroll}>
                {gallery.map((imageUrl, index) => (
                  <View key={`${product.id}_${index}`} style={[styles.imagePage, { width: imageWidth }]}>
                    <TouchableOpacity activeOpacity={0.94} onPress={() => setImageViewerVisible(true)}>
                      <Image source={{ uri: imageUrl }} style={[styles.heroImage, { width: imageWidth, height: imageHeight }]} resizeMode="cover" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={[styles.heroFallback, { width: imageWidth, height: imageHeight }]}>
                <Ionicons name="image-outline" size={44} color="#86908a" />
              </View>
            )}
            {gallery.length > 1 ? (
              <View pointerEvents="none" style={styles.heroCounter}>
                <Text style={styles.heroCounterText}>{activeImageIndex + 1}/{gallery.length}</Text>
              </View>
            ) : null}
        </View>

        <View style={styles.detailsSurface}>
        <View style={styles.priceSection}>
          <Text style={styles.productTitle}>{priceLabel}</Text>
          <Text style={styles.priceText}>{formatPhilippinePeso(priceValue || product.price)}</Text>
          <View style={styles.ratingStockRow}>
            <View style={styles.ratingRow}>
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={11} color="#ffffff" />
                <Text style={styles.ratingBadgeText}>{averageRating > 0 ? averageRating.toFixed(1) : "New"}</Text>
              </View>
              <Text style={styles.soldText}>{soldCount > 0 ? `${soldCount} sold` : `${reviewCount} reviews`}</Text>
            </View>
          </View>

          {variationCount > 0 ? (
            <View style={styles.marketVariationSection}>
              <View style={styles.marketSectionHeadingRow}>
                <Text style={styles.marketSectionLabel}>Variations</Text>
                <TouchableOpacity onPress={() => openVariationSheet("browse")}>
                  <Text style={styles.marketSectionAction}>View all ›</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketVariationStrip}>
                {variations.map((variation, index) => {
                  const selected = selectedVariationName === variation.name;
                  return (
                    <TouchableOpacity
                      key={`${product.id}_${variation.name}_${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${variation.name || `option ${index + 1}`} full screen`}
                      style={styles.marketVariationCard}
                      activeOpacity={0.88}
                      onPress={() => openVariationPreview(variation, index)}
                    >
                      <View style={[styles.variationThumbRing, selected && styles.variationThumbRingSelected]}>
                        {variation.imageUrl ? (
                          <Image source={{ uri: variation.imageUrl }} style={styles.marketVariationImage} resizeMode="cover" />
                        ) : (
                          <View style={styles.marketVariationFallback}><Ionicons name="cube-outline" size={19} color="#718079" /></View>
                        )}
                      </View>
                      <Text style={styles.marketVariationName} numberOfLines={1}>{variation.name || `Option ${index + 1}`}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>

        <View style={styles.detailSection}>
          <Text style={styles.detailSectionTitle}>Product description</Text>
          <View style={styles.productFactRow}>
            <Text style={styles.productFactLabel}>Availability</Text>
            <Text style={styles.productFactValue}>{isSoldOut ? "Sold out" : "In stock"}</Text>
          </View>
          <View style={styles.productFactRow}>
            <Text style={styles.productFactLabel}>Variations</Text>
            <Text style={styles.productFactValue}>{variationCount > 0 ? `${variationCount} options` : "Standard"}</Text>
          </View>
          <View style={styles.sectionDivider} />
          <Text style={styles.descriptionText}>{product.description || "No description provided by the seller."}</Text>
        </View>

        <View style={styles.reviewsSection}>
          <TouchableOpacity style={styles.productRatingHeader} onPress={() => setReviewsVisible(true)}>
            <View style={styles.productRatingTitleRow}>
              <Text style={styles.productRatingScore}>{averageRating > 0 ? averageRating.toFixed(1) : "New"}</Text>
              <Ionicons name="star" size={18} color={colors.warning} />
              <Text style={styles.marketPanelTitle}>Product ratings ({reviewCount})</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
          {averageRating > 0 ? (
            <Text style={styles.reviewSummaryText}>Rated {averageRating.toFixed(1)} out of 5 by verified customers.</Text>
          ) : null}
          {loadingReviews ? (
            <LoadingBird compact />
          ) : visibleReviews.length === 0 ? (
            <Text style={styles.reviewEmptyText}>No customer reviews yet. Be the first to rate and comment.</Text>
          ) : (
            visibleReviews.map((review, index) => (
              <View key={review.id || `preview_review_${index}`} style={styles.marketReviewCard}>
                <View style={styles.marketReviewerRow}>
                  <View style={styles.marketReviewerAvatar}><Ionicons name="person" size={16} color={colors.textMuted} /></View>
                  <Text style={styles.reviewAuthor}>{review.reviewerName || `Buyer ${index + 1}`}</Text>
                </View>
                <Text style={styles.reviewStars}>{renderStars(Number(review.rating) || 0)}</Text>
                <Text style={styles.reviewItemLabel}>{review.itemLabel || "Variation: Standard"}</Text>
                <Text style={styles.reviewComment}>{review.comment || "No written feedback yet."}</Text>
                {review.imageUrl ? <Image source={{ uri: review.imageUrl }} style={styles.reviewImage} resizeMode="cover" /> : null}
              </View>
            ))
          )}
          {reviewCount > visibleReviews.length ? (
            <TouchableOpacity style={styles.viewAllReviewsButton} onPress={() => setReviewsVisible(true)}>
              <Text style={styles.viewAllReviewsText}>View all reviews</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.marketPanel}>
          <View style={styles.reviewComposerHeader}>
            <View style={styles.reviewComposerTitleWrap}>
              <Text style={styles.marketPanelTitle}>Rate this product</Text>
              <Text style={styles.reviewComposerSubtitle}>Tap a star and share your experience with other families.</Text>
            </View>
          </View>

          {!purchaseChecked ? (
            <View style={styles.reviewCheckingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.reviewCheckingText}>Checking your order eligibility...</Text>
            </View>
          ) : !auth.currentUser ? (
            <View style={styles.reviewGateBox}>
              <Ionicons name="lock-closed" size={18} color="#62706b" />
              <Text style={styles.reviewGateText}>Log in to rate and comment on this product.</Text>
            </View>
          ) : !hasPurchased ? (
            <View style={styles.reviewGateBox}>
              <Ionicons name="lock-closed" size={18} color="#62706b" />
              <Text style={styles.reviewGateText}>Only the customer with a verified payment for this exact casket can rate and comment.</Text>
            </View>
          ) : (
            <>
              <View style={styles.verifiedBuyerRow}>
                <Ionicons name="checkmark-circle" size={17} color={colors.primary} />
                <Text style={styles.verifiedBuyerText}>Verified casket order confirmed</Text>
              </View>
              <View style={styles.ratingPickerRow}>
                {RATING_VALUES.map((value) => (
                  <TouchableOpacity key={value} style={styles.ratingButton} activeOpacity={0.85} onPress={() => setRating((current) => (current === value ? 0 : value))}>
                    <Text style={[styles.ratingPickerIcon, value <= rating && styles.ratingPickerIconActive]}>{"\u2605"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={[styles.submitButton, !rating || savingRating ? styles.submitButtonDisabled : null]} disabled={!rating || savingRating} onPress={() => void saveMyRating()}>
                <Text style={styles.submitButtonText}>{savingRating ? "Saving..." : "Save My Rating"}</Text>
              </TouchableOpacity>
              <TextInput multiline placeholder="Write your feedback about this product" placeholderTextColor="#94a3b8" style={styles.feedbackInput} value={feedbackText} onChangeText={setFeedbackText} textAlignVertical="top" />
              <TouchableOpacity style={[styles.submitButton, postingFeedback ? styles.submitButtonDisabled : null]} disabled={postingFeedback} onPress={() => void submitFeedback()}>
                <Text style={styles.submitButtonText}>{postingFeedback ? "Posting..." : "Post Feedback"}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.shopMarketPanel}>
          <View style={styles.shopTrustHeader}>
            <View style={styles.shopTrustBrandLeft}>
              <Ionicons name="bag-check-outline" size={16} color={colors.surface} />
              <Text style={styles.shopTrustBrand}>LifeCycle Shop</Text>
            </View>
            <Text style={styles.shopTrustPromise}>
              {shopDetails?.status === "live" ? "Accredited · Secure" : "Secure listing"}
            </Text>
          </View>
          <View style={styles.shopMarketBody}>
            <View style={styles.shopMarketHeader}>
              {shopDetails?.shopImageUrl ? (
                <Image source={{ uri: shopDetails.shopImageUrl }} style={styles.shopMarketAvatar} />
              ) : (
                <View style={styles.shopMarketAvatarFallback}><Ionicons name="storefront-outline" size={24} color={colors.text} /></View>
              )}
              <View style={styles.shopMarketIdentity}>
                <Text style={styles.shopMarketName}>{shopDetails?.shopName || product.shopName || "Funeral shop"}</Text>
                <View style={styles.shopStatusRow}>
                  <Ionicons name="star" size={14} color={colors.warning} />
                  <Text style={styles.shopStatusText}>{shopDetails?.status === "live" ? "Verified shop" : "Shop listing"}</Text>
                </View>
                <View style={styles.shopOnlineRow}><View style={styles.shopOnlineDot} /><Text style={styles.shopOnlineText}>{shopDetails?.status === "live" ? "Online" : "Listing unavailable"}</Text></View>
                <Text style={styles.shopMarketLocation} numberOfLines={1}>{shopDetails?.generalLocation || shopDetails?.shopAddress || "Location not provided"}</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" style={styles.visitShopButton} onPress={handleOpenShop}>
                <Text style={styles.visitShopText}>Visit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.shopStatsGrid}>
              <View style={styles.shopStat}>
                <Text style={styles.shopStatValue}>{shopDetails?.status === "live" ? "100%" : "Listed"}</Text>
                <Text style={styles.shopStatLabel}>{shopDetails?.status === "live" ? "verified provider" : "provider"}</Text>
              </View>
              <View style={styles.shopStatDivider} />
              <View style={styles.shopStat}>
                <Text style={styles.shopStatValue}>{shopProductCount}</Text>
                <Text style={styles.shopStatLabel}>products available</Text>
              </View>
              <View style={styles.shopStatDivider} />
              <TouchableOpacity accessibilityRole="button" style={styles.shopStat} onPress={handleOpenChat}>
                <Text style={styles.shopStatValue}>Open</Text>
                <Text style={styles.shopStatLabel}>shop chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {relatedProducts.length > 0 ? (
          <View style={styles.relatedSection}>
            <View style={styles.relatedHeader}>
              <Text style={styles.relatedTitle}>From the same shop</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.relatedAction} onPress={handleOpenShop}>
                <Text style={styles.relatedActionText}>See all</Text>
                <Ionicons name="chevron-forward" size={15} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={styles.homeProductGrid}>
              {relatedProducts.slice(0, 4).map((item) => renderHomeProductCard(item))}
            </View>
          </View>
        ) : null}

        {recommendedProducts.length > 0 ? (
          <View style={styles.recommendationSection}>
            <View style={styles.recommendationHeading}>
              <View style={styles.headingLine} />
              <Text style={styles.recommendationTitle}>You may also like</Text>
              <View style={styles.headingLine} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productRail}>
              {recommendedProducts.slice(0, 6).map((item) => renderProductTile(item, true))}
            </ScrollView>
          </View>
        ) : null}
        </View>

      </KeyboardAwareScrollView>

      <View style={[styles.bottomBar, { paddingBottom: bottomBarPadding }]}>
        <TouchableOpacity style={styles.bottomNavButton} onPress={handleOpenChat}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.text} />
          <Text style={styles.bottomNavText}>Chat</Text>
        </TouchableOpacity>
        {isSoldOut ? (
          <TouchableOpacity style={styles.soldOutBuyButton} activeOpacity={1} onPress={() => void proceedToCheckout()}>
            <Ionicons name="ban-outline" size={18} color="#ffffff" />
            <Text style={styles.soldOutBuyButtonText}>Sold Out</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.bottomCartButton} onPress={() => void handleAddToCart()}>
              <Ionicons name="cart-outline" size={24} color="#5a6b64" />
              <View style={styles.bottomCartPlusBadge}>
                <Ionicons name="add" size={10} color="#ffffff" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.buyButton} onPress={handleBuyNow}>
              <Text style={styles.buyButtonText}>Buy now</Text>
              <Text style={styles.buyButtonPrice}>{formatPhilippinePeso(priceValue || product.price)}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <Modal
        visible={imageViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImageViewerVisible(false)}
      >
        <View style={styles.viewerOverlay}>
          <TouchableOpacity style={styles.viewerCloseButton} onPress={() => setImageViewerVisible(false)}>
            <Ionicons name="close" size={22} color="#ffffff" />
          </TouchableOpacity>

          <ScrollView
            horizontal
            pagingEnabled
            contentOffset={{ x: width * activeImageIndex, y: 0 }}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleGalleryScroll}
          >
            {gallery.map((imageUrl, index) => (
              <View key={`viewer_${product.id}_${index}`} style={[styles.viewerPage, { width }]}>
                <Image source={{ uri: imageUrl }} style={styles.viewerImage} resizeMode="contain" />
              </View>
            ))}
          </ScrollView>

          <View style={styles.viewerCounter}>
            <Text style={styles.viewerCounterText}>{gallery.length ? `${activeImageIndex + 1}/${gallery.length}` : "1/1"}</Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={variationsVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => closeVariationSheet()}
      >
        <View style={styles.variationOverlay}>
          <Animated.View style={[styles.variationBackdrop, { opacity: variationBackdropOpacity }]}>
            <TouchableOpacity
              accessibilityLabel="Close variations"
              accessibilityRole="button"
              activeOpacity={1}
              style={styles.variationBackdropPressable}
              onPress={() => closeVariationSheet()}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.sheetCard,
              { paddingBottom: sheetBottomPadding },
              {
                opacity: variationSheetProgress.interpolate({
                  inputRange: [0, 0.12, 1],
                  outputRange: [0, 1, 1],
                  extrapolate: "clamp",
                }),
                transform: [
                  {
                    translateY: variationSheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [120, 0],
                    }),
                  },
                  {
                    scale: variationSheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.985, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.sheetHandle} />

              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{variationSheetMode === "cart" ? "Choose Variation" : "Variations"}</Text>
                <TouchableOpacity style={styles.sheetCloseButton} onPress={() => closeVariationSheet()}>
                  <Ionicons name="close" size={20} color="#22312d" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {variations.map((variation, index) => (
                  <TouchableOpacity
                    key={`sheet_${product.id}_${variation.name}_${index}`}
                    style={[
                      styles.sheetVariationRow,
                      selectedVariationName === variation.name ? styles.sheetVariationRowActive : null,
                    ]}
                    activeOpacity={0.88}
                    onPress={() => {
                      if (variationSheetMode === "browse") {
                        openVariationPreview(variation, index);
                        return;
                      }
                      setSelectedVariationName(variation.name || `Option ${index + 1}`);
                    }}
                  >
                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.sheetVariationThumbLarge}
                      onPress={() => {
                        if (variationSheetMode === "browse") {
                          openVariationPreview(variation, index);
                          return;
                        }
                        setSelectedVariationName(variation.name || `Option ${index + 1}`);
                      }}
                    >
                      {variation.imageUrl ? (
                        <Image source={{ uri: variation.imageUrl }} style={styles.sheetVariationImage} resizeMode="cover" />
                      ) : (
                        <View style={styles.sheetVariationFallback}>
                          <Ionicons name="cube-outline" size={22} color="#75807b" />
                        </View>
                      )}
                    </TouchableOpacity>

                    <View style={styles.sheetVariationBody}>
                      <Text style={styles.sheetVariationName}>{variation.name || `Option ${index + 1}`}</Text>
                      <Text style={styles.sheetVariationHint}>
                        {variationSheetMode === "cart" ? "Select this variation for your cart" : "Tap to view this variation clearly"}
                      </Text>
                    </View>
                    {selectedVariationName === variation.name ? (
                      <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
                    ) : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {variationSheetMode === "cart" || variationSheetMode === "buy" ? (
                <TouchableOpacity
                  style={styles.sheetAddToCartButton}
                  activeOpacity={0.88}
                  onPress={() => {
                    if (variationCount > 0 && !selectedVariation) {
                      Alert.alert(
                        "Select a Variation",
                        variationSheetMode === "buy"
                          ? "Please select a variation before continuing to checkout."
                          : "Please select a variation before adding this product to your cart."
                      );
                      return;
                    }
                    if (variationSheetMode === "buy") {
                      closeVariationSheet(proceedToCheckout);
                      return;
                    }
                    closeVariationSheet(confirmAddToCart);
                  }}
                >
                  <Ionicons name={variationSheetMode === "buy" ? "flash-outline" : "cart-outline"} size={18} color="#ffffff" />
                  <Text style={styles.sheetAddToCartButtonText}>{variationSheetMode === "buy" ? "Continue to Checkout" : "Add to Cart"}</Text>
                </TouchableOpacity>
              ) : null}
            </Animated.View>
          </View>
      </Modal>

      <Modal
        visible={reviewsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setReviewsVisible(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setReviewsVisible(false)} />

          <View style={[styles.sheetCard, { paddingBottom: sheetBottomPadding }]}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Reviews ({reviewCount})</Text>
              <TouchableOpacity style={styles.sheetCloseButton} onPress={() => setReviewsVisible(false)}>
                <Ionicons name="close" size={20} color="#22312d" />
              </TouchableOpacity>
            </View>

            <View style={styles.reviewSummaryRow}>
              <Text style={styles.reviewSummaryScore}>{averageRating > 0 ? `${averageRating.toFixed(1)}/5` : "No ratings yet"}</Text>
              {averageRating > 0 ? <Text style={styles.reviewSummaryStars}>{renderStars(averageRating)}</Text> : null}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {reviews.length === 0 ? (
                <Text style={styles.reviewEmptyText}>No reviews yet.</Text>
              ) : (
                reviews.map((review, index) => (
                  <View key={review.id || `sheet_review_${index}`} style={styles.fullReviewCard}>
                    <Text style={styles.reviewAuthor}>{review.reviewerName || `Buyer ${index + 1}`}</Text>
                    <View style={styles.fullReviewMetaRow}>
                <Text style={styles.reviewStars}>{renderStars(Number(review.rating) || 0)}</Text>
                      <Text style={styles.fullReviewMetaText}>{review.itemLabel || "Item: Standard"}</Text>
                    </View>
                    <Text style={styles.reviewComment}>{review.comment || "No written feedback yet."}</Text>
                    {review.imageUrl ? (
                      <Image source={{ uri: review.imageUrl }} style={styles.reviewImage} resizeMode="cover" />
                    ) : null}
                    <Text style={styles.fullReviewMetaText}>{review.createdLabel || "Recently posted"}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={cartConfirmVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => closeCartConfirm()}
      >
        <View style={styles.confirmOverlay}>
          <Animated.View style={[styles.confirmBackdrop, { opacity: cartConfirmBackdropOpacity }]}>
            <TouchableOpacity
              accessibilityLabel="Close add to cart"
              accessibilityRole="button"
              activeOpacity={1}
              style={styles.confirmBackdropPressable}
              onPress={() => closeCartConfirm()}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.confirmCard,
              { paddingBottom: sheetBottomPadding },
              {
                opacity: cartConfirmSheetProgress.interpolate({
                  inputRange: [0, 0.12, 1],
                  outputRange: [0, 1, 1],
                  extrapolate: "clamp",
                }),
                transform: [
                  {
                    translateY: cartConfirmSheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [120, 0],
                    }),
                  },
                  {
                    scale: cartConfirmSheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.985, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.confirmIconWrap}>
              <Ionicons name="cart-outline" size={22} color="#22312d" />
            </View>
            <Text style={styles.confirmTitle}>Add to Cart</Text>
            <Text style={styles.confirmText}>Add this product to your cart now?</Text>

            <View style={styles.confirmProductRow}>
              <View style={styles.confirmImageWrap}>
                {selectedVariation?.imageUrl || gallery[0] || product.imageUrl ? (
                  <Image
                    source={{ uri: selectedVariation?.imageUrl || gallery[0] || product.imageUrl || "" }}
                    style={styles.confirmImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.confirmImageFallback}>
                    <Ionicons name="cube-outline" size={20} color="#66746f" />
                  </View>
                )}
              </View>
              <View style={styles.confirmBody}>
                <Text style={styles.confirmProductName} numberOfLines={2}>{product.name}</Text>
                {selectedVariationName ? <Text style={styles.confirmVariation}>Variation: {selectedVariationName}</Text> : null}
                <Text style={styles.confirmPrice}>{formatPhilippinePeso(priceValue || product.price)}</Text>
              </View>
            </View>

            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.confirmSecondaryButton} onPress={() => closeCartConfirm()}>
                <Text style={styles.confirmSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmPrimaryButton}
                onPress={() => {
                  hapticMedium();
                  closeCartConfirm(() => void addToCart());
                }}
              >
                <Text style={styles.confirmPrimaryText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={addedToCartVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddedToCartVisible(false)}
      >
        <View style={styles.addedOverlay}>
          <View style={styles.addedCard}>
            <View style={styles.addedIconRing}>
              <Ionicons name="checkmark" size={34} color="#ffffff" />
            </View>
            <Text style={styles.addedTitle}>Added to Cart</Text>
            <Text style={styles.addedText}>
              {product.name}{selectedVariationName ? ` (${selectedVariationName})` : ""} was added to your shopping cart.
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={variationPreviewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVariationPreviewVisible(false)}
      >
        <View style={styles.viewerOverlay}>
          <TouchableOpacity style={styles.viewerCloseButton} onPress={() => setVariationPreviewVisible(false)}>
            <Ionicons name="close" size={22} color="#ffffff" />
          </TouchableOpacity>

          <View style={styles.viewerPage}>
            {previewVariation?.imageUrl ? (
              <Image source={{ uri: previewVariation.imageUrl }} style={styles.viewerImage} resizeMode="contain" />
            ) : null}
            <View style={styles.variationViewerLabel}>
              <Text style={styles.variationViewerLabelText}>{previewVariation?.name || "Variation"}</Text>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
  content: {
    backgroundColor: colors.surfaceWarm,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    zIndex: 10,
  },
  topBackButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    borderWidth: 0,
    backgroundColor: "rgba(255, 255, 255, 0.86)",
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  topIconButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: "rgba(34, 49, 45, 0.52)",
    alignItems: "center",
    justifyContent: "center",
  },
  searchPill: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: "#f1f2f0",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  searchPillText: {
    flex: 1,
    color: "#8a928d",
    fontSize: 13,
    fontWeight: "500",
  },
  heroSection: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: colors.surfaceMuted,
  },
  imagePage: {
    alignItems: "center",
    justifyContent: "center",
  },
  heroImage: {
    backgroundColor: colors.surfaceMuted,
  },
  heroFallback: {
    alignSelf: "center",
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  detailsSurface: {
    marginTop: -22,
    paddingTop: spacing.xl,
    overflow: "hidden",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surfaceWarm,
    zIndex: 2,
  },
  heroFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: 10,
  },
  heroStatusBadge: {
    borderRadius: 999,
    backgroundColor: "#22312d",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  heroStatusBadgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  priceSection: {
    marginHorizontal: spacing.lg,
    paddingBottom: 20,
  },
  productTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
  },
  priceText: {
    color: colors.primary,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  ratingStockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  ratingBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "900",
  },
  ratingText: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "800",
  },
  ratingDivider: {
    color: "#cad5cc",
    fontSize: 14,
    fontWeight: "700",
    marginHorizontal: 2,
  },
  soldText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  offerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  offerPill: {
    borderRadius: 999,
    backgroundColor: "#fbfcf8",
    borderWidth: 1,
    borderColor: "#e4ebe4",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  offerPillText: {
    color: "#66746f",
    fontSize: 12,
    fontWeight: "800",
  },
  panel: {
    marginTop: 12,
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  panelTitle: {
    color: "#22312d",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 10,
  },
  reviewHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reviewSeeMore: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "700",
  },
  reviewEmptyText: {
    color: "#6b7280",
    fontSize: 14,
    fontStyle: "italic",
    marginTop: 2,
  },
  reviewGateBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#d9d6cd",
    paddingHorizontal: 11,
    paddingVertical: 12,
    marginTop: 6,
  },
  reviewGateText: {
    flex: 1,
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
  },
  reviewSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  reviewSummaryScore: {
    color: "#22312d",
    fontSize: 26,
    fontWeight: "900",
  },
  reviewSummaryStars: {
    color: "#f59e0b",
    fontSize: 18,
    fontWeight: "900",
  },
  reviewCard: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#f1f4ef",
  },
  fullReviewCard: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#d8ddd7",
  },
  reviewAuthor: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 6,
  },
  reviewStars: {
    color: "#f59e0b",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  reviewItemLabel: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  reviewComment: {
    color: "#22312d",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10,
  },
  reviewImage: {
    width: 96,
    height: 96,
    borderRadius: 14,
    backgroundColor: "#d8ddd7",
  },
  reviewComposerHeader: {
    marginBottom: 14,
  },
  reviewComposerTitleWrap: {
    flex: 1,
  },
  reviewComposerSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  reviewCheckingRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  reviewCheckingText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  verifiedBuyerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 10,
  },
  verifiedBuyerText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  ratingPickerRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  ratingButton: {
    marginRight: 8,
  },
  ratingPickerIcon: {
    fontSize: 34,
    color: "#cad5cc",
  },
  ratingPickerIconActive: {
    color: "#f59e0b",
  },
  feedbackInput: {
    minHeight: 112,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e4ebe4",
    backgroundColor: "#fbfcf8",
    color: "#22312d",
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  submitButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  submitButtonDisabled: {
    opacity: 0.55,
  },
  submitButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  variationPreviewSection: {
    marginTop: 18,
  },
  variationPreviewTitle: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 10,
  },
  variationPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    backgroundColor: "#fbfcf8",
    borderWidth: 1,
    borderColor: "#e4ebe4",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  variationLeadIcon: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  variationPreviewList: {
    gap: 6,
    paddingHorizontal: 6,
  },
  variationPreviewThumb: {
    width: 34,
    height: 34,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#e4ebe4",
  },
  variationPreviewImage: {
    width: "100%",
    height: "100%",
  },
  variationPreviewFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f4ef",
  },
  variationPreviewText: {
    flex: 1,
    color: "#75807b",
    fontSize: 13,
    fontWeight: "700",
    marginLeft: 8,
  },
  infoGrid: {
    gap: 10,
    marginBottom: 18,
  },
  infoCard: {
    borderRadius: 18,
    backgroundColor: "#fbfcf8",
    borderWidth: 1,
    borderColor: "#e4ebe4",
    padding: 14,
  },
  infoLabel: {
    color: "#75807b",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  infoValue: {
    color: "#22312d",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  iconAction: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "#eef1ec",
    alignItems: "center",
    justifyContent: "center",
  },
  cartButton: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "#f2ede5",
    borderWidth: 1,
    borderColor: "#d4c4ae",
    alignItems: "center",
    justifyContent: "center",
  },
  buyButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
  },
  buyButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900",
  },
  soldOutBuyButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.lg,
    backgroundColor: colors.borderWarm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  soldOutBuyButtonText: {
    color: "#4c5b57",
    fontSize: 14,
    fontWeight: "900",
  },
  viewerOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.96)",
    justifyContent: "center",
  },
  viewerCloseButton: {
    position: "absolute",
    top: 54,
    right: 16,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerPage: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  viewerImage: {
    width: "100%",
    height: "78%",
  },
  viewerCounter: {
    position: "absolute",
    bottom: 44,
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  viewerCounterText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  variationViewerLabel: {
    marginTop: 18,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  variationViewerLabelText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20, 29, 43, 0.38)",
  },
  variationOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  variationBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20, 29, 43, 0.38)",
  },
  variationBackdropPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetCard: {
    maxHeight: "72%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 20,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#cad5cc",
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sheetTitle: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
  },
  sheetCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#eef1ec",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetVariationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    backgroundColor: "#fbfcf8",
    borderWidth: 1,
    borderColor: "#e4ebe4",
    padding: 12,
    marginBottom: 10,
  },
  sheetVariationRowActive: {
    borderColor: "#86efac",
    backgroundColor: "#f0fdf4",
  },
  sheetVariationThumb: {
    width: 60,
    height: 60,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#e4ebe4",
  },
  sheetVariationThumbLarge: {
    width: 72,
    height: 72,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#e4ebe4",
  },
  sheetVariationImage: {
    width: "100%",
    height: "100%",
  },
  sheetVariationFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f4ef",
  },
  sheetVariationName: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "800",
  },
  sheetVariationBody: {
    flex: 1,
    gap: 4,
  },
  sheetVariationHint: {
    color: "#75807b",
    fontSize: 12,
    lineHeight: 18,
  },
  sheetAddToCartButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  sheetAddToCartButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  confirmOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20, 29, 43, 0.38)",
  },
  confirmBackdropPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  addedOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  addedCard: {
    minWidth: 280,
    maxWidth: 340,
    backgroundColor: "#ffffff",
    borderRadius: 22,
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 28,
    gap: 8,
  },
  addedIconRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  addedTitle: {
    color: "#22312d",
    fontSize: 18,
    fontWeight: "900",
  },
  addedText: {
    color: "#75807b",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  confirmCard: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "86%",
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 20,
  },
  confirmIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#f2ede5",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  confirmTitle: {
    color: "#22312d",
    fontSize: 22,
    fontWeight: "900",
  },
  confirmText: {
    color: "#75807b",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  confirmProductRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "#fbfcf8",
    borderWidth: 1,
    borderColor: "#e4ebe4",
  },
  confirmImageWrap: {
    width: 74,
    height: 74,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#e4ebe4",
  },
  confirmImage: {
    width: "100%",
    height: "100%",
  },
  confirmImageFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f4ef",
  },
  confirmBody: {
    flex: 1,
    justifyContent: "center",
  },
  confirmProductName: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "800",
  },
  confirmVariation: {
    color: "#75807b",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  confirmPrice: {
    color: "#6d7f72",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 6,
  },
  confirmActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  confirmSecondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#eef1ec",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmSecondaryText: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "800",
  },
  confirmPrimaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmPrimaryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  fullReviewMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  fullReviewMetaText: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  compactMoreButton: {
    width: 28,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCounter: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.xl,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryDark,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  heroCounterText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "800",
  },
  marketVariationSection: {
    marginTop: spacing.lg,
  },
  marketSectionHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  marketSectionLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  marketSectionAction: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  marketVariationStrip: {
    gap: spacing.md,
    paddingRight: 6,
  },
  marketVariationCard: {
    width: 48,
    alignItems: "center",
  },
  variationThumbRing: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: "transparent",
    padding: 3,
  },
  variationThumbRingSelected: {
    borderColor: colors.primary,
  },
  marketVariationImage: {
    width: "100%",
    height: "100%",
    borderRadius: 16,
    backgroundColor: "#edf0ed",
  },
  marketVariationFallback: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "#edf0ed",
    alignItems: "center",
    justifyContent: "center",
  },
  marketVariationName: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 4,
  },
  marketPanel: {
    marginHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
    paddingVertical: spacing.xl,
  },
  detailSection: {
    marginHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
    paddingVertical: spacing.xl,
  },
  detailSectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: spacing.md,
  },
  productFactRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
  },
  productFactLabel: {
    width: 104,
    color: colors.textMuted,
    fontSize: 13,
  },
  productFactValue: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  sectionDivider: {
    height: 1,
    backgroundColor: colors.borderWarm,
    marginVertical: spacing.md,
  },
  descriptionText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
  },
  reviewsSection: {
    marginHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
    paddingVertical: spacing.xl,
  },
  reviewSummaryText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  marketPanelHeader: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  marketPanelTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  productRatingHeader: {
    minHeight: 35,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  productRatingTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  productRatingScore: {
    color: "#2f3935",
    fontSize: 21,
    fontWeight: "900",
  },
  marketReviewCard: {
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: "#eef1ee",
  },
  marketReviewerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  marketReviewerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#e8ede9",
    alignItems: "center",
    justifyContent: "center",
  },
  viewAllReviewsButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 1,
    borderTopColor: "#eef1ee",
  },
  viewAllReviewsText: {
    color: "#59645f",
    fontSize: 12,
    fontWeight: "800",
  },
  shopMarketPanel: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderTopColor: colors.borderWarm,
    borderColor: colors.borderWarm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  shopTrustHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.primaryDark,
    paddingHorizontal: spacing.md,
  },
  shopTrustBrandLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  shopTrustBrand: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "800",
  },
  shopTrustPromise: {
    color: "#e8eee9",
    fontSize: 9,
    fontWeight: "700",
  },
  shopMarketBody: {
    padding: spacing.lg,
  },
  shopMarketHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  shopMarketAvatar: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  shopMarketAvatarFallback: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  shopMarketIdentity: {
    flex: 1,
    marginLeft: spacing.md,
  },
  shopMarketName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  shopStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
  },
  shopStatusText: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: "800",
  },
  shopOnlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  shopOnlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#36b96d",
  },
  shopOnlineText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  shopMarketLocation: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.xs,
  },
  visitShopButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.primaryDark,
    paddingHorizontal: spacing.lg,
  },
  visitShopText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "800",
  },
  shopStatsGrid: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
  },
  shopStat: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  shopStatValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  shopStatLabel: {
    color: colors.textMuted,
    fontSize: 9,
    marginTop: spacing.xs,
  },
  shopStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.borderWarm,
  },
  relatedSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
  },
  relatedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  relatedTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  relatedAction: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  relatedActionText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  homeProductGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.xl,
  },
  homeProductCard: {
    width: "48%",
  },
  homeProductImageFrame: {
    position: "relative",
    width: "100%",
    aspectRatio: 0.82,
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
  },
  homeProductImage: {
    width: "100%",
    height: "100%",
  },
  homeProductImageFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  homeProductFavoriteButton: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  homeProductDetails: {
    paddingTop: 6,
  },
  homeProductShopName: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  homeProductName: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    marginTop: 1,
  },
  homeProductPrice: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  productRail: {
    gap: spacing.md,
    paddingRight: spacing.lg,
  },
  productRailItem: {
    width: 156,
  },
  productRailImageFrame: {
    width: "100%",
    aspectRatio: 0.9,
    overflow: "hidden",
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  productRailImage: {
    width: "100%",
    height: "100%",
  },
  productRailImageFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  productRailName: {
    minHeight: 36,
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    marginTop: spacing.sm,
  },
  productRailPrice: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  productRailShopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  productRailShopName: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 11,
  },
  recommendationSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
  },
  recommendationHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headingLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.borderWarm,
  },
  recommendationTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  bottomNavButton: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomNavText: {
    color: colors.text,
    fontSize: 9,
    fontWeight: "800",
    marginTop: 2,
  },
  bottomCartButton: {
    width: 48,
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  bottomCartPlusBadge: {
    position: "absolute",
    right: 7,
    top: 7,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#86654a",
    alignItems: "center",
    justifyContent: "center",
  },
  buyButtonPrice: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  emptyTitle: {
    color: "#22312d",
    fontSize: 22,
    fontWeight: "900",
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
});

