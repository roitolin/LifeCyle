import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { subscribeTabRefresh } from "@/utils/tabRefresh";
import { FuneralCartItem, loadFuneralCart, removeFuneralCartItem, removeFuneralCartItems } from "@/utils/funeralCart";

function CartHeader({
  total,
}: {
  total: number;
}) {
  return (
    <View style={styles.navHeader}>
      <View style={styles.navHeaderTextWrap}>
        <Text style={styles.navHeaderTitle}>Cart Total</Text>
        <Text style={styles.navHeaderValue}>{formatPhilippinePeso(total)}</Text>
      </View>
    </View>
  );
}

export default function FuneralCartScreen({ navigation }: any) {
  const [items, setItems] = useState<FuneralCartItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCartId, setSelectedCartId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView>(null);

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
        setSelectionMode(false);
        setSelectedCartId(null);
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

  const total = useMemo(
    () =>
      items.reduce((sum, item) => {
        const numeric = Number(String(item.price || "").replace(/[^\d.]/g, "")) || 0;
        return sum + numeric * item.quantity;
      }, 0),
    [items]
  );

  const handleCheckout = useCallback(() => {
    const selectedItem = items.find((item) => item.cartId === selectedCartId);
    if (!selectedItem) {
      Alert.alert("Select Item", "Please select a cart item first.");
      return;
    }

    navigation.navigate("FuneralCheckout", { cartItem: selectedItem });
  }, [items, navigation, selectedCartId]);

  const enterSelectionMode = () => {
    setSelectedCartId(null);
    setSelectedIds(new Set());
    setSelectionMode(true);
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (cartId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cartId)) {
        next.delete(cartId);
      } else {
        next.add(cartId);
      }
      return next;
    });
  };

  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    Alert.alert(
      "Remove items",
      `Remove ${count} selected item${count > 1 ? "s" : ""} from your cart?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              const next = await removeFuneralCartItems(Array.from(selectedIds));
              setItems(next);
              setSelectedIds(new Set());
              setSelectionMode(false);
              if (next.length === 0) setSelectedCartId(null);
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to remove items.");
            }
          },
        },
      ]
    );
  }, [selectedIds]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitleAlign: "left",
      headerTitle: () => <CartHeader total={total} />,
      headerRight: () => (
        <View style={styles.headerActions}>
          {selectionMode ? (
            <>
              <TouchableOpacity style={styles.headerTextButton} onPress={exitSelectionMode}>
                <Text style={styles.headerCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerDeleteButton, selectedIds.size === 0 ? styles.headerDeleteButtonDisabled : null]}
                onPress={deleteSelected}
              >
                <Ionicons name="trash-outline" size={16} color="#ffffff" />
                <Text style={styles.headerDeleteText}>Delete ({selectedIds.size})</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {items.length > 0 ? (
                <TouchableOpacity style={styles.headerTextButton} onPress={enterSelectionMode}>
                  <Text style={styles.headerSelectText}>Select</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.navHeaderCheckoutButton, !selectedCartId ? styles.navHeaderCheckoutButtonDisabled : null]}
                onPress={handleCheckout}
              >
                <Ionicons name="flash-outline" size={16} color="#ffffff" />
                <Text style={styles.navHeaderCheckoutText}>Checkout</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ),
    });
  }, [deleteSelected, handleCheckout, items.length, navigation, selectedCartId, selectedIds.size, selectionMode, total]);

  const removeItem = async (cartId: string) => {
    const next = await removeFuneralCartItem(cartId);
    setItems(next);
    if (selectedCartId === cartId) {
      setSelectedCartId(null);
    }
  };

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadCart(); }} />}
      >
        {items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="cart-outline" size={30} color="#86908a" />
            <Text style={styles.emptyTitle}>Your cart is empty</Text>
            <Text style={styles.emptyText}>Products you add from funeral shops will appear here.</Text>
          </View>
        ) : (
          <>
            {selectionMode ? (
              <View style={styles.selectionHint}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#8a928d" />
                <Text style={styles.selectionHintText}>Tap items to select, then delete them together.</Text>
              </View>
            ) : null}

            {items.map((item: any) => {
              const isSelected = selectionMode ? selectedIds.has(item.cartId) : selectedCartId === item.cartId;

              return (
                <TouchableOpacity
                  key={item.cartId}
                  style={[styles.itemCard, isSelected ? styles.itemCardActive : null]}
                  activeOpacity={0.92}
                  onPress={() => {
                    if (selectionMode) {
                      toggleSelect(item.cartId);
                    } else {
                      setSelectedCartId((current) => (current === item.cartId ? null : item.cartId));
                    }
                  }}
                >
                  {item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={styles.itemImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.itemFallback}>
                      <Ionicons name="cube-outline" size={24} color="#66746f" />
                    </View>
                  )}

                  <View style={styles.itemBody}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.itemShop}>{item.shopName}</Text>
                    {item.variationName ? <Text style={styles.itemVariation}>Variation: {item.variationName}</Text> : null}
                    {item.packageItems?.length ? (
                      <Text style={styles.itemVariation}>Packages: {item.packageItems.join(", ")}</Text>
                    ) : null}
                    <Text style={styles.itemPrice}>{formatPhilippinePeso(item.price)}</Text>

                    {!selectionMode ? (
                      <View style={styles.itemActions}>
                        <TouchableOpacity style={styles.removeButton} onPress={() => void removeItem(item.cartId)}>
                          <Text style={styles.removeButtonText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>

                  {selectionMode ? (
                    isSelected ? (
                      <View style={styles.selectCheck}>
                        <Ionicons name="checkmark" size={14} color="#ffffff" />
                      </View>
                    ) : (
                      <View style={styles.selectRing} />
                    )
                  ) : null}
                </TouchableOpacity>
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
    padding: 18,
    paddingBottom: 28,
    gap: 16,
  },
  navHeader: {
    justifyContent: "center",
  },
  navHeaderTextWrap: {
    flexShrink: 1,
  },
  navHeaderTitle: {
    color: "#62706b",
    fontSize: 13,
    fontWeight: "700",
  },
  navHeaderValue: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
  },
  navHeaderCheckoutButton: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: "#22312d",
    paddingHorizontal: 14,
    marginRight: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  navHeaderCheckoutButtonDisabled: {
    opacity: 0.45,
  },
  navHeaderCheckoutText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTextButton: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  headerSelectText: {
    color: "#22312d",
    fontSize: 13,
    fontWeight: "900",
  },
  headerCancelText: {
    color: "#8a928d",
    fontSize: 13,
    fontWeight: "700",
  },
  headerDeleteButton: {
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: "#b91c1c",
    paddingHorizontal: 14,
    marginRight: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  headerDeleteButtonDisabled: {
    opacity: 0.45,
  },
  headerDeleteText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  selectionHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 16,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  selectionHintText: {
    color: "#62706b",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  selectRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#d9d6cd",
    alignSelf: "center",
    marginRight: 4,
  },
  selectCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#f59e0b",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginRight: 4,
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
  itemCard: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 12,
  },
  itemCardActive: {
    borderColor: "#f59e0b",
    backgroundColor: "#fffaf0",
  },
  itemImage: {
    width: 94,
    height: 94,
    borderRadius: 16,
  },
  itemFallback: {
    width: 94,
    height: 94,
    borderRadius: 16,
    backgroundColor: "#ebf1e8",
    alignItems: "center",
    justifyContent: "center",
  },
  itemBody: {
    flex: 1,
  },
  itemName: {
    color: "#22312d",
    fontSize: 15,
    fontWeight: "900",
  },
  itemShop: {
    color: "#8b7255",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },
  itemVariation: {
    color: "#62706b",
    fontSize: 12,
    marginTop: 4,
  },
  itemPrice: {
    color: "#22312d",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 8,
  },
  itemActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: 10,
  },
  removeButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  removeButtonText: {
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: "800",
  },
});
