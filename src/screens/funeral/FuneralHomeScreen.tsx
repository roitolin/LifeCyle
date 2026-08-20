import { useCallback, useMemo, useRef, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import LoadingBird from '@/components/LoadingBird';
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { supabase } from "@/services/supabaseClient";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { subscribeTabRefresh } from "@/utils/tabRefresh";
import { useUnreadCount, useUnreadMessageCount } from "@/hooks";

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
};

function getPrimaryProductImage(item: ShopProduct) {
  return item.imageUrl || item.galleryImageUrls?.[0] || item.variations?.find((entry) => entry.imageUrl)?.imageUrl || null;
}

export default function FuneralHomeScreen({ navigation }: any) {
  const tabBarHeight = useBottomTabBarHeight();
  const unreadCount = useUnreadCount();
  const unreadMessageCount = useUnreadMessageCount();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [products, setProducts] = useState<HomeProduct[]>([]);
  const [queryText, setQueryText] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const loadProducts = useCallback(async () => {
    try {
      const { data: productRows } = await supabase
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

      const nextProducts: HomeProduct[] = (productRows || []).map((row: any) => {
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
          shopName: String(row.funeral_shops?.shopName || "Verified Shop"),
        };
      }).filter((p: HomeProduct) => getPrimaryProductImage(p));

      nextProducts.sort((a: any, b: any) => a.name.localeCompare(b.name));
      setProducts(nextProducts);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProducts();
      const unsubscribe = subscribeTabRefresh("Home", () => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        setRefreshing(true);
        void loadProducts();
      });
      return unsubscribe;
    }, [loadProducts])
  );

  const filteredProducts = useMemo(() => {
    const search = queryText.trim().toLowerCase();
    if (!search) return products;
    return products.filter((item: any) =>
      [item.name, item.description, item.shopName]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [products, queryText]);

  const featuredProduct = filteredProducts[0] || null;
  const openProductView = (product: HomeProduct) => {
    navigation.navigate("ProductView", { product });
  };

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(tabBarHeight, 16) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadProducts(); }} />}
      >
        <View style={styles.topRow}>
          <View style={styles.brandBlock}>
            <View style={styles.brandRow}>
              <Image
                source={require("../../../assets/Icon/AppICONTransparents.png")}
                style={styles.brandLogo}
                resizeMode="contain"
              />
              <Text style={styles.brand}>LifeCycle</Text>
            </View>
            <Text style={styles.subbrand}>Verified casket listings from approved funeral shops</Text>
          </View>

          <View style={styles.topActions}>
            <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate("Notifications")}>
              <Ionicons name="notifications-outline" size={19} color="#22312d" />
              {unreadCount > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate("Conversations")}>
              <Ionicons name="chatbubble-ellipses-outline" size={19} color="#22312d" />
              {unreadMessageCount > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{unreadMessageCount > 9 ? "9+" : unreadMessageCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color="#8a928d" />
          <TextInput
            placeholder="Search caskets or shops"
            placeholderTextColor="#a3a3a3"
            style={styles.searchInput}
            value={queryText}
            onChangeText={setQueryText}
          />
          <TouchableOpacity style={styles.searchAction} onPress={() => navigation.navigate("Shops")}>
            <Ionicons name="storefront" size={18} color="#22312d" />
          </TouchableOpacity>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroTextBlock}>
            <Text style={styles.heroTitle}>Live Funeral{`\n`}Product Feed</Text>
            <Text style={styles.heroSubtitle}>
              New caskets created by verified shops will appear here automatically.
            </Text>

            <TouchableOpacity style={styles.heroButton} onPress={() => navigation.navigate("Shops")}>
              <Text style={styles.heroButtonText}>Browse Shops</Text>
              <Ionicons name="arrow-forward" size={14} color="#ffffff" />
            </TouchableOpacity>
          </View>

          <View style={styles.heroImageWrap}>
            {featuredProduct ? (
              <TouchableOpacity activeOpacity={0.92} onPress={() => openProductView(featuredProduct)}>
                <Image source={{ uri: getPrimaryProductImage(featuredProduct) || "" }} style={styles.heroImage} resizeMode="cover" />
              </TouchableOpacity>
            ) : (
              <View style={styles.heroImageFallback}>
                <Ionicons name="albums-outline" size={34} color="#22312d" />
              </View>
            )}
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Available Caskets</Text>
          <TouchableOpacity style={styles.seeAllRow} onPress={() => navigation.navigate("Shops")}>
            <Text style={styles.seeAllText}>Verified Shops</Text>
            <Ionicons name="chevron-forward" size={14} color="#8a928d" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <LoadingBird />
          </View>
        ) : filteredProducts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="cube-outline" size={28} color="#86908a" />
            <Text style={styles.emptyTitle}>No caskets available yet</Text>
            <Text style={styles.emptyText}>
              Once a verified shop adds a casket product, it will automatically show here on Home.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {filteredProducts.map((item: any) => (
              <TouchableOpacity key={`${item.shopId}_${item.id}`} style={styles.card} activeOpacity={0.92} onPress={() => openProductView(item)}>
                {getPrimaryProductImage(item) ? (
                  <Image source={{ uri: getPrimaryProductImage(item) || "" }} style={styles.productImage} resizeMode="cover" />
                ) : (
                  <View style={styles.productVisual}>
                    <Ionicons name="cube-outline" size={44} color="#4c5b57" />
                  </View>
                )}

                <View style={styles.cardFooter}>
                  <Text style={styles.price}>{formatPhilippinePeso(item.price)}</Text>
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.cardDescription} numberOfLines={2}>
                  {item.description || "Casket details will appear here."}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef1ec",
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    flexGrow: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 22,
  },
  brandBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandLogo: {
    width: 50,
    height: 50,
  },
  brand: {
    color: "#22312d",
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1.2,
  },
  subbrand: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    maxWidth: 220,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    alignItems: "center",
    justifyContent: "center",
  },
  countBadge: {
    position: "absolute",
    right: -2,
    top: -2,
    backgroundColor: "#d32f2f",
    borderRadius: 10,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    justifyContent: "center",
    alignItems: "center",
  },
  countBadgeText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "bold",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 8,
    height: 54,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    marginBottom: 18,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    color: "#22312d",
    fontSize: 14,
  },
  searchAction: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#d6e2d2",
    alignItems: "center",
    justifyContent: "center",
  },
  heroCard: {
    flexDirection: "row",
    minHeight: 190,
    backgroundColor: "#d6e2d2",
    borderRadius: 24,
    paddingTop: 16,
    paddingLeft: 16,
    paddingRight: 10,
    marginBottom: 24,
    overflow: "hidden",
    shadowColor: "#7e9080",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  heroTextBlock: {
    flex: 1,
    justifyContent: "space-between",
    paddingBottom: 18,
  },
  heroTitle: {
    color: "#22312d",
    fontSize: 28,
    lineHeight: 31,
    fontWeight: "900",
  },
  heroSubtitle: {
    color: "#796555",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 10,
  },
  heroButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#22312d",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  heroButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  heroImageWrap: {
    width: 126,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  heroImage: {
    width: 140,
    height: 182,
    borderRadius: 20,
  },
  heroImageFallback: {
    width: 120,
    height: 160,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.46)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: {
    color: "#22312d",
    fontSize: 22,
    fontWeight: "800",
  },
  seeAllRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  seeAllText: {
    color: "#8a928d",
    fontSize: 13,
    fontWeight: "600",
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  loadingText: {
    color: "#62706b",
    fontSize: 14,
    fontWeight: "700",
  },
  emptyCard: {
    borderRadius: 24,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 28,
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 14,
  },
  card: {
    width: "47.5%",
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },
  productImage: {
    width: "100%",
    height: 108,
    borderRadius: 18,
    marginBottom: 12,
  },
  productVisual: {
    height: 108,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    backgroundColor: "#ebf1e8",
  },
  cardTitle: {
    color: "#41514d",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 4,
    minHeight: 34,
  },
  cardDescription: {
    color: "#62706b",
    fontSize: 11,
    lineHeight: 16,
    minHeight: 32,
  },
  cardFooter: {
    marginTop: 10,
  },
  price: {
    color: "#22312d",
    fontSize: 18,
    fontWeight: "900",
  },
});
