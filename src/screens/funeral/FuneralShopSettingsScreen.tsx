import { useCallback, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { AdminPaymentModal, AppBackButton, KeyboardAwareScrollView } from "@/components";
import LoadingBird from "@/components/LoadingBird";
import { auth, uploadCertificate } from "@/services";
import { supabase } from "@/services/supabaseClient";
import { formatPhilippinePeso } from "@/utils/funeralCatalog";
import { sanitizePlainText } from "@/utils/inputSecurity";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type ShopStatus = "none" | "pending" | "verified" | "live" | "offline" | "rejected";
type ShopRecord = {
  id: string;
  shopName?: string | null;
  shopAddress?: string | null;
  shopPhoneNumber?: string | null;
  shopImageUrl?: string | null;
  coverImageUrl?: string | null;
  paymentQrUrl?: string | null;
  serviceFeeAmount?: number | string | null;
  paidUntil?: string | null;
  status?: ShopStatus | null;
  rejectionReason?: string | null;
  individualRegisteredName?: string | null;
  businessName?: string | null;
  generalLocation?: string | null;
  registeredAddress?: string | null;
  zipCode?: string | null;
  tin?: string | null;
  vatRegistrationStatus?: boolean | null;
};
type ShopPayment = { status?: string | null; expiresAt?: string | null };
type SettingRowProps = {
  icon: IoniconName;
  label: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
};

function getStatusMeta(status: ShopStatus) {
  if (status === "live") return { label: "Live", color: "#236441", background: "#e3f3e8" };
  if (status === "offline") return { label: "Offline", color: "#5c6863", background: "#e9ecea" };
  if (status === "verified") return { label: "Ready to go live", color: "#245e47", background: "#e8f2ed" };
  if (status === "pending") return { label: "Pending review", color: "#8f561d", background: "#fff0dc" };
  if (status === "rejected") return { label: "Needs changes", color: "#963d38", background: "#fee9e7" };
  return { label: "Setup required", color: "#6c6259", background: "#eee9e3" };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#eef1ec" },
  body: { flex: 1 },
  headerSafeArea: { backgroundColor: "#f8f6f2" },
  headerBar: {
    minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#d9d6cd",
  },
  headerCopy: { flex: 1 },
  headerTitle: { color: "#22312d", fontSize: 20, fontWeight: "900" },
  content: { padding: 16, paddingBottom: 42, gap: 20 },
  identityCard: {
    overflow: "hidden", borderRadius: 22, borderWidth: 1, borderColor: "#cfd6d1", backgroundColor: "#ffffff",
  },
  identityBackdrop: { height: 54, backgroundColor: "#dce7dd" },
  identityCover: { width: "100%", height: "100%", opacity: 0.72 },
  identityContent: {
    minHeight: 92, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingBottom: 13,
  },
  identityAvatar: {
    width: 66, height: 66, borderRadius: 22, marginTop: -24, borderWidth: 3, borderColor: "#ffffff",
    backgroundColor: "#e9efea", overflow: "hidden", alignItems: "center", justifyContent: "center",
  },
  identityImage: { width: "100%", height: "100%" },
  identityCopy: { flex: 1, minWidth: 0, paddingTop: 8 },
  identityName: { color: "#22312d", fontSize: 17, fontWeight: "900" },
  identityAddress: { color: "#7a8580", fontSize: 11, marginTop: 3 },
  statusChip: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 4, marginTop: 7,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 9, fontWeight: "900" },
  editPill: {
    flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 999, backgroundColor: "#ebf1e8",
    paddingHorizontal: 9, paddingVertical: 7,
  },
  editPillText: { color: "#52635d", fontSize: 11, fontWeight: "900" },
  warningCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 16, borderWidth: 1,
    borderColor: "#efc3bf", backgroundColor: "#fff3f1", padding: 13,
  },
  warningCopy: { flex: 1 },
  warningTitle: { color: "#873f3a", fontSize: 13, fontWeight: "900" },
  warningText: { color: "#9a5c56", fontSize: 11, lineHeight: 16, marginTop: 3 },
  sectionLabel: { color: "#62706b", fontSize: 12, fontWeight: "700", marginLeft: 2, marginBottom: 8 },
  menuGroup: {
    overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: "#d9d6cd", backgroundColor: "#ffffff",
  },
  settingRow: {
    minHeight: 66, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 14,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#e8e5dd",
  },
  lastRow: { borderBottomWidth: 0 },
  rowDisabled: { opacity: 0.62 },
  rowIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: "#ebf1e8", alignItems: "center", justifyContent: "center",
  },
  rowIconDisabled: { backgroundColor: "#eff1ef" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { color: "#2d3d38", fontSize: 14, fontWeight: "800" },
  rowLabelDisabled: { color: "#808984" },
  rowDescription: { color: "#8a928d", fontSize: 10, lineHeight: 14, marginTop: 2 },
  rowValue: { maxWidth: 94, color: "#60706a", fontSize: 10, fontWeight: "800", textAlign: "right" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(21, 30, 27, 0.48)", justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalCard: {
    maxHeight: "90%", borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: "#f8f7f3", overflow: "hidden",
  },
  modalContent: { padding: 18, paddingBottom: 34 },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16,
  },
  modalTitle: { color: "#22312d", fontSize: 21, fontWeight: "900", marginTop: 3 },
  modalDescription: { color: "#697670", fontSize: 12, lineHeight: 18, marginBottom: 15 },
  closeButton: {
    width: 38, height: 38, borderRadius: 13, backgroundColor: "#e8ece9", alignItems: "center", justifyContent: "center",
  },
  photoPreview: {
    height: 142, borderRadius: 19, backgroundColor: "#e5eae6", overflow: "visible", marginBottom: 30,
  },
  coverPreview: { width: "100%", height: "100%", borderRadius: 19 },
  photoFallback: { alignItems: "center", justifyContent: "center" },
  logoPreview: {
    position: "absolute", left: 16, bottom: -25, width: 66, height: 66, borderRadius: 22,
    borderWidth: 3, borderColor: "#f8f7f3", backgroundColor: "#e9efea", overflow: "hidden",
    alignItems: "center", justifyContent: "center",
  },
  logoImage: { width: "100%", height: "100%" },
  photoActions: { flexDirection: "row", gap: 9, marginBottom: 4 },
  outlineButton: {
    flex: 1, minHeight: 40, borderRadius: 13, borderWidth: 1, borderColor: "#d9cbbb",
    backgroundColor: "#ffffff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  outlineButtonText: { color: "#765f49", fontSize: 11, fontWeight: "900" },
  inputLabel: { color: "#52615c", fontSize: 11, fontWeight: "900", marginTop: 13, marginBottom: 6 },
  input: {
    minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: "#d3d8d4", backgroundColor: "#ffffff",
    paddingHorizontal: 13, color: "#22312d", fontSize: 14,
  },
  multilineInput: { minHeight: 82, paddingTop: 13, textAlignVertical: "top" },
  primaryButton: {
    minHeight: 50, borderRadius: 15, backgroundColor: "#22312d", flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 7, marginTop: 18,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  buttonDisabled: { opacity: 0.55 },
  readOnlyNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 14,
    backgroundColor: "#ecefeb", padding: 11, marginBottom: 13,
  },
  readOnlyNoteText: { flex: 1, color: "#6c7772", fontSize: 11, lineHeight: 16 },
  detailGroup: {
    overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: "#ddd9d1", backgroundColor: "#ffffff",
  },
  detailLine: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#ece8e1" },
  detailLabel: {
    color: "#8a928d", fontSize: 9, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase",
  },
  detailValue: { color: "#2f3f3a", fontSize: 13, lineHeight: 18, fontWeight: "700", marginTop: 3 },
  outlineWideButton: {
    minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: "#d1d8d3", backgroundColor: "#ffffff",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 14,
  },
  outlineWideButtonText: { color: "#52635d", fontSize: 12, fontWeight: "900" },
  qrPreviewWrap: {
    height: 230, borderRadius: 19, borderWidth: 1, borderColor: "#d8ddd9", backgroundColor: "#ffffff", overflow: "hidden",
  },
  qrPreview: { width: "100%", height: "100%" },
  qrEmpty: {
    height: 190, borderRadius: 19, borderWidth: 1, borderStyle: "dashed", borderColor: "#c8cec9",
    backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", gap: 8,
  },
  qrEmptyText: { color: "#74807a", fontSize: 12, fontWeight: "800" },
  infoNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 14,
    backgroundColor: "#f3ede5", padding: 11, marginTop: 14,
  },
  infoNoteText: { flex: 1, color: "#765f49", fontSize: 11, lineHeight: 16 },
});

