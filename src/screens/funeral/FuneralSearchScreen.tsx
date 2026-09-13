import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import LoadingBird from '@/components/LoadingBird';
import { supabase } from '@/services/supabaseClient';
import { colors, radii, spacing } from '@/theme';
import { formatPhilippinePeso } from '@/utils/funeralCatalog';

type ProductVariation = { name: string; imageUrl?: string | null };
type SearchProduct = {
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
  shopId: string;
  shopName: string;
  rating: number;
  reviewCount: number;
};
type ProductSort = 'name' | 'price_low' | 'price_high';

function getPrimaryProductImage(item: SearchProduct) {
  return item.imageUrl || item.galleryImageUrls?.[0] || item.variations?.find((entry) => entry.imageUrl)?.imageUrl || null;
}

function mapProductRows(rows: any[], ratingSummary: Map<string, { total: number; count: number }>): SearchProduct[] {
  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
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
    shopId: row.shopId,
    shopName: String(row.funeral_shops?.shopName || 'Funeral shop'),
    rating: ratingSummary.has(String(row.id))
      ? (ratingSummary.get(String(row.id))?.total || 0) / (ratingSummary.get(String(row.id))?.count || 1)
      : 0,
    reviewCount: ratingSummary.get(String(row.id))?.count || 0,
  })).filter((product: SearchProduct) => getPrimaryProductImage(product));
}

