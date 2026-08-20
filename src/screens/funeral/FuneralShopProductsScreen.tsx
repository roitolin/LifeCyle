import { useCallback, useMemo, useState } from "react";
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
};

type RatingRow = {
  productId?: string | null;
  rating?: number | null;
};

type ReviewRow = {
  id: string;
  productId?: string | null;
  displayName?: string | null;
  userEmail?: string | null;
  feedback?: string | null;
  ratingSnapshot?: number | null;
  createdAt?: string | null;
};

type StorefrontTab = "shop" | "products" | "categories" | "reviews";
type CategoryFilter = "all" | "variations" | "standard" | "available";
type ProductSort = "Relevance" | "Latest" | "Top Sales" | "Price";

const STOREFRONT_TABS: { key: StorefrontTab; label: string }[] = [
  { key: "shop", label: "Shop" },
  { key: "products", label: "Products" },
  { key: "categories", label: "Categories" },
  { key: "reviews", label: "Reviews" },
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

function ProductCard({
  item,
  width,
  rating,
  onPress,
}: {
  item: ShopProduct;
  width: number;
  rating: number;
  onPress: () => void;
}) {
  const imageUrl = getPrimaryProductImage(item);

  return (
    <TouchableOpacity style={[styles.productCard, { width }]} activeOpacity={0.9} onPress={onPress}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.productImage} resizeMode="contain" />
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
          <Text style={styles.soldOutBadgeText}>SOLD OUT</Text>
        </View>
      ) : null}

      <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
      <Text style={styles.productPrice}>{formatPhilippinePeso(item.price)}</Text>
      <View style={styles.productMetaRow}>
        <Ionicons name="star" size={12} color="#f3ad24" />
        <Text style={styles.productMetaText}>{rating > 0 ? rating.toFixed(1) : "New"}</Text>
        <View style={styles.productMetaDot} />
        <Text style={[styles.productMetaText, item.stock <= 0 ? styles.productMetaSoldOut : null]}>
          {item.stock > 0 ? `${item.stock} left` : "Sold out"}
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
  const [productSort, setProductSort] = useState<ProductSort>("Relevance");
  const [searchText, setSearchText] = useState("");

  const loadShop = useCallback(async () => {
    if (!shopId) {
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
        .select("*")
        .eq("id", shopId)
        .maybeSingle();

      if (shopError) throw shopError;
      if (!shopData) throw new Error("This shop is not available right now.");
      setShop({ ...shopData, id: shopId } as ShopInfo);

      const [productResult, followResult, ratingResult, reviewResult] = await Promise.all([
        supabase
          .from("funeral_products")
          .select(`
            *,
            funeral_product_variations ( name, imageUrl ),
            funeral_product_images ( imageUrl, displayOrder )
          `)
          .eq("shopId", shopId)
          .eq("active", true)
          .order("createdAt", { ascending: false }),
        supabase.from("shop_follows").select("id, userId").eq("shopId", shopId),
        supabase.from("funeral_product_ratings").select("productId, rating").eq("shopId", shopId),
        supabase
          .from("funeral_product_feedback")
          .select("id, productId, displayName, userEmail, feedback, ratingSnapshot, createdAt")
          .eq("shopId", shopId)
          .order("createdAt", { ascending: false }),
      ]);

      if (productResult.error) throw productResult.error;

      const nextProducts = (productResult.data || [])
        .map((row: any) => {
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
        })
        .filter((item: ShopProduct) => Boolean(getPrimaryProductImage(item)));

      setProducts(nextProducts);

      if (!followResult.error) {
        const followRows = followResult.data || [];
        setFollowerCount(followRows.length);
        setFollowing(Boolean(currentViewerId && followRows.some((row: any) => row.userId === currentViewerId)));
      }
      if (!ratingResult.error) setRatings((ratingResult.data || []) as RatingRow[]);
      if (!reviewResult.error) setReviews((reviewResult.data || []) as ReviewRow[]);
    } catch (error: any) {
      Alert.alert("Shop unavailable", error?.message || "Failed to load this shop.");
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
    if (!ratings.length) return 0;
    const total = ratings.reduce((sum, row) => sum + (Number(row.rating) || 0), 0);
    return total / ratings.length;
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
      if (productSort === "Price") return Number(a.price) - Number(b.price);
      if (productSort === "Latest") return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      if (productSort === "Top Sales") return b.stock - a.stock;
      const ratingDifference = (ratingStats.get(b.id)?.average || 0) - (ratingStats.get(a.id)?.average || 0);
      return ratingDifference || b.stock - a.stock;
    });
  }, [filteredProducts, productSort, ratingStats]);

  const topProducts = useMemo(
    () => [...filteredProducts].sort((a, b) => {
      const ratingDifference = (ratingStats.get(b.id)?.average || 0) - (ratingStats.get(a.id)?.average || 0);
      return ratingDifference || b.stock - a.stock;
    }),
    [filteredProducts, ratingStats]
  );

  const shopName = String(shop?.shopName || fallbackShopName);
  const shopAddress = String(shop?.generalLocation || shop?.shopAddress || "Verified funeral service provider");
  const shopPhoneNumber = String(shop?.shopPhoneNumber || "");
  const heroImageUrl = shop?.coverImageUrl || shop?.shopImageUrl || getPrimaryProductImage(products[0]);
  const gridCardWidth = Math.max(146, Math.min(210, (viewportWidth - 44) / 2));

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
      actions.push({ text: "Call shop", onPress: () => void Linking.openURL(`tel:${shopPhoneNumber}`) });
    }
    actions.push({ text: "Cancel", style: "cancel" });
    Alert.alert(shopName, "Choose an action", actions);
  };

  const selectCategory = (filter: CategoryFilter) => {
    setCategoryFilter(filter);
    setActiveTab("products");
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
              onPress={() => openProduct(item)}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.inlineEmpty}>
          <Ionicons name="search-outline" size={22} color="#8a928d" />
          <Text style={styles.inlineEmptyText}>No matching products in this section.</Text>
        </View>
      )}
    </View>
  );

  const renderShopTab = () => (
    <View style={styles.tabContent}>
      {renderProductStrip("Recommended For You", filteredProducts.slice(0, 8))}

      <TouchableOpacity style={styles.customBanner} activeOpacity={0.9} onPress={openCustomRequest}>
        <View style={styles.customBannerIcon}>
          <Ionicons name="color-wand-outline" size={25} color="#ffffff" />
        </View>
        <View style={styles.customBannerCopy}>
          <Text style={styles.customBannerEyebrow}>PERSONALISED SERVICE</Text>
          <Text style={styles.customBannerTitle}>Request a custom casket design</Text>
          <Text style={styles.customBannerText}>Share the material, finish, and memorial details you prefer.</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#ffffff" />
      </TouchableOpacity>

      {renderProductStrip("Top Products", topProducts.slice(0, 8))}
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
        <Text style={styles.productSortLabel}>Sort by</Text>
        {(["Relevance", "Latest", "Top Sales", "Price"] as ProductSort[]).map((sort) => (
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
              onPress={() => openProduct(item)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.largeEmptyCard}>
          <Ionicons name="cube-outline" size={34} color="#85918b" />
          <Text style={styles.emptyTitle}>No products found</Text>
          <Text style={styles.emptyText}>Try another search or category.</Text>
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
      <Text style={styles.pageSectionSubtitle}>Choose a collection to start browsing.</Text>
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
        return (
          <View key={review.id} style={styles.reviewCard}>
            <View style={styles.reviewTopRow}>
              <View style={styles.reviewerAvatar}>
                <Ionicons name="person" size={18} color="#53615d" />
              </View>
              <View style={styles.reviewIdentity}>
                <Text style={styles.reviewerName}>{review.displayName || review.userEmail || "Customer"}</Text>
                <Text style={styles.reviewDate}>{formatReviewDate(review.createdAt)}</Text>
              </View>
              <View style={styles.reviewRatingPill}>
                <Ionicons name="star" size={12} color="#f3ad24" />
                <Text style={styles.reviewRatingText}>{Number(review.ratingSnapshot) || 5}</Text>
              </View>
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

  const heroSource = heroImageUrl ? { uri: heroImageUrl } : require("../../../assets/Icon/AppICONTransparents.png");

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadShop(); }} />}
      >
        <ImageBackground source={heroSource} style={styles.hero} imageStyle={styles.heroImage}>
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <View style={styles.topControls}>
              <AppBackButton onPress={() => navigation.goBack()} />
              <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color="#dfe7e2" />
                <TextInput
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholder="Search in shop"
                  placeholderTextColor="#d6ded9"
                  style={styles.searchInput}
                  returnKeyType="search"
                />
                {searchText ? (
                  <TouchableOpacity onPress={() => setSearchText("")}>
                    <Ionicons name="close-circle" size={18} color="#dfe7e2" />
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity style={styles.roundControl} onPress={showShopMenu}>
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
                <View style={styles.preferredBadge}>
                  <Text style={styles.preferredBadgeText}>Preferred</Text>
                </View>
              </View>
              <View style={styles.shopIdentityCopy}>
                <View style={styles.shopNameRow}>
                  <Text style={styles.shopName} numberOfLines={1}>{shopName}</Text>
                  <Ionicons name="chevron-forward" size={17} color="#ffffff" />
                </View>
                <View style={styles.shopStatsRow}>
                  <Ionicons name="star" size={14} color="#ffd166" />
                  <Text style={styles.shopStatsText}>{overallRating > 0 ? overallRating.toFixed(1) : "New"}</Text>
                  <View style={styles.shopStatsDot} />
                  <Text style={styles.shopStatsText}>{formatFollowerCount(followerCount)} Followers</Text>
                </View>
                <Text style={styles.shopLocation} numberOfLines={1}>{shopAddress}</Text>
              </View>
              <View style={styles.shopActionColumn}>
                <TouchableOpacity
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
                <TouchableOpacity style={styles.shopActionButton} onPress={openChat}>
                  <Ionicons name="chatbubble-ellipses-outline" size={14} color="#ffffff" />
                  <Text style={styles.shopActionText}>Chat</Text>
                </TouchableOpacity>
              </View>
            </View>

          </View>
        </ImageBackground>

        <View style={styles.tabBar}>
          {STOREFRONT_TABS.map((tab) => {
            const selected = activeTab === tab.key;
            const isMiddleTab = tab.key === "products" || tab.key === "categories";
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tabButton, isMiddleTab ? styles.tabButtonMiddle : styles.tabButtonEdge, selected && styles.tabButtonActive]}
                onPress={() => setActiveTab(tab.key)}
              >
                {tab.key === "products" ? (
                  <View style={styles.newBadge}>
                    <Text style={styles.newBadgeText}>New</Text>
                  </View>
                ) : null}
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
  screen: { flex: 1, backgroundColor: "#eef1ec" },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f1f3ef" },
  loadingText: { color: "#62706b", fontSize: 14, fontWeight: "700" },
  hero: { minHeight: 150, backgroundColor: "#d6e2d2", justifyContent: "flex-end" },
  heroImage: { resizeMode: "cover" },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(25, 25, 32, 0.45)" },
  heroContent: { flex: 1, justifyContent: "space-between", paddingHorizontal: 10, paddingTop: 5, paddingBottom: 12 },
  topControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  roundControl: { width: 28, height: 36, alignItems: "center", justifyContent: "center" },
  searchBox: { flex: 1, minHeight: 36, borderRadius: 6, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(33, 39, 54, 0.5)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 13, paddingVertical: 6 },
  shopIdentityRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  shopAvatarWrap: { width: 56, height: 56, borderRadius: 28, padding: 3, backgroundColor: "#ffffff", position: "relative" },
  shopAvatar: { width: "100%", height: "100%", borderRadius: 25 },
  shopAvatarFallback: { flex: 1, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: "#e8efe9" },
  preferredBadge: { position: "absolute", left: -3, bottom: -5, borderRadius: 3, backgroundColor: "#796555", paddingHorizontal: 4, paddingVertical: 2 },
  preferredBadgeText: { color: "#ffffff", fontSize: 8, lineHeight: 9, fontWeight: "900" },
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
    shadowColor: "#312d2b",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
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
  newBadge: { position: "absolute", top: 1, right: 5, borderRadius: 3, backgroundColor: "#796555", paddingHorizontal: 3, paddingVertical: 1 },
  newBadgeText: { color: "#ffffff", fontSize: 7, lineHeight: 8, fontWeight: "900" },
  pageBody: { paddingBottom: 40, backgroundColor: "#eef1ec" },
  tabContent: { padding: 6, gap: 8 },
  sectionCard: { borderRadius: 13, backgroundColor: "#ffffff", paddingVertical: 11, borderWidth: 1, borderColor: "#d9d6cd", overflow: "hidden", shadowColor: "#7e9080", shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, marginBottom: 10 },
  sectionTitle: { color: "#22312d", fontSize: 14, fontWeight: "900" },
  seeMoreText: { color: "#8a928d", fontSize: 11, fontWeight: "700" },
  productStrip: { paddingHorizontal: 8, gap: 7 },
  productCard: { borderRadius: 12, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#d9d6cd", padding: 7, position: "relative", shadowColor: "#7e9080", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  productImage: { width: "100%", height: 125, borderRadius: 9, backgroundColor: "#ebf1e8" },
  productImageFallback: { height: 125, borderRadius: 2, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f2ef" },
  variationBadge: { position: "absolute", top: 14, left: 14, borderRadius: 4, backgroundColor: "rgba(34,49,45,0.88)", paddingHorizontal: 6, paddingVertical: 3 },
  variationBadgeText: { color: "#ffffff", fontSize: 9, fontWeight: "800" },
  soldOutBadge: { position: "absolute", top: 14, right: 14, borderRadius: 4, backgroundColor: "rgba(120,35,35,0.92)", paddingHorizontal: 6, paddingVertical: 3 },
  soldOutBadgeText: { color: "#ffffff", fontSize: 9, fontWeight: "900", letterSpacing: 0.4 },
  productMetaSoldOut: { color: "#9b2c2c", fontWeight: "900" },
  productName: { minHeight: 36, marginTop: 8, color: "#33413c", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  productPrice: { color: "#22312d", fontSize: 17, fontWeight: "900", marginTop: 3 },
  productMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  productMetaText: { color: "#66736e", fontSize: 10, fontWeight: "700" },
  productMetaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#aab1ad" },
  inlineEmpty: { alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 24 },
  inlineEmptyText: { color: "#78827d", fontSize: 12 },
  customBanner: { minHeight: 96, borderRadius: 13, backgroundColor: "#22312d", overflow: "hidden", padding: 13, flexDirection: "row", alignItems: "center", gap: 11 },
  customBannerIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#5a6b64" },
  customBannerCopy: { flex: 1 },
  customBannerEyebrow: { color: "#b9c9c0", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  customBannerTitle: { color: "#ffffff", fontSize: 15, lineHeight: 18, fontWeight: "900", marginTop: 4 },
  customBannerText: { color: "#ced8d2", fontSize: 10, lineHeight: 14, marginTop: 4 },
  customBannerLinkRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
  customBannerLink: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  productsHeadingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, backgroundColor: "#ffffff", paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: "#e7e9e6" },
  pageSectionTitle: { color: "#26332e", fontSize: 19, fontWeight: "900" },
  pageSectionSubtitle: { color: "#76817c", fontSize: 12, marginTop: 3 },
  productSortRow: { alignItems: "center", gap: 7, paddingVertical: 2, paddingHorizontal: 1 },
  productSortLabel: { color: "#62706b", fontSize: 11, fontWeight: "800", marginRight: 2 },
  productSortButton: { borderRadius: 999, borderWidth: 1, borderColor: "#d9d6cd", backgroundColor: "#ffffff", paddingHorizontal: 12, paddingVertical: 8 },
  productSortButtonActive: { borderColor: "#22312d", backgroundColor: "#22312d" },
  productSortButtonText: { color: "#62706b", fontSize: 11, fontWeight: "700" },
  productSortButtonTextActive: { color: "#ffffff", fontWeight: "900" },
  clearFilterButton: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, backgroundColor: "#e8ede9", paddingHorizontal: 10, paddingVertical: 7 },
  clearFilterText: { color: "#22312d", fontSize: 11, fontWeight: "800" },
  productGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" },
  largeEmptyCard: { minHeight: 180, borderRadius: 16, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", padding: 20, borderWidth: 1, borderColor: "#e5e9e5" },
  emptyTitle: { color: "#26332e", fontSize: 17, fontWeight: "900", marginTop: 10 },
  emptyText: { color: "#76817c", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 5 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 5 },
  categoryCard: { width: "48.5%", minHeight: 154, borderRadius: 13, backgroundColor: "#ffffff", padding: 13, borderWidth: 1, borderColor: "#e3e8e3", shadowColor: "#2d352f", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  categoryIcon: { width: 43, height: 43, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#e9efe9" },
  categoryTitle: { color: "#26332e", fontSize: 15, fontWeight: "900", marginTop: 13 },
  categorySubtitle: { color: "#77817d", fontSize: 11, lineHeight: 16, marginTop: 5 },
  categoryCount: { color: "#796555", fontSize: 11, fontWeight: "900", marginTop: 9 },
  ratingSummary: { borderRadius: 13, backgroundColor: "#ffffff", padding: 17, flexDirection: "row", alignItems: "center", gap: 17, borderWidth: 1, borderColor: "#e3e8e3", shadowColor: "#2d352f", shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  ratingValue: { color: "#22312d", fontSize: 42, fontWeight: "900" },
  ratingSummaryCopy: { flex: 1 },
  starsRow: { flexDirection: "row", gap: 2 },
  ratingCaption: { color: "#6f7a75", fontSize: 12, marginTop: 7 },
  reviewCard: { borderRadius: 13, backgroundColor: "#ffffff", padding: 15, borderWidth: 1, borderColor: "#e3e8e3", shadowColor: "#2d352f", shadowOpacity: 0.035, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
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
