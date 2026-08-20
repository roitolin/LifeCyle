import { useCallback, useMemo, useRef, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
  businessName?: string;
  generalLocation?: string;
};

export default function FuneralShopsScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const loadShops = useCallback(async () => {
    try {
      const { data: shopRows } = await supabase
        .from("funeral_shops")
        .select("*")
        .eq("status", "live")
        .gt("paidUntil", new Date().toISOString())
        .order("shopName", { ascending: true });

      const nextShops: ShopRecord[] = (shopRows || []).map((row: any) => ({
        id: row.id,
        shopName: String(row.shopName || ""),
        shopAddress: String(row.shopAddress || ""),
        shopPhoneNumber: String(row.shopPhoneNumber || ""),
        shopImageUrl: row.shopImageUrl || null,
        businessName: row.businessName ? String(row.businessName) : undefined,
        generalLocation: row.generalLocation ? String(row.generalLocation) : undefined,
      }));

      setShops(nextShops);
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

  const shopCountLabel = useMemo(() => `${shops.length} verified ${shops.length === 1 ? "shop" : "shops"}`, [shops.length]);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadShops(); }} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>Verified Funeral Shops</Text>
          <Text style={styles.heroTitle}>Browse Trusted Casket Sellers</Text>
          <Text style={styles.heroSubtitle}>Once a funeral shop is verified, it will appear here automatically for families to browse.</Text>

          <View style={styles.heroPill}>
            <Ionicons name="storefront-outline" size={16} color="#22312d" />
            <Text style={styles.heroPillText}>{shopCountLabel}</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <LoadingBird />
          </View>
        ) : shops.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="storefront-outline" size={28} color="#86908a" />
            <Text style={styles.emptyTitle}>No verified shops yet</Text>
            <Text style={styles.emptyText}>Verified funeral shops will show up here automatically as soon as admins approve them.</Text>
          </View>
        ) : (
          shops.map((shop) => (
            <View key={shop.id} style={styles.shopCard}>
              {shop.shopImageUrl ? (
                <Image source={{ uri: shop.shopImageUrl }} style={styles.shopImage} resizeMode="cover" />
              ) : (
                <View style={styles.shopImageFallback}>
                  <Ionicons name="storefront-outline" size={28} color="#22312d" />
                </View>
              )}

              <View style={styles.shopBody}>
                <Text style={styles.shopName}>{shop.shopName}</Text>
                <Text style={styles.shopMeta}>{shop.generalLocation || shop.shopAddress || "Location not available"}</Text>
                <Text style={styles.shopMeta}>{shop.shopPhoneNumber || "No contact number"}</Text>
                {shop.businessName ? <Text style={styles.shopBusiness}>{shop.businessName}</Text> : null}
              </View>

              <TouchableOpacity style={styles.shopButton} onPress={() => navigation.navigate("ShopProducts", { shopId: shop.id, shopName: shop.shopName })}>
                <Text style={styles.shopButtonText}>View Products</Text>
              </TouchableOpacity>
            </View>
          ))
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
  heroCard: {
    borderRadius: 28,
    backgroundColor: "#d6e2d2",
    padding: 20,
  },
  heroEyebrow: {
    color: "#86654a",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  heroTitle: {
    color: "#22312d",
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "900",
    marginTop: 6,
  },
  heroSubtitle: {
    color: "#53615d",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
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
    marginTop: 16,
  },
  heroPillText: {
    color: "#22312d",
    fontSize: 12,
    fontWeight: "900",
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
  shopCard: {
    borderRadius: 24,
    backgroundColor: "#f8f6f2",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 14,
  },
  shopImage: {
    width: "100%",
    height: 180,
    borderRadius: 18,
  },
  shopImageFallback: {
    width: "100%",
    height: 180,
    borderRadius: 18,
    backgroundColor: "#ebf1e8",
    alignItems: "center",
    justifyContent: "center",
  },
  shopBody: {
    marginTop: 14,
    gap: 5,
  },
  shopName: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "900",
  },
  shopMeta: {
    color: "#62706b",
    fontSize: 13,
    lineHeight: 19,
  },
  shopBusiness: {
    color: "#8b7255",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },
  shopButton: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  shopButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
});

