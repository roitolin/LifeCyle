import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "@/components";
import ServiceRequestScheduleFields from "@/components/ServiceRequestScheduleFields";
import { supabase } from "@/services/supabaseClient";
import { generateId } from "@/utils/generateId";
import { auth, uploadCertificate } from "@/services";
import { CommonActions } from "@react-navigation/native";
import { hapticMedium } from "@/utils/haptics";
import {
  serializeDateOnly,
  serializeTimeOnly,
  validateServiceSchedule,
} from "@/utils/serviceRequestSchedule";
type SuccessState = {
  requestId: string;
  shopName: string;
};



const formatDateLabel = (value: Date | null, fallback: string) => {
  if (!value) return fallback;
  return value.toLocaleDateString();
};

const computeAgeFromDates = (dob: Date | null, dop: Date | null) => {
  if (!dob || !dop) return null;
  if (dop.getTime() <= dob.getTime()) return null;
  let age = dop.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    dop.getMonth() < dob.getMonth() ||
    (dop.getMonth() === dob.getMonth() && dop.getDate() < dob.getDate());
  return beforeBirthday ? age - 1 : age;
};

export default function FuneralCustomCasketRequestScreen({ navigation, route }: any) {
  const shopId = String(route?.params?.shopId || "");
  const fallbackShopName = String(route?.params?.shopName || "Shop");

  const [shopName, setShopName] = useState(fallbackShopName);
  const [shopContactNumber, setShopContactNumber] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [memorialPhotoUrl, setMemorialPhotoUrl] = useState<string | null>(null);
  const [referencePhotoUrl, setReferencePhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [deceasedFullName, setDeceasedFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateOfPassing, setDateOfPassing] = useState<Date | null>(null);
  const [showDateOfPassingPicker, setShowDateOfPassingPicker] = useState(false);
  const [tributeMessage, setTributeMessage] = useState("");
  const [familyCoordinatorName, setFamilyCoordinatorName] = useState("");
  const [wakeAddress, setWakeAddress] = useState("");
  const [wakeStartDate, setWakeStartDate] = useState<Date | null>(null);
  const [wakeEndDate, setWakeEndDate] = useState<Date | null>(null);
  const [burialTime, setBurialTime] = useState<Date | null>(null);
  const [pickupAddress, setPickupAddress] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [designNotes, setDesignNotes] = useState("");
  const [deceasedAge, setDeceasedAge] = useState("");
  const [ageInputMode, setAgeInputMode] = useState<"auto" | "manual">("auto");
  const [submitting, setSubmitting] = useState(false);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Custom Casket Request",
    });
  }, [navigation]);

  useEffect(() => {
    const loadContext = async () => {
      const user = auth.currentUser;
      try {
        if (user) {
          const { data: userData } = await supabase
            .from("users")
            .select("fullName")
            .eq("id", user.uid)
            .maybeSingle();
          if (userData) {
            setFamilyCoordinatorName(String(userData.fullName || ""));
          }
        }

        if (shopId) {
          const { data: shopData } = await supabase
            .from("funeral_shops")
            .select("shopName, shopPhoneNumber, shopAddress")
            .eq("id", shopId)
            .maybeSingle();
          if (shopData) {
            setShopName(String(shopData.shopName || fallbackShopName));
            setShopContactNumber(String(shopData.shopPhoneNumber || ""));
            setShopAddress(String(shopData.shopAddress || ""));
          }
        }
      } catch {
        // Keep screen usable even if prefill fails.
      }
    };

    void loadContext();
  }, [fallbackShopName, shopId]);

  const uploadPhoto = useCallback(async (uri: string, target: "memorial" | "reference") => {
    setUploadingPhoto(true);
    try {
      const url = await uploadCertificate(uri);
      if (target === "memorial") {
        setMemorialPhotoUrl(url);
        Alert.alert("Uploaded", "Photo of your loved one added.");
      } else {
        setReferencePhotoUrl(url);
        Alert.alert("Uploaded", "Reference photo added.");
      }
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Failed to upload photo.");
    } finally {
      setUploadingPhoto(false);
    }
  }, []);

  const pickPhoto = useCallback(async (target: "memorial" | "reference") => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.7,
    });

    if (!picker.canceled && picker.assets[0]) {
      await uploadPhoto(picker.assets[0].uri, target);
    }
  }, [uploadPhoto]);

  const onDateChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS !== "ios") {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      setDateOfBirth(selectedDate);
    }
  };

  const onDateOfPassingChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS !== "ios") {
      setShowDateOfPassingPicker(false);
    }
    if (selectedDate) {
      setDateOfPassing(selectedDate);
    }
  };

  const computedAge = useMemo(() => computeAgeFromDates(dateOfBirth, dateOfPassing), [dateOfBirth, dateOfPassing]);

  const ageMismatch =
    ageInputMode === "manual" &&
    computedAge != null &&
    deceasedAge.trim() !== "" &&
    Number(deceasedAge) !== computedAge;

  useEffect(() => {
    if (ageInputMode === "auto" && computedAge != null) {
      setDeceasedAge(String(computedAge));
    }
  }, [ageInputMode, computedAge]);

  const submitRequest = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Login Required", "You need to be logged in to continue.");
      return;
    }

    const safeDeceasedFullName = deceasedFullName.trim();
    const safeTributeMessage = tributeMessage.trim();
    const safeFamilyCoordinatorName = familyCoordinatorName.trim();
    const safeWakeAddress = wakeAddress.trim();
    const safePickupAddress = pickupAddress.trim();
    const safeContactNumber = contactNumber.trim();
    const safeDesignNotes = designNotes.trim();
    const resolvedAge =
      ageInputMode === "auto"
        ? computedAge != null
          ? String(computedAge)
          : deceasedAge.trim()
        : deceasedAge.trim();

    if (
      !memorialPhotoUrl ||
      !safeDeceasedFullName ||
      !dateOfBirth ||
      !dateOfPassing ||
      !resolvedAge ||
      !safeTributeMessage ||
      !safeFamilyCoordinatorName ||
      !safeWakeAddress ||
      !wakeStartDate ||
      !wakeEndDate ||
      !burialTime ||
      !safePickupAddress ||
      !safeContactNumber ||
      !safeDesignNotes
    ) {
      Alert.alert("Incomplete", "Please complete all required details before sending your custom request.");
      return;
    }

    const scheduleIssue = validateServiceSchedule({
      wakeStartDate,
      wakeEndDate,
      burialTime,
      dateOfPassing,
    });
    if (scheduleIssue === "before_passing") {
      Alert.alert("Invalid Wake Schedule", "The wake cannot start before the date of passing.");
      return;
    }
    if (scheduleIssue === "invalid_range") {
      Alert.alert("Invalid Wake Schedule", "The wake end date must be the same as or after the start date.");
      return;
    }

    setSubmitting(true);
    try {
      const requestId = generateId();
      const { error } = await supabase.from("funeral_service_requests").insert({
        id: requestId,
        requesterId: user.uid,
        shopId,
        shopName,
        shopContactNumber: shopContactNumber || null,
        shopAddress: shopAddress || null,
        cartId: `custom_${Date.now()}`,
        productId: "custom_casket_design",
        productName: "Custom Casket Design",
        productPrice: null,
        productImageUrl: null,
        variationName: null,
        requestType: "custom_casket",
        customDesignNotes: safeDesignNotes,
        memorialPhotoUrl,
        referencePhotoUrl: referencePhotoUrl,
        deceasedFullName: safeDeceasedFullName,
        deceasedDateOfBirth: dateOfBirth.toISOString(),
        deceasedDateOfPassing: dateOfPassing.toISOString(),
        deceasedAge: Number(resolvedAge) || null,
        tributeMessage: safeTributeMessage,
        familyCoordinatorName: safeFamilyCoordinatorName,
        wakeAddress: safeWakeAddress,
        wakeStartDate: serializeDateOnly(wakeStartDate),
        wakeEndDate: serializeDateOnly(wakeEndDate),
        burialTime: serializeTimeOnly(burialTime),
        pickupAddress: safePickupAddress,
        contactNumber: safeContactNumber,
        status: "pending_shop_acceptance",
        acceptedAt: null,
        declinedAt: null,
        cancelledAt: null,
        shopRespondedAt: null,
        handledByShopId: null,
      });

      if (error) throw error;

      try {
        await supabase.from("notifications").insert({
          userId: shopId,
          type: "funeral_request_pending",
          title: "New Custom Casket Request",
          body: `${safeFamilyCoordinatorName} sent a custom casket request for ${safeDeceasedFullName}.`,
          data: {
            requestId,
            requesterId: user.uid,
            shopId,
            productId: "custom_casket_design",
          },
          read: false,
        });
      } catch (notificationError) {
        console.warn("Failed to create custom casket request notification:", notificationError);
      }

      setSuccessState({
        requestId,
        shopName,
      });
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to send your custom request.");
    } finally {
      setSubmitting(false);
    }
  }, [
    deceasedAge,
    ageInputMode,
    contactNumber,
    computedAge,
    dateOfBirth,
    dateOfPassing,
    deceasedFullName,
    designNotes,
    familyCoordinatorName,
    memorialPhotoUrl,
    pickupAddress,
    referencePhotoUrl,
    shopAddress,
    shopContactNumber,
    shopId,
    shopName,
    tributeMessage,
    wakeAddress,
    wakeStartDate,
    wakeEndDate,
    burialTime,
  ]);

  const confirmSubmitRequest = useCallback(() => {
    Alert.alert(
      "Confirm Request",
      "Are you sure you want to send this custom casket request?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send Request",
          onPress: () => {
            hapticMedium();
            void submitRequest();
          },
        },
      ]
    );
  }, [submitRequest]);

  if (successState) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Ionicons name="time-outline" size={34} color="#86654a" />
          </View>
          <Text style={styles.successTitle}>Request Sent</Text>
          <Text style={styles.successText}>
            Your custom casket request has been forwarded to {successState.shopName}. Please wait while the shop reviews and accepts your request.
          </Text>
          <Text style={styles.successMeta}>Reference: {successState.requestId}</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{
                  name: "FuneralTabs",
                  state: {
                    routes: [
                      { name: "Home" },
                      { name: "Shops" },
                      { name: "Carts" },
                      {
                        name: "Profile",
                        state: {
                          routes: [
                            { name: "ProfileMain" },
                            { name: "MyServiceRequests" },
                          ],
                          index: 1,
                        },
                      },
                    ],
                    index: 3,
                  },
                }],
              })
            )}
          >
            <Text style={styles.primaryButtonText}>Track My Request</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEyebrow}>Custom Design Request</Text>
          <Text style={styles.summaryTitle}>{shopName}</Text>
          <Text style={styles.summarySubtitle}>{shopAddress || "Verified funeral shop"}</Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Memorial Portrait</Text>
          <TouchableOpacity style={styles.photoPicker} onPress={() => void pickPhoto("memorial")} disabled={uploadingPhoto}>
            {uploadingPhoto ? (
              <ActivityIndicator size="small" color="#22312d" />
            ) : memorialPhotoUrl ? (
              <Image source={{ uri: memorialPhotoUrl }} style={styles.photoPreview} resizeMode="cover" />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="image-outline" size={26} color="#86908a" />
                <Text style={styles.photoPlaceholderText}>Add photo of your loved one</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Reference Image for the Design</Text>
          <TouchableOpacity style={styles.photoPicker} onPress={() => void pickPhoto("reference")} disabled={uploadingPhoto}>
            {uploadingPhoto ? (
              <ActivityIndicator size="small" color="#22312d" />
            ) : referencePhotoUrl ? (
              <Image source={{ uri: referencePhotoUrl }} style={styles.photoPreview} resizeMode="cover" />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="image-outline" size={26} color="#86908a" />
                <Text style={styles.photoPlaceholderText}>Add reference photo</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.label}>Full Name of the Deceased</Text>
          <TextInput style={styles.input} placeholder="Full name of the deceased" value={deceasedFullName} onChangeText={setDeceasedFullName} />

          <Text style={styles.label}>Date of Birth</Text>
          <TouchableOpacity style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
            <Text style={styles.dateButtonText}>{formatDateLabel(dateOfBirth, "Select date of birth")}</Text>
            <Ionicons name="calendar-outline" size={18} color="#62706b" />
          </TouchableOpacity>
          {showDatePicker ? (
            <DateTimePicker
              value={dateOfBirth || new Date()}
              mode="date"
              display="default"
              maximumDate={new Date()}
              onChange={onDateChange}
            />
          ) : null}

          <Text style={styles.label}>Date of Passing</Text>
          <TouchableOpacity style={styles.dateButton} onPress={() => setShowDateOfPassingPicker(true)}>
            <Text style={styles.dateButtonText}>{formatDateLabel(dateOfPassing, "Select date of passing")}</Text>
            <Ionicons name="calendar-outline" size={18} color="#62706b" />
          </TouchableOpacity>
          {showDateOfPassingPicker ? (
            <DateTimePicker
              value={dateOfPassing || new Date()}
              mode="date"
              display="default"
              maximumDate={new Date()}
              onChange={onDateOfPassingChange}
            />
          ) : null}

          <Text style={styles.label}>Age of the Deceased</Text>
          <View style={styles.ageModeRow}>
            <TouchableOpacity
              style={[styles.ageModeButton, ageInputMode === "auto" ? styles.ageModeButtonActive : null]}
              onPress={() => setAgeInputMode("auto")}
            >
              <Text style={[styles.ageModeButtonText, ageInputMode === "auto" ? styles.ageModeButtonTextActive : null]}>
                Automatic
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ageModeButton, ageInputMode === "manual" ? styles.ageModeButtonActive : null]}
              onPress={() => setAgeInputMode("manual")}
            >
              <Text style={[styles.ageModeButtonText, ageInputMode === "manual" ? styles.ageModeButtonTextActive : null]}>
                Manual
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder={
              ageInputMode === "auto"
                ? computedAge != null
                  ? `${computedAge} years`
                  : "Calculated from the dates provided"
                : "Enter age at time of passing"
            }
            value={ageInputMode === "auto" ? (computedAge != null ? String(computedAge) : "") : deceasedAge}
            onChangeText={(value) => {
              setAgeInputMode("manual");
              setDeceasedAge(value);
            }}
            keyboardType="number-pad"
          />
          {ageInputMode === "auto" ? (
            <Text style={styles.ageAutoHint}>
              {computedAge != null
                ? "Age is calculated automatically from the dates provided above."
                : "Select both the date of birth and date of passing to calculate the age automatically."}
            </Text>
          ) : null}
          {ageMismatch ? (
            <View style={styles.ageMismatchCard}>
              <Text style={styles.ageMismatchText}>
                The entered age does not match the date of birth and date of passing. Calculated age: {computedAge}.
              </Text>
            </View>
          ) : null}

          <Text style={styles.label}>Tribute Message</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder="A short tribute in memory of the deceased"
            value={tributeMessage}
            onChangeText={setTributeMessage}
            multiline
          />

          <Text style={styles.label}>Family Coordinator</Text>
          <TextInput
            style={styles.input}
            placeholder="Name of the family member in charge"
            value={familyCoordinatorName}
            onChangeText={setFamilyCoordinatorName}
          />

          <Text style={styles.label}>Wake Venue</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder="Complete address of the wake venue"
            value={wakeAddress}
            onChangeText={setWakeAddress}
            multiline
          />

          <ServiceRequestScheduleFields
            wakeStartDate={wakeStartDate}
            wakeEndDate={wakeEndDate}
            burialTime={burialTime}
            onWakeStartDateChange={setWakeStartDate}
            onWakeEndDateChange={setWakeEndDate}
            onBurialTimeChange={setBurialTime}
            minimumWakeDate={dateOfPassing}
          />

          <Text style={styles.label}>Pickup Address</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder="Location where the deceased will be picked up"
            value={pickupAddress}
            onChangeText={setPickupAddress}
            multiline
          />

          <Text style={styles.label}>Contact Number</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter contact number"
            value={contactNumber}
            onChangeText={setContactNumber}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Custom Design Specifications</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder="Describe your preferred casket design, materials, colors, or special specifications"
            value={designNotes}
            onChangeText={setDesignNotes}
            multiline
          />
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, submitting || uploadingPhoto ? styles.primaryButtonDisabled : null]}
          onPress={confirmSubmitRequest}
          disabled={submitting || uploadingPhoto}
        >
          <Text style={styles.primaryButtonText}>{submitting ? "Sending Request..." : "Send Custom Request"}</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#eef1ec" },
  content: { padding: 18, paddingBottom: 120, gap: 16 },
  summaryCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#f8f6f2",
    padding: 18,
  },
  summaryEyebrow: { color: "#8b7255", fontSize: 12, fontWeight: "800" },
  summaryTitle: { color: "#22312d", fontSize: 24, fontWeight: "900", marginTop: 4 },
  summarySubtitle: { color: "#62706b", fontSize: 13, lineHeight: 20, marginTop: 8 },
  sectionCard: {
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
    padding: 16,
  },
  sectionTitle: { color: "#22312d", fontSize: 16, fontWeight: "900", marginBottom: 12 },
  photoPicker: {
    minHeight: 180,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#d2d7d1",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fafaf9",
  },
  photoPreview: { width: "100%", height: 220 },
  photoPlaceholder: { alignItems: "center", justifyContent: "center", gap: 8 },
  photoPlaceholderText: { color: "#62706b", fontSize: 13, fontWeight: "700" },
  label: { color: "#53615d", fontSize: 13, fontWeight: "800", marginBottom: 8, marginTop: 12 },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d2d7d1",
    backgroundColor: "#fcfcfb",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#22312d",
    fontSize: 14,
  },
  multilineInput: { minHeight: 100, textAlignVertical: "top" },
  dateButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d2d7d1",
    backgroundColor: "#fcfcfb",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateButtonText: { color: "#22312d", fontSize: 14 },
  ageModeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  ageModeButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d2d7d1",
    backgroundColor: "#fcfcfb",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  ageModeButtonActive: {
    backgroundColor: "#22312d",
    borderColor: "#22312d",
  },
  ageModeButtonText: {
    color: "#62706b",
    fontSize: 13,
    fontWeight: "800",
  },
  ageModeButtonTextActive: {
    color: "#ffffff",
  },
  ageAutoHint: {
    color: "#62706b",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  ageMismatchCard: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "#fde68a",
    padding: 12,
  },
  ageMismatchText: {
    color: "#86654a",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  readonlyField: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#ece9e3",
    borderWidth: 1,
    borderColor: "#e7e5e4",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  readonlyValue: { color: "#62706b", fontSize: 14, fontWeight: "700" },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "#22312d",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
  successWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 14,
  },
  successIcon: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fef3c7",
  },
  successTitle: { color: "#22312d", fontSize: 24, fontWeight: "900" },
  successText: { color: "#62706b", fontSize: 14, lineHeight: 22, textAlign: "center" },
  successMeta: { color: "#86654a", fontSize: 12, fontWeight: "800" },
});

