import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Linking,
  RefreshControl,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
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
  onPress,
}: {
  item: ShopProduct;
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
      style={styles.productCard}
      activeOpacity={0.78}
      onPress={onPress}
    >
      <View style={styles.productImageFrame}>
        {imageUrl && !imageFailed ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.productImage}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={styles.productImageFallback}>
            <Ionicons name="cube-outline" size={30} color="#718079" />
          </View>
        )}
        {item.stock <= 0 ? (
          <View style={styles.soldOutBadge}>
            <Text style={styles.soldOutBadgeText}>Sold out</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.productDetails}>
        <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.productPrice}>{formatPhilippinePeso(item.price)}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function FuneralShopProductsScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
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
    navigation.navigate("ShopChat", {
      otherUserId: shopId,
      otherUserName: shopName || "Funeral Shop",
      shopId,
    });
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
    const actions: any[] = [];
    if (viewerId === shopId) {
      actions.push({ text: "Add new product", onPress: () => navigation.navigate("ProductEditor") });
    }
    actions.push({ text: "Custom casket request", onPress: openCustomRequest });
    if (shopPhoneNumber) {
      actions.push({ text: "Call shop", onPress: () => void callShop() });
    }
    actions.push({ text: "Cancel", style: "cancel" });
    Alert.alert(shopName, "Choose an action", actions);
  };

  const shareShop = async () => {
    try {
      await Share.share({
        title: shopName,
        message: `${shopName} on LifeCycle${shopAddress ? ` · ${shopAddress}` : ""}`,
      });
    } catch {
      // Sharing can be cancelled by the user; no error state is needed.
    }
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

  const renderProductPreview = (title: string, items: ShopProduct[]) => (
    <View style={styles.productSection}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {items.length > 0 ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => { setCategoryFilter("all"); setActiveTab("products"); }}>
            <Text style={styles.seeMoreText}>View all</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {items.length > 0 ? (
        <View style={styles.productGrid}>
          {items.slice(0, 4).map((item) => (
            <ProductCard
              key={`${title}_${item.id}`}
              item={item}
              onPress={() => openProduct(item)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.inlineEmpty}>
          <Text style={styles.inlineEmptyText}>No products available right now.</Text>
        </View>
      )}
    </View>
  );

  const renderShopTab = () => (
    <View style={styles.tabContent}>
      {renderProductPreview("Available products", availableFeaturedProducts)}

      <TouchableOpacity style={styles.customRequest} activeOpacity={0.78} onPress={openCustomRequest}>
        <View style={styles.customRequestIcon}>
          <Ionicons name="create-outline" size={20} color={colors.text} />
        </View>
        <View style={styles.customRequestCopy}>
          <Text style={styles.customRequestTitle}>Request a custom casket</Text>
          <Text style={styles.customRequestText}>Tell this shop what you need.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );

  const renderProductsTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.productsHeadingRow}>
        <View>
          <Text style={styles.pageSectionTitle}>Products</Text>
          <Text style={styles.pageSectionSubtitle}>
            {filteredProducts.length} {filteredProducts.length === 1 ? "item" : "items"}
          </Text>
        </View>
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
    { key: "all", title: "All products", subtitle: "Full catalog", count: products.length, icon: "grid-outline" },
    { key: "variations", title: "With options", subtitle: "More than one style", count: products.filter((item) => item.hasVariations).length, icon: "layers-outline" },
    { key: "standard", title: "Standard", subtitle: "Single style", count: products.filter((item) => !item.hasVariations).length, icon: "cube-outline" },
    { key: "available", title: "Available", subtitle: "In stock", count: products.filter((item) => item.stock > 0).length, icon: "checkmark-circle-outline" },
  ];

  const renderCategoriesTab = () => (
    <View style={styles.tabContent}>
      <Text style={styles.pageSectionTitle}>Categories</Text>
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
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <StatusBar hidden={false} style="light" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primaryDark} onRefresh={() => { setRefreshing(true); void loadShop(); }} />}
      >
        <ImageBackground source={heroSource} style={styles.hero} imageStyle={styles.heroImage}>
          <View style={styles.heroOverlay} />
          <View style={[styles.heroContent, { paddingTop: Math.max(14, insets.top + 4) }]}>
            <View style={styles.topControls}>
              <AppBackButton onPress={handleBack} style={styles.heroBackButton} />
              <View style={styles.topControlsSpacer} />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Search products from ${shopName}`}
                style={styles.roundControl}
                onPress={() => setActiveTab("products")}
              >
                <Ionicons name="search" size={22} color="#ffffff" />
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="More shop actions" style={styles.roundControl} onPress={showShopMenu}>
                <Ionicons name="ellipsis-horizontal-circle-outline" size={25} color="#ffffff" />
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Share ${shopName}`} style={styles.roundControl} onPress={() => void shareShop()}>
                <Ionicons name="arrow-redo-outline" size={24} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>
        </ImageBackground>

        <View style={styles.profilePanel}>
          <View style={styles.profileAvatarWrap}>
            {shop?.shopImageUrl ? (
              <Image source={{ uri: shop.shopImageUrl }} style={styles.profileAvatar} />
            ) : (
              <View style={styles.profileAvatarFallback}>
                <Ionicons name="storefront" size={44} color="#315f50" />
              </View>
            )}
            <View style={[styles.onlineIndicator, shop?.status !== "live" && styles.offlineIndicator]} />
          </View>
          <Text style={styles.profileName} numberOfLines={1}>{shopName}</Text>
          <View style={styles.profileMetaRow}>
            <View style={styles.profileMetaItem}>
              <Ionicons name="star" size={14} color="#d89a1b" />
              <Text style={styles.profileMetaText}>{overallRating > 0 ? overallRating.toFixed(1) : "New"}</Text>
            </View>
            <View style={styles.profileMetaDivider} />
            <Text style={styles.profileMetaText}>{formatFollowerCount(followerCount)} followers</Text>
            <View style={styles.profileMetaDivider} />
            <Text style={styles.profileMetaText} numberOfLines={1}>{shopAddress}</Text>
          </View>
          <View style={styles.profileActionsRow}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: followBusy || viewerId === shopId, selected: following }}
              style={[styles.profileActionButton, styles.profileFollowButton, following && styles.profileFollowButtonActive]}
              disabled={followBusy || viewerId === shopId}
              onPress={() => void toggleFollow()}
            >
              {followBusy ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name={following ? "checkmark" : "add"} size={15} color="#ffffff" />
              )}
              <Text style={styles.profileActionText}>{viewerId === shopId ? "Your Shop" : following ? "Following" : "Follow"}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Chat with ${shopName}`} style={[styles.profileActionButton, styles.profileChatButton]} onPress={openChat}>
              <Ionicons name="chatbubble-ellipses-outline" size={15} color="#315f50" />
              <Text style={styles.profileChatText}>Chat</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.profileSearchBox}>
            <Ionicons name="search" size={18} color="#64736c" />
            <TextInput
              value={searchText}
              onChangeText={handleSearchChange}
              placeholder="Search products in this shop"
              placeholderTextColor="#8b9791"
              style={styles.profileSearchInput}
              returnKeyType="search"
              accessibilityLabel={`Search products from ${shopName}`}
              onSubmitEditing={() => setActiveTab("products")}
            />
            {searchText ? (
              <TouchableOpacity accessibilityLabel="Clear product search" onPress={() => setSearchText("")}>
                <Ionicons name="close-circle" size={18} color="#64736c" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

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
            return (
              <TouchableOpacity
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={styles.tabButton}
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
  screen: { flex: 1, backgroundColor: colors.surface },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f1f3ef" },
  loadingText: { color: "#62706b", fontSize: 14, fontWeight: "700" },
  errorScreen: { flex: 1, backgroundColor: colors.surfaceMuted, padding: spacing.lg },
  errorContent: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  errorTitle: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: spacing.md },
  errorText: { color: colors.textMuted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: spacing.sm },
  retryButton: { minHeight: 44, borderRadius: radii.md, backgroundColor: colors.primaryDark, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  retryButtonText: { color: colors.surface, fontSize: 13, fontWeight: "900" },
  hero: { height: 286, backgroundColor: "#d6e2d2", justifyContent: "flex-end" },
  heroImage: { resizeMode: "cover" },
  heroOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(20, 29, 26, 0.28)" },
  heroContent: { flex: 1, paddingHorizontal: 12, paddingBottom: 18 },
  topControls: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 42 },
  topControlsSpacer: { flex: 1 },
  heroBackButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderColor: "rgba(23, 23, 23, 0.12)",
  },
  roundControl: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(21, 33, 29, 0.62)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.42)",
  },
  searchBox: { flex: 1, minHeight: 40, borderRadius: 12, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(24, 34, 31, 0.62)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 13, paddingVertical: 6 },
  shopIdentityRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  shopAvatarWrap: { width: 54, height: 54, borderRadius: 27, padding: 2, backgroundColor: "#ffffff" },
  shopAvatar: { width: "100%", height: "100%", borderRadius: 25 },
  shopAvatarFallback: { flex: 1, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: "#e8efe9" },
  shopIdentityCopy: { flex: 1 },
  shopName: { color: "#ffffff", fontSize: 17, lineHeight: 22, fontWeight: "800" },
  shopStatsRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  shopStatsText: { color: "#f3f6f4", fontSize: 11, fontWeight: "600" },
  shopStatsDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#dce4df", marginHorizontal: 2 },
  shopLocation: { color: "#dbe4df", fontSize: 10, marginTop: 4 },
  shopActionsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  shopActionButton: { height: 38, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.72)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12 },
  followButton: { flex: 1, backgroundColor: "rgba(255,255,255,0.14)" },
  chatButton: { flex: 1 },
  shopActionButtonActive: { backgroundColor: "rgba(255,255,255,0.24)" },
  shopActionText: { color: "#ffffff", fontSize: 12, fontWeight: "800" },
  profilePanel: {
    position: "relative",
    marginTop: -58,
    paddingTop: 72,
    paddingHorizontal: 18,
    paddingBottom: 18,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  profileAvatarWrap: {
    position: "absolute",
    top: -72,
    width: 144,
    height: 144,
    padding: 5,
    borderRadius: 72,
    backgroundColor: colors.surface,
    shadowColor: "#17241e",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 7,
  },
  profileAvatar: { width: "100%", height: "100%", borderRadius: 67 },
  profileAvatarFallback: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 67, backgroundColor: "#e8efe9" },
  onlineIndicator: {
    position: "absolute",
    right: 3,
    bottom: 9,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 4,
    borderColor: colors.surface,
    backgroundColor: "#20a545",
  },
  offlineIndicator: { backgroundColor: "#8e9a94" },
  profileName: { maxWidth: "100%", color: "#111614", fontSize: 27, lineHeight: 32, fontWeight: "900", textAlign: "center" },
  profileMetaRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 7, marginTop: 9 },
  profileMetaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  profileMetaText: { color: "#68756f", fontSize: 11, fontWeight: "700", maxWidth: 150 },
  profileMetaDivider: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#b0b9b4", marginHorizontal: 1 },
  profileActionsRow: { width: "100%", maxWidth: 320, flexDirection: "row", gap: 9, marginTop: 16 },
  profileActionButton: { height: 40, flex: 1, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1 },
  profileFollowButton: { borderColor: colors.primaryDark, backgroundColor: colors.primaryDark },
  profileFollowButtonActive: { backgroundColor: colors.primary },
  profileChatButton: { borderColor: "#b7c8bf", backgroundColor: colors.surface },
  profileActionText: { color: colors.surface, fontSize: 12, fontWeight: "900" },
  profileChatText: { color: "#315f50", fontSize: 12, fontWeight: "900" },
  profileSearchBox: { width: "100%", minHeight: 46, marginTop: 14, borderRadius: 14, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f2f5f1", borderWidth: 1, borderColor: "#d9e1db" },
  profileSearchInput: { flex: 1, color: colors.text, fontSize: 13, paddingVertical: 7 },
  previewBanner: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#e6e3da", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  previewBannerText: { flex: 1, color: colors.text, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  refreshWarning: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#fff1f1", paddingHorizontal: spacing.lg },
  refreshWarningText: { flex: 1, color: colors.danger, fontSize: 11, fontWeight: "700" },
  tabBar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    zIndex: 10,
  },
  tabButton: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  tabLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  tabLabelActive: { color: colors.text, fontWeight: "900" },
  tabIndicator: { position: "absolute", bottom: 0, width: 28, height: 2, borderRadius: 1, backgroundColor: colors.primaryDark },
  pageBody: { paddingBottom: 40, backgroundColor: colors.surface },
  tabContent: { paddingHorizontal: spacing.lg, paddingTop: 20, paddingBottom: 8, gap: spacing.lg },
  productSection: { backgroundColor: colors.surface },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  seeMoreText: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  productCard: { width: "48%" },
  productImageFrame: { position: "relative", width: "100%", aspectRatio: 0.82, overflow: "hidden", borderRadius: 18, backgroundColor: colors.surfaceMuted },
  productImage: { width: "100%", height: "100%" },
  productImageFallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  soldOutBadge: { position: "absolute", top: 8, right: 8, borderRadius: 7, backgroundColor: "rgba(92,38,38,0.9)", paddingHorizontal: 7, paddingVertical: 4 },
  soldOutBadgeText: { color: "#ffffff", fontSize: 9, fontWeight: "800" },
  productDetails: { paddingTop: 6 },
  productName: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: "800", marginTop: 1 },
  productPrice: { color: colors.text, fontSize: 13, fontWeight: "800", marginTop: 2 },
  inlineEmpty: { alignItems: "flex-start", justifyContent: "center", paddingVertical: 24 },
  inlineEmptyText: { color: "#78827d", fontSize: 12 },
  customRequest: { minHeight: 68, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  customRequestIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  customRequestCopy: { flex: 1 },
  customRequestTitle: { color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: "800" },
  customRequestText: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  productsHeadingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pageSectionTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
  pageSectionSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  productSortRow: { alignItems: "center", gap: 7, paddingVertical: 2, paddingHorizontal: 1 },
  productFilterButton: { borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  productFilterButtonActive: { backgroundColor: colors.primaryDark },
  productFilterButtonText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  productFilterButtonTextActive: { color: colors.surface, fontWeight: "900" },
  productSortLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "800", marginRight: 2 },
  productSortButton: { borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, paddingHorizontal: 12, paddingVertical: 8 },
  productSortButtonActive: { backgroundColor: colors.text },
  productSortButtonText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  productSortButtonTextActive: { color: colors.surface, fontWeight: "900" },
  productGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.xl },
  largeEmptyCard: { minHeight: 180, alignItems: "center", justifyContent: "center", padding: 20 },
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
