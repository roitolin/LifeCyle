import { useCallback, useMemo, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  Alert,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton } from "@/components";
import { supabase } from "@/services/supabaseClient";
import { auth } from "@/services";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { colors, radii, spacing } from "@/theme";

const PHOTO_SLOT_COUNT = 5;

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

function getProductImages(item?: ShopProduct | null) {
  if (!item) return [];
  const source = item.galleryImageUrls?.length ? item.galleryImageUrls : item.imageUrl ? [item.imageUrl] : [];
  return source.filter((url): url is string => Boolean(url)).slice(0, PHOTO_SLOT_COUNT);
}

function formatDate(value: string) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function getAvailabilityLabel(item?: ShopProduct | null) {
  if (!item) return "Unknown";
  if (!item.active) return "Paused";
  return (item.stock ?? 0) > 0 ? "Available" : "Sold out";
}

export default function FuneralProductDetailsScreen({ navigation, route }: any) {
  const { width } = useWindowDimensions();
  const productId = typeof route?.params?.productId === "string" ? route.params.productId : null;
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<ShopProduct | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const load = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      Alert.alert("Login Required", "You need to be logged in to view this product.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
      return;
    }

    setLoading(true);
    try {
      const { data: productRows } = await supabase
        .from("funeral_products")
        .select(`
          *,
          funeral_product_variations ( id, name, imageUrl ),
          funeral_product_images ( id, imageUrl, displayOrder )
        `)
        .eq("shopId", user.uid);

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

      const current = productId ? nextProducts.find((entry) => entry.id === productId) : null;
      if (!current) {
        Alert.alert("Not found", "This product could not be found.", [
          { text: "OK", onPress: () => navigation.goBack() },
        ]);
        return;
      }

      setProduct(current);
      setActiveImageIndex(0);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load product details.");
    } finally {
      setLoading(false);
    }
  }, [navigation, productId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const productImages = useMemo(() => getProductImages(product), [product]);
  const uploadedCount = productImages.length;
  const variations = useMemo(
    () => (product?.hasVariations && Array.isArray(product.variations) ? product.variations : []),
    [product]
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <LoadingBird fullScreen />
      </SafeAreaView>
    );
  }

  if (!product) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.emptyWrap}>
          <Ionicons name="cube-outline" size={24} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Product not found</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const openEditor = () => {
    navigation.navigate("ProductEditor", { productId: product.id });
  };

  const mediaWidth = Math.max(width - spacing.xxl, 1);
  const mediaHeight = Math.min(mediaWidth * 0.76, 320);
  const availabilityLabel = getAvailabilityLabel(product);
  const isSoldOut = product.active && (product.stock ?? 0) <= 0;

  const handleGalleryScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (productImages.length <= 1) return;
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / mediaWidth);
    setActiveImageIndex(Math.min(Math.max(nextIndex, 0), productImages.length - 1));
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <AppBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle} numberOfLines={1}>Product details</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.mediaFrame, { height: mediaHeight }]}>
          {productImages.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              bounces={false}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleGalleryScroll}
            >
              {productImages.map((imageUrl, index) => (
                <Image
                  key={`${product.id}_photo_${index}`}
                  accessibilityLabel={`${product.name} photo ${index + 1} of ${uploadedCount}`}
                  source={{ uri: imageUrl }}
                  style={[styles.productImage, { width: mediaWidth, height: mediaHeight }]}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.mediaFallback}>
              <Ionicons name="image-outline" size={24} color={colors.textMuted} />
              <Text style={styles.mediaFallbackText}>No product photo</Text>
            </View>
          )}

          {productImages.length > 1 ? (
            <View style={styles.galleryCounter}>
              <Text style={styles.galleryCounterText}>
                {activeImageIndex + 1} / {uploadedCount}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.productSummary}>
          <Text style={styles.productName}>{product.name || "Untitled product"}</Text>
          <View style={styles.priceStatusRow}>
            <Text style={styles.productPrice}>{formatPhilippinePeso(product.price)}</Text>
            <View style={styles.statusBadge}>
              <View
                style={[
                  styles.statusDot,
                  !product.active ? styles.statusDotPaused : null,
                  isSoldOut ? styles.statusDotSoldOut : null,
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  !product.active ? styles.statusTextPaused : null,
                  isSoldOut ? styles.statusTextSoldOut : null,
                ]}
              >
                {availabilityLabel}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.quickFacts}>
          <View style={styles.quickFact}>
            <Text style={styles.quickFactLabel}>Type</Text>
            <Text style={styles.quickFactValue}>Casket</Text>
          </View>
          <View style={styles.quickFactDivider} />
          <View style={styles.quickFact}>
            <Text style={styles.quickFactLabel}>Stock</Text>
            <Text style={styles.quickFactValue}>{String(product.stock ?? 0)}</Text>
          </View>
          <View style={styles.quickFactDivider} />
          <View style={styles.quickFact}>
            <Text style={styles.quickFactLabel}>Variations</Text>
            <Text style={styles.quickFactValue}>
              {product.hasVariations ? String(variations.length) : "None"}
            </Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.descriptionText}>
            {product.description || "No description has been added for this product."}
          </Text>
        </View>

        {product.hasVariations ? (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle}>Variations</Text>
              <Text style={styles.sectionCount}>{variations.length}</Text>
            </View>

            {variations.length === 0 ? (
              <View style={styles.emptyVariationRow}>
                <Ionicons name="layers-outline" size={20} color={colors.textMuted} />
                <Text style={styles.emptyVariationText}>No variations have been added yet.</Text>
              </View>
            ) : (
              variations.map((variation, index) => (
                <View key={`${product.id}_variation_${index}`}>
                  {index > 0 ? <View style={styles.listDivider} /> : null}
                  <View style={styles.variationRow}>
                    {variation.imageUrl ? (
                      <Image source={{ uri: variation.imageUrl }} style={styles.variationImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.variationImageFallback}>
                        <Ionicons name="image-outline" size={20} color={colors.textMuted} />
                      </View>
                    )}
                    <View style={styles.variationCopy}>
                      <Text style={styles.variationName}>{variation.name || "Unnamed variation"}</Text>
                      <Text style={styles.variationMeta}>Option {index + 1}</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Listing</Text>

          <View style={styles.listingRow}>
            <Ionicons
              name={product.active ? "eye-outline" : "eye-off-outline"}
              size={20}
              color={colors.primary}
            />
            <View style={styles.listingCopy}>
              <Text style={styles.listingLabel}>Visibility</Text>
              <Text style={styles.listingValue}>{product.active ? "Visible to buyers" : "Hidden from buyers"}</Text>
            </View>
          </View>
          <View style={styles.listDivider} />
          <View style={styles.listingRow}>
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            <View style={styles.listingCopy}>
              <Text style={styles.listingLabel}>Created</Text>
              <Text style={styles.listingValue}>{formatDate(product.createdAt)}</Text>
            </View>
          </View>
          <View style={styles.listDivider} />
          <View style={styles.listingRow}>
            <Ionicons name="time-outline" size={20} color={colors.primary} />
            <View style={styles.listingCopy}>
              <Text style={styles.listingLabel}>Last updated</Text>
              <Text style={styles.listingValue}>{formatDate(product.updatedAt)}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Edit product"
          activeOpacity={0.84}
          style={styles.primaryButton}
          onPress={openEditor}
        >
          <Ionicons name="create-outline" size={18} color={colors.surface} />
          <Text style={styles.primaryButtonText}>Edit product</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  header: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderWarm,
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  mediaFrame: {
    width: "100%",
    overflow: "hidden",
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderWarm,
  },
  productImage: {
    backgroundColor: colors.surfaceMuted,
  },
  mediaFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  mediaFallbackText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  galleryCounter: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryDark,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  galleryCounterText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "800",
  },
  productSummary: {
    gap: spacing.sm,
  },
  productName: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "800",
  },
  priceStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  productPrice: {
    flexShrink: 1,
    color: colors.primary,
    fontSize: 20,
    fontWeight: "800",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  statusDotPaused: {
    backgroundColor: colors.warning,
  },
  statusDotSoldOut: {
    backgroundColor: colors.danger,
  },
  statusText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  statusTextPaused: {
    color: colors.warning,
  },
  statusTextSoldOut: {
    color: colors.danger,
  },
  quickFacts: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    paddingVertical: spacing.lg,
  },
  quickFact: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: spacing.sm,
  },
  quickFactDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.borderWarm,
  },
  quickFactLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  quickFactValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  sectionCard: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    padding: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  sectionHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionCount: {
    minWidth: 24,
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  descriptionText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.md,
  },
  emptyVariationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  emptyVariationText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  variationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  variationImage: {
    width: 64,
    height: 64,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  variationImageFallback: {
    width: 64,
    height: 64,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  variationCopy: {
    flex: 1,
  },
  variationName: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
  },
  variationMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.xs,
  },
  listDivider: {
    height: 1,
    backgroundColor: colors.borderWarm,
  },
  listingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  listingCopy: {
    flex: 1,
  },
  listingLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  listingValue: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
});
