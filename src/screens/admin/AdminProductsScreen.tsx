import { useCallback, useEffect, useState } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Searchbar, SegmentedButtons } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { useResponsive } from "@/utils/responsive";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";

type FilterType = "all" | "available" | "soldout" | "hidden";

type Variation = {
  name: string;
  imageUrl?: string | null;
};

type GalleryImage = {
  imageUrl: string;
  displayOrder?: number;
};

type ProductRow = {
  id: string;
  shopId: string;
  name: string;
  description?: string | null;
  price: string | number;
  stock: number;
  imageUrl?: string | null;
  hasVariations?: boolean;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  shopName: string;
  ownerName?: string;
  ownerEmail?: string;
  variations: Variation[];
  galleryImages: GalleryImage[];
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "available", label: "Available" },
  { value: "soldout", label: "Sold Out" },
  { value: "hidden", label: "Hidden" },
];

const formatTimestamp = (value: any) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, { hour12: true });
};

export default function AdminProductsScreen() {
  const { isDesktop } = useResponsive();
  const [items, setItems] = useState<ProductRow[]>([]);
  const [filteredItems, setFilteredItems] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [selectedItem, setSelectedItem] = useState<ProductRow | null>(null);

  const applyFilters = useCallback((allItems: ProductRow[], search: string, filter: FilterType) => {
    let result = [...allItems];

    if (filter === "available") {
      result = result.filter((item) => item.active && item.stock > 0);
    } else if (filter === "soldout") {
      result = result.filter((item) => item.stock <= 0);
    } else if (filter === "hidden") {
      result = result.filter((item) => !item.active);
    }

    if (search.trim()) {
      const lower = search.trim().toLowerCase();
      result = result.filter((item) =>
        [item.name, item.shopName, item.ownerName, item.ownerEmail]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(lower))
      );
    }

    setFilteredItems(result);
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("funeral_products")
        .select(`
          *,
          funeral_shops!inner (
            "shopName",
            users!funeral_shops_id_fkey ( email, "fullName" )
          ),
          funeral_product_variations ( name, imageUrl ),
          funeral_product_images ( imageUrl, displayOrder )
        `)
        .order("createdAt", { ascending: false });

      if (error) throw error;

      const nextItems: ProductRow[] = (data || []).map((row: any) => ({
        id: row.id,
        shopId: row.shopId,
        name: row.name || "Untitled product",
        description: row.description || null,
        price: row.price != null ? String(row.price) : "0",
        stock: Number(row.stock) || 0,
        imageUrl: row.imageUrl || null,
        hasVariations: Boolean(row.hasVariations),
        active: Boolean(row.active),
        createdAt: row.createdAt || "",
        updatedAt: row.updatedAt || "",
        shopName: row.funeral_shops?.shopName || "Unnamed shop",
        ownerName: row.funeral_shops?.users?.fullName || "",
        ownerEmail: row.funeral_shops?.users?.email || "",
        variations: row.funeral_product_variations || [],
        galleryImages: row.funeral_product_images || [],
      }));

      setItems(nextItems);
      applyFilters(nextItems, searchQuery, filterType);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load products.");
    }
  }, [applyFilters, filterType, searchQuery]);

  useEffect(() => {
    setLoading(true);
    void loadProducts().finally(() => setLoading(false));
  }, [loadProducts]);

  const refreshProducts = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadProducts();
    } finally {
      setRefreshing(false);
    }
  }, [loadProducts]);

  const renderItem = ({ item }: { item: ProductRow }) => {
    const status = !item.active
      ? { label: "Hidden", background: "#f1f5f9", text: "#64748b" }
      : item.stock > 0
        ? { label: "Available", background: "#e7f5ec", text: "#166534" }
        : { label: "Sold Out", background: "#fef3c7", text: "#86654a" };

    return (
      <TouchableOpacity style={styles.itemCard} activeOpacity={0.85} onPress={() => setSelectedItem(item)}>
        <View style={styles.itemTopRow}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Text style={styles.thumbPlaceholderText}>No img</Text>
            </View>
          )}
          <View style={styles.itemTextBlock}>
            <Text style={styles.itemTitle}>{item.name}</Text>
            <Text style={styles.itemMeta}>Shop: {item.shopName || "Unknown"}</Text>
            <Text style={styles.itemMeta}>Owner: {item.ownerName || item.ownerEmail || "Unknown"}</Text>
            <Text style={styles.itemMeta}>
              Price: {formatPhilippinePeso(item.price)} • Stock: {item.stock}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: status.background }]}>
            <Text style={[styles.statusBadgeText, { color: status.text }]}>{status.label}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <LoadingBird fullScreen />;
  }

  return (
    <View style={[styles.container, isDesktop && styles.containerDesktop]}>
      <Text style={styles.title}>All Shop Products</Text>
      <Text style={styles.subtitle}>Includes hidden and sold-out listings.</Text>

      <Searchbar
        placeholder="Search by product, shop, or owner"
        value={searchQuery}
        onChangeText={(value) => {
          setSearchQuery(value);
          applyFilters(items, value, filterType);
        }}
        style={styles.searchbar}
      />

      <SegmentedButtons
        value={filterType}
        onValueChange={(value) => {
          const nextFilter = value as FilterType;
          setFilterType(nextFilter);
          applyFilters(items, searchQuery, nextFilter);
        }}
        buttons={FILTER_OPTIONS}
      />

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={refreshProducts}
        ListEmptyComponent={<Text style={styles.emptyText}>No products found.</Text>}
      />

      <Modal
        visible={Boolean(selectedItem)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {selectedItem ? (
                <>
                  <Text style={styles.modalTitle}>{selectedItem.name}</Text>
                  <Text style={styles.modalSubtitle}>
                    {selectedItem.shopName} • {selectedItem.ownerName || selectedItem.ownerEmail || "Unknown owner"}
                  </Text>

                  {selectedItem.imageUrl ? (
                    <Image source={{ uri: selectedItem.imageUrl }} style={styles.modalMainImage} resizeMode="cover" />
                  ) : null}

                  {selectedItem.galleryImages.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.galleryRow}>
                      {selectedItem.galleryImages.map((image, index) => (
                        <Image key={index} source={{ uri: image.imageUrl }} style={styles.galleryImage} resizeMode="cover" />
                      ))}
                    </ScrollView>
                  ) : null}

                  <Text style={styles.detailLabel}>Price</Text>
                  <Text style={styles.detailValue}>{formatPhilippinePeso(selectedItem.price)}</Text>

                  <Text style={styles.detailLabel}>Stock</Text>
                  <Text style={styles.detailValue}>{selectedItem.stock}</Text>

                  <Text style={styles.detailLabel}>Status</Text>
                  <Text style={styles.detailValue}>
                    {selectedItem.active ? (selectedItem.stock > 0 ? "Available" : "Sold Out") : "Hidden"}
                  </Text>

                  <Text style={styles.detailLabel}>Description</Text>
                  <Text style={styles.detailValue}>{selectedItem.description || "No description."}</Text>

                  {selectedItem.variations.length > 0 ? (
                    <>
                      <Text style={styles.detailLabel}>Variations</Text>
                      {selectedItem.variations.map((variation, index) => (
                        <View key={index} style={styles.variationRow}>
                          <Text style={styles.detailValue}>{variation.name}</Text>
                          {variation.imageUrl ? (
                            <Image source={{ uri: variation.imageUrl }} style={styles.variationImage} resizeMode="cover" />
                          ) : null}
                        </View>
                      ))}
                    </>
                  ) : null}

                  <Text style={styles.detailLabel}>Product ID</Text>
                  <Text style={styles.detailValue}>{selectedItem.id}</Text>

                  <Text style={styles.detailLabel}>Shop ID</Text>
                  <Text style={styles.detailValue}>{selectedItem.shopId}</Text>

                  <Text style={styles.detailLabel}>Created</Text>
                  <Text style={styles.detailValue}>{formatTimestamp(selectedItem.createdAt)}</Text>

                  <Text style={styles.detailLabel}>Last Updated</Text>
                  <Text style={styles.detailValue}>{formatTimestamp(selectedItem.updatedAt)}</Text>

                  <TouchableOpacity style={styles.closeButton} onPress={() => setSelectedItem(null)}>
                    <Text style={styles.closeButtonText}>Close</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#f5f5f5",
  },
  containerDesktop: {
    maxWidth: 920,
    width: "100%",
    alignSelf: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#334155",
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
    color: "#4b5563",
    lineHeight: 20,
  },
  searchbar: {
    marginBottom: 10,
  },
  listContent: {
    paddingTop: 10,
    paddingBottom: 24,
    gap: 10,
  },
  itemCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 12,
  },
  itemTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
  },
  thumbPlaceholder: {
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbPlaceholderText: {
    fontSize: 10,
    color: "#94a3b8",
    fontWeight: "700",
  },
  itemTextBlock: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
  },
  itemMeta: {
    color: "#475569",
    lineHeight: 19,
    fontSize: 13,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "900",
  },
  emptyText: {
    textAlign: "center",
    color: "#64748b",
    marginTop: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "88%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 18,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
  },
  modalSubtitle: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
    marginBottom: 12,
  },
  modalMainImage: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    marginBottom: 12,
  },
  galleryRow: {
    marginBottom: 10,
  },
  galleryImage: {
    width: 90,
    height: 90,
    borderRadius: 10,
    marginRight: 8,
  },
  detailLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 10,
    marginBottom: 4,
  },
  detailValue: {
    color: "#334155",
    fontSize: 14,
    lineHeight: 20,
  },
  variationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
  },
  variationImage: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  closeButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: "#eef1ec",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  closeButtonText: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "900",
  },
});