function formatDate(value?: string | null) {
  if (!value) return "Not active";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not active";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function SettingsSection({ label, children }: { label: string; children: ReactNode }) {
  return <View><Text style={styles.sectionLabel}>{label}</Text><View style={styles.menuGroup}>{children}</View></View>;
}

function SettingRow({ icon, label, description, value, onPress, last, disabled, trailing }: SettingRowProps) {
  const content = (
    <>
      <View style={[styles.rowIcon, disabled ? styles.rowIconDisabled : null]}>
        <Ionicons name={icon} size={20} color={disabled ? "#9ca49f" : "#41514d"} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, disabled ? styles.rowLabelDisabled : null]}>{label}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
      {trailing || (onPress ? <Ionicons name="chevron-forward" size={18} color="#8a928d" /> : null)}
    </>
  );
  if (!onPress) return <View style={[styles.settingRow, last ? styles.lastRow : null]}>{content}</View>;
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} activeOpacity={0.82} disabled={disabled}
      onPress={onPress} style={[styles.settingRow, last ? styles.lastRow : null, disabled ? styles.rowDisabled : null]}>
      {content}
    </TouchableOpacity>
  );
}

function DetailLine({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  return (
    <View style={[styles.detailLine, last ? styles.lastRow : null]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || "Not provided"}</Text>
    </View>
  );
}

export default function FuneralShopSettingsScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [shop, setShop] = useState<ShopRecord | null>(null);
  const [payment, setPayment] = useState<ShopPayment | null>(null);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [businessVisible, setBusinessVisible] = useState(false);
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [adminPaymentsVisible, setAdminPaymentsVisible] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingImage, setUploadingImage] = useState<"logo" | "cover" | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ name: "", address: "", phone: "", logo: null as string | null, cover: null as string | null });
  const [paymentDraft, setPaymentDraft] = useState({ qr: null as string | null, amount: "" });

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      let shopId = auth.currentUser?.uid || null;
      if (!shopId) {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        shopId = sessionData.session?.user?.id || null;
      }
      if (!shopId) { setShop(null); return; }
      const [{ data: shopData, error: shopError }, { data: paymentData, error: paymentError }] = await Promise.all([
        supabase.from("funeral_shops").select("*").eq("id", shopId).maybeSingle(),
        supabase.from("shop_payments").select('status, "expiresAt"').eq("shopId", shopId)
          .order("createdAt", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (shopError) throw shopError;
      if (paymentError) throw paymentError;
      setShop((shopData as ShopRecord | null) || null);
      setPayment((paymentData as ShopPayment | null) || null);
    } catch (error: any) {
      Alert.alert("Settings unavailable", error?.message || "Unable to load shop settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadSettings(); }, [loadSettings]));

  const status = (shop?.status || "none") as ShopStatus;
  const statusMeta = getStatusMeta(status);
  const isVerified = ["verified", "live", "offline"].includes(status);
  const paymentReady = Boolean(shop?.paymentQrUrl && Number(shop?.serviceFeeAmount) > 0);
  const latestPaymentVerified = String(payment?.status || "").toLowerCase() === "verified";
  const subscriptionExpired = Boolean(shop?.paidUntil && new Date(shop.paidUntil).getTime() <= Date.now());

  const handleBack = () => navigation.canGoBack?.() ? navigation.goBack() : navigation.navigate("ShopCenter");
  const openProfile = () => {
    setProfileDraft({
      name: String(shop?.shopName || ""),
      address: String(shop?.shopAddress || ""),
      phone: String(shop?.shopPhoneNumber || ""),
      logo: shop?.shopImageUrl || null,
      cover: shop?.coverImageUrl || null,
    });
    setProfileVisible(true);
  };
  const openPayment = () => {
    if (!isVerified) {
      Alert.alert("Shop Approval Required", "Your shop must be approved before family payment settings can be changed.");
      return;
    }
    setPaymentDraft({
      qr: shop?.paymentQrUrl || null,
      amount: Number(shop?.serviceFeeAmount) > 0 ? String(Number(shop?.serviceFeeAmount)) : "",
    });
    setPaymentVisible(true);
  };

  const pickProfileImage = async (kind: "logo" | "cover") => {
    const picker = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.82 });
    if (picker.canceled || !picker.assets[0]) return;
    setUploadingImage(kind);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setProfileDraft((current) => ({ ...current, [kind]: url }));
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Unable to upload the selected image.");
    } finally { setUploadingImage(null); }
  };

  const saveProfile = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const name = sanitizePlainText(profileDraft.name, 120);
    const address = sanitizePlainText(profileDraft.address, 220);
    const phone = sanitizePlainText(profileDraft.phone, 24);
    if (!name || !address || !phone) {
      Alert.alert("Missing information", "Shop name, address, and phone number are required.");
      return;
    }
    setSavingProfile(true);
    try {
      const update = { shopName: name, shopAddress: address, shopPhoneNumber: phone, shopImageUrl: profileDraft.logo,
        coverImageUrl: profileDraft.cover, updatedAt: new Date().toISOString() };
      const { error } = await supabase.from("funeral_shops").update(update).eq("id", user.uid);
      if (error) throw error;
      setShop((current) => current ? { ...current, ...update } : current);
      setProfileVisible(false);
      Alert.alert("Shop profile saved", "Your public storefront information has been updated.");
    } catch (error: any) {
      Alert.alert("Save failed", error?.message || "Unable to update the shop profile.");
    } finally { setSavingProfile(false); }
  };

  const pickPaymentQr = async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.9 });
    if (picker.canceled || !picker.assets[0]) return;
    setUploadingQr(true);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setPaymentDraft((current) => ({ ...current, qr: url }));
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Unable to upload the payment QR.");
    } finally { setUploadingQr(false); }
  };

  const saveFamilyPayment = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const amount = Number(paymentDraft.amount.trim().replace(/[^\d.]/g, ""));
    if (!paymentDraft.qr || !Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Complete payment setup", "Upload a QR code and enter a valid amount.");
      return;
    }
    setSavingPayment(true);
    try {
      const update = { paymentQrUrl: paymentDraft.qr, serviceFeeAmount: amount, updatedAt: new Date().toISOString() };
      const { error } = await supabase.from("funeral_shops").update(update).eq("id", user.uid);
      if (error) throw error;
      setShop((current) => current ? { ...current, ...update } : current);
      setPaymentVisible(false);
      Alert.alert("Payment settings saved", "Families will use this QR and amount after you accept their request.");
    } catch (error: any) {
      Alert.alert("Save failed", error?.message || "Unable to update family payment settings.");
    } finally { setSavingPayment(false); }
  };

  const toggleAvailability = (nextLive: boolean) => {
    const user = auth.currentUser;
    if (!user || savingAvailability) return;
    if (!isVerified) { Alert.alert("Shop Approval Required", "Your shop must be approved before it can go live."); return; }
    if (nextLive && !latestPaymentVerified) { Alert.alert("Payment Required", "A verified LifeCycle registration payment is required before your shop can go live."); return; }
    if (nextLive && subscriptionExpired) { Alert.alert("Subscription Expired", "Renew your LifeCycle registration payment before making the shop live."); return; }
    Alert.alert(nextLive ? "Make shop live?" : "Take shop offline?",
      nextLive ? "Families will be able to find your storefront and available products." : "Your storefront will be hidden, but your subscription time will continue.", [
      { text: "Cancel", style: "cancel" },
      { text: nextLive ? "Go Live" : "Go Offline", style: nextLive ? "default" : "destructive", onPress: async () => {
        setSavingAvailability(true);
        try {
          let paidUntil = shop?.paidUntil || null;
          if (nextLive && !paidUntil) { const nextEnd = new Date(); nextEnd.setMonth(nextEnd.getMonth() + 1); paidUntil = nextEnd.toISOString(); }
          const update = { status: nextLive ? "live" : "offline", paidUntil, updatedAt: new Date().toISOString() };
          const { error } = await supabase.from("funeral_shops").update(update).eq("id", user.uid);
          if (error) throw error;
          setShop((current) => current ? { ...current, ...update, status: update.status as ShopStatus } : current);
        } catch (error: any) {
          Alert.alert("Update failed", error?.message || "Unable to change storefront availability.");
        } finally { setSavingAvailability(false); }
      }},
    ]);
  };

  const openStorefront = () => {
    if (shop?.id) navigation.navigate("ShopProducts", { shopId: shop.id, shopName: shop.shopName || "My Shop" });
  };
  if (loading) return <SafeAreaView style={styles.screen}><LoadingBird fullScreen /></SafeAreaView>;

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.headerSafeArea}>
        <View style={styles.headerBar}>
          <AppBackButton onPress={handleBack} />
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Shop Settings</Text>
          </View>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.body}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={styles.identityCard} activeOpacity={0.86} onPress={openProfile}>
            <View style={styles.identityBackdrop}>
              {shop?.coverImageUrl ? <Image source={{ uri: shop.coverImageUrl }} style={styles.identityCover} resizeMode="cover" /> : null}
            </View>
            <View style={styles.identityContent}>
              <View style={styles.identityAvatar}>
                {shop?.shopImageUrl ? (
                  <Image source={{ uri: shop.shopImageUrl }} style={styles.identityImage} resizeMode="cover" />
                ) : (
                  <Ionicons name="storefront-outline" size={28} color="#33443e" />
                )}
              </View>
              <View style={styles.identityCopy}>
                <Text style={styles.identityName} numberOfLines={1}>{shop?.shopName || "My Shop"}</Text>
                <Text style={styles.identityAddress} numberOfLines={1}>{shop?.shopAddress || "Add your shop address"}</Text>
                <View style={[styles.statusChip, { backgroundColor: statusMeta.background }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
                  <Text style={[styles.statusText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
                </View>
              </View>
              <View style={styles.editPill}>
                <Text style={styles.editPillText}>Edit</Text>
                <Ionicons name="chevron-forward" size={15} color="#52635d" />
              </View>
            </View>
          </TouchableOpacity>

          {status === "rejected" && shop?.rejectionReason ? (
            <View style={styles.warningCard}>
              <Ionicons name="alert-circle-outline" size={20} color="#963d38" />
              <View style={styles.warningCopy}>
                <Text style={styles.warningTitle}>Shop profile needs changes</Text>
                <Text style={styles.warningText}>{shop.rejectionReason}</Text>
              </View>
            </View>
          ) : null}

          <SettingsSection label="Storefront">
            <SettingRow icon="storefront-outline" label="Shop Profile" description="Logo, cover, shop name, address, and contact" onPress={openProfile} />
            <SettingRow icon="business-outline" label="Registered Business Information" description="Owner, business address, TIN, and VAT status" onPress={() => setBusinessVisible(true)} />
            <SettingRow icon="eye-outline" label="View Public Storefront" description="Preview what families see" onPress={openStorefront} last />
          </SettingsSection>

          <SettingsSection label="Payments & Billing">
            <SettingRow icon="qr-code-outline" label="Family Payment Setup"
              description={paymentReady ? "QR code and default amount are ready" : "Add the QR and amount shown after acceptance"}
              value={paymentReady ? formatPhilippinePeso(String(shop?.serviceFeeAmount)) : "Incomplete"}
              onPress={openPayment} disabled={!isVerified} />
            <SettingRow icon="card-outline" label="LifeCycle Payments"
              description="Registration payment, renewal, and payment history"
              onPress={() => setAdminPaymentsVisible(true)} />
            <SettingRow icon="calendar-outline" label="Subscription"
              description={subscriptionExpired ? "Renewal is required before going live" : "Storefront access period"}
              value={formatDate(shop?.paidUntil)} onPress={() => setAdminPaymentsVisible(true)} last />
          </SettingsSection>

          <SettingsSection label="Store Preferences">
            <SettingRow icon={status === "live" ? "radio-outline" : "moon-outline"} label="Storefront Availability"
              description={isVerified ? (status === "live" ? "Families can currently find your shop" : "Your storefront is hidden from families") : "Available after shop approval"}
              disabled={!isVerified || savingAvailability}
              trailing={savingAvailability ? <ActivityIndicator size="small" color="#41514d" /> : (
                <Switch value={status === "live"} onValueChange={toggleAvailability} disabled={!isVerified}
                  trackColor={{ false: "#ccd2ce", true: "#8eb5a2" }} thumbColor={status === "live" ? "#2f6b55" : "#f6f7f6"} />
              )} />
            <SettingRow icon="notifications-outline" label="Notification Preferences"
              description="Choose shop alerts and notification sounds"
              onPress={() => navigation.navigate("NotificationPreferences")} last />
          </SettingsSection>

          <SettingsSection label="Help">
            <SettingRow icon="help-circle-outline" label="Contact LifeCycle Support"
              description="Get help with your shop or payments" onPress={() => navigation.navigate("Contact")} last />
          </SettingsSection>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={profileVisible} transparent animationType="fade" onRequestClose={() => setProfileVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setProfileVisible(false)} />
          <View style={styles.modalCard}>
            <KeyboardAwareScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>Edit Shop Profile</Text>
                </View>
                <TouchableOpacity style={styles.closeButton} onPress={() => setProfileVisible(false)}>
                  <Ionicons name="close" size={20} color="#53615d" />
                </TouchableOpacity>
              </View>
              <View style={styles.photoPreview}>
                {profileDraft.cover ? (
                  <Image source={{ uri: profileDraft.cover }} style={styles.coverPreview} resizeMode="cover" />
                ) : (
                  <View style={[styles.coverPreview, styles.photoFallback]}><Ionicons name="image-outline" size={26} color="#8b9691" /></View>
                )}
                <View style={styles.logoPreview}>
                  {profileDraft.logo ? (
                    <Image source={{ uri: profileDraft.logo }} style={styles.logoImage} resizeMode="cover" />
                  ) : (
                    <Ionicons name="storefront-outline" size={28} color="#43534d" />
                  )}
                </View>
              </View>
              <View style={styles.photoActions}>
                <TouchableOpacity style={styles.outlineButton} onPress={() => void pickProfileImage("cover")} disabled={Boolean(uploadingImage)}>
                  {uploadingImage === "cover" ? <ActivityIndicator size="small" color="#765f49" /> : <Ionicons name="image-outline" size={17} color="#765f49" />}
                  <Text style={styles.outlineButtonText}>Cover</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.outlineButton} onPress={() => void pickProfileImage("logo")} disabled={Boolean(uploadingImage)}>
                  {uploadingImage === "logo" ? <ActivityIndicator size="small" color="#765f49" /> : <Ionicons name="camera-outline" size={17} color="#765f49" />}
                  <Text style={styles.outlineButtonText}>Shop logo</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.inputLabel}>Shop Name</Text>
              <TextInput style={styles.input} value={profileDraft.name}
                onChangeText={(name) => setProfileDraft((current) => ({ ...current, name }))} />
              <Text style={styles.inputLabel}>Shop Address</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={profileDraft.address}
                onChangeText={(address) => setProfileDraft((current) => ({ ...current, address }))} multiline />
              <Text style={styles.inputLabel}>Phone Number</Text>
              <TextInput style={styles.input} value={profileDraft.phone}
                onChangeText={(phone) => setProfileDraft((current) => ({ ...current, phone }))} keyboardType="phone-pad" />
              <TouchableOpacity style={[styles.primaryButton, savingProfile ? styles.buttonDisabled : null]}
                onPress={() => void saveProfile()} disabled={savingProfile || Boolean(uploadingImage)}>
                {savingProfile ? <ActivityIndicator size="small" color="#ffffff" /> : <Ionicons name="checkmark-circle-outline" size={18} color="#ffffff" />}
                <Text style={styles.primaryButtonText}>{savingProfile ? "Saving..." : "Save Shop Profile"}</Text>
              </TouchableOpacity>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={businessVisible} transparent animationType="fade" onRequestClose={() => setBusinessVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setBusinessVisible(false)} />
          <View style={styles.modalCard}>
            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>Business Information</Text>
                </View>
                <TouchableOpacity style={styles.closeButton} onPress={() => setBusinessVisible(false)}>
                  <Ionicons name="close" size={20} color="#53615d" />
                </TouchableOpacity>
              </View>
              <View style={styles.readOnlyNote}>
                <Ionicons name="lock-closed-outline" size={17} color="#6c7772" />
                <Text style={styles.readOnlyNoteText}>Contact support if legal registration details need to be corrected.</Text>
              </View>
              <View style={styles.detailGroup}>
                <DetailLine label="Business name" value={shop?.businessName} />
                <DetailLine label="Registered owner" value={shop?.individualRegisteredName} />
                <DetailLine label="General location" value={shop?.generalLocation} />
                <DetailLine label="Registered address" value={shop?.registeredAddress} />
                <DetailLine label="ZIP code" value={shop?.zipCode} />
                <DetailLine label="TIN" value={shop?.tin} />
                <DetailLine label="VAT status" value={shop?.vatRegistrationStatus ? "VAT Registered" : "Non Registered"} last />
              </View>
              <TouchableOpacity style={styles.outlineWideButton} onPress={() => { setBusinessVisible(false); navigation.navigate("Contact"); }}>
                <Ionicons name="help-circle-outline" size={18} color="#52635d" />
                <Text style={styles.outlineWideButtonText}>Request a correction</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={paymentVisible} transparent animationType="fade" onRequestClose={() => setPaymentVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setPaymentVisible(false)} />
          <View style={styles.modalCard}>
            <KeyboardAwareScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>Payment Setup</Text>
                </View>
                <TouchableOpacity style={styles.closeButton} onPress={() => setPaymentVisible(false)}>
                  <Ionicons name="close" size={20} color="#53615d" />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalDescription}>Set the QR and default amount families see only after your shop accepts a request.</Text>
              {paymentDraft.qr ? (
                <View style={styles.qrPreviewWrap}>
                  <Image source={{ uri: paymentDraft.qr }} style={styles.qrPreview} resizeMode="contain" />
                </View>
              ) : (
                <TouchableOpacity style={styles.qrEmpty} onPress={() => void pickPaymentQr()} disabled={uploadingQr}>
                  {uploadingQr ? <ActivityIndicator color="#765f49" /> : <Ionicons name="qr-code-outline" size={36} color="#9ca59f" />}
                  <Text style={styles.qrEmptyText}>{uploadingQr ? "Uploading..." : "Upload payment QR"}</Text>
                </TouchableOpacity>
              )}
              {paymentDraft.qr ? (
                <TouchableOpacity style={styles.outlineWideButton} onPress={() => void pickPaymentQr()} disabled={uploadingQr}>
                  {uploadingQr ? <ActivityIndicator size="small" color="#52635d" /> : <Ionicons name="image-outline" size={18} color="#52635d" />}
                  <Text style={styles.outlineWideButtonText}>Replace QR image</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.inputLabel}>Default Amount</Text>
              <TextInput style={styles.input} value={paymentDraft.amount}
                onChangeText={(amount) => setPaymentDraft((current) => ({ ...current, amount }))}
                placeholder="e.g. 5000" keyboardType="decimal-pad" />
              <View style={styles.infoNote}>
                <Ionicons name="information-circle-outline" size={18} color="#765f49" />
                <Text style={styles.infoNoteText}>This does not change payments already submitted for existing requests.</Text>
              </View>
              <TouchableOpacity style={[styles.primaryButton, savingPayment || !paymentDraft.qr ? styles.buttonDisabled : null]}
                onPress={() => void saveFamilyPayment()} disabled={savingPayment || uploadingQr || !paymentDraft.qr}>
                {savingPayment ? <ActivityIndicator size="small" color="#ffffff" /> : <Ionicons name="checkmark-circle-outline" size={18} color="#ffffff" />}
                <Text style={styles.primaryButtonText}>{savingPayment ? "Saving..." : "Save Payment Setup"}</Text>
              </TouchableOpacity>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      <AdminPaymentModal visible={adminPaymentsVisible} onClose={() => setAdminPaymentsVisible(false)}
        onChanged={() => void loadSettings()} />
    </View>
  );
}
