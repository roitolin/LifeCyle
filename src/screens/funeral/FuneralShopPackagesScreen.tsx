import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { generateId } from "@/utils/generateId";

type PackageItem = {
  id: string;
  name: string;
  imageUrl?: string | null;
};

type ShopPackage = {
  id?: string;
  shopId: string;
  items: PackageItem[];
  flowersImageUrl?: string | null;
  candlesImageUrl?: string | null;
  curtainsImageUrl?: string | null;
  vehicleImageUrl?: string | null;
  active?: boolean;
};

const MAX_PACKAGE_ITEMS = 12;

function normalizePackageItems(row?: Partial<ShopPackage> | null): PackageItem[] {
  if (Array.isArray(row?.items) && row.items.length > 0) {
    return row.items
      .map((item) => ({
        id: String(item?.id || generateId()),
        name: String(item?.name || ""),
        imageUrl: item?.imageUrl || null,
      }))
      .filter((item) => item.name || item.imageUrl);
  }

  return [
    { id: "legacy-flowers", name: "Flowers", imageUrl: row?.flowersImageUrl },
    { id: "legacy-candles", name: "Candles", imageUrl: row?.candlesImageUrl },
    { id: "legacy-curtains", name: "Curtains", imageUrl: row?.curtainsImageUrl },
    { id: "legacy-vehicle", name: "Vehicle", imageUrl: row?.vehicleImageUrl },
  ].filter((item) => Boolean(item.imageUrl));
}

export default function FuneralShopPackagesScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
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
        .select("id, shopId, items, flowersImageUrl, candlesImageUrl, curtainsImageUrl, vehicleImageUrl, active")
        .eq("shopId", user.uid)
        .maybeSingle();
      if (error) throw error;
      const row = data as ShopPackage | null;
      setPackageRow(row
        ? { ...row, items: normalizePackageItems(row) }
        : { shopId: user.uid, active: true, items: [] });
    } catch (error: any) {
      Alert.alert("Packages unavailable", error?.message || "Unable to load your package setup.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPackage();
  }, [loadPackage]);

  const addPackageItem = () => {
    setPackageRow((current) => {
      const row = current || { shopId: auth.currentUser?.uid || "", active: true, items: [] };
      if (row.items.length >= MAX_PACKAGE_ITEMS) return row;
      return { ...row, items: [...row.items, { id: generateId(), name: "", imageUrl: null }] };
    });
  };

  const updatePackageItem = (id: string, updates: Partial<PackageItem>) => {
    setPackageRow((current) => current
      ? { ...current, items: current.items.map((item) => item.id === id ? { ...item, ...updates } : item) }
      : current);
  };

  const removePackageItem = (id: string) => {
    setPackageRow((current) => current
      ? { ...current, items: current.items.filter((item) => item.id !== id) }
      : current);
  };

  const pickImage = async (item: PackageItem) => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.82,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingKey(item.id);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      updatePackageItem(item.id, { imageUrl: url });
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Unable to upload this package picture.");
    } finally {
      setUploadingKey(null);
    }
  };

  const savePackage = async () => {
    const user = auth.currentUser;
    if (!user || !packageRow || saving) return;

    const items = packageRow.items.map((item) => ({
      id: item.id,
      name: item.name.trim(),
      imageUrl: item.imageUrl || null,
    }));
    if (items.length === 0) {
      Alert.alert("Add an item", "Add at least one item to your package.");
      return;
    }
    const unnamedItem = items.find((item) => !item.name);
    if (unnamedItem) {
      Alert.alert("Name required", "Give every package item a name.");
      return;
    }
    const missingPhoto = items.find((item) => !item.imageUrl);
    if (missingPhoto) {
      Alert.alert("Picture required", `Add a picture for ${missingPhoto.name}.`);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("funeral_shop_packages").upsert({
        id: packageRow.id,
        shopId: user.uid,
        items,
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
          <Text style={styles.headerSub}>Create the inclusions your shop offers</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.introBlock}>
          <Text style={styles.sectionTitle}>Shop package</Text>
          <Text style={styles.sectionText}>Add the inclusions that come with every casket. They are covered by the selected casket price and update automatically on new and existing products.</Text>
        </View>

        <View style={styles.itemGrid}>
          {(packageRow?.items || []).map((item, index) => {
            const imageUrl = item.imageUrl;
            const uploading = uploadingKey === item.id;
            return (
              <View key={item.id} style={styles.itemBlock}>
                <View style={styles.itemTopRow}>
                  <View style={styles.itemTitleRow}>
                    <Ionicons name="gift-outline" size={17} color="#31433d" />
                    <Text style={styles.itemTitle}>Inclusion {index + 1}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => removePackageItem(item.id)}
                    disabled={saving || Boolean(uploadingKey)}
                    accessibilityLabel={`Remove ${item.name || `inclusion ${index + 1}`}`}
                  >
                    <Ionicons name="trash-outline" size={17} color="#a43b3b" />
                    <Text style={styles.removeButtonText}>Remove</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>What is included?</Text>
                <TextInput
                  style={styles.nameInput}
                  value={item.name}
                  onChangeText={(name) => updatePackageItem(item.id, { name })}
                  placeholder="Example: Memorial flower arrangement"
                  placeholderTextColor="#8a9590"
                  maxLength={80}
                  editable={!saving}
                />

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

        {(packageRow?.items.length || 0) === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="gift-outline" size={25} color="#718079" />
            <Text style={styles.emptyTitle}>No inclusions yet</Text>
            <Text style={styles.emptyText}>Add what your shop provides with its own name and photo.</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.addButton}
          onPress={addPackageItem}
          disabled={saving || Boolean(uploadingKey) || (packageRow?.items.length || 0) >= MAX_PACKAGE_ITEMS}
        >
          <Ionicons name="add-circle-outline" size={19} color="#22312d" />
          <Text style={styles.addButtonText}>{(packageRow?.items.length || 0) >= MAX_PACKAGE_ITEMS ? "Maximum 12 inclusions" : "Add Inclusion"}</Text>
        </TouchableOpacity>

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
  removeButton: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 5, paddingHorizontal: 3 },
  removeButtonText: { color: "#a43b3b", fontSize: 12, fontWeight: "800" },
  fieldLabel: { color: "#4e5d57", fontSize: 12, fontWeight: "800" },
  nameInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#d2d9d5",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    color: "#22312d",
    fontSize: 14,
    fontWeight: "700",
  },
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
  emptyState: { alignItems: "center", gap: 6, paddingVertical: 18, paddingHorizontal: 16 },
  emptyTitle: { color: "#22312d", fontSize: 15, fontWeight: "900" },
  emptyText: { color: "#69766f", fontSize: 13, lineHeight: 19, textAlign: "center" },
  addButton: {
    minHeight: 46,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#c9d2ce",
    borderStyle: "dashed",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
  },
  addButtonText: { color: "#22312d", fontSize: 13, fontWeight: "900" },
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
