import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme';

export default function ProductRating({ rating, count }: { rating: number; count: number }) {
  const value = Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : 0;
  const label = value > 0 ? value.toFixed(1) : '0';

  return (
    <View style={styles.row} accessible accessibilityLabel={`${label} out of 5 from ${count} ${count === 1 ? 'rating' : 'ratings'}`}>
      {[1, 2, 3, 4, 5].map(star => (
        <Ionicons
          key={star}
          name={value >= star ? 'star' : value >= star - 0.5 ? 'star-half' : 'star-outline'}
          size={11}
          color={value >= star - 0.5 ? colors.warning : colors.textMuted}
        />
      ))}
      <Text style={styles.value}>{label}</Text>
      <Text style={styles.count}>({count})</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4, flexWrap: 'wrap' },
  value: { color: colors.primary, fontSize: 11, fontWeight: '700', marginLeft: 2 },
  count: { color: colors.textMuted, fontSize: 10 },
});
