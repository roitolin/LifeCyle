import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  Alert,
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
type VariationSheetMode = "browse" | "cart" | "buy";
type VariationPreviewState = {
  name: string;
  imageUrl?: string | null;
} | null;

export default function FuneralProductViewScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const sheetBottomPadding = Math.max(insets.bottom + 16, 24);
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
  const [specsExpanded, setSpecsExpanded] = useState(true);
  const [shopDetails, setShopDetails] = useState<ShopSummary | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<ProductViewItem[]>([]);
  const [shopProductCount, setShopProductCount] = useState(1);

  const product = (route?.params?.product || null) as ProductViewItem | null;
  const gallery = product ? getGallery(product) : [];

  const imageWidth = width;
  const imageHeight = Math.min(width * 0.92, 440);

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

  const isVerifiedBuyer = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser || !product?.id) return false;
    const { data } = await supabase
      .from("funeral_service_requests")
      .select("id")
      .eq("requesterId", currentUser.uid)
      .eq("productId", product.id)
      .in("status", ["accepted_by_shop", "awaiting_payment", "payment_submitted", "payment_verified", "awaiting_customer_confirmation", "completed"])
      .limit(1);
    return Boolean(data && data.length > 0);
  }, [product?.id]);

  const checkPurchaseEligibility = useCallback(async () => {
    const bought = await isVerifiedBuyer();
    setHasPurchased(bought);
    setPurchaseChecked(true);
  }, [isVerifiedBuyer]);

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
        return;
      }

      const [shopResult, relatedResult] = await Promise.all([
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
      ]);

      if (cancelled) return;
      if (!shopResult.error) setShopDetails((shopResult.data as ShopSummary | null) ?? null);
      if (!relatedResult.error) {
        const nextRelated = (relatedResult.data || []).map((row: any) => ({
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
          shopId: product.shopId,
          shopName: shopResult.data?.shopName || product.shopName || "Verified Shop",
          hasVariations: Boolean(row.hasVariations) || (row.funeral_product_variations || []).length > 0,
          variations: (row.funeral_product_variations || []).map((variation: any) => ({
            name: String(variation.name || "Standard"),
            imageUrl: variation.imageUrl || null,
          })),
        })) as ProductViewItem[];
        setRelatedProducts(nextRelated);
        setShopProductCount((relatedResult.count ?? nextRelated.length) + 1);
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

    const bought = await isVerifiedBuyer();
    if (!bought) {
      Alert.alert("Purchase Required", "Only families who purchased this product can rate and comment.");
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

    const bought = await isVerifiedBuyer();
    if (!bought) {
      Alert.alert("Purchase Required", "Only families who purchased this product can rate and comment.");
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
        shopName: product.shopName || "Verified Shop",
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

  const showProductMenu = () => {
    Alert.alert(product.name, "Choose an action", [
      { text: "Visit shop", onPress: handleOpenShop },
      { text: "Share product", onPress: () => void shareProduct() },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const openRelatedProduct = (item: ProductViewItem) => {
    navigation.push("ProductView", { product: item });
  };

  const confirmAddToCart = () => {
    setCartConfirmVisible(true);
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
        shopName: product.shopName || "Verified Shop",
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
        shopName: product.shopName || "Verified Shop",
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
      setVariationSheetMode("cart");
      setVariationsVisible(true);
      return;
    }

    confirmAddToCart();
  };

  const handleBuyNow = () => {
    if (variationCount > 0) {
      setVariationSheetMode("buy");
      setVariationsVisible(true);
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
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <View style={styles.topBar}>
        <AppBackButton onPress={() => navigation.goBack()} />

        <TouchableOpacity activeOpacity={0.9} style={styles.searchPill} onPress={handleOpenShop}>
          <Ionicons name="search-outline" size={17} color="#8a928d" />
          <Text numberOfLines={1} style={styles.searchPillText}>Search more in shop</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.topIconButton} onPress={() => void shareProduct()}>
          <Ionicons name="share-social-outline" size={22} color="#22312d" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.topIconButton} onPress={() => navigation.navigate("FuneralTabs", { screen: "Carts" })}>
          <Ionicons name="cart-outline" size={23} color="#22312d" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.compactMoreButton} onPress={showProductMenu}>
          <Ionicons name="ellipsis-vertical" size={20} color="#22312d" />
        </TouchableOpacity>
      </View>

      <KeyboardAwareScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: 92 + Math.max(insets.bottom, 8) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          {gallery.length ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={handleGalleryScroll}>
              {gallery.map((imageUrl, index) => (
                <View key={`${product.id}_${index}`} style={[styles.imagePage, { width }]}>
                  <TouchableOpacity activeOpacity={0.94} onPress={() => setImageViewerVisible(true)}>
                    <Image source={{ uri: imageUrl }} style={[styles.heroImage, { width: imageWidth, height: imageHeight }]} resizeMode="contain" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.heroFallback, { width: imageWidth, height: imageHeight }]}>
              <Ionicons name="image-outline" size={44} color="#86908a" />
            </View>
          )}
          <View style={styles.heroCounter}>
            <Text style={styles.heroStatusBadgeText}>{gallery.length ? `${activeImageIndex + 1}/${gallery.length}` : "1/1"}</Text>
          </View>
          {gallery.length > 1 ? (
            <View pointerEvents="none" style={styles.heroDots}>
              {gallery.slice(0, 7).map((_, index) => {
                const selectedDot = Math.min(activeImageIndex, 6) === index;
                return <View key={`gallery_dot_${index}`} style={[styles.heroDot, selectedDot && styles.heroDotActive]} />;
              })}
            </View>
          ) : null}
        </View>

        <View style={styles.priceSection}>
          <View style={styles.priceRow}>
            <Text style={styles.priceText}>{formatPhilippinePeso(priceValue || product.price)}</Text>
            <View style={[styles.stockBadge, isSoldOut ? styles.stockBadgeSoldOut : null]}>
              <Text style={[styles.stockBadgeText, isSoldOut ? styles.stockBadgeTextSoldOut : null]}>
                {isSoldOut ? "Sold out" : `${stockCount} in stock`}
              </Text>
            </View>
          </View>
          {isSoldOut ? (
            <View style={styles.soldOutNotice}>
              <Ionicons name="alert-circle-outline" size={18} color="#9b2c2c" />
              <Text style={styles.soldOutNoticeText}>
                This product is sold out. You can still view the details, but ordering and checkout are not available.
              </Text>
            </View>
          ) : null}
          <Text style={styles.priceSubtext}>{priceLabel}</Text>
          <View style={styles.ratingRow}>
            <Text style={styles.preferredBadge}>Preferred</Text>
            <Ionicons name="star" size={15} color={averageRating > 0 ? "#f3ad24" : "#a3a3a3"} />
            <Text style={styles.ratingText}>{averageRating > 0 ? averageRating.toFixed(1) : "New"}</Text>
            <Text style={styles.ratingDivider}>|</Text>
            <Text style={styles.soldText}>{soldCount > 0 ? `${soldCount} sold` : `${reviewCount} reviews`}</Text>
          </View>

          {variationCount > 0 ? (
            <View style={styles.marketVariationSection}>
              <View style={styles.marketSectionHeadingRow}>
                <Text style={styles.marketSectionLabel}>Variations</Text>
                <TouchableOpacity onPress={() => { setVariationSheetMode("browse"); setVariationsVisible(true); }}>
                  <Text style={styles.marketSectionAction}>View all ›</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketVariationStrip}>
                {variations.map((variation, index) => {
                  const selected = selectedVariationName === variation.name;
                  return (
                    <TouchableOpacity
                      key={`${product.id}_${variation.name}_${index}`}
                      style={[styles.marketVariationCard, selected && styles.marketVariationCardSelected]}
                      activeOpacity={0.88}
                      onPress={() => setSelectedVariationName(variation.name || `Option ${index + 1}`)}
                      onLongPress={() => openVariationPreview(variation, index)}
                    >
                      {variation.imageUrl ? (
                        <Image source={{ uri: variation.imageUrl }} style={styles.marketVariationImage} resizeMode="cover" />
                      ) : (
                        <View style={styles.marketVariationFallback}><Ionicons name="cube-outline" size={22} color="#718079" /></View>
                      )}
                      <Text style={styles.marketVariationName} numberOfLines={1}>{variation.name || `Option ${index + 1}`}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>

        <View style={styles.guaranteePanel}>
          <View style={styles.guaranteeRow}>
            <Ionicons name="car-outline" size={19} color="#5a6b64" />
            <Text style={styles.guaranteeText}>Delivery schedule coordinated with the funeral shop</Text>
            <Ionicons name="chevron-forward" size={18} color="#a4aba7" />
          </View>
          <View style={styles.guaranteeDivider} />
          <View style={styles.guaranteeRow}>
            <Ionicons name="shield-checkmark-outline" size={19} color="#5a6b64" />
            <Text style={styles.guaranteeText}>LifeCycle secure service coordination</Text>
            <Ionicons name="chevron-forward" size={18} color="#a4aba7" />
          </View>
        </View>

        <View style={styles.marketPanel}>
          <TouchableOpacity style={styles.marketPanelHeader} onPress={() => setSpecsExpanded((expanded) => !expanded)}>
            <Text style={styles.marketPanelTitle}>Product Description</Text>
            <Ionicons name={specsExpanded ? "chevron-up" : "chevron-down"} size={18} color="#8a928d" />
          </TouchableOpacity>
          {specsExpanded ? (
            <View style={styles.specsBody}>
              <View style={styles.specRow}><Text style={styles.specLabel}>Availability</Text><Text style={styles.specValue}>{stockCount > 0 ? "In Stock" : "Ask Shop"}</Text></View>
              <View style={styles.specRow}><Text style={styles.specLabel}>Variations</Text><Text style={styles.specValue}>{variationCount > 0 ? `${variationCount} options` : "Standard"}</Text></View>
              <View style={styles.specDivider} />
              <Text style={styles.descriptionText}>{product.description || "No description provided by the seller."}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.marketPanel}>
          <TouchableOpacity style={styles.productRatingHeader} onPress={() => setReviewsVisible(true)}>
            <View style={styles.productRatingTitleRow}>
              <Text style={styles.productRatingScore}>{averageRating > 0 ? averageRating.toFixed(1) : "New"}</Text>
              <Ionicons name="star" size={18} color="#f3ad24" />
              <Text style={styles.marketPanelTitle}>Product Ratings ({reviewCount})</Text>
            </View>
            <Ionicons name="chevron-forward" size={19} color="#9ca5a0" />
          </TouchableOpacity>

          {averageRating > 0 ? (
            <View style={styles.reviewInsightPill}>
              <Ionicons name="chatbubble-ellipses" size={14} color="#86654a" />
              <Text style={styles.reviewInsightText}>Customers rated this product {averageRating.toFixed(1)} out of 5</Text>
            </View>
          ) : null}

          {loadingReviews ? (
            <LoadingBird compact />
          ) : visibleReviews.length === 0 ? (
            <Text style={styles.reviewEmptyText}>No customer reviews yet. Be the first to rate and comment.</Text>
          ) : (
            visibleReviews.map((review, index) => (
              <View key={review.id || `preview_review_${index}`} style={styles.marketReviewCard}>
                <View style={styles.marketReviewerRow}>
                  <View style={styles.marketReviewerAvatar}><Ionicons name="person" size={16} color="#53615d" /></View>
                  <Text style={styles.reviewAuthor}>{review.reviewerName || `Buyer ${index + 1}`}</Text>
                </View>
                <Text style={styles.reviewStars}>{renderStars(Number(review.rating) || 0)}</Text>
                <Text style={styles.reviewItemLabel}>{review.itemLabel || "Variation: Standard"}</Text>
                <Text style={styles.reviewComment}>{review.comment || "No written feedback yet."}</Text>
                {review.imageUrl ? <Image source={{ uri: review.imageUrl }} style={styles.reviewImage} resizeMode="cover" /> : null}
              </View>
            ))
          )}
          {reviewCount > 0 ? (
            <TouchableOpacity style={styles.viewAllReviewsButton} onPress={() => setReviewsVisible(true)}>
              <Text style={styles.viewAllReviewsText}>View All Reviews ›</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.marketPanel}>
          <Text style={styles.marketPanelTitle}>Rate This Product</Text>

          {!purchaseChecked ? (
            <Text style={styles.reviewEmptyText}>Checking your purchase eligibility...</Text>
          ) : !auth.currentUser ? (
            <View style={styles.reviewGateBox}>
              <Ionicons name="lock-closed" size={18} color="#62706b" />
              <Text style={styles.reviewGateText}>Log in to rate and comment on this product.</Text>
            </View>
          ) : !hasPurchased ? (
            <View style={styles.reviewGateBox}>
              <Ionicons name="lock-closed" size={18} color="#62706b" />
              <Text style={styles.reviewGateText}>Only families who purchased this product can rate and comment. Complete your order to share your experience.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.reviewComposerHint}>Tap a star and share your experience with other families.</Text>
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
              <Ionicons name="bag-check" size={16} color="#ffffff" />
              <Text style={styles.shopTrustBrand}>LifeCycle Shop</Text>
            </View>
            <Text style={styles.shopTrustPromise}>Accredited · Secure</Text>
          </View>

          <View style={styles.shopMarketBody}>
            <View style={styles.shopMarketHeader}>
              {shopDetails?.shopImageUrl ? (
                <Image source={{ uri: shopDetails.shopImageUrl }} style={styles.shopMarketAvatar} />
              ) : (
                <View style={styles.shopMarketAvatarFallback}><Ionicons name="storefront" size={25} color="#22312d" /></View>
              )}
              <View style={styles.shopMarketIdentity}>
                <Text style={styles.shopMarketName}>{shopDetails?.shopName || product.shopName || "Verified Shop"}</Text>
                <View style={styles.shopMarketRatingRow}>
                  <Ionicons name="star" size={13} color="#f3ad24" />
                  <Text style={styles.shopMarketRatingScore}>{averageRating > 0 ? averageRating.toFixed(1) : "New"}</Text>
                  <Text style={styles.shopMarketSold}>{reviewCount > 0 ? `${reviewCount} reviews` : "New shop"}</Text>
                </View>
                <View style={styles.shopOnlineRow}><View style={styles.shopOnlineDot} /><Text style={styles.shopOnlineText}>{shopDetails?.status === "live" ? "Online" : "Verified shop"}</Text></View>
                <Text style={styles.shopMarketLocation} numberOfLines={1}>{shopDetails?.generalLocation || shopDetails?.shopAddress || "Philippines"}</Text>
              </View>
              <TouchableOpacity style={styles.visitShopButton} onPress={handleOpenShop}><Text style={styles.visitShopText}>Visit</Text></TouchableOpacity>
            </View>

            <View style={styles.shopStatsGrid}>
              <View style={styles.shopStat}><Text style={styles.shopStatValue}>100%</Text><Text style={styles.shopStatLabel}>verified provider</Text></View>
              <View style={styles.shopStatDivider} />
              <View style={styles.shopStat}><Text style={styles.shopStatValue}>{shopProductCount}</Text><Text style={styles.shopStatLabel}>products available</Text></View>
              <View style={styles.shopStatDivider} />
              <TouchableOpacity style={styles.shopStat} onPress={handleOpenChat}><Text style={styles.shopStatValue}>Open</Text><Text style={styles.shopStatLabel}>shop chat</Text></TouchableOpacity>
            </View>
          </View>
        </View>

        {relatedProducts.length > 0 ? (
          <View style={styles.relatedSection}>
            <View style={styles.relatedHeader}><Text style={styles.relatedTitle}>From The Same Shop</Text><TouchableOpacity onPress={handleOpenShop}><Text style={styles.marketSectionAction}>See all ›</Text></TouchableOpacity></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relatedStrip}>
              {relatedProducts.map((item) => {
                const imageUrl = getGallery(item)[0] || item.imageUrl;
                return (
                  <TouchableOpacity key={`same_${item.id}`} style={styles.relatedCard} activeOpacity={0.9} onPress={() => openRelatedProduct(item)}>
                    {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.relatedImage} resizeMode="contain" /> : <View style={styles.relatedImageFallback}><Ionicons name="cube-outline" size={27} color="#718079" /></View>}
                    <Text style={styles.relatedName} numberOfLines={2}>{item.name}</Text>
                    <Text style={styles.relatedPrice}>{formatPhilippinePeso(item.price)}</Text>
                    <View style={styles.relatedRating}><Ionicons name="star" size={11} color="#f3ad24" /><Text style={styles.relatedRatingText}>Shop item</Text></View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {relatedProducts.length > 1 ? (
          <View style={styles.recommendationSection}>
            <View style={styles.recommendationHeading}><View style={styles.headingLine} /><Text style={styles.relatedTitle}>You May Also Like</Text><View style={styles.headingLine} /></View>
            <View style={styles.recommendationGrid}>
              {relatedProducts.slice(0, 4).reverse().map((item) => {
                const imageUrl = getGallery(item)[0] || item.imageUrl;
                return (
                  <TouchableOpacity key={`also_${item.id}`} style={styles.recommendationCard} activeOpacity={0.9} onPress={() => openRelatedProduct(item)}>
                    {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.recommendationImage} resizeMode="contain" /> : <View style={styles.recommendationImageFallback}><Ionicons name="cube-outline" size={30} color="#718079" /></View>}
                    <Text style={styles.recommendationName} numberOfLines={2}>{item.name}</Text>
                    <Text style={styles.relatedPrice}>{formatPhilippinePeso(item.price)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TouchableOpacity style={styles.bottomNavButton} onPress={handleOpenShop}>
          <Ionicons name="storefront-outline" size={21} color="#22312d" />
          <Text style={styles.bottomNavText}>Shop</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomNavButton} onPress={handleOpenChat}>
          <Ionicons name="chatbubble-ellipses-outline" size={21} color="#22312d" />
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
        animationType="slide"
        onRequestClose={() => setVariationsVisible(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setVariationsVisible(false)} />

          <View style={[styles.sheetCard, { paddingBottom: sheetBottomPadding }]}>
            <View style={styles.sheetHandle} />

              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{variationSheetMode === "cart" ? "Choose Variation" : "Variations"}</Text>
                <TouchableOpacity style={styles.sheetCloseButton} onPress={() => setVariationsVisible(false)}>
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
                    setVariationsVisible(false);
                    if (variationSheetMode === "buy") {
                      proceedToCheckout();
                      return;
                    }
                    confirmAddToCart();
                  }}
                >
                  <Ionicons name={variationSheetMode === "buy" ? "flash-outline" : "cart-outline"} size={18} color="#ffffff" />
                  <Text style={styles.sheetAddToCartButtonText}>{variationSheetMode === "buy" ? "Continue to Checkout" : "Add to Cart"}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
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
        animationType="fade"
        onRequestClose={() => setCartConfirmVisible(false)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
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
              <TouchableOpacity style={styles.confirmSecondaryButton} onPress={() => setCartConfirmVisible(false)}>
                <Text style={styles.confirmSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmPrimaryButton}
                onPress={() => {
                  hapticMedium();
                  setCartConfirmVisible(false);
                  void addToCart();
                }}
              >
                <Text style={styles.confirmPrimaryText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
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
    backgroundColor: "#f1f2ef",
  },
  content: {
    backgroundColor: "#f1f2ef",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 56,
    paddingHorizontal: 7,
    paddingVertical: 8,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e7e9e6",
    shadowColor: "#26322d",
    shadowOpacity: 0.06,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    zIndex: 4,
  },
  topIconButton: {
    width: 36,
    height: 38,
    borderRadius: 8,
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
    backgroundColor: "#f8f7f4",
    position: "relative",
    overflow: "hidden",
  },
  imagePage: {
    alignItems: "center",
    justifyContent: "center",
  },
  heroImage: {
    backgroundColor: "#f8f7f4",
  },
  heroFallback: {
    alignSelf: "center",
    backgroundColor: "#d8ddd7",
    alignItems: "center",
    justifyContent: "center",
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
    marginTop: 8,
    marginHorizontal: 8,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e3e7e3",
    paddingHorizontal: 12,
    paddingVertical: 15,
    shadowColor: "#26322d",
    shadowOpacity: 0.04,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  priceText: {
    color: "#6d7f72",
    fontSize: 25,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: -1.1,
  },
  priceSubtext: {
    color: "#22312d",
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
    marginTop: 9,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
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
    color: "#66746f",
    fontSize: 14,
    fontWeight: "700",
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
    borderRadius: 14,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    paddingHorizontal: 14,
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
  reviewComposerHint: {
    color: "#75807b",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
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
  descriptionText: {
    color: "#66746f",
    fontSize: 14,
    lineHeight: 22,
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#dfe3df",
    gap: 5,
    paddingHorizontal: 8,
    paddingTop: 7,
    shadowColor: "#1f2925",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -3 },
    elevation: 10,
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
    minHeight: 54,
    borderRadius: 999,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
  },
  buyButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  soldOutBuyButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 999,
    backgroundColor: "#c9cfcb",
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
    backgroundColor: "rgba(15,23,42,0.34)",
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
    backgroundColor: "rgba(15,23,42,0.42)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
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
    maxWidth: 360,
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: "#d8ddd7",
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
    right: 10,
    bottom: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  heroDots: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  heroDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(34,49,45,0.28)",
  },
  heroDotActive: {
    width: 16,
    backgroundColor: "#5a6b64",
  },
  stockBadge: {
    marginLeft: "auto",
    borderRadius: 4,
    backgroundColor: "#eef1ec",
    borderWidth: 1,
    borderColor: "#d8ddd7",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  stockBadgeSoldOut: {
    backgroundColor: "#fdecec",
    borderColor: "#f3c2c2",
  },
  stockBadgeText: {
    color: "#53615d",
    fontSize: 10,
    fontWeight: "800",
  },
  stockBadgeTextSoldOut: {
    color: "#9b2c2c",
  },
  soldOutNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    backgroundColor: "#fdecec",
    borderWidth: 1,
    borderColor: "#f3c2c2",
    padding: 11,
    marginTop: 10,
  },
  soldOutNoticeText: {
    flex: 1,
    color: "#8f2525",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  preferredBadge: {
    color: "#ffffff",
    backgroundColor: "#86654a",
    borderRadius: 3,
    overflow: "hidden",
    paddingHorizontal: 5,
    paddingVertical: 2,
    fontSize: 9,
    fontWeight: "900",
  },
  marketVariationSection: {
    marginTop: 16,
  },
  marketSectionHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 9,
  },
  marketSectionLabel: {
    color: "#303a36",
    fontSize: 14,
    fontWeight: "800",
  },
  marketSectionAction: {
    color: "#5a6b64",
    fontSize: 11,
    fontWeight: "800",
  },
  marketVariationStrip: {
    gap: 7,
    paddingRight: 6,
  },
  marketVariationCard: {
    width: 74,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e1e5e1",
    backgroundColor: "#ffffff",
    padding: 4,
  },
  marketVariationCardSelected: {
    borderColor: "#5a6b64",
    borderWidth: 2,
    padding: 3,
  },
  marketVariationImage: {
    width: "100%",
    height: 61,
    borderRadius: 4,
    backgroundColor: "#edf0ed",
  },
  marketVariationFallback: {
    height: 61,
    borderRadius: 4,
    backgroundColor: "#edf0ed",
    alignItems: "center",
    justifyContent: "center",
  },
  marketVariationName: {
    color: "#59635f",
    fontSize: 9,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 4,
  },
  guaranteePanel: {
    marginTop: 8,
    marginHorizontal: 8,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e3e7e3",
    overflow: "hidden",
  },
  guaranteeRow: {
    minHeight: 51,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  guaranteeText: {
    flex: 1,
    color: "#4f5a55",
    fontSize: 12,
    lineHeight: 17,
  },
  guaranteeDivider: {
    height: 1,
    marginLeft: 38,
    backgroundColor: "#edf0ed",
  },
  marketPanel: {
    marginTop: 8,
    marginHorizontal: 8,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e3e7e3",
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  marketPanelHeader: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  marketPanelTitle: {
    color: "#303a36",
    fontSize: 14,
    fontWeight: "900",
  },
  specsBody: {
    paddingTop: 10,
  },
  specRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 7,
  },
  specLabel: {
    width: 112,
    color: "#7d8682",
    fontSize: 12,
  },
  specValue: {
    flex: 1,
    color: "#39443f",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  specDivider: {
    height: 1,
    backgroundColor: "#edf0ed",
    marginVertical: 10,
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
  reviewInsightPill: {
    marginTop: 8,
    marginBottom: 7,
    borderRadius: 6,
    backgroundColor: "#f2ede5",
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  reviewInsightText: {
    color: "#86654a",
    fontSize: 10,
    fontWeight: "700",
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
    marginTop: 8,
    marginHorizontal: 8,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#dedfdc",
    shadowColor: "#26322d",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  shopTrustHeader: {
    minHeight: 34,
    paddingHorizontal: 12,
    backgroundColor: "#3b2e24",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  shopTrustBrandLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  shopTrustBrand: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
  },
  shopTrustPromise: {
    color: "#e9ded3",
    fontSize: 9,
    fontWeight: "700",
  },
  shopMarketBody: {
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  shopMarketHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  shopMarketAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#edf0ed",
  },
  shopMarketAvatarFallback: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#e8ede9",
    alignItems: "center",
    justifyContent: "center",
  },
  shopMarketIdentity: {
    flex: 1,
    marginLeft: 10,
  },
  shopMarketName: {
    color: "#28332f",
    fontSize: 14,
    fontWeight: "900",
  },
  shopMarketRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  shopMarketRatingScore: {
    color: "#3f5d50",
    fontSize: 11,
    fontWeight: "900",
  },
  shopMarketSold: {
    color: "#8a928d",
    fontSize: 10,
    marginLeft: 3,
  },
  shopOnlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 3,
  },
  shopOnlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#36b96d",
  },
  shopOnlineText: {
    color: "#6f7974",
    fontSize: 10,
  },
  shopMarketLocation: {
    color: "#818a86",
    fontSize: 10,
    marginTop: 3,
  },
  visitShopButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#22312d",
    backgroundColor: "#22312d",
    paddingHorizontal: 20,
    paddingVertical: 9,
  },
  visitShopText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
  },
  shopStatsGrid: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
  },
  shopStat: {
    flex: 1,
    alignItems: "center",
  },
  shopStatValue: {
    color: "#303a36",
    fontSize: 13,
    fontWeight: "900",
  },
  shopStatLabel: {
    color: "#8b938f",
    fontSize: 9,
    marginTop: 3,
  },
  shopStatDivider: {
    width: 1,
    height: 30,
    backgroundColor: "#edf0ed",
  },
  relatedSection: {
    marginTop: 8,
    marginHorizontal: 8,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e3e7e3",
    overflow: "hidden",
    paddingVertical: 13,
  },
  relatedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 9,
    marginBottom: 10,
  },
  relatedTitle: {
    color: "#303a36",
    fontSize: 14,
    fontWeight: "900",
  },
  relatedStrip: {
    paddingHorizontal: 8,
    gap: 7,
  },
  relatedCard: {
    width: 132,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#e6e9e6",
    padding: 6,
    backgroundColor: "#ffffff",
  },
  relatedImage: {
    width: "100%",
    height: 112,
    borderRadius: 7,
    backgroundColor: "#f6f7f4",
  },
  relatedImageFallback: {
    height: 112,
    borderRadius: 5,
    backgroundColor: "#edf0ed",
    alignItems: "center",
    justifyContent: "center",
  },
  relatedName: {
    minHeight: 34,
    color: "#3b4641",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
  relatedPrice: {
    color: "#6d7f72",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 4,
  },
  relatedRating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 5,
  },
  relatedRatingText: {
    color: "#7d8682",
    fontSize: 9,
  },
  recommendationSection: {
    marginTop: 8,
    marginHorizontal: 8,
    backgroundColor: "#f7f8f6",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e3e7e3",
    overflow: "hidden",
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  recommendationHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 22,
    marginBottom: 12,
  },
  headingLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#cfd5d1",
  },
  recommendationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  recommendationCard: {
    width: "48.8%",
    backgroundColor: "#ffffff",
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: "#e6e9e6",
    borderRadius: 9,
    overflow: "hidden",
  },
  recommendationImage: {
    width: "100%",
    height: 170,
    backgroundColor: "#f6f7f4",
  },
  recommendationImageFallback: {
    height: 170,
    backgroundColor: "#edf0ed",
    alignItems: "center",
    justifyContent: "center",
  },
  recommendationName: {
    minHeight: 36,
    color: "#3b4641",
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 6,
    marginTop: 5,
  },
  bottomNavButton: {
    width: 48,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomNavText: {
    color: "#22312d",
    fontSize: 9,
    fontWeight: "800",
    marginTop: 2,
  },
  bottomCartButton: {
    width: 52,
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: "#eef1ec",
    borderWidth: 1,
    borderColor: "#d8ddd7",
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

