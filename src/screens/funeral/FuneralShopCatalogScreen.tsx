import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
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
import { AppBackButton } from "@/components";
import LoadingBird from "@/components/LoadingBird";
import { auth } from "@/services";
import { supabase } from "@/services/supabaseClient";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { colors, radii, spacing } from "@/theme";

type ProductFilter = "all" | "available" | "soldout";

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

function getProductState(item: ShopProduct): Exclude<ProductFilter, "all"> {
  if (!item.active || (item.stock ?? 0) <= 0) return "soldout";
  return "available";
}

function getPrimaryProductImage(item: ShopProduct) {
  return item.imageUrl || item.galleryImageUrls?.[0] || item.variations?.find((entry) => entry.imageUrl)?.imageUrl || null;
}

function formatUpdatedAt(value?: string) {
  if (!value) return "Recently updated";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recently updated";
  return `Updated ${parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

export default function FuneralShopCatalogScreen({ navigation, route }: any) {
  const requestedFilter = route.params?.initialFilter;
  const [filter, setFilter] = useState<ProductFilter>(
    requestedFilter === "available" || requestedFilter === "soldout" ? requestedFilter : "all"
  );
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingProductId, setUpdatingProductId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProducts = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);

    try {
      let shopId = auth.currentUser?.uid || null;
      if (!shopId) {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        shopId = sessionData.session?.user?.id || null;
      }

      if (!shopId) {
        setProducts([]);
        return;
      }

      const { data, error } = await supabase
        .from("funeral_products")
        .select(`
          *,
          funeral_product_variations ( name, imageUrl ),
          funeral_product_images ( imageUrl, displayOrder )
        `)
        .eq("shopId", shopId)
        .order("updatedAt", { ascending: false });
      if (error) throw error;

      setProducts((data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description || "",
        price: String(row.price),
        stock: row.stock,
        imageUrl: row.imageUrl,
        galleryImageUrls: (row.funeral_product_images || [])
          .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
          .map((image: any) => image.imageUrl),
        hasVariations: row.hasVariations,
        variations: (row.funeral_product_variations || []).map((variation: any) => ({
          name: variation.name,
          imageUrl: variation.imageUrl,
        })),
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })));
    } catch (error: any) {
      setLoadError(error?.message || "Your product catalog could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadProducts(); }, [loadProducts]));

  const availableProducts = useMemo(
    () => products.filter((item) => getProductState(item) === "available"),
    [products]
  );
  const soldOutProducts = useMemo(
    () => products.filter((item) => getProductState(item) === "soldout"),
    [products]
  );
  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter((item) => {
      if (filter !== "all" && getProductState(item) !== filter) return false;
      if (!normalizedQuery) return true;
      return `${item.name} ${item.description}`.toLowerCase().includes(normalizedQuery);
    });
  }, [filter, products, query]);

  const handleBack = () => {
    if (navigation.canGoBack?.()) navigation.goBack();
    else navigation.navigate("ShopCenter");
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
        ? `${item.name} will be available to families while your shop is live.`
        : `${item.name} will be hidden until you activate it again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: nextActive ? "Activate" : "Pause",
          style: nextActive ? "default" : "destructive",
          onPress: async () => {
            setUpdatingProductId(item.id);
            try {
              const updatedAt = new Date().toISOString();
              const { error } = await supabase
                .from("funeral_products")
                .update({ active: nextActive, updatedAt })
                .eq("id", item.id);
              if (error) throw error;
              setProducts((current) => current.map((product) =>
                product.id === item.id ? { ...product, active: nextActive, updatedAt } : product
              ));
            } catch (error: any) {
              Alert.alert("Update Failed", error?.message || "Unable to update the product.");
            } finally {
              setUpdatingProductId(null);
            }
          },
        },
      ]
    );
  };

  const removeProduct = (item: ShopProduct) => {
    Alert.alert("Delete Product", `Remove ${item.name}? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setUpdatingProductId(item.id);
          try {
            const { error } = await supabase.from("funeral_products").delete().eq("id", item.id);
            if (error) throw error;
            setProducts((current) => current.filter((product) => product.id !== item.id));
          } catch (error: any) {
            Alert.alert("Delete Failed", error?.message || "Unable to delete the product.");
          } finally {
            setUpdatingProductId(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.headerSafeArea}>
        <View style={styles.headerBar}>
          <AppBackButton onPress={handleBack} />
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Product Catalog</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Add a new product"
            style={styles.headerAddButton}
            onPress={() => navigation.navigate("ProductEditor")}
          >
            <Ionicons name="add" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.body}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void loadProducts(true)} tintColor="#22312d" />
          }
        >
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={19} color="#76827d" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              style={styles.searchInput}
              placeholder="Search products"
              placeholderTextColor="#929b97"
              returnKeyType="search"
            />
            {query ? (
              <TouchableOpacity accessibilityLabel="Clear search" onPress={() => setQuery("")}>
                <Ionicons name="close-circle" size={19} color="#929b97" />
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {([
              { key: "all", label: `All (${products.length})` },
              { key: "available", label: `Available (${availableProducts.length})` },
              { key: "soldout", label: `Unavailable (${soldOutProducts.length})` },
            ] as { key: ProductFilter; label: string }[]).map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.filterChip, filter === item.key ? styles.filterChipActive : null]}
                onPress={() => setFilter(item.key)}
              >
                <Text style={[styles.filterChipText, filter === item.key ? styles.filterChipTextActive : null]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loading ? (
            <View style={styles.loadingWrap}><LoadingBird /></View>
          ) : loadError ? (
            <View style={styles.emptyCard}>
              <Ionicons name="cloud-offline-outline" size={30} color="#9b403b" />
              <Text style={styles.emptyTitle}>Catalog unavailable</Text>
              <Text style={styles.emptyText}>{loadError}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void loadProducts()}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : visibleProducts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name={query ? "search-outline" : "albums-outline"} size={30} color="#84918b" />
              <Text style={styles.emptyTitle}>{query ? "No matching products" : filter === "all" ? "Start your catalog" : "Nothing in this filter"}</Text>
              <Text style={styles.emptyText}>{query ? "Try a different product name or description." : "Add a product so families can browse your available services."}</Text>
              {!query && filter === "all" ? (
                <TouchableOpacity style={styles.retryButton} onPress={() => navigation.navigate("ProductEditor")}>
                  <Text style={styles.retryButtonText}>Add Product</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <View style={styles.productList}>
              {visibleProducts.map((item) => {
                const state = getProductState(item);
                const imageUrl = getPrimaryProductImage(item);
                const busy = updatingProductId === item.id;
                return (
                  <View key={item.id} style={[styles.productCard, state === "soldout" ? styles.productCardUnavailable : null]}>
                    <TouchableOpacity
                      activeOpacity={0.88}
                      style={styles.productSummary}
                      onPress={() => navigation.navigate("ProductDetails", { productId: item.id })}
                    >
                      {imageUrl ? (
                        <Image source={{ uri: imageUrl }} style={styles.productImage} resizeMode="cover" />
                      ) : (
                        <View style={[styles.productImage, styles.productImageFallback]}>
                          <Ionicons name="image-outline" size={26} color="#929d98" />
                        </View>
                      )}
                      <View style={styles.productCopy}>
                        <View style={styles.productTopRow}>
                          <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
                          <View style={[styles.stateBadge, state === "available" ? styles.stateAvailable : styles.stateUnavailable]}>
                            <Text style={[styles.stateText, state === "available" ? styles.stateTextAvailable : styles.stateTextUnavailable]}>
                              {state === "available" ? "AVAILABLE" : item.active ? "SOLD OUT" : "PAUSED"}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.productPrice}>{formatPhilippinePeso(item.price)}</Text>
                        <Text style={styles.productMeta}>Stock {item.stock ?? 0}{item.hasVariations && item.variations?.length ? `  |  ${item.variations.length} variations` : ""}</Text>
                        <Text style={styles.productDescription} numberOfLines={2}>{item.description || "No description yet."}</Text>
                        <Text style={styles.productUpdated}>{formatUpdatedAt(item.updatedAt)}</Text>
                      </View>
                    </TouchableOpacity>

                    <View style={styles.productActions}>
                      <TouchableOpacity style={styles.editButton} onPress={() => navigation.navigate("ProductEditor", { productId: item.id })} disabled={busy}>
                        <Ionicons name="create-outline" size={16} color="#ffffff" />
                        <Text style={styles.editButtonText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.pauseButton} onPress={() => toggleProductAvailability(item)} disabled={busy}>
                        {busy ? <ActivityIndicator size="small" color="#765f49" /> : <Ionicons name={item.active ? "pause-outline" : "play-outline"} size={16} color="#765f49" />}
                        <Text style={styles.pauseButtonText}>{item.active ? "Pause" : "Activate"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity accessibilityLabel={`Delete ${item.name}`} style={styles.deleteButton} onPress={() => removeProduct(item)} disabled={busy}>
                        <Ionicons name="trash-outline" size={17} color="#9b403b" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceMuted },
  body: { flex: 1 },
  headerSafeArea: { backgroundColor: "#f8f6f2" },
  headerBar: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#d9d6cd" },
  headerCopy: { flex: 1 },
  headerTitle: { color: "#22312d", fontSize: 20, fontWeight: "900" },
  headerAddButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#22312d", alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.lg, paddingBottom: 38, gap: spacing.md },
  searchBox: { minHeight: 48, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, color: "#22312d", fontSize: 14, paddingVertical: 10 },
  filterRow: { gap: 8, paddingRight: 4 },
  filterChip: { minHeight: 38, borderRadius: 999, borderWidth: 1, borderColor: "#d6d2c9", backgroundColor: "#ffffff", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  filterChipActive: { backgroundColor: "#516961", borderColor: "#516961" },
  filterChipText: { color: "#62706b", fontSize: 12, fontWeight: "900" },
  filterChipTextActive: { color: "#ffffff" },
  loadingWrap: { minHeight: 240, alignItems: "center", justifyContent: "center" },
  emptyCard: { minHeight: 230, borderRadius: 24, borderWidth: 1, borderColor: "#d9d6cd", backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", padding: 24 },
  emptyTitle: { color: "#22312d", fontSize: 18, fontWeight: "900", marginTop: 11 },
  emptyText: { color: "#687570", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 5 },
  retryButton: { minHeight: 40, borderRadius: 13, backgroundColor: "#22312d", justifyContent: "center", paddingHorizontal: 16, marginTop: 15 },
  retryButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  productList: { gap: spacing.md },
  productCard: { borderRadius: radii.xl, borderWidth: 1, borderColor: colors.borderWarm, backgroundColor: colors.surface, padding: spacing.md },
  productCardUnavailable: { borderColor: "#e2c7af", backgroundColor: "#fffdf9" },
  productSummary: { flexDirection: "row", alignItems: "center", gap: 12 },
  productImage: { width: 88, height: 94, borderRadius: 17, backgroundColor: "#ebf1e8" },
  productImageFallback: { alignItems: "center", justifyContent: "center" },
  productCopy: { flex: 1, minWidth: 0 },
  productTopRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  productName: { flex: 1, color: "#22312d", fontSize: 16, fontWeight: "900" },
  stateBadge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 5 },
  stateAvailable: { backgroundColor: "#e3f3e8" },
  stateUnavailable: { backgroundColor: "#f7e5d7" },
  stateText: { fontSize: 8, fontWeight: "900", letterSpacing: 0.35 },
  stateTextAvailable: { color: "#236441" },
  stateTextUnavailable: { color: "#914d26" },
  productPrice: { color: "#2d6752", fontSize: 16, fontWeight: "900", marginTop: 7 },
  productMeta: { color: "#62706b", fontSize: 11, fontWeight: "800", marginTop: 3 },
  productDescription: { color: "#74807b", fontSize: 11, lineHeight: 16, marginTop: 5 },
  productUpdated: { color: "#9a7c5d", fontSize: 9, fontWeight: "800", marginTop: 5 },
  productActions: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: "#ebe7df", paddingTop: 11, marginTop: 12 },
  editButton: { flex: 1.35, minHeight: 39, borderRadius: 13, backgroundColor: "#22312d", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  editButtonText: { color: "#ffffff", fontSize: 11, fontWeight: "900" },
  pauseButton: { flex: 1, minHeight: 39, borderRadius: 13, borderWidth: 1, borderColor: "#dfd1c2", backgroundColor: "#f5eee6", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  pauseButtonText: { color: "#765f49", fontSize: 11, fontWeight: "900" },
  deleteButton: { width: 39, height: 39, borderRadius: 13, backgroundColor: "#feeceb", alignItems: "center", justifyContent: "center" },
});
