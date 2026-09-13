import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, ImageBackground, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import LoadingBird from "@/components/LoadingBird";
import { useUnreadCount, useUnreadMessageCount } from "@/hooks";
import { supabase } from "@/services/supabaseClient";
import { colors, radii, spacing } from "@/theme";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { getHomeHeroContent, type HomeHeroContent } from '@/utils/homeHero';
import { subscribeTabRefresh } from "@/utils/tabRefresh";

const appLogo = require("../../../assets/Icon/IconTraparent.png");

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
};

type HomeProduct = ShopProduct & {
  shopId: string;
  shopName: string;
  rating: number;
  reviewCount: number;
};

type HomeSort = "name" | "price_low" | "price_high";

function getPrimaryProductImage(item: ShopProduct) {
  return item.imageUrl || item.galleryImageUrls?.[0] || item.variations?.find((entry) => entry.imageUrl)?.imageUrl || null;
}

export default function FuneralHomeScreen({ navigation }: any) {
  const tabBarHeight = useBottomTabBarHeight();
  const unreadCount = useUnreadCount();
  const unreadMessageCount = useUnreadMessageCount();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [products, setProducts] = useState<HomeProduct[]>([]);
  const [heroContent, setHeroContent] = useState<HomeHeroContent | null>(null);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [selectedShopId, setSelectedShopId] = useState("all");
  const [sortBy, setSortBy] = useState<HomeSort>("name");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minimumRating, setMinimumRating] = useState(0);
  const [favoriteProductIds, setFavoriteProductIds] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<ScrollView>(null);
  const catalogOffsetRef = useRef(0);
  const filterBackdropOpacity = useRef(new Animated.Value(0)).current;
  const filterSheetProgress = useRef(new Animated.Value(0)).current;

  const loadProducts = useCallback(async () => {
    try {
      setLoadError(false);
      const { data: productRows, error } = await supabase
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
        .gt("funeral_shops.paidUntil", new Date().toISOString());

      if (error) throw error;

      const productIds = (productRows || []).map((row: any) => String(row.id));
      let ratingRows: any[] = [];
      if (productIds.length > 0) {
        const { data: ratingData, error: ratingError } = await supabase
          .from("funeral_product_ratings")
          .select("productId, rating")
          .in("productId", productIds);
        if (ratingError) console.warn("Unable to load home product ratings:", ratingError.message);
        else ratingRows = ratingData || [];
      }

      const ratingSummary = new Map<string, { total: number; count: number }>();
      ratingRows.forEach((row: any) => {
        const productId = String(row.productId || "");
        const ratingValue = Number(row.rating) || 0;
        if (!productId || ratingValue <= 0) return;
        const current = ratingSummary.get(productId) || { total: 0, count: 0 };
        ratingSummary.set(productId, { total: current.total + ratingValue, count: current.count + 1 });
      });

      const nextProducts: HomeProduct[] = (productRows || []).map((row: any) => {
        const productRating = ratingSummary.get(String(row.id));
        const variations = (row.funeral_product_variations || []).map((v: any) => ({
          name: v.name,
          imageUrl: v.imageUrl,
        }));
        const galleryImageUrls = (row.funeral_product_images || [])
          .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
          .map((img: any) => img.imageUrl);

        return {
          id: row.id,
          name: row.name,
          description: row.description || "",
          price: String(row.price),
          stock: row.stock,
          imageUrl: row.imageUrl,
          galleryImageUrls,
          hasVariations: row.hasVariations,
          variations,
          active: row.active,
          shopId: row.shopId,
          shopName: String(row.funeral_shops?.shopName || "Funeral shop"),
          rating: productRating ? productRating.total / productRating.count : 0,
          reviewCount: productRating?.count || 0,
        };
      }).filter((p: HomeProduct) => getPrimaryProductImage(p));

      nextProducts.sort((first, second) => first.name.localeCompare(second.name));
      setProducts(nextProducts);
    } catch (error) {
      console.error("Unable to load home products:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadHeroContent = useCallback(async () => {
    try {
      setHeroContent(await getHomeHeroContent());
    } catch (error) {
      console.warn('Unable to load mobile home feature:', error);
      setHeroContent(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProducts();
      void loadHeroContent();
      const unsubscribe = subscribeTabRefresh("Home", () => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        setRefreshing(true);
        void loadProducts();
        void loadHeroContent();
      });
      const heroChannel = supabase
        .channel(`mobile-home-hero-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'home_hero_content' }, () => void loadHeroContent())
        .subscribe();
      return () => {
        unsubscribe();
        void supabase.removeChannel(heroChannel);
      };
    }, [loadHeroContent, loadProducts])
  );

  const shopOptions = useMemo(() => {
    const shops = new Map<string, string>();
    products.forEach((product) => shops.set(product.shopId, product.shopName));
    return Array.from(shops, ([id, name]) => ({ id, name }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [products]);

  const visibleProducts = useMemo(() => {
    const parsedMinPrice = Number(minPrice);
    const parsedMaxPrice = Number(maxPrice);
    const effectiveMinPrice = minPrice.trim() && Number.isFinite(parsedMinPrice) ? parsedMinPrice : 0;
    const effectiveMaxPrice = maxPrice.trim() && Number.isFinite(parsedMaxPrice) ? parsedMaxPrice : Number.POSITIVE_INFINITY;

    const nextProducts = products.filter((product) => {
      const productPrice = Number(product.price) || 0;
      const matchesShop = selectedShopId === "all" || product.shopId === selectedShopId;
      const matchesPrice = productPrice >= effectiveMinPrice && productPrice <= effectiveMaxPrice;
      const matchesRating = minimumRating === 0 || product.rating >= minimumRating;
      return matchesShop && matchesPrice && matchesRating;
    });
    return [...nextProducts].sort((first, second) => {
      if (sortBy === "price_low") return Number(first.price) - Number(second.price);
      if (sortBy === "price_high") return Number(second.price) - Number(first.price);
      return first.name.localeCompare(second.name);
    });
  }, [maxPrice, minPrice, minimumRating, products, selectedShopId, sortBy]);

  const activeFilterCount = (selectedShopId === "all" ? 0 : 1)
    + (sortBy === "name" ? 0 : 1)
    + (minPrice.trim() || maxPrice.trim() ? 1 : 0)
    + (minimumRating > 0 ? 1 : 0);

  const clearFilters = () => {
    setSelectedShopId("all");
    setSortBy("name");
    setMinPrice("");
    setMaxPrice("");
    setMinimumRating(0);
  };

  const openProductFilters = () => {
    filterBackdropOpacity.stopAnimation();
    filterSheetProgress.stopAnimation();
    filterBackdropOpacity.setValue(0);
    filterSheetProgress.setValue(0);
    setFilterExpanded(true);

    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(filterBackdropOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(filterSheetProgress, {
          toValue: 1,
          damping: 19,
          stiffness: 210,
          mass: 0.85,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const closeProductFilters = () => {
    filterBackdropOpacity.stopAnimation();
    filterSheetProgress.stopAnimation();
    Animated.parallel([
      Animated.timing(filterBackdropOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(filterSheetProgress, {
        toValue: 0,
        duration: 210,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setFilterExpanded(false);
    });
  };

  const toggleProductFavorite = (productId: string) => {
    setFavoriteProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const openProductView = (product: HomeProduct) => {
    navigation.navigate("ProductView", { product });
  };

  const openHeroDestination = () => {
    if (heroContent?.target === 'catalog') {
      scrollRef.current?.scrollTo({ y: Math.max(0, catalogOffsetRef.current - spacing.lg), animated: true });
      return;
    }
    navigation.navigate('Shops');
  };

  const refreshProducts = () => {
    setRefreshing(true);
    void loadProducts();
  };

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(tabBarHeight, spacing.xl) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshProducts}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        )}
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={appLogo} style={styles.brandLogo} resizeMode="contain" />
            <Text style={styles.brand}>LifeCycle</Text>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity
              accessibilityLabel="Open notifications"
              accessibilityRole="button"
              activeOpacity={0.75}
              style={styles.iconButton}
              onPress={() => navigation.navigate("Notifications")}
            >
              <Ionicons name="notifications-outline" size={20} color={colors.text} />
              {unreadCount > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityLabel="Open messages"
              accessibilityRole="button"
              activeOpacity={0.75}
              style={styles.iconButton}
              onPress={() => navigation.navigate("Conversations")}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.text} />
              {unreadMessageCount > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{unreadMessageCount > 9 ? "9+" : unreadMessageCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchRow}>
          <TouchableOpacity
            accessibilityHint='Opens the product search screen'
            accessibilityLabel='Search caskets or funeral shops'
            accessibilityRole='button'
            activeOpacity={0.78}
            style={styles.searchBar}
            onPress={() => navigation.navigate('Search')}
          >
            <Ionicons name='search-outline' size={17} color={colors.textMuted} />
            <Text numberOfLines={1} style={styles.searchPlaceholder}>Search...</Text>
          </TouchableOpacity>
          <View style={styles.searchDivider} />
          <TouchableOpacity
            accessibilityLabel='Show product filters'
            accessibilityRole='button'
            activeOpacity={0.78}
            style={styles.filterButton}
            onPress={openProductFilters}
          >
            <Ionicons name='options-outline' size={21} color={colors.primary} />
            {activeFilterCount > 0 ? (
              <View style={styles.filterCountBadge}>
                <Text style={styles.filterCountText}>{activeFilterCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {heroContent?.imageUrl ? (
          <TouchableOpacity
            accessibilityLabel={`${heroContent.title}. ${heroContent.buttonLabel}`}
            accessibilityRole='button'
            activeOpacity={0.9}
            style={styles.heroCard}
            onPress={openHeroDestination}
          >
            <ImageBackground source={{ uri: heroContent.imageUrl }} resizeMode='cover' style={styles.heroImage}>
              <View style={styles.heroOverlay}>
                <Text style={styles.heroTitle} numberOfLines={2}>{heroContent.title}</Text>
                <Text style={styles.heroSubtitle} numberOfLines={3}>{heroContent.subtitle}</Text>
                <View style={styles.heroButton}>
                  <Text style={styles.heroButtonText}>{heroContent.buttonLabel}</Text>
                </View>
              </View>
            </ImageBackground>
          </TouchableOpacity>
        ) : null}

        <View
          style={styles.sectionHeader}
          onLayout={(event) => { catalogOffsetRef.current = event.nativeEvent.layout.y; }}
        >
          <Text style={styles.sectionTitle}>Available caskets</Text>
          <TouchableOpacity
            accessibilityLabel='View all available caskets'
            accessibilityRole='button'
            activeOpacity={0.72}
            style={styles.viewAllButton}
            onPress={() => navigation.navigate('AllProducts', { showAll: true })}
          >
            <Text style={styles.viewAllText}>View all</Text>
            <Ionicons name='arrow-forward' size={15} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <LoadingBird compact style={styles.loadingIndicator} />
        ) : loadError && products.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name="cloud-offline-outline" size={24} color={colors.textMuted} />
            <Text style={styles.stateTitle}>Couldn’t load caskets</Text>
            <Text style={styles.stateText}>Check your connection, then try again.</Text>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.75}
              style={styles.stateAction}
              onPress={() => {
                setLoading(true);
                void loadProducts();
              }}
            >
              <Text style={styles.stateActionText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : products.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name="search-outline" size={24} color={colors.textMuted} />
            <Text style={styles.stateTitle}>No caskets available</Text>
            <Text style={styles.stateText}>New listings will appear here when a shop adds them.</Text>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.75}
              style={styles.stateAction}
              onPress={() => navigation.navigate("Shops")}
            >
              <Text style={styles.stateActionText}>Browse shops</Text>
            </TouchableOpacity>
          </View>
        ) : visibleProducts.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name="options-outline" size={24} color={colors.textMuted} />
            <Text style={styles.stateTitle}>No matching listings</Text>
            <Text style={styles.stateText}>Try a different shop or reset the filters.</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.stateAction} onPress={clearFilters}>
              <Text style={styles.stateActionText}>Reset filters</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.productGrid}>
            {visibleProducts.map((item) => {
              const price = formatPhilippinePeso(item.price);
              const isFavorite = favoriteProductIds.has(item.id);
              return (
                <TouchableOpacity
                  key={`${item.shopId}_${item.id}`}
                  accessibilityLabel={`${item.name}, ${price}, from ${item.shopName}`}
                  accessibilityRole="button"
                  activeOpacity={0.78}
                  style={styles.productCard}
                  onPress={() => openProductView(item)}
                >
                  <View style={styles.productImageFrame}>
                    <Image
                      source={{ uri: getPrimaryProductImage(item) || "" }}
                      style={styles.productImage}
                      resizeMode="cover"
                    />
                    <TouchableOpacity
                      accessibilityLabel={isFavorite ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`}
                      accessibilityRole="button"
                      activeOpacity={0.72}
                      style={styles.favoriteButton}
                      onPress={(event) => {
                        event.stopPropagation();
                        toggleProductFavorite(item.id);
                      }}
                    >
                      <Ionicons
                        name={isFavorite ? "heart" : "heart-outline"}
                        size={17}
                        color={isFavorite ? colors.accent : colors.text}
                      />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.productDetails}>
                    <Text style={styles.shopName} numberOfLines={1}>{item.shopName}</Text>
                    <Text style={styles.productTitle} numberOfLines={2}>{item.name}</Text>
                    <Text style={styles.price}>{price}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        animationType="none"
        transparent
        statusBarTranslucent
        visible={filterExpanded}
        onRequestClose={closeProductFilters}
      >
        <View style={styles.filterModalRoot}>
          <Animated.View style={[styles.filterBackdrop, { opacity: filterBackdropOpacity }]}>
            <TouchableOpacity
              accessibilityLabel="Close product filters"
              accessibilityRole="button"
              activeOpacity={1}
              style={styles.filterBackdropPressable}
              onPress={closeProductFilters}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.filterSheet,
              {
                opacity: filterSheetProgress.interpolate({
                  inputRange: [0, 0.12, 1],
                  outputRange: [0, 1, 1],
                  extrapolate: "clamp",
                }),
                transform: [
                  {
                    translateY: filterSheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [120, 0],
                    }),
                  },
                  {
                    scale: filterSheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.985, 1],
                    }),
                  },
                ],
              },
            ]}
          >
          <SafeAreaView edges={["bottom"]} style={styles.filterSheetSafeArea} accessibilityViewIsModal>
            <View style={styles.filterSheetHeader}>
              <View style={styles.filterSheetTitleRow}>
                <Ionicons name="filter-outline" size={17} color={colors.primary} />
                <Text style={styles.filterSheetTitle}>FILTER</Text>
              </View>
              <TouchableOpacity
                accessibilityLabel="Close product filters"
                accessibilityRole="button"
                activeOpacity={0.7}
                style={styles.filterCloseButton}
                onPress={closeProductFilters}
              >
                <Ionicons name="close" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.filterSheetContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeading}>
                  <Text style={styles.filterLabel}>SORT BY</Text>
                  {activeFilterCount > 0 ? (
                    <TouchableOpacity accessibilityRole="button" onPress={clearFilters}>
                      <Text style={styles.clearFilterText}>Reset</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View style={styles.sortOptions}>
                  {([
                    { value: "price_low", label: "Price: Low to High", description: "Show the most affordable first", icon: "arrow-up-outline" },
                    { value: "price_high", label: "Price: High to Low", description: "Show premium products first", icon: "arrow-down-outline" },
                  ] as const).map((option) => {
                    const selected = sortBy === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        accessibilityLabel={option.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        activeOpacity={0.75}
                        style={[styles.sortOption, selected && styles.sortOptionActive]}
                        onPress={() => setSortBy(option.value)}
                      >
                        <View style={[styles.sortOptionIcon, selected && styles.sortOptionIconActive]}>
                          <Ionicons name={option.icon} size={17} color={selected ? colors.surface : colors.primary} />
                        </View>
                        <View style={styles.sortOptionCopy}>
                          <Text style={[styles.sortOptionLabel, selected && styles.sortOptionLabelActive]}>{option.label}</Text>
                          <Text style={styles.sortOptionDescription}>{option.description}</Text>
                        </View>
                        <Ionicons
                          name={selected ? "checkmark-circle" : "ellipse-outline"}
                          size={20}
                          color={selected ? colors.primary : colors.borderWarm}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>PRICE RANGE</Text>
                <View style={styles.priceFilterRow}>
                  <TextInput
                    accessibilityLabel="Minimum product price"
                    style={styles.priceFilterInput}
                    value={minPrice}
                    onChangeText={(value) => setMinPrice(value.replace(/[^\d.]/g, ""))}
                    placeholder="MIN"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                  <Text style={styles.priceFilterSeparator}>—</Text>
                  <TextInput
                    accessibilityLabel="Maximum product price"
                    style={styles.priceFilterInput}
                    value={maxPrice}
                    onChangeText={(value) => setMaxPrice(value.replace(/[^\d.]/g, ""))}
                    placeholder="MAX"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                </View>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>RATING</Text>
                <View style={styles.ratingFilterList}>
                  {[5, 4, 3, 2, 1].map((value) => {
                    const selected = minimumRating === value;
                    return (
                      <TouchableOpacity
                        key={value}
                        accessibilityLabel={`${value} stars and up`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        activeOpacity={0.75}
                        style={[styles.ratingFilterRow, selected && styles.ratingFilterRowActive]}
                        onPress={() => setMinimumRating((current) => current === value ? 0 : value)}
                      >
                        <View style={styles.ratingStars}>
                          {Array.from({ length: 5 }, (_, index) => (
                            <Ionicons
                              key={index}
                              name={index < value ? "star" : "star-outline"}
                              size={17}
                              color={index < value ? "#f3ad24" : colors.textMuted}
                            />
                          ))}
                        </View>
                        <Text style={styles.ratingFilterText}>&amp; up</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {shopOptions.length > 1 ? (
                <View style={styles.filterSection}>
                  <Text style={styles.filterLabel}>FUNERAL SHOP</Text>
                  <View style={styles.filterChips}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={[styles.filterChip, selectedShopId === "all" && styles.filterChipActive]}
                      onPress={() => setSelectedShopId("all")}
                    >
                      <Text style={[styles.filterChipText, selectedShopId === "all" && styles.filterChipTextActive]}>All shops</Text>
                    </TouchableOpacity>
                    {shopOptions.map((shop) => (
                      <TouchableOpacity
                        key={shop.id}
                        accessibilityRole="button"
                        style={[styles.filterChip, selectedShopId === shop.id && styles.filterChipActive]}
                        onPress={() => setSelectedShopId(shop.id)}
                      >
                        <Text style={[styles.filterChipText, selectedShopId === shop.id && styles.filterChipTextActive]}>{shop.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.filterSheetFooter}>
              <TouchableOpacity
                accessibilityLabel="Apply product filters"
                accessibilityRole="button"
                activeOpacity={0.8}
                style={styles.filterApplyButton}
                onPress={closeProductFilters}
              >
                <Text style={styles.filterApplyText}>APPLY</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
          </Animated.View>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  brandLogo: {
    width: 36,
    height: 36,
  },
  brand: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadge: {
    position: "absolute",
    right: -2,
    top: -2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  countBadgeText: {
    color: colors.surface,
    fontSize: 9,
    fontWeight: "800",
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingLeft: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  searchBar: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchPlaceholder: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 14,
  },
  searchDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.borderWarm,
  },
  heroCard: {
    height: 176,
    overflow: 'hidden',
    borderRadius: radii.xl,
    backgroundColor: colors.primaryDark,
    marginBottom: spacing.xl,
  },
  heroImage: {
    flex: 1,
  },
  heroOverlay: {
    flex: 1,
    width: '74%',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: spacing.lg,
    backgroundColor: 'rgba(20, 28, 26, 0.72)',
  },
  heroTitle: {
    color: colors.surface,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: '#eef1ec',
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  heroButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    marginTop: spacing.md,
  },
  heroButtonText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  viewAllButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  viewAllText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  filterButton: {
    position: 'relative',
    width: 48,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountBadge: {
    position: 'absolute',
    top: -3,
    right: -2,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  filterCountText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: "800",
  },
  filterModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  filterBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 29, 43, 0.38)',
  },
  filterBackdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  filterSheet: {
    width: '100%',
    maxWidth: 560,
    height: '78%',
    alignSelf: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 20,
  },
  filterSheetSafeArea: {
    flex: 1,
  },
  filterSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 62,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderWarm,
  },
  filterSheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  filterSheetTitle: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  filterCloseButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  filterSheetContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  filterSection: {
    paddingVertical: spacing.lg,
  },
  filterSectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  clearFilterText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  sortOptions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  sortOption: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  sortOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceMuted,
  },
  sortOptionIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  sortOptionIconActive: {
    backgroundColor: colors.primary,
  },
  sortOptionCopy: {
    flex: 1,
  },
  sortOptionLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  sortOptionLabelActive: {
    color: colors.primary,
  },
  sortOptionDescription: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  filterChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  filterChip: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  filterChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  filterChipText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: colors.surface,
  },
  priceFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  priceFilterInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  priceFilterSeparator: {
    color: colors.textMuted,
    fontSize: 16,
  },
  ratingFilterList: {
    gap: 4,
    marginTop: spacing.sm,
  },
  ratingFilterRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: radii.sm,
  },
  ratingFilterRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceMuted,
  },
  ratingStars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  ratingFilterText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  filterSheetFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
    backgroundColor: colors.surface,
  },
  filterApplyButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  filterApplyText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  loadingIndicator: {
    minHeight: 180,
    backgroundColor: colors.surfaceWarm,
  },
  stateCard: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    marginTop: spacing.md,
  },
  stateText: {
    maxWidth: 280,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  stateAction: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.sm,
    marginTop: spacing.lg,
  },
  stateActionText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  productGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.xl,
  },
  productCard: {
    width: "48%",
  },
  productImageFrame: {
    position: "relative",
    width: "100%",
    aspectRatio: 0.82,
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
  },
  productImage: {
    width: "100%",
    height: "100%",
  },
  favoriteButton: {
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
  productDetails: {
    paddingTop: 6,
  },
  productTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    marginTop: 1,
  },
  shopName: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  price: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
});
