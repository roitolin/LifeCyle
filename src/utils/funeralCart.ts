import AsyncStorage from "@react-native-async-storage/async-storage";

const FUNERAL_CART_KEY = "funeral_cart_v1";

export type FuneralCartItem = {
  cartId: string;
  productId: string;
  shopId: string;
  shopName: string;
  name: string;
  price: string;
  imageUrl?: string | null;
  variationName?: string | null;
  packageItems?: string[];
  quantity: number;
};

export async function loadFuneralCart(): Promise<FuneralCartItem[]> {
  const raw = await AsyncStorage.getItem(FUNERAL_CART_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FuneralCartItem[]) : [];
  } catch {
    return [];
  }
}

export async function saveFuneralCart(items: FuneralCartItem[]) {
  await AsyncStorage.setItem(FUNERAL_CART_KEY, JSON.stringify(items));
}

export async function addFuneralCartItem(item: Omit<FuneralCartItem, "cartId" | "quantity">) {
  const current = await loadFuneralCart();
  const next = [
    ...current,
    {
      ...item,
      cartId: `${item.shopId}_${item.productId}_${item.variationName || "standard"}_${item.packageItems?.join("-") || "no-package"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      quantity: 1,
    },
  ];
  await saveFuneralCart(next);
  return next;
}

export async function removeFuneralCartItem(cartId: string) {
  const current = await loadFuneralCart();
  const next = current.filter((item: any) => item.cartId !== cartId);
  await saveFuneralCart(next);
  return next;
}

export async function removeFuneralCartItems(cartIds: string[]) {
  const current = await loadFuneralCart();
  const idSet = new Set(cartIds);
  const next = current.filter((item: FuneralCartItem) => !idSet.has(item.cartId));
  await saveFuneralCart(next);
  return next;
}

export async function updateFuneralCartQuantity(cartId: string, quantity: number) {
  const current = await loadFuneralCart();
  const next =
    quantity <= 0
      ? current.filter((item: any) => item.cartId !== cartId)
      : current.map((item: any) => (item.cartId === cartId ? { ...item, quantity } : item));
  await saveFuneralCart(next);
  return next;
}
