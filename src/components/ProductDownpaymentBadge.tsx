import { StyleSheet, Text, View } from 'react-native';

type PaymentTerms = {
  price: number | string;
  downpaymentEnabled?: boolean;
  downpaymentAmount?: number | string | null;
  downpaymentPercentage?: number | null;
};

export default function ProductDownpaymentBadge({ product }: { product: PaymentTerms }) {
  const amount = Number(product.downpaymentAmount);
  const percentage = Number(product.downpaymentPercentage);
  const price = Number(String(product.price).replace(/[^\d.]/g, ''));
  if (!product.downpaymentEnabled || !Number.isFinite(amount) || amount <= 0 || amount > price
    || !Number.isFinite(price) || price <= 0 || !Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return null;

  return (
    <View style={styles.badge} accessible accessibilityLabel={`${percentage}% down payment available`} pointerEvents="none">
      <Text style={styles.label}><Text style={styles.percentage}>{percentage}%</Text> down payment</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', bottom: 8, left: 8, right: 8, alignItems: 'flex-start' },
  label: { paddingHorizontal: 6, paddingVertical: 3, color: '#315f50', backgroundColor: 'rgba(251, 253, 251, 0.97)', borderWidth: 1, borderColor: '#bfd4c7', borderRadius: 3, fontSize: 10, lineHeight: 14, fontWeight: '600' },
  percentage: { fontWeight: '800' },
});
