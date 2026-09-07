import { useCallback, useMemo, useRef, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import LoadingBird from '@/components/LoadingBird';
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/services/supabaseClient";
import { subscribeTabRefresh } from "@/utils/tabRefresh";

type ShopRecord = {
  id: string;
  shopName: string;
  shopAddress: string;
  shopPhoneNumber: string;
  shopImageUrl?: string | null;
  coverImageUrl?: string | null;
  businessName?: string;
  generalLocation?: string;
  productCount: number;
  availableProductCount: number;
};

export default function FuneralShopsScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<ScrollView>(null);

  const loadShops = useCallback(async () => {
    setLoadError(null);
    try {
      const { data: shopRows, error } = await supabase
        .from("funeral_shops")
        .select(`
          id, shopName, shopAddress, shopPhoneNumber, shopImageUrl, coverImageUrl, businessName, generalLocation,
          funeral_products ( id, stock, active )
        `)
        .eq("status", "live")
        .gt("paidUntil", new Date().toISOString())
        .eq("funeral_products.active", true)
        .order("shopName", { ascending: true });
      if (error) throw error;

      const nextShops: ShopRecord[] = (shopRows || []).map((row: any) => {
        const activeProducts = (row.funeral_products || []).filter((product: any) => product.active !== false);
        return {
          id: row.id,
          shopName: String(row.shopName || "Funeral shop"),
          shopAddress: String(row.shopAddress || ""),
          shopPhoneNumber: String(row.shopPhoneNumber || ""),
          shopImageUrl: row.shopImageUrl || null,
          coverImageUrl: row.coverImageUrl || null,
          businessName: row.businessName ? String(row.businessName) : undefined,
          generalLocation: row.generalLocation ? String(row.generalLocation) : undefined,
          productCount: activeProducts.length,
          availableProductCount: activeProducts.filter((product: any) => Number(product.stock) > 0).length,
        };
      });

      setShops(nextShops);
      setFailedImageIds(new Set());
    } catch (error: any) {
      setLoadError(error?.message || "Active funeral shops could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadShops();
      const unsubscribe = subscribeTabRefresh("Shops", () => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        setRefreshing(true);
        void loadShops();
      });
      return unsubscribe;
    }, [loadShops])
  );

  const visibleShops = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return shops;
    return shops.filter((shop) =>
      [shop.shopName, shop.businessName, shop.generalLocation, shop.shopAddress]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [query, shops]);

  const shopCountLabel = useMemo(() => {
    if (query.trim()) return `${visibleShops.length} of ${shops.length} active shops`;
    return `${shops.length} active ${shops.length === 1 ? "shop" : "shops"}`;
  }, [query, shops.length, visibleShops.length]);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadShops(); }} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Find the right funeral shop</Text>
          <Text style={styles.heroSubtitle}>Browse active funeral shops and their available products.</Text>

          <View style={styles.heroPill}>
            <Ionicons name="storefront-outline" size={16} color="#22312d" />
            <Text style={styles.heroPillText}>{shopCountLabel}</Text>
          </View>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color="#62706b" />
          <TextInput
            accessibilityLabel="Search funeral shops"
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            placeholder="Search by shop or location"
            placeholderTextColor="#8a928d"
            returnKeyType="search"
          />
          {query ? (
            <TouchableOpacity accessibilityLabel="Clear shop search" onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={18} color="#8a928d" />
            </TouchableOpacity>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <LoadingBird />
          </View>
        ) : loadError && shops.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="cloud-offline-outline" size={28} color="#9b2c2c" />
            <Text style={styles.emptyTitle}>Shops unavailable</Text>
            <Text style={styles.emptyText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); void loadShops(); }}>
              <Text style={styles.retryButtonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : visibleShops.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name={query ? "search-outline" : "storefront-outline"} size={28} color="#86908a" />
            <Text style={styles.emptyTitle}>{query ? "No matching shops" : "No active shops yet"}</Text>
            <Text style={styles.emptyText}>{query ? "Try another shop name or location." : "Approved funeral shops will appear here when their listings are active."}</Text>
            {query ? (
              <TouchableOpacity style={styles.retryButton} onPress={() => setQuery("")}>
                <Text style={styles.retryButtonText}>Clear search</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <>
            {loadError ? (
              <TouchableOpacity style={styles.refreshWarning} onPress={() => void loadShops()}>
                <Ionicons name="cloud-offline-outline" size={18} color="#9b2c2c" />
                <Text style={styles.refreshWarningText}>Could not refresh. Showing the last loaded shops.</Text>
              </TouchableOpacity>
            ) : null}
            {visibleShops.map((shop) => {
              const imageUrl = shop.coverImageUrl || shop.shopImageUrl;
              const imageFailed = failedImageIds.has(shop.id);
              return (
            <View key={shop.id} style={styles.shopCard}>
              {imageUrl && !imageFailed ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={styles.shopImage}
                  resizeMode="cover"
                  onError={() => setFailedImageIds((current) => new Set(current).add(shop.id))}
                />
              ) : (
                <View style={styles.shopImageFallback}>
                  <Ionicons name="storefront-outline" size={28} color="#22312d" />
                </View>
              )}

              <View style={styles.shopBody}>
                <Text style={styles.shopName}>{shop.shopName}</Text>
                {shop.businessName && shop.businessName.trim().toLowerCase() !== shop.shopName.trim().toLowerCase() ? (
                  <Text style={styles.shopBusiness}>{shop.businessName}</Text>
                ) : null}

                <View style={styles.shopMetaRow}>
                  <Ionicons name="location-outline" size={16} color="#62706b" />
                  <Text style={styles.shopMeta}>{shop.generalLocation || shop.shopAddress || "Location not available"}</Text>
                </View>
                <View style={styles.shopMetaRow}>
                  <Ionicons name="call-outline" size={16} color="#62706b" />
                  <Text style={styles.shopMeta}>{shop.shopPhoneNumber || "No contact number"}</Text>
                </View>
                <View style={styles.catalogMetaRow}>
                  <Ionicons name="albums-outline" size={16} color="#2f6b55" />
                  <Text style={styles.catalogMetaText}>
                    {shop.availableProductCount} available · {shop.productCount} {shop.productCount === 1 ? "product" : "products"}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Browse ${shop.shopName} catalog`}
                style={styles.shopButton}
                onPress={() => navigation.navigate("ShopProducts", { shopId: shop.id, shopName: shop.shopName })}
              >
                <Text style={styles.shopButtonText}>Browse Catalog</Text>
                <Ionicons name="arrow-forward" size={16} color="#ffffff" />
              </TouchableOpacity>
            </View>
              );
            })}
          </>
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
    padding: 16,
    paddingBottom: 28,
    gap: 14,
  },
  heroCard: {
    borderRadius: 22,
    backgroundColor: "#d6e2d2",
    padding: 17,
  },
  heroTitle: {
    color: "#22312d",
    fontSize: 23,
    lineHeight: 28,
    fontWeight: "900",
  },
  heroSubtitle: {
    color: "#53615d",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  heroPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.68)",
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 12,
  },
  heroPillText: {
    color: "#22312d",
    fontSize: 12,
    fontWeight: "900",
  },
  searchBox: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: "#22312d",
    fontSize: 13,
    paddingVertical: 8,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 48,
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
  retryButton: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 16,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  refreshWarning: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: "#fff1f1",
    paddingHorizontal: 12,
  },
  refreshWarningText: {
    flex: 1,
    color: "#9b2c2c",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  shopCard: {
    borderRadius: 24,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 14,
  },
  shopImage: {
    width: "100%",
    height: 156,
    borderRadius: 18,
  },
  shopImageFallback: {
    width: "100%",
    height: 156,
    borderRadius: 18,
    backgroundColor: "#ebf1e8",
    alignItems: "center",
    justifyContent: "center",
  },
  shopBody: {
    marginTop: 14,
    gap: 7,
  },
  shopName: {
    color: "#22312d",
    fontSize: 19,
    fontWeight: "900",
  },
  shopMetaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  shopMeta: {
    flex: 1,
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
  },
  shopBusiness: {
    color: "#8b7255",
    fontSize: 12,
    fontWeight: "800",
  },
  catalogMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 8,
    backgroundColor: "#ebf1e8",
    paddingHorizontal: 8,
    paddingVertical: 7,
    marginTop: 2,
  },
  catalogMetaText: {
    flex: 1,
    color: "#2f6b55",
    fontSize: 11,
    fontWeight: "800",
  },
  shopButton: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: "#22312d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
  },
  shopButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
});

