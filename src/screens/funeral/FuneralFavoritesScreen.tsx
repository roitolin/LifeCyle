import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/services/supabaseClient';
import { formatPhilippinePeso } from '@/utils/funeralCatalog';
import { loadFavoriteProductIds, subscribeFavoriteProducts, toggleFavoriteProduct } from '@/utils/favoriteProducts';

type FavoriteProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  shopId: string;
  shopName: string;
};

export default function FuneralFavoritesScreen({ navigation }: any) {
  const tabBarHeight = useBottomTabBarHeight();
  const [favorites, setFavorites] = useState<FavoriteProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadFavorites = useCallback(async () => {
    setLoadError(false);
    try {
      const ids = await loadFavoriteProductIds();
      if (ids.size === 0) {
        setFavorites([]);
        return;
      }
      const orderedIds = Array.from(ids);
      const { data, error } = await supabase
        .from('funeral_products')
        .select('id, name, description, price, stock, imageUrl, shopId, funeral_shops!inner ( shopName, status, paidUntil )')
        .in('id', orderedIds)
        .eq('active', true)
        .gt('stock', 0)
        .eq('funeral_shops.status', 'live')
        .gt('funeral_shops.paidUntil', new Date().toISOString());
      if (error) throw error;
      const byId = new Map((data || []).map((row: any) => [String(row.id), {
        id: String(row.id),
        name: String(row.name || 'Funeral product'),
        description: String(row.description || ''),
        price: Number(row.price) || 0,
        stock: Number(row.stock) || 0,
        imageUrl: row.imageUrl || null,
        shopId: String(row.shopId || ''),
        shopName: String(row.funeral_shops?.shopName || 'Funeral shop'),
      } satisfies FavoriteProduct]));
      setFavorites(orderedIds.map((id) => byId.get(id)).filter((item): item is FavoriteProduct => Boolean(item)));
    } catch (error) {
      console.warn('Unable to load favorite products:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadFavorites();
    return subscribeFavoriteProducts(() => { void loadFavorites(); });
  }, [loadFavorites]));

  const removeFavorite = async (productId: string) => {
    try {
      await toggleFavoriteProduct(productId);
    } catch {
      setLoadError(true);
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
      <FlatList
        data={favorites}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(tabBarHeight + 14, 28) }, favorites.length === 0 && styles.emptyList]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadFavorites(); }} />}
        ListHeaderComponent={(
          <View style={styles.header}>
            <View style={styles.headerIcon}><Ionicons name="heart" size={20} color="#e45a16" /></View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Favorites</Text>
              <Text style={styles.subtitle}>Products you saved with the heart button.</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={loading ? (
          <View style={styles.emptyState}><ActivityIndicator color="#356b59" /><Text style={styles.emptyText}>Loading favorites…</Text></View>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}><Ionicons name={loadError ? 'cloud-offline-outline' : 'heart-outline'} size={28} color="#77847e" /></View>
            <Text style={styles.emptyTitle}>{loadError ? 'Favorites unavailable' : 'Nothing saved yet'}</Text>
            <Text style={styles.emptyText}>{loadError ? 'Pull down to try loading your saved products again.' : 'Tap the heart on a product to keep it here.'}</Text>
            <TouchableOpacity style={styles.browseButton} onPress={() => navigation.navigate('Home')}>
              <Text style={styles.browseButtonText}>Browse products</Text>
              <Ionicons name="arrow-forward" size={16} color="#ffffff" />
            </TouchableOpacity>
          </View>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.productCard}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ProductView', { product: item })}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.name}`}
          >
            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.productImage} resizeMode="cover" /> : (
              <View style={styles.productImageFallback}><Ionicons name="flower-outline" size={28} color="#648071" /></View>
            )}
            <View style={styles.productCopy}>
              <Text style={styles.shopName} numberOfLines={1}>{item.shopName}</Text>
              <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.price}>{formatPhilippinePeso(item.price)}</Text>
              <Text style={styles.stock}>{item.stock} available</Text>
            </View>
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => void removeFavorite(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name} from favorites`}
              hitSlop={8}
            >
              <Ionicons name="heart" size={20} color="#e45a16" />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f6f2' },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  emptyList: { flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  headerIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff0e7' },
  headerCopy: { flex: 1 },
  title: { color: '#22312d', fontSize: 23, fontWeight: '900' },
  subtitle: { color: '#77847e', fontSize: 12, marginTop: 3 },
  productCard: { minHeight: 118, borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e7ebe6' },
  productImage: { width: 88, height: 96, borderRadius: 13, backgroundColor: '#edf1ec' },
  productImageFallback: { width: 88, height: 96, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf1ec' },
  productCopy: { flex: 1, minWidth: 0 },
  shopName: { color: '#738078', fontSize: 10, fontWeight: '700' },
  productName: { color: '#26342f', fontSize: 14, lineHeight: 18, fontWeight: '800', marginTop: 5 },
  price: { color: '#2e624e', fontSize: 14, fontWeight: '900', marginTop: 7 },
  stock: { color: '#88948e', fontSize: 10, marginTop: 2 },
  removeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff4ed' },
  emptyState: { flex: 1, minHeight: 330, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  emptyIcon: { width: 62, height: 62, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e9eee8' },
  emptyTitle: { color: '#273630', fontSize: 17, fontWeight: '900', marginTop: 14 },
  emptyText: { color: '#77847e', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  browseButton: { height: 44, borderRadius: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, backgroundColor: '#2d5d4a' },
  browseButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
});
