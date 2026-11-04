import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme';

export default function ProductRating({ rating, count, compact = false }: { rating: number; count: number; compact?: boolean }) {
  const value = Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : 0;
  const label = value > 0 ? value.toFixed(1) : '0';

  return (
    <View style={[styles.row, compact && styles.compactRow]} accessible accessibilityLabel={`${label} out of 5 from ${count} ${count === 1 ? 'rating' : 'ratings'}`}>
      {compact ? (
        <View style={[styles.badge, value === 0 && styles.unratedBadge]}>
          <Ionicons name={value > 0 ? 'star' : 'star-outline'} size={11} color={value > 0 ? '#d4a52e' : '#8b9690'} />
          <Text style={[styles.badgeValue, value === 0 && styles.unratedValue]}>{label}</Text>
        </View>
      ) : (
        <>
          {[1, 2, 3, 4, 5].map(star => (
            <Ionicons
              key={star}
              name={value >= star ? 'star' : value >= star - 0.5 ? 'star-half' : 'star-outline'}
              size={11}
              color={value >= star - 0.5 ? colors.warning : colors.textMuted}
            />
          ))}
          <Text style={styles.value}>{label}</Text>
        </>
      )}
      <Text style={styles.count}>({count})</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4, flexWrap: 'wrap' },
  value: { color: colors.primary, fontSize: 11, fontWeight: '700', marginLeft: 2 },
  count: { color: colors.textMuted, fontSize: 10 },
  compactRow: { marginTop: 0, flexWrap: 'nowrap', gap: 4 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 4, paddingVertical: 1, borderWidth: 1, borderColor: '#f0dfb2', borderRadius: 3, backgroundColor: '#fffaf0' },
  badgeValue: { color: '#63501e', fontSize: 11, lineHeight: 15, fontWeight: '700' },
  unratedBadge: { backgroundColor: '#f5f7f6', borderColor: '#dfe6e2' },
  unratedValue: { color: '#64736b' },
});
