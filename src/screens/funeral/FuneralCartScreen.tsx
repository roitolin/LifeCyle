import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ScrollViewInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { subscribeTabRefresh } from "@/utils/tabRefresh";
import {
  FuneralCartItem,
  loadFuneralCart,
  removeFuneralCartItems,
  updateFuneralCartQuantity,
} from "@/utils/funeralCart";
import { supabase } from "@/services";

type ShopGroup = {
  shopId: string;
  shopName: string;
  items: FuneralCartItem[];
};

function CircularCheckbox({
  checked,
  onPress,
  size = 22,
}: {
  checked: boolean;
  onPress: () => void;
  size?: number;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.checkboxBase,
        { width: size, height: size, borderRadius: size / 2 },
        checked ? styles.checkboxChecked : styles.checkboxUnchecked,
      ]}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      {checked ? (
        <Ionicons name="checkmark" size={size * 0.65} color="#ffffff" />
      ) : null}
    </TouchableOpacity>
  );
}

function ShopAvatar({ uri }: { uri?: string | null }) {
  const [hasError, setHasError] = useState(false);

  if (uri && !hasError) {
    return (
      <View style={styles.shopAvatarWrap}>
        <Image
          source={{ uri }}
          style={styles.shopAvatar}
          resizeMode="cover"
          onError={() => setHasError(true)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.shopAvatarWrap, styles.shopAvatarFallback]}>
      <Ionicons name="storefront" size={13} color="#315f50" />
    </View>
  );
}

