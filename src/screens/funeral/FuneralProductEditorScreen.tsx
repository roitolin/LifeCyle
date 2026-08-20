import { useEffect, useMemo, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton, KeyboardAwareScrollView } from "@/components";
import { supabase } from "@/services/supabaseClient";
import { generateId } from "@/utils/generateId";
import * as ImagePicker from "expo-image-picker";
import { auth, uploadCertificate } from "@/services";
import { normalizePesoInput } from "@/utils/funeralCatalog";

const PHOTO_SLOT_COUNT = 5;
const MAX_VARIATION_COUNT = 4;

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

function normalizeVariations(item?: ShopProduct | null) {
  if (!item?.hasVariations || !Array.isArray(item.variations)) return [];
  return item.variations.map((entry) => ({
    name: String(entry?.name || ""),
    imageUrl: entry?.imageUrl || null,
  }));
}

async function notifyShopFollowersOnNewProduct(
  shopId: string,
  shopName: string,
  productId: string,
  productName: string
) {
  try {
    const { data: followers } = await supabase
      .from("shop_follows")
      .select("userId")
      .eq("shopId", shopId);
    if (!followers || followers.length === 0) return;

    const rows = followers.map((follower: { userId: string }) => ({
      userId: follower.userId,
      type: "funeral_new_product",
      title: `New product from ${shopName}`,
      body: `${shopName} just added "${productName}". View it now.`,
      data: { productId, shopId, shopName },
      read: false,
    }));
    await supabase.from("notifications").insert(rows);
  } catch (error) {
    console.warn("Failed to notify shop followers:", error);
  }
}

