import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Card, Button as PaperButton, Chip } from "react-native-paper";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/services/supabaseClient";
import { auth, uploadProfilePicture } from "@/services";
import { useAuth } from "@/context/AuthContext";
import { useResponsive } from "@/utils/responsive";
import { subscribeTabRefresh } from "@/utils/tabRefresh";

const otherDefault = require("../../../assets/Male_Default_Profile.png");

type ShopStatus = "none" | "pending" | "verified" | "live" | "offline" | "rejected";

export default function FuneralProfileScreen({ navigation }: any) {
  const { isDesktop } = useResponsive();
  const { logout } = useAuth();

  const [fullName, setFullName] = useState("");
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [shopStatus, setShopStatus] = useState<ShopStatus>("none");
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [shopInfo, setShopInfo] = useState<{ shopName?: string; shopAddress?: string; shopPhoneNumber?: string } | null>(null);
  const [businessInfo, setBusinessInfo] = useState<{ generalLocation?: string; registeredAddress?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [startRegistrationVisible, setStartRegistrationVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const getDefaultImage = () => {
    return otherDefault;
  };

  const loadProfile = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const { data: userData } = await supabase
        .from("users")
        .select("*")
        .eq("id", user.uid)
        .single();

      if (!userData) return;

      setFullName(userData.fullName || "");
      setPhotoURL(userData.photoURL || null);

      // Load shop status from funeral_shops table
      const { data: shopData } = await supabase
        .from("funeral_shops")
        .select("*")
        .eq("id", user.uid)
        .maybeSingle();

      if (shopData) {
        setShopStatus((shopData.status || "pending") as ShopStatus);
        setRejectionReason(shopData.rejectionReason || null);
        setShopInfo({
          shopName: shopData.shopName,
          shopAddress: shopData.shopAddress,
          shopPhoneNumber: shopData.shopPhoneNumber,
        });
        setBusinessInfo({
          generalLocation: shopData.generalLocation,
          registeredAddress: shopData.registeredAddress,
        });
      } else {
        setShopStatus("none");
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load profile.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
      const unsubscribe = subscribeTabRefresh("Profile", () => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        void loadProfile();
      });
      return unsubscribe;
    }, [loadProfile])
  );


  const uploadProfilePic = async (uri: string) => {
    setUploading(true);
    try {
      const downloadURL = await uploadProfilePicture(uri);
      const user = auth.currentUser;
      if (!user) throw new Error("Not logged in");

      await supabase.from("users").update({ photoURL: downloadURL, updatedAt: new Date().toISOString() }).eq("id", user.uid);
      setPhotoURL(downloadURL);
      Alert.alert("Success", "Profile picture updated.");
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Failed to upload profile photo.");
    } finally {
      setUploading(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });

    if (!result.canceled && result.assets[0]) {
      await uploadProfilePic(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Camera permission is required.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });

    if (!result.canceled && result.assets[0]) {
      await uploadProfilePic(result.assets[0].uri);
    }
  };


  const shopStatusColor =
    shopStatus === "live"
      ? "#1677ff"
      : shopStatus === "verified"
      ? "#15803d"
      : shopStatus === "offline"
      ? "#6b7280"
      : shopStatus === "pending"
      ? "#9a7c5d"
      : shopStatus === "rejected"
      ? "#b91c1c"
      : "#6b7280";

  const shopActionLabel = shopStatus === "none" || shopStatus === "rejected" ? "Register Shop" : "Shop Center";

  const handlePrimaryAction = () => {
    if (shopStatus === "none" || shopStatus === "rejected") {
      setStartRegistrationVisible(true);
      return;
    }

    if (shopStatus === "pending") {
      Alert.alert(
        "Registration Under Review",
        "Your shop registration must be verified by an administrator before you can access Shop Center.",
      );
      return;
    }

    navigation.navigate("ShopCenter");
  };

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}>
      <Card style={styles.pageHeader}>
        <Card.Content>
          <Text style={styles.pageTitle}>Profile</Text>
          <Text style={styles.pageSubtitle}>Manage your personal details and keep your funeral shop registration in its own space.</Text>
          <View style={styles.uidPill}>
            <Text style={styles.uidPillLabel}>Your UID</Text>
            <Text selectable style={styles.uidPillValue}>{auth.currentUser?.uid || "Unknown"}</Text>
          </View>
        </Card.Content>
      </Card>

      <Card style={styles.sectionCard}>
        <Card.Content>
          <View style={styles.photoSection}>
            <TouchableOpacity onPress={() => setPreviewVisible(true)} style={styles.photoContainer}>
              {uploading ? (
                <ActivityIndicator size="large" color="#5a6b64" />
              ) : photoURL ? (
                <Image source={{ uri: photoURL }} style={styles.photo} resizeMode="cover" />
              ) : (
                <Image source={getDefaultImage()} style={styles.photo} resizeMode="cover" />
              )}
            </TouchableOpacity>
            <View style={styles.photoActions}>
              <PaperButton mode="outlined" textColor="#5a6b64" onPress={pickImage} disabled={uploading}>Gallery</PaperButton>
              <PaperButton mode="outlined" textColor="#5a6b64" onPress={takePhoto} disabled={uploading}>Camera</PaperButton>
            </View>
          </View>

          <Text style={styles.label}>Full Name</Text>
          <Text style={styles.value}>{fullName}</Text>
        </Card.Content>
      </Card>

      <Card style={styles.sectionCard}>
        <Card.Content>
          <View style={styles.statusRow}>
            <Text style={styles.sectionTitle}>Shop Status</Text>
            <Chip textStyle={{ color: shopStatusColor }} style={{ backgroundColor: "#eef1ec" }}>
              {shopStatus.toUpperCase()}
            </Chip>
          </View>

          {shopStatus === "verified" ? (
            <>
              <View style={styles.infoBanner}>
                <Ionicons name="checkmark-circle-outline" size={20} color="#15803d" />
                <Text style={styles.infoBannerText}>
                  Your shop registration is verified. You can manage and review your registered shop details from the shop center.
                </Text>
              </View>
              {shopInfo?.shopName ? <Text style={styles.value}>Shop Name: {shopInfo.shopName}</Text> : null}
              {shopInfo?.shopAddress ? <Text style={styles.value}>Shop Address: {shopInfo.shopAddress}</Text> : null}
              {businessInfo?.generalLocation ? <Text style={styles.value}>General Location: {businessInfo.generalLocation}</Text> : null}
            </>
          ) : null}

          {shopStatus === "offline" ? (
            <>
              <View style={styles.infoBanner}>
                <Ionicons name="moon-outline" size={20} color="#6b7280" />
                <Text style={styles.infoBannerText}>
                  Your shop is currently offline and hidden from buyers. Manage your storefront and catalog from the shop center.
                </Text>
              </View>
              {shopInfo?.shopName ? <Text style={styles.value}>Shop Name: {shopInfo.shopName}</Text> : null}
              {shopInfo?.shopAddress ? <Text style={styles.value}>Shop Address: {shopInfo.shopAddress}</Text> : null}
              {businessInfo?.generalLocation ? <Text style={styles.value}>General Location: {businessInfo.generalLocation}</Text> : null}
            </>
          ) : null}

          {shopStatus === "pending" ? (
            <View style={styles.infoBanner}>
              <Ionicons name="hourglass-outline" size={20} color="#9a7c5d" />
              <Text style={styles.infoBannerText}>
                Your shop registration is under review. Shop Center will unlock after an administrator verifies it.
              </Text>
            </View>
          ) : null}

          {shopStatus === "rejected" ? (
            <>
              <View style={styles.infoBanner}>
                <Ionicons name="close-circle-outline" size={20} color="#b91c1c" />
                <Text style={styles.infoBannerText}>
                  Your last shop registration was rejected. Start the registration again to submit updated business details.
                </Text>
              </View>
              {rejectionReason ? <Text style={styles.reason}>Reason: {rejectionReason}</Text> : null}
            </>
          ) : null}

          {shopStatus === "none" ? (
            <Text style={styles.infoText}>
              Ready to open a funeral shop? Start registration to enter shop details and business information.
            </Text>
          ) : null}

          <PaperButton mode="contained" buttonColor="#5a6b64" onPress={handlePrimaryAction} style={styles.primaryButton}>
            {shopActionLabel}
          </PaperButton>
          <PaperButton mode="outlined" textColor="#5a6b64" onPress={() => navigation.navigate("MyServiceRequests")} style={styles.utilityButton}>
            My Service Requests
          </PaperButton>
        </Card.Content>
      </Card>

      <Card style={styles.sectionCard}>
        <Card.Content>
          <PaperButton mode="outlined" textColor="#5a6b64" onPress={() => navigation.navigate("Contact")} style={styles.utilityButton}>
            Contact Support
          </PaperButton>
          <PaperButton mode="outlined" textColor="#5a6b64" onPress={() => navigation.navigate("AboutUs")} style={styles.utilityButton}>
            About Us
          </PaperButton>
          <PaperButton mode="outlined" textColor="#5a6b64" onPress={() => navigation.navigate("AppFeedback")} style={styles.utilityButton}>
            Rate & Feedback
          </PaperButton>
          <PaperButton mode="outlined" textColor="#5a6b64" onPress={() => navigation.navigate("AccountSettings")} style={styles.utilityButton}>
            Account Settings
          </PaperButton>
          <PaperButton
            mode="contained"
            buttonColor="#22312d"
            onPress={() => {
              Alert.alert("Log Out", "Are you sure you want to log out?", [
                { text: "Cancel", style: "cancel" },
                { text: "Log Out", style: "destructive", onPress: async () => { try { await logout(); } catch {} } },
              ]);
            }}
          >
            Log Out
          </PaperButton>
        </Card.Content>
      </Card>

      <Modal visible={previewVisible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setPreviewVisible(false)}>
          <View style={styles.modalContent}>
            <TouchableOpacity activeOpacity={1}>
              {photoURL ? (
                <Image source={{ uri: photoURL }} style={styles.previewImage} resizeMode="contain" />
              ) : (
                <Image source={getDefaultImage()} style={styles.previewImage} resizeMode="contain" />
              )}
              <PaperButton mode="contained-tonal" onPress={() => setPreviewVisible(false)}>
                Close
              </PaperButton>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={startRegistrationVisible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setStartRegistrationVisible(false)}>
          <View style={styles.modalContent}>
            <TouchableOpacity activeOpacity={1} style={styles.startRegistrationCard}>
              <Text style={styles.startRegistrationTitle}>Start Registration</Text>
              <Text style={styles.startRegistrationText}>
                Begin the funeral shop registration flow and complete your shop and business information.
              </Text>
              <PaperButton
                mode="contained"
                buttonColor="#5a6b64"
                onPress={() => {
                  setStartRegistrationVisible(false);
                  navigation.navigate("ShopInformation");
                }}
                style={styles.primaryButton}
              >
                Start Registration
              </PaperButton>
              <PaperButton mode="text" onPress={() => setStartRegistrationVisible(false)}>
                Cancel
              </PaperButton>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 36,
    backgroundColor: "#eef1ec",
    gap: 10,
  },
  containerDesktop: {
    maxWidth: 980,
    alignSelf: "center",
    width: "100%",
  },
  pageHeader: {
    borderRadius: 12,
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#5a6b64",
  },
  pageSubtitle: {
    marginTop: 3,
    color: "#4b5563",
    fontSize: 14,
  },
  uidPill: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#cad5cc",
    borderRadius: 999,
    backgroundColor: "#fbfcf8",
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  uidPillLabel: {
    color: "#66746f",
    fontSize: 11,
    fontWeight: "700",
  },
  uidPillValue: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 1,
  },
  sectionCard: {
    borderRadius: 12,
  },
  photoSection: {
    alignItems: "center",
    marginBottom: 12,
  },
  photoContainer: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#5a6b64",
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  photoActions: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    marginTop: 12,
    marginBottom: 5,
    color: "#4c5b57",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd2cb",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#cbd2cb",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  dateButton: {
    borderWidth: 1,
    borderColor: "#cbd2cb",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  ageDisplay: {
    borderWidth: 1,
    borderColor: "#d8ddd7",
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#f9fafb",
    marginBottom: 10,
  },
  ageText: {
    fontSize: 15,
    color: "#4c5b57",
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#5a6b64",
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  value: {
    fontSize: 16,
    color: "#1f2937",
    marginBottom: 6,
  },
  infoText: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 10,
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d8ddd7",
    backgroundColor: "#fafafa",
    marginBottom: 10,
  },
  infoBannerText: {
    flex: 1,
    color: "#4c5b57",
    fontSize: 14,
  },
  reason: {
    color: "#b91c1c",
    marginBottom: 10,
    fontStyle: "italic",
  },
  primaryButton: {
    marginTop: 6,
    borderRadius: 10,
    marginBottom: 12,
  },
  utilityButton: {
    marginBottom: 8,
    borderColor: "#5a6b64",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
  },
  modalContent: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 10,
    alignItems: "center",
    width: "100%",
    maxWidth: 420,
  },
  previewImage: {
    width: 300,
    height: 300,
    borderRadius: 10,
    marginBottom: 10,
  },
  startRegistrationCard: {
    width: "100%",
    alignItems: "center",
  },
  startRegistrationTitle: {
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 8,
  },
  startRegistrationText: {
    color: "#66746f",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 8,
  },
});