export default function FuneralCartScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<FuneralCartItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [shopImageMap, setShopImageMap] = useState<Record<string, string | null>>({});
  const scrollRef = useRef<ScrollViewInstance>(null);

  // Hide the default navigation header so we render our custom clean top bar
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  const loadCart = useCallback(async () => {
    try {
      const next = await loadFuneralCart();
      setItems(next);
      setSelectedIds((current) => {
        const remaining = new Set<string>();
        current.forEach((cartId) => {
          if (next.some((item) => item.cartId === cartId)) remaining.add(cartId);
        });
        return remaining;
      });
      if (next.length === 0) {
        setIsEditing(false);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadCart();
      const unsubscribe = subscribeTabRefresh("Carts", () => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        setRefreshing(true);
        void loadCart();
      });
      return unsubscribe;
    }, [loadCart])
  );

  // Group items by shop
  const groupedShops: ShopGroup[] = useMemo(() => {
    const map = new Map<string, ShopGroup>();
    items.forEach((item) => {
      const key = item.shopId || "shop_general";
      const existing = map.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(key, {
          shopId: key,
          shopName: item.shopName || "Funeral Home",
          items: [item],
        });
      }
    });
    return Array.from(map.values());
  }, [items]);

  // Fetch shop profile images for each shop in cart
  useEffect(() => {
    const shopIds = groupedShops.map((s) => s.shopId).filter((id) => Boolean(id) && id !== "shop_general");
    if (shopIds.length === 0) return;

    const fetchShopProfiles = async () => {
      try {
        const { data } = await supabase
          .from("funeral_shops")
          .select("id, shopImageUrl, coverImageUrl")
          .in("id", shopIds);

        if (data && data.length > 0) {
          setShopImageMap((current) => {
            const next = { ...current };
            data.forEach((row: any) => {
              if (row.id) {
                next[row.id] = row.shopImageUrl || row.coverImageUrl || null;
              }
            });
            return next;
          });
        }
      } catch {
        // keep existing map
      }
    };

    void fetchShopProfiles();
  }, [groupedShops]);

  // Selected items calculation
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.cartId)),
    [items, selectedIds]
  );

  const selectedTotalPrice = useMemo(
    () =>
      selectedItems.reduce((sum, item) => {
        const numeric =
          Number(String(item.fullPrice || item.price || "").replace(/[^\d.]/g, "")) || 0;
        return sum + numeric * (item.quantity || 1);
      }, 0),
    [selectedItems]
  );

  const totalItemCount = useMemo(
    () => items.reduce((sum, item) => sum + (item.quantity || 1), 0),
    [items]
  );

  const selectedCount = selectedItems.length;

  // Selection handlers
  const isAllChecked = useMemo(
    () => items.length > 0 && items.every((it) => selectedIds.has(it.cartId)),
    [items, selectedIds]
  );

  const isShopChecked = useCallback(
    (shop: ShopGroup) => {
      if (shop.items.length === 0) return false;
      return shop.items.every((it) => selectedIds.has(it.cartId));
    },
    [selectedIds]
  );

  const toggleSelectItem = (cartId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cartId)) next.delete(cartId);
      else next.add(cartId);
      return next;
    });
  };

  const toggleSelectShop = (shop: ShopGroup) => {
    const allShopSelected = shop.items.every((it) => selectedIds.has(it.cartId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      shop.items.forEach((it) => {
        if (allShopSelected) {
          next.delete(it.cartId);
        } else {
          next.add(it.cartId);
        }
      });
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (isAllChecked) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((it) => it.cartId)));
    }
  };

  // Stepper handlers
  const handleDecreaseQuantity = async (item: FuneralCartItem) => {
    const currentQty = item.quantity || 1;
    if (currentQty > 1) {
      const next = await updateFuneralCartQuantity(item.cartId, currentQty - 1);
      setItems(next);
    } else {
      Alert.alert(
        "Remove Item",
        `Remove "${item.name}" from your cart?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              const next = await removeFuneralCartItems([item.cartId]);
              setItems(next);
              setSelectedIds((prev) => {
                const s = new Set(prev);
                s.delete(item.cartId);
                return s;
              });
            },
          },
        ]
      );
    }
  };

  const handleIncreaseQuantity = async (item: FuneralCartItem) => {
    const currentQty = item.quantity || 1;
    const next = await updateFuneralCartQuantity(item.cartId, currentQty + 1);
    setItems(next);
  };

  // Bulk delete selected items (Edit mode)
  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) {
      Alert.alert("Select Items", "Please select at least one item to remove.");
      return;
    }
    const count = selectedIds.size;
    Alert.alert(
      "Remove Items",
      `Remove ${count} selected item${count > 1 ? "s" : ""} from your cart?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const toRemove = Array.from(selectedIds);
            const next = await removeFuneralCartItems(toRemove);
            setItems(next);
            setSelectedIds(new Set());
            setIsEditing(false);
          },
        },
      ]
    );
  };

  // Checkout handling
  const handleCheckout = () => {
    if (selectedIds.size === 0) {
      Alert.alert(
        "No Item Selected",
        "Please select at least one service from your cart before proceeding to checkout."
      );
      return;
    }

    const selectedList = items.filter((it) => selectedIds.has(it.cartId));
    if (selectedList.length === 1) {
      navigation.navigate("FuneralCheckout", { cartItem: selectedList[0] });
      return;
    }

    // Funeral service requests are 1:1 since each service requires individual deceased details and schedule.
    Alert.alert(
      "Multiple Services Selected",
      `You selected ${selectedList.length} services. Funeral service requests require individual deceased details.\n\nProceed to checkout with "${selectedList[0].name}" first?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Proceed",
          onPress: () => {
            navigation.navigate("FuneralCheckout", { cartItem: selectedList[0] });
          },
        },
      ]
    );
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate("Home");
    }
  };

  return (
    <View style={styles.root}>
      {/* ── Top Header ────────────────────────────────────────── */}
      <View style={[styles.headerContainer, { paddingTop: Math.max(12, insets.top) }]}>
        <TouchableOpacity
          style={styles.headerBackButton}
          onPress={handleBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color="#1c2b25" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            Cart ({totalItemCount})
          </Text>
        </View>

        <TouchableOpacity
          style={styles.headerEditBtn}
          onPress={() => setIsEditing((prev) => !prev)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Text style={styles.headerEditText}>{isEditing ? "Done" : "Edit"}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Main Scrollable Body (Flat List, No Cards) ────────── */}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: items.length === 0 ? 40 : 100 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadCart();
            }}
            colors={["#315f50"]}
            tintColor="#315f50"
          />
        }
      >
        {items.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="cart-outline" size={48} color="#8a9e95" />
            </View>
            <Text style={styles.emptyTitle}>Your cart is empty</Text>
            <Text style={styles.emptySubtitle}>
              Products and services you add from shops will appear here.
            </Text>
            <TouchableOpacity
              style={styles.emptyExploreBtn}
              activeOpacity={0.88}
              onPress={() => navigation.navigate("Shops")}
            >
              <Text style={styles.emptyExploreText}>Explore Shops</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {groupedShops.map((shop, shopIndex) => {
              const shopSelected = isShopChecked(shop);

              return (
                <View key={shop.shopId} style={styles.shopBlock}>
                  {/* Thick Gray Divider Between Shops (Matches Screenshot) */}
                  {shopIndex > 0 ? <View style={styles.shopDivider} /> : null}

                  {/* Edge-to-Edge Shop Section */}
                  <View style={styles.shopSection}>
                    {/* Shop Header Row */}
                    <View style={styles.shopHeaderRow}>
                      <CircularCheckbox
                        checked={shopSelected}
                        onPress={() => toggleSelectShop(shop)}
                      />

                      {/* Shop Name with Avatar and Chevron */}
                      <TouchableOpacity
                        style={styles.shopTitleRow}
                        activeOpacity={0.7}
                        onPress={() => {
                          navigation.navigate("ShopProducts", {
                            shop: { id: shop.shopId, name: shop.shopName },
                          });
                        }}
                      >
                        <ShopAvatar uri={shopImageMap[shop.shopId]} />
                        <Text style={styles.shopNameText} numberOfLines={1}>
                          {shop.shopName}
                        </Text>
                        <Ionicons name="chevron-forward" size={14} color="#85928d" />
                      </TouchableOpacity>
                    </View>

                    {/* Shop Items List */}
                    <View style={styles.itemsWrapper}>
                      {shop.items.map((item, idx) => {
                        const isChecked = selectedIds.has(item.cartId);
                        const numericPrice =
                          Number(String(item.fullPrice || item.price || "").replace(/[^\d.]/g, "")) || 0;

                        return (
                          <View
                            key={item.cartId}
                            style={[
                              styles.itemRow,
                              idx > 0 ? styles.itemBorderTop : null,
                            ]}
                          >
                            {/* Item Checkbox (Centered vertically with thumbnail) */}
                            <View style={styles.itemCheckboxCol}>
                              <CircularCheckbox
                                checked={isChecked}
                                onPress={() => toggleSelectItem(item.cartId)}
                              />
                            </View>

                            {/* Product Thumbnail */}
                            <TouchableOpacity
                              style={styles.thumbContainer}
                              activeOpacity={0.88}
                              onPress={() => toggleSelectItem(item.cartId)}
                            >
                              {item.imageUrl ? (
                                <Image
                                  source={{ uri: item.imageUrl }}
                                  style={styles.thumbImage}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={styles.thumbFallback}>
                                  <Ionicons name="cube-outline" size={26} color="#687a73" />
                                </View>
                              )}
                            </TouchableOpacity>

                            {/* Product Details */}
                            <View style={styles.itemDetailsCol}>
                              {/* Product Title */}
                              <Text style={styles.itemTitle} numberOfLines={2}>
                                {item.name}
                              </Text>

                              {/* Variation / Inclusion Pill */}
                              {item.variationName ? (
                                <View style={styles.variantPill}>
                                  <Text style={styles.variantPillText} numberOfLines={1}>
                                    {item.variationName}
                                  </Text>
                                  <Ionicons
                                    name="chevron-down"
                                    size={11}
                                    color="#607068"
                                    style={{ marginLeft: 3 }}
                                  />
                                </View>
                              ) : item.packageItems?.length ? (
                                <View style={styles.variantPill}>
                                  <Text style={styles.variantPillText} numberOfLines={1}>
                                    {item.packageItems.length} Inclusions
                                  </Text>
                                  <Ionicons
                                    name="chevron-down"
                                    size={11}
                                    color="#607068"
                                    style={{ marginLeft: 3 }}
                                  />
                                </View>
                              ) : null}

                              {/* Downpayment Notice if enabled */}
                              {item.downpaymentEnabled ? (
                                <Text style={styles.downpaymentHint}>
                                  Downpayment available
                                </Text>
                              ) : null}

                              {/* Price & Quantity Stepper */}
                              <View style={styles.priceAndStepperRow}>
                                <Text style={styles.mainPriceText}>
                                  {formatPhilippinePeso(numericPrice)}
                                </Text>

                                {/* Stepper: [ - ] quantity [ + ] */}
                                <View style={styles.stepperContainer}>
                                  <TouchableOpacity
                                    style={styles.stepperBtn}
                                    onPress={() => void handleDecreaseQuantity(item)}
                                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                                    activeOpacity={0.65}
                                  >
                                    <Ionicons name="remove" size={13} color="#3c4c45" />
                                  </TouchableOpacity>
                                  <Text style={styles.stepperQtyText}>
                                    {item.quantity || 1}
                                  </Text>
                                  <TouchableOpacity
                                    style={styles.stepperBtn}
                                    onPress={() => void handleIncreaseQuantity(item)}
                                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                                    activeOpacity={0.65}
                                  >
                                    <Ionicons name="add" size={13} color="#3c4c45" />
                                  </TouchableOpacity>
                                </View>
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ── Fixed Bottom Checkout Bar (Edge-to-Edge) ────────────── */}
      {items.length > 0 ? (
        <View
          style={[
            styles.bottomBar,
            { paddingBottom: Math.max(12, insets.bottom) },
          ]}
        >
          {/* Select All */}
          <TouchableOpacity
            style={styles.allSelectRow}
            activeOpacity={0.8}
            onPress={toggleSelectAll}
          >
            <CircularCheckbox checked={isAllChecked} onPress={toggleSelectAll} />
            <Text style={styles.allSelectLabel}>All</Text>
          </TouchableOpacity>

          {/* Price Summary (Normal Mode) */}
          {!isEditing ? (
            <View style={styles.bottomSummaryCol}>
              <Text style={styles.summaryLabel}>Total</Text>
              <Text style={styles.totalPriceText}>
                {formatPhilippinePeso(selectedTotalPrice)}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {/* Action Button: Check out vs Delete */}
          {!isEditing ? (
            <TouchableOpacity
              style={[
                styles.checkoutBtn,
                selectedCount === 0 ? styles.checkoutBtnDisabled : null,
              ]}
              disabled={selectedCount === 0}
              onPress={handleCheckout}
              activeOpacity={0.88}
            >
              <Text style={styles.checkoutBtnText}>
                Check out{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.deleteBtn,
                selectedCount === 0 ? styles.deleteBtnDisabled : null,
              ]}
              disabled={selectedCount === 0}
              onPress={handleDeleteSelected}
              activeOpacity={0.88}
            >
              <Text style={styles.deleteBtnText}>
                Delete{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#ffffff",
  },

  /* ── Header ────────────────────────────────────────── */
  headerContainer: {
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eaeeeb",
    zIndex: 10,
  },
  headerBackButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1d2a24",
  },
  headerEditBtn: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  headerEditText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1d2a24",
  },

  /* ── ScrollView & Empty State ──────────────────────── */
  scrollView: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  scrollContent: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    backgroundColor: "#ffffff",
  },
  emptyContainer: {
    backgroundColor: "#ffffff",
    alignItems: "center",
    paddingVertical: 64,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#eef4f1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#1d2a24",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: "#72827c",
    textAlign: "center",
    marginBottom: 20,
  },
  emptyExploreBtn: {
    backgroundColor: "#315f50",
    borderRadius: 999,
    paddingHorizontal: 26,
    paddingVertical: 12,
  },
  emptyExploreText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },

  /* ── Circular Checkbox ─────────────────────────────── */
  checkboxBase: {
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxUnchecked: {
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#cfd8d3",
  },
  checkboxChecked: {
    backgroundColor: "#315f50",
    borderWidth: 1.5,
    borderColor: "#315f50",
  },

  /* ── Flat List / Shop Block (Edge-to-Edge) ─────────── */
  listContainer: {
    width: "100%",
    backgroundColor: "#ffffff",
  },
  shopBlock: {
    width: "100%",
  },
  shopDivider: {
    height: 10,
    backgroundColor: "#f2f4f5",
    width: "100%",
  },
  shopSection: {
    backgroundColor: "#ffffff",
    width: "100%",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  shopHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 8,
  },
  shopTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  shopAvatarWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#dbe3e0",
    backgroundColor: "#eef4f1",
  },
  shopAvatar: {
    width: "100%",
    height: "100%",
  },
  shopAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  shopNameText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1c2b25",
    flexShrink: 1,
  },

  /* ── Items List ────────────────────────────────────── */
  itemsWrapper: {
    width: "100%",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
  },
  itemBorderTop: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#edf0ee",
  },
  itemCheckboxCol: {
    alignItems: "center",
    justifyContent: "center",
  },
  thumbContainer: {
    width: 86,
    height: 86,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#f4f6f5",
    borderWidth: 1,
    borderColor: "#eaeeec",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  thumbFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eaf1ed",
  },
  itemDetailsCol: {
    flex: 1,
    minHeight: 86,
    justifyContent: "space-between",
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1c2b25",
    lineHeight: 19,
  },
  variantPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0f3f1",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginTop: 4,
    maxWidth: "92%",
  },
  variantPillText: {
    fontSize: 11,
    color: "#4e5e57",
    fontWeight: "500",
  },
  downpaymentHint: {
    fontSize: 11,
    color: "#315f50",
    fontWeight: "600",
    marginTop: 3,
  },
  priceAndStepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  mainPriceText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#315f50",
  },
  stepperContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f4f6f5",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#dce3df",
    overflow: "hidden",
  },
  stepperBtn: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9fbfa",
  },
  stepperQtyText: {
    minWidth: 26,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    color: "#1e2c26",
    paddingHorizontal: 4,
  },

  /* ── Bottom Fixed Checkout Bar ─────────────────────── */
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e6ebe8",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 6,
    zIndex: 30,
  },
  allSelectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 10,
  },
  allSelectLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1c2b25",
  },
  bottomSummaryCol: {
    flex: 1,
    alignItems: "flex-end",
    paddingRight: 12,
  },
  summaryLabel: {
    fontSize: 11,
    color: "#788781",
  },
  totalPriceText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#315f50",
  },
  checkoutBtn: {
    backgroundColor: "#315f50",
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 116,
  },
  checkoutBtnDisabled: {
    backgroundColor: "#a1b4ac",
    opacity: 0.65,
  },
  checkoutBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  deleteBtn: {
    backgroundColor: "#b91c1c",
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 116,
  },
  deleteBtnDisabled: {
    backgroundColor: "#d19a9a",
    opacity: 0.65,
  },
  deleteBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
