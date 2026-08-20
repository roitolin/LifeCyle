import { useCallback, useMemo, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton, KeyboardAwareScrollView } from "@/components";
import { supabase } from "@/services/supabaseClient";
import { auth } from "@/services";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";

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

function normalizeProductImages(item?: ShopProduct | null) {
  if (!item) return Array<string | null>(PHOTO_SLOT_COUNT).fill(null);
  const source = item.galleryImageUrls?.length ? item.galleryImageUrls : item.imageUrl ? [item.imageUrl] : [];
  const next = Array<string | null>(PHOTO_SLOT_COUNT).fill(null);
  source.slice(0, PHOTO_SLOT_COUNT).forEach((url, index) => {
    next[index] = url || null;
  });
  return next;
}

function formatDate(value: string) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString(undefined, { hour12: true });
}

function getAvailabilityLabel(item?: ShopProduct | null) {
  if (!item) return "Unknown";
  if (!item.active) return "Paused (hidden from buyers)";
  return (item.stock ?? 0) > 0 ? "Available" : "Sold Out";
}

export default function FuneralProductDetailsScreen({ navigation, route }: any) {
  const productId = typeof route?.params?.productId === "string" ? route.params.productId : null;
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<ShopProduct | null>(null);

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

  const productImages = useMemo(() => normalizeProductImages(product), [product]);
  const uploadedCount = useMemo(() => productImages.filter(Boolean).length, [productImages]);
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
          <Ionicons name="cube-outline" size={38} color="#8a928d" />
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

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <AppBackButton style={styles.backButtonSpacing} onPress={() => navigation.goBack()} />

          <Text style={styles.heroEyebrow}>Product Overview</Text>
          <Text style={styles.heroTitle}>Product Details</Text>
          <Text style={styles.heroSubtitle}>
            Review the full listing at a glance, including every uploaded photo and all of the product information.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Product Photos</Text>
          <Text style={styles.sectionSubtitle}>Swipe through every uploaded photo. Slot 1 is the main display image.</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
            {productImages.map((imageUrl, index) => {
              const slotLabel = index === 0 ? "Main Photo" : `Angle ${index + 1}`;
              return (
                <View key={`${product.id}_photo_${index}`} style={styles.photoCard}>
                  <View style={styles.photoBadge}>
                    <Text style={styles.photoBadgeText}>{slotLabel}</Text>
                  </View>

                  {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={styles.photoPreview} resizeMode="cover" />
                  ) : (
                    <View style={styles.photoPlaceholder}>
                      <Ionicons name="image-outline" size={26} color="#a9b2ac" />
                      <Text style={styles.photoPlaceholderText}>No photo</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <Text style={styles.photoCounter}>{uploadedCount} of {PHOTO_SLOT_COUNT} photos uploaded</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Product Details</Text>
          <Text style={styles.sectionSubtitle}>The casket name, price, stock, variations, and description.</Text>

          <Text style={styles.inputLabel}>Product Name</Text>
          <View style={styles.staticField}>
            <Text style={styles.staticFieldText}>{product.name || "Untitled Product"}</Text>
          </View>

          <Text style={styles.inputLabel}>Price</Text>
          <View style={styles.staticField}>
            <Text style={styles.staticFieldText}>{formatPhilippinePeso(product.price)}</Text>
          </View>

          <View style={styles.row}>
            <View style={styles.rowField}>
              <Text style={styles.inputLabel}>Stock</Text>
              <View style={styles.staticField}>
                <Text style={styles.staticFieldText}>{String(product.stock ?? 0)}</Text>
              </View>
            </View>
            <View style={styles.rowField}>
              <Text style={styles.inputLabel}>Product Type</Text>
              <View style={styles.staticField}>
                <Text style={styles.staticFieldText}>Casket</Text>
              </View>
            </View>
          </View>

          <Text style={styles.inputLabel}>Has Variations?</Text>
          <View style={styles.toggleRow}>
            <View style={[styles.toggleButton, !product.hasVariations ? styles.toggleButtonActive : null]}>
              <Text style={[styles.toggleButtonText, !product.hasVariations ? styles.toggleButtonTextActive : null]}>Off</Text>
            </View>
            <View style={[styles.toggleButton, product.hasVariations ? styles.toggleButtonActive : null]}>
              <Text style={[styles.toggleButtonText, product.hasVariations ? styles.toggleButtonTextActive : null]}>On</Text>
            </View>
          </View>

          {product.hasVariations ? (
            <View style={styles.variationSection}>
              <Text style={styles.variationHeading}>Casket Variations</Text>
              <Text style={styles.variationSubheading}>Each variation shown with its name and photo.</Text>

              {variations.length === 0 ? (
                <View style={styles.variationCard}>
                  <Text style={styles.variationEmptyText}>No variations recorded yet.</Text>
                </View>
              ) : (
                variations.map((variation, index) => (
                  <View key={`${product.id}_variation_${index}`} style={styles.variationCard}>
                    <Text style={styles.variationCardTitle}>Variation {index + 1}</Text>

                    <Text style={styles.inputLabel}>Variation Name</Text>
                    <View style={styles.staticField}>
                      <Text style={styles.staticFieldText}>{variation.name || "Unnamed variation"}</Text>
                    </View>

                    {variation.imageUrl ? (
                      <Image source={{ uri: variation.imageUrl }} style={styles.variationImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.variationImagePlaceholder}>
                        <Ionicons name="image-outline" size={24} color="#a9b2ac" />
                        <Text style={styles.photoPlaceholderText}>No photo</Text>
                      </View>
                    )}
                  </View>
                ))
              )}
            </View>
          ) : null}

          <Text style={styles.inputLabel}>Product Description</Text>
          <View style={[styles.staticField, styles.multilineField]}>
            <Text style={styles.multilineFieldText}>{product.description || "No description provided."}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Listing Status</Text>
          <Text style={styles.sectionSubtitle}>Availability and history for this product.</Text>

          <View style={styles.detailRow}>
            <View style={styles.detailIconWrap}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#7f6653" />
            </View>
            <View style={styles.detailCopy}>
              <Text style={styles.detailLabel}>Availability</Text>
              <Text style={styles.detailValue}>{getAvailabilityLabel(product)}</Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <View style={styles.detailIconWrap}>
              <Ionicons name="calendar-outline" size={16} color="#7f6653" />
            </View>
            <View style={styles.detailCopy}>
              <Text style={styles.detailLabel}>Created</Text>
              <Text style={styles.detailValue}>{formatDate(product.createdAt)}</Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <View style={styles.detailIconWrap}>
              <Ionicons name="time-outline" size={16} color="#7f6653" />
            </View>
            <View style={styles.detailCopy}>
              <Text style={styles.detailLabel}>Last Updated</Text>
              <Text style={styles.detailValue}>{formatDate(product.updatedAt)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.actionStack}>
          <TouchableOpacity style={styles.primaryButton} onPress={openEditor}>
            <Ionicons name="create-outline" size={18} color="#ffffff" />
            <Text style={styles.primaryButtonText}>Edit Product</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostButton} onPress={() => navigation.goBack()}>
            <Text style={styles.ghostButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef1ec",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
  },
  emptyTitle: {
    color: "#22312d",
    fontSize: 18,
    fontWeight: "900",
  },
  content: {
    padding: 20,
    paddingBottom: 120,
    gap: 16,
  },
  heroCard: {
    borderRadius: 28,
    backgroundColor: "#d6e2d2",
    padding: 20,
  },
  backButtonSpacing: {
    marginBottom: 18,
  },
  heroEyebrow: {
    color: "#86654a",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  heroTitle: {
    color: "#22312d",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 6,
  },
  heroSubtitle: {
    color: "#53615d",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  card: {
    borderRadius: 24,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 16,
  },
  sectionTitle: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
  },
  sectionSubtitle: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
    marginBottom: 14,
  },
  photoRow: {
    gap: 12,
    paddingRight: 4,
  },
  photoCard: {
    width: 186,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 12,
  },
  photoBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#e4ece0",
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
  },
  photoBadgeText: {
    color: "#86654a",
    fontSize: 11,
    fontWeight: "900",
  },
  photoPreview: {
    width: "100%",
    height: 154,
    borderRadius: 16,
  },
  photoPlaceholder: {
    width: "100%",
    height: 154,
    borderRadius: 16,
    backgroundColor: "#ebf1e8",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  photoPlaceholderText: {
    color: "#a9b2ac",
    fontSize: 11,
    fontWeight: "700",
  },
  photoCounter: {
    color: "#86908a",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 12,
  },
  inputLabel: {
    color: "#53615d",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 6,
    marginTop: 6,
  },
  staticField: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 16,
    backgroundColor: "#fbfaf7",
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: "center",
  },
  staticFieldText: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "800",
  },
  multilineField: {
    minHeight: 120,
  },
  multilineFieldText: {
    color: "#22312d",
    fontSize: 14,
    lineHeight: 21,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  rowField: {
    flex: 1,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  toggleButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleButtonActive: {
    backgroundColor: "#22312d",
    borderColor: "#22312d",
  },
  toggleButtonText: {
    color: "#62706b",
    fontSize: 13,
    fontWeight: "900",
  },
  toggleButtonTextActive: {
    color: "#ffffff",
  },
  variationSection: {
    marginTop: 16,
    gap: 12,
  },
  variationHeading: {
    color: "#22312d",
    fontSize: 16,
    fontWeight: "900",
  },
  variationSubheading: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 20,
  },
  variationCard: {
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 14,
  },
  variationCardTitle: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "900",
  },
  variationEmptyText: {
    color: "#62706b",
    fontSize: 13,
  },
  variationImage: {
    width: "100%",
    height: 170,
    borderRadius: 16,
    marginTop: 12,
  },
  variationImagePlaceholder: {
    width: "100%",
    height: 170,
    borderRadius: 16,
    backgroundColor: "#ebf1e8",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0e6da",
  },
  detailIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#e4ece0",
    alignItems: "center",
    justifyContent: "center",
  },
  detailCopy: {
    flex: 1,
  },
  detailLabel: {
    color: "#86654a",
    fontSize: 12,
    fontWeight: "800",
  },
  detailValue: {
    color: "#292524",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
  },
  actionStack: {
    gap: 10,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  ghostButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#ece9e3",
    alignItems: "center",
    justifyContent: "center",
  },
  ghostButtonText: {
    color: "#62706b",
    fontSize: 14,
    fontWeight: "800",
  },
});
