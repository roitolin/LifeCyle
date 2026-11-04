import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import ProductRating from '@/components/ProductRating';

type Props = {
  rating: number;
  ratingCount: number;
  stock?: number;
  shopName?: string;
};

export default function ProductCardMeta({ rating, ratingCount, stock, shopName }: Props) {
  const stockCount = stock != null && Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : null;

  return (
    <View style={styles.meta}>
      <View style={styles.row}>
        <ProductRating rating={rating} count={ratingCount} compact />
        {stockCount != null ? (
          <View style={styles.stock}>
            <Text style={styles.stockText}>{stockCount} left</Text>
          </View>
        ) : null}
      </View>
      {shopName ? (
        <View style={styles.shop}>
          <Ionicons name="storefront-outline" size={12} color="#78877f" />
          <Text style={styles.shopName} numberOfLines={1}>{shopName}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { marginTop: 5, gap: 5 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  stock: { paddingLeft: 6, borderLeftWidth: 1, borderLeftColor: '#dfe6e1' },
  stockText: { color: '#66766d', fontSize: 11, lineHeight: 15 },
  shop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shopName: { flex: 1, color: '#78877f', fontSize: 11, lineHeight: 15 },
});
