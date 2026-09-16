import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { AppBackButton } from "@/components";
import LoadingBird from "@/components/LoadingBird";
import { auth, uploadCertificate } from "@/services";
import { supabase } from "@/services/supabaseClient";

type PackageKey = "flowers" | "candles" | "curtains" | "vehicle";

type ShopPackage = {
  id?: string;
  shopId: string;
  flowersImageUrl?: string | null;
  candlesImageUrl?: string | null;
  curtainsImageUrl?: string | null;
  vehicleImageUrl?: string | null;
  active?: boolean;
};

const PACKAGE_ITEMS: { key: PackageKey; label: string; icon: keyof typeof Ionicons.glyphMap; field: keyof ShopPackage }[] = [
  { key: "flowers", label: "Flowers", icon: "flower-outline", field: "flowersImageUrl" },
  { key: "candles", label: "Candles", icon: "flame-outline", field: "candlesImageUrl" },
  { key: "curtains", label: "Curtains", icon: "albums-outline", field: "curtainsImageUrl" },
  { key: "vehicle", label: "Vehicle", icon: "car-outline", field: "vehicleImageUrl" },
];

export default function FuneralShopPackagesScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<PackageKey | null>(null);
  const [packageRow, setPackageRow] = useState<ShopPackage | null>(null);

  const loadPackage = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setPackageRow(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("funeral_shop_packages")
        .select("id, shopId, flowersImageUrl, candlesImageUrl, curtainsImageUrl, vehicleImageUrl, active")
        .eq("shopId", user.uid)
        .maybeSingle();
      if (error) throw error;
      setPackageRow((data as ShopPackage | null) || { shopId: user.uid, active: true });
    } catch (error: any) {
      Alert.alert("Packages unavailable", error?.message || "Unable to load your package setup.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPackage();
  }, [loadPackage]);

  const pickImage = async (item: (typeof PACKAGE_ITEMS)[number]) => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.82,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingKey(item.key);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setPackageRow((current) => ({ ...current, shopId: current?.shopId || auth.currentUser?.uid || "", [item.field]: url }));
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || `Unable to upload ${item.label.toLowerCase()} picture.`);
    } finally {
      setUploadingKey(null);
    }
  };

  const savePackage = async () => {
    const user = auth.currentUser;
    if (!user || !packageRow || saving) return;

    const missing = PACKAGE_ITEMS.find((item) => !packageRow[item.field]);
    if (missing) {
      Alert.alert("Picture required", `Add a picture for ${missing.label}.`);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("funeral_shop_packages").upsert({
        id: packageRow.id,
        shopId: user.uid,
        flowersImageUrl: packageRow.flowersImageUrl,
        candlesImageUrl: packageRow.candlesImageUrl,
        curtainsImageUrl: packageRow.curtainsImageUrl,
        vehicleImageUrl: packageRow.vehicleImageUrl,
        active: true,
        updatedAt: new Date().toISOString(),
      }, { onConflict: "shopId" });
      if (error) throw error;
      Alert.alert("Saved", "Your shop package is ready for your products.");
      await loadPackage();
    } catch (error: any) {
      Alert.alert("Save failed", error?.message || "Unable to save your package setup.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <LoadingBird fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <AppBackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Packages</Text>
          <Text style={styles.headerSub}>One package used by every product</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.introBlock}>
          <Text style={styles.sectionTitle}>Shop package</Text>
          <Text style={styles.sectionText}>Add pictures for Flowers, Candles, Curtains, and Vehicle once. New and existing products will show this package automatically.</Text>
        </View>

        <View style={styles.itemGrid}>
          {PACKAGE_ITEMS.map((item) => {
            const imageUrl = packageRow?.[item.field] as string | null | undefined;
            const uploading = uploadingKey === item.key;
            return (
              <View key={item.key} style={styles.itemBlock}>
                <View style={styles.itemTopRow}>
                  <View style={styles.itemTitleRow}>
                    <Ionicons name={item.icon} size={17} color="#31433d" />
                    <Text style={styles.itemTitle}>{item.label}</Text>
                  </View>
                  {imageUrl ? <Ionicons name="checkmark-circle" size={18} color="#2f7b57" /> : null}
                </View>

                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.preview} resizeMode="cover" />
                ) : (
                  <View style={styles.placeholder}>
                    {uploading ? <ActivityIndicator color="#22312d" size="small" /> : <Ionicons name="image-outline" size={24} color="#88948e" />}
                  </View>
                )}

                <TouchableOpacity style={styles.imageButton} onPress={() => void pickImage(item)} disabled={uploading || saving}>
                  <Text style={styles.imageButtonText}>{imageUrl ? "Replace Picture" : "Add Picture"}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={savePackage} disabled={saving || Boolean(uploadingKey)}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="save-outline" size={18} color="#fff" />}
          <Text style={styles.primaryButtonText}>Save Package</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f3f5f7" },
  header: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#dde3e0",
    backgroundColor: "#ffffff",
  },
  headerCopy: { flex: 1 },
  headerTitle: { color: "#1d2b27", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#69766f", fontSize: 12, fontWeight: "700", marginTop: 2 },
  content: { padding: 18, paddingBottom: 120, gap: 18 },
  introBlock: { gap: 6, paddingBottom: 4 },
  sectionTitle: { color: "#1d2b27", fontSize: 17, fontWeight: "900" },
  sectionText: { color: "#61706a", fontSize: 13, lineHeight: 20 },
  itemGrid: { gap: 14 },
  itemBlock: {
    borderWidth: 1,
    borderColor: "#d7dedb",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 10,
  },
  itemTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  itemTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  itemTitle: { color: "#22312d", fontSize: 15, fontWeight: "900" },
  preview: { width: "100%", height: 170, borderRadius: 8, backgroundColor: "#eef2f0" },
  placeholder: {
    height: 170,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#d2d9d5",
    backgroundColor: "#fafafa",
    alignItems: "center",
    justifyContent: "center",
  },
  imageButton: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: "#edf2ef",
    borderWidth: 1,
    borderColor: "#d2d9d5",
    alignItems: "center",
    justifyContent: "center",
  },
  imageButtonText: { color: "#22312d", fontSize: 13, fontWeight: "900" },
  primaryButton: {
    minHeight: 50,
    borderRadius: 10,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
});