export default function FuneralProductEditorScreen({ navigation, route }: any) {
  const productId = typeof route?.params?.productId === "string" ? route.params.productId : null;
  const isEditing = Boolean(productId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productStock, setProductStock] = useState("1");
  const [hasVariations, setHasVariations] = useState(false);
  const [variationCount, setVariationCount] = useState(1);
  const [variationEntries, setVariationEntries] = useState<ProductVariation[]>([]);
  const [productDescription, setProductDescription] = useState("");
  const [productImages, setProductImages] = useState<(string | null)[]>((Array<string | null>(PHOTO_SLOT_COUNT).fill(null)));

  useEffect(() => {
    const load = async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
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
        if (productId) {
          const current = nextProducts.find((entry) => entry.id === productId);
          if (!current) {
            Alert.alert("Not found", "This product could not be found.");
            navigation.goBack();
            return;
          }

          setProductName(current.name || "");
          setProductPrice(current.price || "");
          setProductStock(String(current.stock ?? 1));
          const nextVariations = normalizeVariations(current);
          setHasVariations(Boolean(current.hasVariations && nextVariations.length));
          setVariationCount(nextVariations.length || 1);
          setVariationEntries(nextVariations);
          setProductDescription(current.description || "");
          setProductImages(normalizeProductImages(current));
        }
      } catch (error) {
        console.error(error);
        Alert.alert("Error", "Failed to load product editor.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [navigation, productId]);

  const uploadedCount = useMemo(() => productImages.filter(Boolean).length, [productImages]);

  const pickAndUploadImage = async (index: number) => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.75,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingIndex(index);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setProductImages((current) => current.map((entry, currentIndex) => (currentIndex === index ? url : entry)));
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Failed to upload product image.");
    } finally {
      setUploadingIndex(null);
    }
  };

  const removeImage = (index: number) => {
    setProductImages((current) => current.map((entry, currentIndex) => (currentIndex === index ? null : entry)));
  };

  const updateVariationCount = (count: number) => {
    setVariationCount(count);
    setVariationEntries((current) => {
      const next = Array.from({ length: count }, (_, index) => current[index] || { name: "", imageUrl: null });
      return next;
    });
  };

  const updateVariationField = (index: number, field: keyof ProductVariation, value: string | null) => {
    setVariationEntries((current) =>
      current.map((entry, currentIndex) => (currentIndex === index ? { ...entry, [field]: value } : entry))
    );
  };

  const pickAndUploadVariationImage = async (index: number) => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.75,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingIndex(PHOTO_SLOT_COUNT + index);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      updateVariationField(index, "imageUrl", url);
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Failed to upload variation image.");
    } finally {
      setUploadingIndex(null);
    }
  };

  const saveProduct = async () => {
    const user = auth.currentUser;
    if (!user) return;

    if (!productName.trim() || !productPrice.trim()) {
      Alert.alert("Missing fields", "Product name and price are required.");
      return;
    }

    const stockValue = Number(productStock);
    if (!Number.isFinite(stockValue) || stockValue < 0) {
      Alert.alert("Invalid stock", "Stock must be 0 or higher.");
      return;
    }

    if (uploadedCount < PHOTO_SLOT_COUNT) {
      Alert.alert("More photos needed", "Please upload all 5 product photos so buyers can swipe through each angle.");
      return;
    }

    const normalizedVariations = hasVariations ? variationEntries.slice(0, variationCount) : [];
    if (hasVariations) {
      const hasInvalidVariation = normalizedVariations.some((entry) => !entry.name.trim() || !entry.imageUrl);
      if (hasInvalidVariation) {
        Alert.alert("Variation incomplete", "Each casket variation needs a variation name and one photo.");
        return;
      }
    }

    const galleryImageUrls = productImages.filter((entry): entry is string => Boolean(entry));
    const finalProductId = productId || generateId();

    setSaving(true);
    try {
      // Upsert the product row
      const { error: productError } = await supabase.from("funeral_products").upsert({
        id: finalProductId,
        shopId: user.uid,
        name: productName.trim(),
        description: productDescription.trim(),
        price: Number(productPrice.trim().replace(/[^\d.]/g, "")) || 0,
        stock: stockValue,
        imageUrl: galleryImageUrls[0] || null,
        hasVariations,
        active: stockValue > 0,
        updatedAt: new Date().toISOString(),
      });
      if (productError) throw productError;

      // Replace gallery images: delete old, insert new
      await supabase.from("funeral_product_images").delete().eq("productId", finalProductId);
      if (galleryImageUrls.length > 0) {
        const imageRows = galleryImageUrls.map((url, index) => ({
          productId: finalProductId,
          imageUrl: url,
          displayOrder: index,
        }));
        await supabase.from("funeral_product_images").insert(imageRows);
      }

      // Replace variations: delete old, insert new
      await supabase.from("funeral_product_variations").delete().eq("productId", finalProductId);
      if (hasVariations && normalizedVariations.length > 0) {
        const variationRows = normalizedVariations.map((entry) => ({
          productId: finalProductId,
          name: entry.name.trim(),
          imageUrl: entry.imageUrl || null,
        }));
        await supabase.from("funeral_product_variations").insert(variationRows);
      }

      if (!isEditing && stockValue > 0) {
        const { data: shopRow } = await supabase
          .from("funeral_shops")
          .select("shopName")
          .eq("id", user.uid)
          .maybeSingle();
        await notifyShopFollowersOnNewProduct(
          user.uid,
          shopRow?.shopName || "A funeral shop",
          finalProductId,
          productName.trim()
        );
      }

      Alert.alert("Saved", isEditing ? "Product updated." : "Product added.", [
        {
          text: "OK",
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to save product.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <LoadingBird fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <AppBackButton style={styles.backButtonSpacing} onPress={() => navigation.goBack()} />

          <Text style={styles.heroEyebrow}>Product Form</Text>
          <Text style={styles.heroTitle}>{isEditing ? "Edit Product" : "Add Product"}</Text>
          <Text style={styles.heroSubtitle}>
            Upload 5 product photos. The first image becomes the main product photo, and the rest can be swiped to show more angles.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Product Photos</Text>
          <Text style={styles.sectionSubtitle}>Fill all 5 photo slots. Slot 1 is the main display image.</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
            {productImages.map((imageUrl, index) => {
              const slotLabel = index === 0 ? "Main Photo" : `Angle ${index + 1}`;
              const isUploading = uploadingIndex === index;
              return (
                <View key={slotLabel} style={styles.photoCard}>
                  <View style={styles.photoBadge}>
                    <Text style={styles.photoBadgeText}>{slotLabel}</Text>
                  </View>

                  {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={styles.photoPreview} resizeMode="cover" />
                  ) : (
                    <View style={styles.photoPlaceholder}>
                      {isUploading ? <ActivityIndicator size="small" color="#22312d" /> : <Ionicons name="image-outline" size={26} color="#86908a" />}
                    </View>
                  )}

                  <TouchableOpacity style={styles.photoButton} onPress={() => void pickAndUploadImage(index)} disabled={isUploading}>
                    <Text style={styles.photoButtonText}>{imageUrl ? "Replace" : "Upload"}</Text>
                  </TouchableOpacity>

                  {imageUrl ? (
                    <TouchableOpacity style={styles.photoGhostButton} onPress={() => removeImage(index)}>
                      <Text style={styles.photoGhostButtonText}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          <Text style={styles.photoCounter}>{uploadedCount} of {PHOTO_SLOT_COUNT} photos uploaded</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Product Details</Text>
          <Text style={styles.sectionSubtitle}>Add the casket name, price, stock, optional variations, and description.</Text>

          <Text style={styles.inputLabel}>Product Name</Text>
          <TextInput style={styles.input} value={productName} onChangeText={setProductName} placeholder="Product name" />

          <Text style={styles.inputLabel}>Price</Text>
          <TextInput
            style={styles.input}
            value={productPrice}
            onChangeText={(value) => setProductPrice(normalizePesoInput(value))}
            placeholder="₱0"
            keyboardType="number-pad"
          />

          <View style={styles.row}>
            <View style={styles.rowField}>
              <Text style={styles.inputLabel}>Stock</Text>
              <TextInput style={styles.input} value={productStock} onChangeText={setProductStock} placeholder="Stock" keyboardType="number-pad" />
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
            <TouchableOpacity
              style={[styles.toggleButton, !hasVariations ? styles.toggleButtonActive : null]}
              onPress={() => {
                setHasVariations(false);
                setVariationEntries([]);
                setVariationCount(1);
              }}
            >
              <Text style={[styles.toggleButtonText, !hasVariations ? styles.toggleButtonTextActive : null]}>Off</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleButton, hasVariations ? styles.toggleButtonActive : null]}
              onPress={() => {
                setHasVariations(true);
                updateVariationCount(Math.max(variationCount, 1));
              }}
            >
              <Text style={[styles.toggleButtonText, hasVariations ? styles.toggleButtonTextActive : null]}>On</Text>
            </TouchableOpacity>
          </View>

          {hasVariations ? (
            <View style={styles.variationSection}>
              <Text style={styles.variationHeading}>Casket Variations</Text>
              <Text style={styles.variationSubheading}>Choose how many variations this casket has. Each variation needs only a name and one photo.</Text>

              <View style={styles.variationCountRow}>
                {Array.from({ length: MAX_VARIATION_COUNT }, (_, index) => index + 1).map((count) => (
                  <TouchableOpacity
                    key={count}
                    style={[styles.variationCountButton, variationCount === count ? styles.variationCountButtonActive : null]}
                    onPress={() => updateVariationCount(count)}
                  >
                    <Text style={[styles.variationCountButtonText, variationCount === count ? styles.variationCountButtonTextActive : null]}>{count}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {variationEntries.slice(0, variationCount).map((variation, index) => {
                const isUploading = uploadingIndex === PHOTO_SLOT_COUNT + index;
                return (
                  <View key={`variation_${index}`} style={styles.variationCard}>
                    <Text style={styles.variationCardTitle}>Variation {index + 1}</Text>

                    <Text style={styles.inputLabel}>Variation Name</Text>
                    <TextInput
                      style={styles.input}
                      value={variation.name}
                      onChangeText={(value) => updateVariationField(index, "name", value)}
                      placeholder="Example: Mahogany Gloss"
                    />

                    {variation.imageUrl ? (
                      <Image source={{ uri: variation.imageUrl }} style={styles.variationImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.variationImagePlaceholder}>
                        {isUploading ? <ActivityIndicator size="small" color="#22312d" /> : <Ionicons name="image-outline" size={24} color="#86908a" />}
                      </View>
                    )}

                    <TouchableOpacity style={styles.photoButton} onPress={() => void pickAndUploadVariationImage(index)} disabled={isUploading}>
                      <Text style={styles.photoButtonText}>{variation.imageUrl ? "Replace Variation Photo" : "Upload Variation Photo"}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.inputLabel}>Product Description</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            value={productDescription}
            onChangeText={setProductDescription}
            placeholder="Describe the casket material, finish, lining, and overall look."
            multiline
          />
        </View>

        <View style={styles.actionStack}>
          <TouchableOpacity style={styles.primaryButton} onPress={saveProduct} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#ffffff" /> : null}
            <Text style={styles.primaryButtonText}>{isEditing ? "Save Changes" : "Add Product"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostButton} onPress={() => navigation.goBack()} disabled={saving}>
            <Text style={styles.ghostButtonText}>Cancel</Text>
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
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: "#62706b",
    fontSize: 14,
    fontWeight: "700",
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
  },
  photoButton: {
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: "#d6e2d2",
    borderWidth: 1,
    borderColor: "#c3d0bf",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  photoButtonText: {
    color: "#22312d",
    fontSize: 13,
    fontWeight: "900",
  },
  photoGhostButton: {
    minHeight: 40,
    borderRadius: 14,
    backgroundColor: "#ece9e3",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  photoGhostButtonText: {
    color: "#62706b",
    fontSize: 13,
    fontWeight: "800",
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
  input: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 16,
    backgroundColor: "#fbfaf7",
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "#22312d",
  },
  staticField: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 16,
    backgroundColor: "#ebf1e8",
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
  multilineInput: {
    minHeight: 120,
    textAlignVertical: "top",
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
  variationCountRow: {
    flexDirection: "row",
    gap: 10,
  },
  variationCountButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },
  variationCountButtonActive: {
    backgroundColor: "#d6e2d2",
    borderColor: "#c3d0bf",
  },
  variationCountButtonText: {
    color: "#62706b",
    fontSize: 13,
    fontWeight: "900",
  },
  variationCountButtonTextActive: {
    color: "#22312d",
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
    marginTop: 12,
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

