import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { AppBackButton } from "@/components";
import { supabase } from "@/services/supabaseClient";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { colors, radii, spacing } from "@/theme";

type ProductVariation = {
  name: string;
  imageUrl?: string | null;
};

type ShopProduct = {
  id: string;
  name: string;
  description: string;
  price: string;
  stock: number;
  imageUrl?: string | null;
  galleryImageUrls: string[];
  hasVariations: boolean;
  variations: ProductVariation[];
  active: boolean;
  createdAt?: string | null;
};

type ShopInfo = {
  id: string;
  shopName?: string | null;
  shopAddress?: string | null;
  shopPhoneNumber?: string | null;
  shopImageUrl?: string | null;
  coverImageUrl?: string | null;
  generalLocation?: string | null;
  status?: string | null;
  paidUntil?: string | null;
};

type RatingRow = {
  productId?: string | null;
  rating?: number | null;
};

type ReviewRow = {
  id: string;
  productId?: string | null;
  displayName?: string | null;
  feedback?: string | null;
  ratingSnapshot?: number | null;
  createdAt?: string | null;
};

type StorefrontTab = "shop" | "products" | "categories" | "reviews";
type CategoryFilter = "all" | "variations" | "standard" | "available";
type ProductSort = "Name" | "Newest" | "Price: Low" | "Price: High";

const STOREFRONT_TABS: { key: StorefrontTab; label: string }[] = [
  { key: "shop", label: "Shop" },
  { key: "products", label: "Products" },
  { key: "categories", label: "Categories" },
  { key: "reviews", label: "Reviews" },
];

const PRODUCT_FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "variations", label: "With options" },
  { key: "standard", label: "Standard" },
];

function getPrimaryProductImage(item?: ShopProduct | null) {
  if (!item) return null;
  return (
    item.imageUrl ||
    item.galleryImageUrls?.[0] ||
    item.variations.find((entry) => entry.imageUrl)?.imageUrl ||
    null
  );
}

function formatFollowerCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatReviewDate(value?: string | null) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function getNumericProductPrice(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function ProductCard({
  item,
  width,
  rating,
  reviewCount,
  onPress,
}: {
  item: ShopProduct;
  width: number;
  rating: number;
  reviewCount: number;
  onPress: () => void;
}) {
  const imageUrl = getPrimaryProductImage(item);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${formatPhilippinePeso(item.price)}, ${item.stock > 0 ? `${item.stock} available` : "sold out"}`}
      style={[styles.productCard, { width }]}
      activeOpacity={0.9}
      onPress={onPress}
    >
      {imageUrl && !imageFailed ? (
        <Image
          source={{ uri: imageUrl }}
          style={styles.productImage}
          resizeMode="contain"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={styles.productImageFallback}>
          <Ionicons name="cube-outline" size={38} color="#718079" />
        </View>
      )}

      {item.hasVariations ? (
        <View style={styles.variationBadge}>
          <Text style={styles.variationBadgeText}>{item.variations.length} options</Text>
        </View>
      ) : null}

      {item.stock <= 0 ? (
        <View style={styles.soldOutBadge}>
          <Text style={styles.soldOutBadgeText}>Sold out</Text>
        </View>
      ) : null}

      <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
      <Text style={styles.productPrice}>{formatPhilippinePeso(item.price)}</Text>
      <View style={styles.productMetaRow}>
        <View style={styles.productRatingGroup}>
          <Ionicons name="star" size={12} color="#f3ad24" />
          <Text style={styles.productMetaText}>
            {rating > 0 ? `${rating.toFixed(1)} (${reviewCount})` : "No reviews"}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.productStockText, item.stock <= 0 ? styles.productMetaSoldOut : null]}>
          {item.stock > 0 ? `${item.stock} available` : "Sold out"}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function FuneralShopProductsScreen({ navigation, route }: any) {
  const { width: viewportWidth } = useWindowDimensions();
  const shopId = String(route?.params?.shopId || "");
  const fallbackShopName = String(route?.params?.shopName || "Shop");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [following, setFollowing] = useState(false);
  const [activeTab, setActiveTab] = useState<StorefrontTab>("shop");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [productSort, setProductSort] = useState<ProductSort>("Name");
  const [searchText, setSearchText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadShop = useCallback(async () => {
    setLoadError(null);
    if (!shopId) {
      setLoadError("This shop link is incomplete. Please return to the shops list and try again.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const currentViewerId = sessionData.session?.user.id ?? null;
      setViewerId(currentViewerId);

      const { data: shopData, error: shopError } = await supabase
        .from("funeral_shops")
        .select("id, shopName, shopAddress, shopPhoneNumber, shopImageUrl, coverImageUrl, generalLocation, status, paidUntil")
        .eq("id", shopId)
        .maybeSingle();

      if (shopError) throw shopError;
      if (!shopData) {
        setShop(null);
        setProducts([]);
        throw new Error("This shop is not available right now.");
      }

      const paidUntil = shopData.paidUntil ? new Date(shopData.paidUntil).getTime() : null;
      const subscriptionActive = paidUntil === null || (Number.isFinite(paidUntil) && paidUntil > Date.now());
      if (currentViewerId !== shopId && (shopData.status !== "live" || !subscriptionActive)) {
        setShop(null);
        setProducts([]);
        throw new Error("This shop's catalog is currently offline.");
      }
      setShop({ ...shopData, id: shopId } as ShopInfo);

      const [productResult, followCountResult, viewerFollowResult, ratingResult, reviewResult] = await Promise.all([
        supabase
          .from("funeral_products")
          .select(`
            id, name, description, price, stock, imageUrl, hasVariations, active, createdAt,
            funeral_product_variations ( name, imageUrl ),
            funeral_product_images ( imageUrl, displayOrder )
          `)
          .eq("shopId", shopId)
          .eq("active", true)
          .order("createdAt", { ascending: false }),
        supabase.from("shop_follows").select("id", { count: "exact", head: true }).eq("shopId", shopId),
        currentViewerId
          ? supabase.from("shop_follows").select("id").eq("shopId", shopId).eq("userId", currentViewerId).limit(1)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("funeral_product_ratings").select("productId, rating").eq("shopId", shopId),
        supabase
          .from("funeral_product_feedback")
          .select("id, productId, displayName, feedback, ratingSnapshot, createdAt")
          .eq("shopId", shopId)
          .order("createdAt", { ascending: false }),
      ]);

      if (productResult.error) throw productResult.error;

      const nextProducts = (productResult.data || []).map((row: any) => {
        const variations = (row.funeral_product_variations || []).map((variation: any) => ({
          name: String(variation.name || "Standard"),
          imageUrl: variation.imageUrl || null,
        }));
        const galleryImageUrls = (row.funeral_product_images || [])
          .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
          .map((image: any) => image.imageUrl)
          .filter(Boolean);

        return {
          id: String(row.id),
          name: String(row.name || "Untitled Product"),
          description: String(row.description || ""),
          price: String(row.price || 0),
          stock: Number(row.stock) || 0,
          imageUrl: row.imageUrl || null,
          galleryImageUrls,
          hasVariations: Boolean(row.hasVariations) || variations.length > 0,
          variations,
          active: Boolean(row.active),
          createdAt: row.createdAt || null,
        } as ShopProduct;
      });

      setProducts(nextProducts);

      if (!followCountResult.error) setFollowerCount(followCountResult.count || 0);
      if (!viewerFollowResult.error) setFollowing(Boolean(viewerFollowResult.data?.length));
      if (!ratingResult.error) setRatings((ratingResult.data || []) as RatingRow[]);
      if (!reviewResult.error) setReviews((reviewResult.data || []) as ReviewRow[]);
    } catch (error: any) {
      setLoadError(error?.message || "Failed to load this shop.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [shopId]);

  useFocusEffect(
    useCallback(() => {
      void loadShop();
    }, [loadShop])
  );

  const ratingStats = useMemo(() => {
    const byProduct = new Map<string, { total: number; count: number; average: number }>();
    ratings.forEach((row) => {
      if (!row.productId) return;
      const rating = Number(row.rating) || 0;
      if (rating <= 0) return;
      const current = byProduct.get(row.productId) || { total: 0, count: 0, average: 0 };
      current.total += rating;
      current.count += 1;
      current.average = current.total / current.count;
      byProduct.set(row.productId, current);
    });
    return byProduct;
  }, [ratings]);

  const overallRating = useMemo(() => {
    const validRatings = ratings
      .map((row) => Number(row.rating))
      .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);
    if (!validRatings.length) return 0;
    return validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length;
  }, [ratings]);

  const filteredProducts = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return products.filter((product) => {
      const categoryMatch =
        categoryFilter === "all" ||
        (categoryFilter === "available" && product.stock > 0) ||
        (categoryFilter === "variations" && product.hasVariations) ||
        (categoryFilter === "standard" && !product.hasVariations);
      if (!categoryMatch) return false;
      if (!query) return true;
      return [product.name, product.description, ...product.variations.map((variation) => variation.name)]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [categoryFilter, products, searchText]);

  const availableProductCount = useMemo(() => filteredProducts.filter((item) => item.stock > 0).length, [filteredProducts]);

  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      if (productSort === "Price: Low") return getNumericProductPrice(a.price) - getNumericProductPrice(b.price);
      if (productSort === "Price: High") return getNumericProductPrice(b.price) - getNumericProductPrice(a.price);
      if (productSort === "Newest") return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      return a.name.localeCompare(b.name);
    });
  }, [filteredProducts, productSort]);

  const availableFeaturedProducts = useMemo(
    () => filteredProducts.filter((product) => product.stock > 0).slice(0, 8),
    [filteredProducts]
  );

  const shopName = String(shop?.shopName || fallbackShopName);
  const shopAddress = String(shop?.generalLocation || shop?.shopAddress || "Location not provided");
  const shopPhoneNumber = String(shop?.shopPhoneNumber || "");
  const heroImageUrl = shop?.coverImageUrl || shop?.shopImageUrl || getPrimaryProductImage(products[0]);
  const gridCardWidth = Math.max(120, Math.min(210, (viewportWidth - spacing.lg - spacing.sm) / 2));

  const handleBack = () => {
    if (navigation.canGoBack?.()) navigation.goBack();
    else navigation.navigate("FuneralTabs", { screen: "Shops" });
  };

  const openProduct = (product: ShopProduct) => {
    const stats = ratingStats.get(product.id);
    navigation.navigate("ProductView", {
      product: {
        ...product,
        shopId,
        shopName,
        rating: stats?.average || 0,
        reviewCount: stats?.count || 0,
      },
    });
  };

  const openCustomRequest = () => {
    navigation.navigate("FuneralCustomCasketRequest", {
      shopId,
      shopName,
      shopAddress,
      shopPhoneNumber,
    });
  };

  const openChat = () => {
    if (!viewerId) {
      Alert.alert("Sign in required", "Please sign in before chatting with this shop.");
      return;
    }
    if (viewerId === shopId) {
      Alert.alert("Your shop", "You cannot start a chat with your own shop account.");
      return;
    }
    navigation.navigate("ShopChat", { otherUserId: shopId, otherUserName: shopName || "Funeral Shop" });
  };

  const callShop = async () => {
    const dialNumber = shopPhoneNumber.replace(/[^\d+]/g, "");
    if (!dialNumber) {
      Alert.alert("Phone number unavailable", "This shop has not provided a callable phone number.");
      return;
    }

    try {
      const phoneUrl = `tel:${dialNumber}`;
      if (!(await Linking.canOpenURL(phoneUrl))) throw new Error("Calling is not available on this device.");
      await Linking.openURL(phoneUrl);
    } catch (error: any) {
      Alert.alert("Unable to call", error?.message || "Please try again from a phone.");
    }
  };

  const toggleFollow = async () => {
    if (!viewerId) {
      Alert.alert("Sign in required", "Please sign in before following this shop.");
      return;
    }
    if (viewerId === shopId || followBusy) return;

    setFollowBusy(true);
    try {
      if (following) {
        const { error } = await supabase
          .from("shop_follows")
          .delete()
          .eq("shopId", shopId)
          .eq("userId", viewerId);
        if (error) throw error;
        setFollowing(false);
        setFollowerCount((count) => Math.max(0, count - 1));
      } else {
        const { error } = await supabase.from("shop_follows").insert({ shopId, userId: viewerId });
        if (error) throw error;
        setFollowing(true);
        setFollowerCount((count) => count + 1);
      }
    } catch (error: any) {
      Alert.alert("Unable to update follow", error?.message || "Please try again.");
    } finally {
      setFollowBusy(false);
    }
  };

  const showShopMenu = () => {
    const actions: any[] = [
      { text: "Custom casket request", onPress: openCustomRequest },
    ];
    if (shopPhoneNumber) {
      actions.push({ text: "Call shop", onPress: () => void callShop() });
    }
    actions.push({ text: "Cancel", style: "cancel" });
    Alert.alert(shopName, "Choose an action", actions);
  };

  const selectCategory = (filter: CategoryFilter) => {
    setCategoryFilter(filter);
    setActiveTab("products");
  };

  const handleSearchChange = (value: string) => {
    setSearchText(value);
    if (value.trim()) setActiveTab("products");
  };

  const resetProductFilters = () => {
    setSearchText("");
    setCategoryFilter("all");
  };

  const renderProductStrip = (title: string, items: ShopProduct[], showMore = true) => (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {showMore && items.length > 0 ? (
          <TouchableOpacity onPress={() => { setCategoryFilter("all"); setActiveTab("products"); }}>
            <Text style={styles.seeMoreText}>See More  ›</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {items.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productStrip}>
          {items.map((item) => (
            <ProductCard
              key={`${title}_${item.id}`}
              item={item}
              width={142}
              rating={ratingStats.get(item.id)?.average || 0}
              reviewCount={ratingStats.get(item.id)?.count || 0}
              onPress={() => openProduct(item)}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.inlineEmpty}>
          <Ionicons name="search-outline" size={22} color="#8a928d" />
          <Text style={styles.inlineEmptyText}>No products are currently in stock.</Text>
        </View>
      )}
    </View>
  );

  const renderShopTab = () => (
    <View style={styles.tabContent}>
      {renderProductStrip("Available products", availableFeaturedProducts)}

      <TouchableOpacity style={styles.customBanner} activeOpacity={0.9} onPress={openCustomRequest}>
        <View style={styles.customBannerIcon}>
          <Ionicons name="color-wand-outline" size={25} color="#ffffff" />
        </View>
        <View style={styles.customBannerCopy}>
          <Text style={styles.customBannerTitle}>Custom casket request</Text>
          <Text style={styles.customBannerText}>Share the material, finish, and memorial details you prefer.</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#ffffff" />
      </TouchableOpacity>

    </View>
  );

  const renderProductsTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.productsHeadingRow}>
        <View>
          <Text style={styles.pageSectionTitle}>All Products</Text>
          <Text style={styles.pageSectionSubtitle}>
            {availableProductCount} available · {filteredProducts.length} total
          </Text>
        </View>
        {categoryFilter !== "all" ? (
          <TouchableOpacity style={styles.clearFilterButton} onPress={() => setCategoryFilter("all")}>
            <Ionicons name="close" size={14} color="#22312d" />
            <Text style={styles.clearFilterText}>Clear filter</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productSortRow}>
        {PRODUCT_FILTERS.map((item) => {
          const selected = categoryFilter === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.productFilterButton, selected && styles.productFilterButtonActive]}
              onPress={() => setCategoryFilter(item.key)}
            >
              <Text style={[styles.productFilterButtonText, selected && styles.productFilterButtonTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productSortRow}>
        <Text style={styles.productSortLabel}>Sort by</Text>
        {(["Name", "Newest", "Price: Low", "Price: High"] as ProductSort[]).map((sort) => (
          <TouchableOpacity key={sort} style={[styles.productSortButton, productSort === sort && styles.productSortButtonActive]} onPress={() => setProductSort(sort)}>
            <Text style={[styles.productSortButtonText, productSort === sort && styles.productSortButtonTextActive]}>{sort}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {sortedProducts.length > 0 ? (
        <View style={styles.productGrid}>
          {sortedProducts.map((item) => (
            <ProductCard
              key={item.id}
              item={item}
              width={gridCardWidth}
              rating={ratingStats.get(item.id)?.average || 0}
              reviewCount={ratingStats.get(item.id)?.count || 0}
              onPress={() => openProduct(item)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.largeEmptyCard}>
          <Ionicons name="cube-outline" size={34} color="#85918b" />
          <Text style={styles.emptyTitle}>No products found</Text>
          <Text style={styles.emptyText}>Try another search or category.</Text>
          <TouchableOpacity style={styles.emptyActionButton} onPress={resetProductFilters}>
            <Text style={styles.emptyActionButtonText}>Reset filters</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const categories: {
    key: CategoryFilter;
    title: string;
    subtitle: string;
    count: number;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    { key: "all", title: "All Caskets", subtitle: "Browse the full collection", count: products.length, icon: "grid-outline" },
    { key: "variations", title: "With Variations", subtitle: "Multiple styles or finishes", count: products.filter((item) => item.hasVariations).length, icon: "layers-outline" },
    { key: "standard", title: "Standard Caskets", subtitle: "Ready-to-order designs", count: products.filter((item) => !item.hasVariations).length, icon: "cube-outline" },
    { key: "available", title: "Available Now", subtitle: "Currently in stock", count: products.filter((item) => item.stock > 0).length, icon: "checkmark-circle-outline" },
  ];

  const renderCategoriesTab = () => (
    <View style={styles.tabContent}>
      <Text style={styles.pageSectionTitle}>Shop Categories</Text>
      <View style={styles.categoryGrid}>
        {categories.map((category) => (
          <TouchableOpacity key={category.key} style={styles.categoryCard} activeOpacity={0.88} onPress={() => selectCategory(category.key)}>
            <View style={styles.categoryIcon}>
              <Ionicons name={category.icon} size={24} color="#22312d" />
            </View>
            <Text style={styles.categoryTitle}>{category.title}</Text>
            <Text style={styles.categorySubtitle}>{category.subtitle}</Text>
            <Text style={styles.categoryCount}>{category.count} {category.count === 1 ? "product" : "products"}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderReviewsTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.ratingSummary}>
        <Text style={styles.ratingValue}>{overallRating > 0 ? overallRating.toFixed(1) : "New"}</Text>
        <View style={styles.ratingSummaryCopy}>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Ionicons
                key={star}
                name={overallRating >= star ? "star" : "star-outline"}
                size={18}
                color="#f3ad24"
              />
            ))}
          </View>
          <Text style={styles.ratingCaption}>{ratings.length} {ratings.length === 1 ? "rating" : "ratings"} across this shop</Text>
        </View>
      </View>

      {reviews.length > 0 ? reviews.map((review) => {
        const product = products.find((item) => item.id === review.productId);
        const reviewScore = Number(review.ratingSnapshot) || 0;
        return (
          <View key={review.id} style={styles.reviewCard}>
            <View style={styles.reviewTopRow}>
              <View style={styles.reviewerAvatar}>
                <Ionicons name="person" size={18} color="#53615d" />
              </View>
              <View style={styles.reviewIdentity}>
                <Text style={styles.reviewerName}>{review.displayName || "Verified customer"}</Text>
                <Text style={styles.reviewDate}>{formatReviewDate(review.createdAt)}</Text>
              </View>
              {reviewScore > 0 ? (
                <View style={styles.reviewRatingPill}>
                  <Ionicons name="star" size={12} color="#f3ad24" />
                  <Text style={styles.reviewRatingText}>{reviewScore}</Text>
                </View>
              ) : null}
            </View>
            {product ? <Text style={styles.reviewProduct}>For {product.name}</Text> : null}
            <Text style={styles.reviewBody}>{review.feedback || "Customer rating"}</Text>
          </View>
        );
      }) : (
        <View style={styles.largeEmptyCard}>
          <Ionicons name="chatbubble-ellipses-outline" size={34} color="#85918b" />
          <Text style={styles.emptyTitle}>No written reviews yet</Text>
          <Text style={styles.emptyText}>Product reviews from customers will appear here.</Text>
        </View>
      )}
    </View>
  );

  if (loading && !shop) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <LoadingBird fullScreen />
      </SafeAreaView>
    );
  }

  if (loadError && !shop) {
    return (
      <SafeAreaView style={styles.errorScreen}>
        <AppBackButton onPress={handleBack} />
        <View style={styles.errorContent}>
          <Ionicons name="storefront-outline" size={34} color={colors.textMuted} />
          <Text style={styles.errorTitle}>Catalog unavailable</Text>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); void loadShop(); }}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const heroSource = heroImageUrl ? { uri: heroImageUrl } : require("../../../assets/Icon/IconTraparent.png");

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primaryDark} onRefresh={() => { setRefreshing(true); void loadShop(); }} />}
      >
        <ImageBackground source={heroSource} style={styles.hero} imageStyle={styles.heroImage}>
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <View style={styles.topControls}>
              <AppBackButton onPress={handleBack} />
              <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color="#dfe7e2" />
                <TextInput
                  value={searchText}
                  onChangeText={handleSearchChange}
                  placeholder="Search in shop"
                  placeholderTextColor="#d6ded9"
                  style={styles.searchInput}
                  returnKeyType="search"
                  accessibilityLabel={`Search products from ${shopName}`}
                  onSubmitEditing={() => setActiveTab("products")}
                />
                {searchText ? (
                  <TouchableOpacity accessibilityLabel="Clear product search" onPress={() => setSearchText("")}>
                    <Ionicons name="close-circle" size={18} color="#dfe7e2" />
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="More shop actions" style={styles.roundControl} onPress={showShopMenu}>
                <Ionicons name="ellipsis-vertical" size={21} color="#ffffff" />
              </TouchableOpacity>
            </View>

            <View style={styles.shopIdentityRow}>
              <View style={styles.shopAvatarWrap}>
                {shop?.shopImageUrl ? (
                  <Image source={{ uri: shop.shopImageUrl }} style={styles.shopAvatar} />
                ) : (
                  <View style={styles.shopAvatarFallback}>
                    <Ionicons name="storefront" size={28} color="#22312d" />
                  </View>
                )}
              </View>
              <View style={styles.shopIdentityCopy}>
                <View style={styles.shopNameRow}>
                  <Text style={styles.shopName} numberOfLines={1}>{shopName}</Text>
                  <Ionicons name="chevron-forward" size={17} color="#ffffff" />
                </View>
                <View style={styles.shopStatsRow}>
                  <Ionicons name="star" size={14} color="#ffd166" />
                  <Text style={styles.shopStatsText}>{overallRating > 0 ? overallRating.toFixed(1) : "Unrated"}</Text>
                  <View style={styles.shopStatsDot} />
                  <Text style={styles.shopStatsText}>{formatFollowerCount(followerCount)} Followers</Text>
                </View>
                <Text style={styles.shopLocation} numberOfLines={1}>{shopAddress}</Text>
              </View>
              <View style={styles.shopActionColumn}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ disabled: followBusy || viewerId === shopId, selected: following }}
                  style={[styles.shopActionButton, following && styles.shopActionButtonActive]}
                  disabled={followBusy || viewerId === shopId}
                  onPress={() => void toggleFollow()}
                >
                  {followBusy ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Ionicons name={following ? "checkmark" : "add"} size={14} color="#ffffff" />
                  )}
                  <Text style={styles.shopActionText}>{viewerId === shopId ? "Your Shop" : following ? "Following" : "Follow"}</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Chat with ${shopName}`} style={styles.shopActionButton} onPress={openChat}>
                  <Ionicons name="chatbubble-ellipses-outline" size={14} color="#ffffff" />
                  <Text style={styles.shopActionText}>Chat</Text>
                </TouchableOpacity>
              </View>
            </View>

          </View>
        </ImageBackground>

        {viewerId === shopId && shop?.status !== "live" ? (
          <View style={styles.previewBanner}>
            <Ionicons name="eye-outline" size={18} color={colors.text} />
            <Text style={styles.previewBannerText}>Storefront preview — customers cannot see this catalog while your shop is offline.</Text>
          </View>
        ) : null}

        {loadError && shop ? (
          <TouchableOpacity style={styles.refreshWarning} onPress={() => void loadShop()}>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.danger} />
            <Text style={styles.refreshWarningText}>Could not refresh. Showing the last loaded catalog.</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.tabBar}>
          {STOREFRONT_TABS.map((tab) => {
            const selected = activeTab === tab.key;
            const isMiddleTab = tab.key === "products" || tab.key === "categories";
            return (
              <TouchableOpacity
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={[styles.tabButton, isMiddleTab ? styles.tabButtonMiddle : styles.tabButtonEdge, selected && styles.tabButtonActive]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Text numberOfLines={1} style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text>
                {selected ? <View style={styles.tabIndicator} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.pageBody}>
          {activeTab === "shop" ? renderShopTab() : null}
          {activeTab === "products" ? renderProductsTab() : null}
          {activeTab === "categories" ? renderCategoriesTab() : null}
          {activeTab === "reviews" ? renderReviewsTab() : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceMuted },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f1f3ef" },
  loadingText: { color: "#62706b", fontSize: 14, fontWeight: "700" },
  errorScreen: { flex: 1, backgroundColor: colors.surfaceMuted, padding: spacing.lg },
  errorContent: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  errorTitle: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: spacing.md },
  errorText: { color: colors.textMuted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: spacing.sm },
  retryButton: { minHeight: 44, borderRadius: radii.md, backgroundColor: colors.primaryDark, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  retryButtonText: { color: colors.surface, fontSize: 13, fontWeight: "900" },
  hero: { minHeight: 150, backgroundColor: "#d6e2d2", justifyContent: "flex-end" },
  heroImage: { resizeMode: "cover" },
  heroOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(25, 25, 32, 0.45)" },
  heroContent: { flex: 1, justifyContent: "space-between", paddingHorizontal: 10, paddingTop: 5, paddingBottom: 12 },
  topControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  roundControl: { width: 28, height: 36, alignItems: "center", justifyContent: "center" },
  searchBox: { flex: 1, minHeight: 36, borderRadius: 6, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(33, 39, 54, 0.5)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 13, paddingVertical: 6 },
  shopIdentityRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  shopAvatarWrap: { width: 56, height: 56, borderRadius: 28, padding: 3, backgroundColor: "#ffffff", position: "relative" },
  shopAvatar: { width: "100%", height: "100%", borderRadius: 25 },
  shopAvatarFallback: { flex: 1, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: "#e8efe9" },
  shopIdentityCopy: { flex: 1 },
  shopNameRow: { flexDirection: "row", alignItems: "center" },
  shopName: { color: "#ffffff", fontSize: 14, fontWeight: "900", maxWidth: "86%" },
  shopStatsRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  shopStatsText: { color: "#f3f6f4", fontSize: 10, fontWeight: "700" },
  shopStatsDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#dce4df", marginHorizontal: 2 },
  shopLocation: { color: "#dbe4df", fontSize: 9, marginTop: 3 },
  shopActionColumn: { width: 82, gap: 4 },
  shopActionButton: { width: 82, height: 26, borderRadius: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 5 },
  shopActionButtonActive: { backgroundColor: "rgba(255,255,255,0.16)" },
  shopActionText: { color: "#ffffff", fontSize: 10, fontWeight: "800" },
  previewBanner: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#e6e3da", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  previewBannerText: { flex: 1, color: colors.text, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  refreshWarning: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#fff1f1", paddingHorizontal: spacing.lg },
  refreshWarningText: { flex: 1, color: colors.danger, fontSize: 11, fontWeight: "700" },
  tabBar: {
    height: 52,
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    paddingHorizontal: 4,
    marginTop: 8,
    marginHorizontal: 8,
    width: "auto",
    borderRadius: 16,
    backgroundColor: "#d6e2d2",
    zIndex: 10,
  },
  tabButton: {
    flexBasis: 0,
    flexShrink: 1,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 2,
    paddingHorizontal: 4,
    position: "relative",
  },
  tabButtonEdge: { flexGrow: 0.78 },
  tabButtonMiddle: { flexGrow: 1.22 },
  tabButtonActive: { backgroundColor: "#22312d" },
  tabLabel: { color: "#62706b", fontSize: 12, fontWeight: "700", flexShrink: 1 },
  tabLabelActive: { color: "#ffffff", fontWeight: "900" },
  tabIndicator: { display: "none" },
  pageBody: { paddingBottom: 40, backgroundColor: colors.surfaceMuted },
  tabContent: { padding: spacing.sm, gap: spacing.sm },
  sectionCard: { borderRadius: radii.md, backgroundColor: colors.surface, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.borderWarm, overflow: "hidden" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, marginBottom: 10 },
  sectionTitle: { color: "#22312d", fontSize: 14, fontWeight: "900" },
  seeMoreText: { color: "#8a928d", fontSize: 11, fontWeight: "700" },
  productStrip: { paddingHorizontal: 8, gap: 7 },
  productCard: { borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderWarm, padding: spacing.sm, position: "relative" },
  productImage: { width: "100%", height: 125, borderRadius: 9, backgroundColor: "#ebf1e8" },
  productImageFallback: { height: 125, borderRadius: 2, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f2ef" },
  variationBadge: { position: "absolute", top: 14, left: 14, borderRadius: 4, backgroundColor: "rgba(34,49,45,0.88)", paddingHorizontal: 6, paddingVertical: 3 },
  variationBadgeText: { color: "#ffffff", fontSize: 9, fontWeight: "800" },
  soldOutBadge: { position: "absolute", top: 14, right: 14, borderRadius: 4, backgroundColor: "rgba(120,35,35,0.92)", paddingHorizontal: 6, paddingVertical: 3 },
  soldOutBadgeText: { color: "#ffffff", fontSize: 9, fontWeight: "900", letterSpacing: 0.4 },
  productMetaSoldOut: { color: "#9b2c2c", fontWeight: "900" },
  productName: { minHeight: 36, marginTop: 8, color: "#33413c", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  productPrice: { color: "#22312d", fontSize: 17, fontWeight: "900", marginTop: 3 },
  productMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs, marginTop: 5 },
  productRatingGroup: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  productMetaText: { color: "#66736e", fontSize: 10, fontWeight: "700" },
  productStockText: { flexShrink: 1, color: "#66736e", fontSize: 10, fontWeight: "700", textAlign: "right" },
  inlineEmpty: { alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 24 },
  inlineEmptyText: { color: "#78827d", fontSize: 12 },
  customBanner: { minHeight: 96, borderRadius: 13, backgroundColor: "#22312d", overflow: "hidden", padding: 13, flexDirection: "row", alignItems: "center", gap: 11 },
  customBannerIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#5a6b64" },
  customBannerCopy: { flex: 1 },
  customBannerTitle: { color: "#ffffff", fontSize: 15, lineHeight: 18, fontWeight: "900" },
  customBannerText: { color: "#ced8d2", fontSize: 10, lineHeight: 14, marginTop: 4 },
  customBannerLinkRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
  customBannerLink: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  productsHeadingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, backgroundColor: "#ffffff", paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: "#e7e9e6" },
  pageSectionTitle: { color: "#26332e", fontSize: 19, fontWeight: "900" },
  pageSectionSubtitle: { color: "#76817c", fontSize: 12, marginTop: 3 },
  productSortRow: { alignItems: "center", gap: 7, paddingVertical: 2, paddingHorizontal: 1 },
  productFilterButton: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderWarm, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  productFilterButtonActive: { borderColor: colors.primaryDark, backgroundColor: "#e6e3da" },
  productFilterButtonText: { color: "#62706b", fontSize: 11, fontWeight: "700" },
  productFilterButtonTextActive: { color: colors.primaryDark, fontWeight: "900" },
  productSortLabel: { color: "#62706b", fontSize: 11, fontWeight: "800", marginRight: 2 },
  productSortButton: { borderRadius: 999, borderWidth: 1, borderColor: "#d9d6cd", backgroundColor: "#ffffff", paddingHorizontal: 12, paddingVertical: 8 },
  productSortButtonActive: { borderColor: "#22312d", backgroundColor: "#22312d" },
  productSortButtonText: { color: "#62706b", fontSize: 11, fontWeight: "700" },
  productSortButtonTextActive: { color: "#ffffff", fontWeight: "900" },
  clearFilterButton: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, backgroundColor: "#e8ede9", paddingHorizontal: 10, paddingVertical: 7 },
  clearFilterText: { color: "#22312d", fontSize: 11, fontWeight: "800" },
  productGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.sm, rowGap: spacing.md, justifyContent: "space-between" },
  largeEmptyCard: { minHeight: 180, borderRadius: 16, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", padding: 20, borderWidth: 1, borderColor: "#e5e9e5" },
  emptyTitle: { color: "#26332e", fontSize: 17, fontWeight: "900", marginTop: 10 },
  emptyText: { color: "#76817c", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 5 },
  emptyActionButton: { minHeight: 40, borderRadius: radii.md, backgroundColor: colors.primaryDark, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, marginTop: spacing.md },
  emptyActionButtonText: { color: colors.surface, fontSize: 11, fontWeight: "900" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 5 },
  categoryCard: { width: "48.5%", minHeight: 154, borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  categoryIcon: { width: 43, height: 43, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#e9efe9" },
  categoryTitle: { color: "#26332e", fontSize: 15, fontWeight: "900", marginTop: 13 },
  categorySubtitle: { color: "#77817d", fontSize: 11, lineHeight: 16, marginTop: 5 },
  categoryCount: { color: "#796555", fontSize: 11, fontWeight: "900", marginTop: 9 },
  ratingSummary: { borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.lg, borderWidth: 1, borderColor: colors.border },
  ratingValue: { color: "#22312d", fontSize: 36, fontWeight: "900" },
  ratingSummaryCopy: { flex: 1 },
  starsRow: { flexDirection: "row", gap: 2 },
  ratingCaption: { color: "#6f7a75", fontSize: 12, marginTop: 7 },
  reviewCard: { borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  reviewTopRow: { flexDirection: "row", alignItems: "center" },
  reviewerAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#e9eeea" },
  reviewIdentity: { flex: 1, marginLeft: 10 },
  reviewerName: { color: "#2d3934", fontSize: 13, fontWeight: "900" },
  reviewDate: { color: "#87908c", fontSize: 10, marginTop: 2 },
  reviewRatingPill: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 999, backgroundColor: "#fff8e4", paddingHorizontal: 8, paddingVertical: 5 },
  reviewRatingText: { color: "#7e6416", fontSize: 11, fontWeight: "900" },
  reviewProduct: { color: "#796555", fontSize: 10, fontWeight: "800", marginTop: 11 },
  reviewBody: { color: "#4f5c56", fontSize: 13, lineHeight: 20, marginTop: 5 },
});