export default function FuneralSearchScreen({ navigation, route }: any) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedShopId, setSelectedShopId] = useState('all');
  const [sortBy, setSortBy] = useState<ProductSort>('name');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minimumRating, setMinimumRating] = useState(0);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [favoriteProductIds, setFavoriteProductIds] = useState<Set<string>>(() => new Set());
  const filterBackdropOpacity = useRef(new Animated.Value(0)).current;
  const filterSheetProgress = useRef(new Animated.Value(0)).current;
  const showAllProducts = Boolean(route?.params?.showAll);

  const loadProducts = useCallback(async () => {
    try {
      setLoadError(false);
      const { data: rows, error } = await supabase
        .from('funeral_products')
        .select('*, funeral_product_variations ( name, imageUrl ), funeral_product_images ( imageUrl, displayOrder ), funeral_shops!inner ( shopName, status )')
        .eq('active', true)
        .gt('stock', 0)
        .eq('funeral_shops.status', 'live')
        .gt('funeral_shops.paidUntil', new Date().toISOString());
      if (error) throw error;

      const productIds = (rows || []).map((row: any) => String(row.id));
      let ratingRows: any[] = [];
      if (productIds.length > 0) {
        const { data: ratingData, error: ratingError } = await supabase
          .from('funeral_product_ratings')
          .select('productId, rating')
          .in('productId', productIds);
        if (ratingError) console.warn('Unable to load product ratings:', ratingError.message);
        else ratingRows = ratingData || [];
      }

      const ratingSummary = new Map<string, { total: number; count: number }>();
      ratingRows.forEach((row: any) => {
        const productId = String(row.productId || '');
        const ratingValue = Number(row.rating) || 0;
        if (!productId || ratingValue <= 0) return;
        const current = ratingSummary.get(productId) || { total: 0, count: 0 };
        ratingSummary.set(productId, { total: current.total + ratingValue, count: current.count + 1 });
      });

      setProducts(mapProductRows(rows || [], ratingSummary));
    } catch (error) {
      console.error('Unable to load search products:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadProducts(); }, [loadProducts]));

  const shopOptions = useMemo(() => {
    const shops = new Map<string, string>();
    products.forEach((product) => shops.set(product.shopId, product.shopName));
    return Array.from(shops, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const normalizedQuery = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!normalizedQuery && !showAllProducts) return [];
    const parsedMin = Number(minPrice);
    const parsedMax = Number(maxPrice);
    const effectiveMin = minPrice.trim() && Number.isFinite(parsedMin) ? parsedMin : 0;
    const effectiveMax = maxPrice.trim() && Number.isFinite(parsedMax) ? parsedMax : Number.POSITIVE_INFINITY;
    const filtered = products.filter((product) => {
      const matchesQuery = !normalizedQuery || [product.name, product.description, product.shopName]
        .join(' ').toLowerCase().includes(normalizedQuery);
      const matchesShop = selectedShopId === 'all' || product.shopId === selectedShopId;
      const price = Number(product.price) || 0;
      const matchesRating = minimumRating === 0 || product.rating >= minimumRating;
      return matchesQuery && matchesShop && matchesRating && price >= effectiveMin && price <= effectiveMax;
    });
    return [...filtered].sort((a, b) => {
      if (sortBy === 'price_low') return Number(a.price) - Number(b.price);
      if (sortBy === 'price_high') return Number(b.price) - Number(a.price);
      return a.name.localeCompare(b.name);
    });
  }, [maxPrice, minPrice, minimumRating, normalizedQuery, products, selectedShopId, showAllProducts, sortBy]);

  const activeFilterCount = (selectedShopId === 'all' ? 0 : 1)
    + (sortBy === 'name' ? 0 : 1)
    + (minPrice.trim() || maxPrice.trim() ? 1 : 0)
    + (minimumRating > 0 ? 1 : 0);
  const clearFilters = () => {
    setSelectedShopId('all');
    setSortBy('name');
    setMinPrice('');
    setMaxPrice('');
    setMinimumRating(0);
  };
  const openProductFilters = () => {
    filterBackdropOpacity.stopAnimation();
    filterSheetProgress.stopAnimation();
    filterBackdropOpacity.setValue(0);
    filterSheetProgress.setValue(0);
    setFiltersVisible(true);
    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(filterBackdropOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(filterSheetProgress, {
          toValue: 1,
          damping: 19,
          stiffness: 210,
          mass: 0.85,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };
  const closeProductFilters = () => {
    filterBackdropOpacity.stopAnimation();
    filterSheetProgress.stopAnimation();
    Animated.parallel([
      Animated.timing(filterBackdropOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(filterSheetProgress, {
        toValue: 0,
        duration: 210,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setFiltersVisible(false);
    });
  };
  const toggleFavorite = (id: string) => setFavoriteProductIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <View style={styles.searchArea}>
        <View style={styles.searchControl}>
          <Ionicons name='search-outline' size={17} color={colors.textMuted} />
          <TextInput
            accessibilityLabel='Search caskets or funeral shops'
            autoCapitalize='none'
            autoCorrect={false}
            autoFocus={!showAllProducts}
            placeholder='Search...'
            placeholderTextColor={colors.textMuted}
            returnKeyType='search'
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
          />
          {query ? (
            <TouchableOpacity accessibilityLabel='Clear search' accessibilityRole='button' style={styles.clearButton} onPress={() => setQuery('')}>
              <Ionicons name='close-circle' size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
          <View style={styles.searchDivider} />
          <TouchableOpacity
            accessibilityLabel='Show product filters'
            accessibilityRole='button'
            activeOpacity={0.72}
            style={styles.filterButton}
            onPress={openProductFilters}
          >
            <Ionicons name='options-outline' size={19} color={colors.text} />
            {activeFilterCount > 0 ? (
              <View style={styles.filterCountBadge}><Text style={styles.filterCountText}>{activeFilterCount}</Text></View>
            ) : null}
          </TouchableOpacity>
        </View>
        {(normalizedQuery || showAllProducts) && !loading && !loadError ? (
          <Text style={styles.resultCount}>{results.length} {results.length === 1 ? 'product' : 'products'}</Text>
        ) : null}
      </View>

      {loading ? (
        <LoadingBird compact style={styles.loadingIndicator} />
      ) : loadError ? (
        <View style={styles.stateWrap}>
          <Ionicons name='cloud-offline-outline' size={28} color={colors.textMuted} />
          <Text style={styles.stateTitle}>Could not load products</Text>
          <Text style={styles.stateText}>Check your connection, then try again.</Text>
          <TouchableOpacity accessibilityRole='button' style={styles.stateAction} onPress={() => { setLoading(true); void loadProducts(); }}>
            <Text style={styles.stateActionText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : !normalizedQuery && !showAllProducts ? (
        <View style={styles.stateWrap}>
          <Ionicons name='search-outline' size={28} color={colors.textMuted} />
          <Text style={styles.stateTitle}>Find a casket</Text>
          <Text style={styles.stateText}>Search by product name or funeral shop.</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.stateWrap}>
          <Ionicons name='search-outline' size={28} color={colors.textMuted} />
          <Text style={styles.stateTitle}>{showAllProducts ? 'No matching caskets' : 'No results found'}</Text>
          <Text style={styles.stateText}>{activeFilterCount ? 'Try changing or resetting the filters.' : 'Try a shorter product or shop name.'}</Text>
          {activeFilterCount ? (
            <TouchableOpacity accessibilityRole='button' style={styles.stateAction} onPress={clearFilters}>
              <Text style={styles.stateActionText}>Reset filters</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <FlatList
          columnWrapperStyle={styles.resultRow}
          contentContainerStyle={styles.resultsContent}
          data={results}
          keyboardDismissMode='on-drag'
          keyboardShouldPersistTaps='handled'
          keyExtractor={(item) => item.shopId + '_' + item.id}
          numColumns={2}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const price = formatPhilippinePeso(item.price);
            const isFavorite = favoriteProductIds.has(item.id);
            return (
              <TouchableOpacity
                accessibilityLabel={item.name + ', ' + price + ', from ' + item.shopName}
                accessibilityRole='button'
                activeOpacity={0.78}
                style={styles.productCard}
                onPress={() => navigation.navigate('ProductView', { product: item })}
              >
                <View style={styles.productImageFrame}>
                  <Image source={{ uri: getPrimaryProductImage(item) || '' }} resizeMode='cover' style={styles.productImage} />
                  <TouchableOpacity
                    accessibilityLabel={(isFavorite ? 'Remove ' : 'Add ') + item.name + (isFavorite ? ' from favorites' : ' to favorites')}
                    accessibilityRole='button'
                    activeOpacity={0.72}
                    style={styles.favoriteButton}
                    onPress={(event) => { event.stopPropagation(); toggleFavorite(item.id); }}
                  >
                    <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={17} color={isFavorite ? colors.accent : colors.text} />
                  </TouchableOpacity>
                </View>
                <View style={styles.productDetails}>
                  <Text style={styles.shopName} numberOfLines={1}>{item.shopName}</Text>
                  <Text style={styles.productTitle} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.price}>{price}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal animationType='none' transparent statusBarTranslucent visible={filtersVisible} onRequestClose={closeProductFilters}>
        <View style={styles.filterModalRoot}>
          <Animated.View style={[styles.filterBackdrop, { opacity: filterBackdropOpacity }]}>
            <TouchableOpacity accessibilityLabel='Close product filters' accessibilityRole='button' activeOpacity={1} style={styles.filterBackdropPressable} onPress={closeProductFilters} />
          </Animated.View>
          <Animated.View
            style={[
              styles.filterSheet,
              {
                opacity: filterSheetProgress.interpolate({
                  inputRange: [0, 0.12, 1],
                  outputRange: [0, 1, 1],
                  extrapolate: 'clamp',
                }),
                transform: [
                  {
                    translateY: filterSheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [120, 0],
                    }),
                  },
                  {
                    scale: filterSheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.985, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <SafeAreaView edges={['bottom']} style={styles.filterSheetSafeArea} accessibilityViewIsModal>
              <View style={styles.filterHeader}>
                <View style={styles.filterTitleRow}>
                  <Ionicons name='filter-outline' size={17} color={colors.primary} />
                  <Text style={styles.filterTitle}>FILTER</Text>
                </View>
                <TouchableOpacity accessibilityLabel='Close product filters' accessibilityRole='button' activeOpacity={0.7} style={styles.filterClose} onPress={closeProductFilters}>
                  <Ionicons name='close' size={22} color={colors.primary} />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={styles.filterContent} showsVerticalScrollIndicator={false}>
                <View style={styles.filterSection}>
                  <View style={styles.filterHeading}>
                    <Text style={styles.filterLabel}>SORT BY</Text>
                    {activeFilterCount > 0 ? <TouchableOpacity accessibilityRole='button' onPress={clearFilters}><Text style={styles.resetText}>Reset</Text></TouchableOpacity> : null}
                  </View>
                  <View style={styles.sortOptions}>
                    {([
                      { value: 'price_low', label: 'Price: Low to High', description: 'Show the most affordable first', icon: 'arrow-up-outline' },
                      { value: 'price_high', label: 'Price: High to Low', description: 'Show premium products first', icon: 'arrow-down-outline' },
                    ] as const).map((option) => {
                      const selected = sortBy === option.value;
                      return (
                        <TouchableOpacity key={option.value} accessibilityLabel={option.label} accessibilityRole='button' accessibilityState={{ selected }} activeOpacity={0.75} style={[styles.sortOption, selected && styles.sortOptionActive]} onPress={() => setSortBy(option.value)}>
                          <View style={[styles.sortIcon, selected && styles.sortIconActive]}><Ionicons name={option.icon} size={17} color={selected ? colors.surface : colors.primary} /></View>
                          <View style={styles.sortCopy}>
                            <Text style={[styles.sortLabel, selected && styles.sortLabelActive]}>{option.label}</Text>
                            <Text style={styles.sortDescription}>{option.description}</Text>
                          </View>
                          <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selected ? colors.primary : colors.borderWarm} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.filterSection}>
                  <Text style={styles.filterLabel}>PRICE RANGE</Text>
                  <View style={styles.priceRow}>
                    <TextInput accessibilityLabel='Minimum product price' style={styles.priceInput} value={minPrice} onChangeText={(value) => setMinPrice(value.replace(/[^\d.]/g, ''))} placeholder='MIN' placeholderTextColor={colors.textMuted} keyboardType='decimal-pad' returnKeyType='done' />
                    <Text style={styles.priceSeparator}>—</Text>
                    <TextInput accessibilityLabel='Maximum product price' style={styles.priceInput} value={maxPrice} onChangeText={(value) => setMaxPrice(value.replace(/[^\d.]/g, ''))} placeholder='MAX' placeholderTextColor={colors.textMuted} keyboardType='decimal-pad' returnKeyType='done' />
                  </View>
                </View>

                <View style={styles.filterSection}>
                  <Text style={styles.filterLabel}>RATING</Text>
                  <View style={styles.ratingFilterList}>
                    {[5, 4, 3, 2, 1].map((value) => {
                      const selected = minimumRating === value;
                      return (
                        <TouchableOpacity
                          key={value}
                          accessibilityLabel={`${value} stars and up`}
                          accessibilityRole='button'
                          accessibilityState={{ selected }}
                          activeOpacity={0.75}
                          style={[styles.ratingFilterRow, selected && styles.ratingFilterRowActive]}
                          onPress={() => setMinimumRating((current) => current === value ? 0 : value)}
                        >
                          <View style={styles.ratingStars}>
                            {Array.from({ length: 5 }, (_, index) => (
                              <Ionicons key={index} name={index < value ? 'star' : 'star-outline'} size={17} color={index < value ? '#f3ad24' : colors.textMuted} />
                            ))}
                          </View>
                          <Text style={styles.ratingFilterText}>&amp; up</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {shopOptions.length > 1 ? (
                  <View style={styles.filterSection}>
                    <Text style={styles.filterLabel}>FUNERAL SHOP</Text>
                    <View style={styles.filterChips}>
                      {[{ id: 'all', name: 'All shops' }, ...shopOptions].map((shop) => {
                        const selected = selectedShopId === shop.id;
                        return (
                          <TouchableOpacity key={shop.id} accessibilityRole='button' style={[styles.filterChip, selected && styles.filterChipActive]} onPress={() => setSelectedShopId(shop.id)}>
                            <Text style={[styles.filterChipText, selected && styles.filterChipTextActive]}>{shop.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </ScrollView>
              <View style={styles.filterFooter}>
                <TouchableOpacity accessibilityLabel='Apply product filters' accessibilityRole='button' activeOpacity={0.8} style={styles.applyButton} onPress={closeProductFilters}>
                  <Text style={styles.applyText}>APPLY</Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceWarm },
  searchArea: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  searchControl: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
    color: colors.text,
    fontSize: 13,
  },
  clearButton: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  searchDivider: { width: 1, height: 24, backgroundColor: colors.borderWarm },
  filterButton: {
    position: 'relative',
    width: 48,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountBadge: {
    position: 'absolute',
    top: -3,
    right: -2,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  filterCountText: { color: colors.surface, fontSize: 10, fontWeight: '800' },
  resultCount: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  loadingIndicator: { flex: 1, backgroundColor: colors.surfaceWarm },
  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: 80,
  },
  stateTitle: { marginTop: spacing.md, color: colors.text, fontSize: 18, fontWeight: '800' },
  stateText: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  stateAction: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  stateActionText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  resultsContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  resultRow: { justifyContent: 'space-between', marginBottom: spacing.xl },
  productCard: { width: '48%' },
  productImageFrame: {
    position: 'relative',
    width: '100%',
    aspectRatio: 0.82,
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
  },
  productImage: { width: '100%', height: '100%' },
  favoriteButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  productDetails: { paddingTop: 6 },
  shopName: { color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  productTitle: {
    marginTop: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  price: { marginTop: 2, color: colors.text, fontSize: 13, fontWeight: '800' },
  filterModalRoot: { flex: 1, justifyContent: 'flex-end' },
  filterBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 29, 43, 0.38)',
  },
  filterBackdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  filterSheet: {
    width: '100%',
    maxWidth: 560,
    height: '78%',
    alignSelf: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 20,
  },
  filterSheetSafeArea: {
    flex: 1,
  },
  filterHeader: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderWarm,
  },
  filterTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  filterTitle: { color: colors.primary, fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  filterClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  filterContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  filterSection: { paddingVertical: spacing.lg },
  filterHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterLabel: { color: colors.text, fontSize: 12, fontWeight: '800' },
  resetText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  sortOptions: { gap: spacing.sm, marginTop: spacing.md },
  sortOption: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  sortOptionActive: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  sortIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  sortIconActive: { backgroundColor: colors.primary },
  sortCopy: { flex: 1 },
  sortLabel: { color: colors.text, fontSize: 12, fontWeight: '800' },
  sortLabelActive: { color: colors.primary },
  sortDescription: { color: colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  priceInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  priceSeparator: { color: colors.textMuted, fontSize: 16 },
  ratingFilterList: {
    gap: 4,
    marginTop: spacing.sm,
  },
  ratingFilterRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radii.sm,
  },
  ratingFilterRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceMuted,
  },
  ratingStars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingFilterText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  filterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  filterChip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  filterChipText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  filterChipTextActive: { color: colors.surface },
  filterFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
    backgroundColor: colors.surface,
  },
  applyButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  applyText: { color: colors.surface, fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
});
