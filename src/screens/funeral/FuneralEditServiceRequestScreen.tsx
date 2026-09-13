import { useCallback, useMemo, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { AppBackButton, KeyboardAwareScrollView } from "@/components";
import ServiceRequestScheduleFields from "@/components/ServiceRequestScheduleFields";
import { auth, uploadCertificate } from "@/services";
import { supabase } from "@/services/supabaseClient";
import { hapticSuccess } from "@/utils/haptics";
import {
  parseDateOnly,
  parseTimeOnly,
  serializeDateOnly,
  serializeTimeOnly,
  validateServiceSchedule,
} from "@/utils/serviceRequestSchedule";

type EditableServiceRequest = {
  id: string;
  requesterId: string;
  status: string;
  productName?: string | null;
  productImageUrl?: string | null;
  shopName?: string | null;
  variationName?: string | null;
  requestType?: string | null;
  deceasedFullName?: string | null;
  deceasedDateOfBirth?: string | null;
  deceasedDateOfPassing?: string | null;
  deceasedAge?: number | null;
  tributeMessage?: string | null;
  familyCoordinatorName?: string | null;
  wakeAddress?: string | null;
  churchName?: string | null;
  cemeteryName?: string | null;
  wakeStartDate?: string | null;
  wakeEndDate?: string | null;
  burialTime?: string | null;
  pickupAddress?: string | null;
  contactNumber?: string | null;
  memorialPhotoUrl?: string | null;
  referencePhotoUrl?: string | null;
  customDesignNotes?: string | null;
};

type EditForm = {
  deceasedFullName: string;
  deceasedDateOfBirth: Date | null;
  deceasedDateOfPassing: Date | null;
  deceasedAge: string;
  tributeMessage: string;
  familyCoordinatorName: string;
  wakeAddress: string;
  churchName: string;
  cemeteryName: string;
  wakeStartDate: Date | null;
  wakeEndDate: Date | null;
  burialTime: Date | null;
  pickupAddress: string;
  contactNumber: string;
  memorialPhotoUrl: string | null;
  referencePhotoUrl: string | null;
  customDesignNotes: string;
};

const parseStoredDate = (value?: string | null) => {
  if (!value) return null;
  const dateOnly = parseDateOnly(String(value).slice(0, 10));
  if (dateOnly) return dateOnly;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateLabel = (value: Date | null, fallback: string) =>
  value
    ? value.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : fallback;

const computeAgeFromDates = (dateOfBirth: Date | null, dateOfPassing: Date | null) => {
  if (!dateOfBirth || !dateOfPassing || dateOfPassing.getTime() <= dateOfBirth.getTime()) return null;
  let age = dateOfPassing.getFullYear() - dateOfBirth.getFullYear();
  const beforeBirthday =
    dateOfPassing.getMonth() < dateOfBirth.getMonth() ||
    (dateOfPassing.getMonth() === dateOfBirth.getMonth() && dateOfPassing.getDate() < dateOfBirth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
};

type PhotoFieldProps = {
  label: string;
  helper: string;
  value: string | null;
  uploading: boolean;
  onChoose: () => void;
  onRemove: () => void;
};

function PhotoField({ label, helper, value, uploading, onChoose, onRemove }: PhotoFieldProps) {
  return (
    <View style={styles.photoField}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.fieldHelp}>{helper}</Text>
      <TouchableOpacity
        style={styles.photoPicker}
        onPress={onChoose}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel={value ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
      >
        {uploading ? (
          <View style={styles.photoPlaceholder}>
            <ActivityIndicator size="small" color="#315f50" />
            <Text style={styles.photoPlaceholderText}>Uploading photo…</Text>
          </View>
        ) : value ? (
          <Image source={{ uri: value }} style={styles.photoPreview} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="image-outline" size={25} color="#71807a" />
            <Text style={styles.photoPlaceholderText}>Choose photo</Text>
          </View>
        )}
      </TouchableOpacity>
      {value && !uploading ? (
        <View style={styles.photoActions}>
          <TouchableOpacity style={styles.photoAction} onPress={onChoose}>
            <Text style={styles.photoActionText}>Replace</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoAction} onPress={onRemove}>
            <Text style={styles.removePhotoText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

export default function FuneralEditServiceRequestScreen({ navigation, route }: any) {
  const request = route.params?.request as EditableServiceRequest | undefined;
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState<"memorial" | "reference" | null>(null);
  const [showDateOfBirthPicker, setShowDateOfBirthPicker] = useState(false);
  const [showDateOfPassingPicker, setShowDateOfPassingPicker] = useState(false);
  const initialDateOfBirth = parseStoredDate(request?.deceasedDateOfBirth);
  const initialDateOfPassing = parseStoredDate(request?.deceasedDateOfPassing);
  const initialComputedAge = computeAgeFromDates(initialDateOfBirth, initialDateOfPassing);
  const [ageInputMode, setAgeInputMode] = useState<"auto" | "manual">(
    initialComputedAge != null &&
      (request?.deceasedAge == null || Number(request.deceasedAge) === initialComputedAge)
      ? "auto"
      : "manual"
  );
  const [form, setForm] = useState<EditForm>(() => ({
    deceasedFullName: String(request?.deceasedFullName || ""),
    deceasedDateOfBirth: initialDateOfBirth,
    deceasedDateOfPassing: initialDateOfPassing,
    deceasedAge: request?.deceasedAge != null ? String(request.deceasedAge) : "",
    tributeMessage: String(request?.tributeMessage || ""),
    familyCoordinatorName: String(request?.familyCoordinatorName || ""),
    wakeAddress: String(request?.wakeAddress || ""),
    churchName: String(request?.churchName || ""),
    cemeteryName: String(request?.cemeteryName || ""),
    wakeStartDate: parseDateOnly(request?.wakeStartDate),
    wakeEndDate: parseDateOnly(request?.wakeEndDate),
    burialTime: parseTimeOnly(request?.burialTime),
    pickupAddress: String(request?.pickupAddress || ""),
    contactNumber: String(request?.contactNumber || ""),
    memorialPhotoUrl: request?.memorialPhotoUrl || null,
    referencePhotoUrl: request?.referencePhotoUrl || null,
    customDesignNotes: String(request?.customDesignNotes || ""),
  }));

  const isCustomRequest = useMemo(
    () => request?.requestType === "custom_casket" || Boolean(request?.customDesignNotes || request?.referencePhotoUrl),
    [request]
  );
  const computedAge = useMemo(
    () => computeAgeFromDates(form.deceasedDateOfBirth, form.deceasedDateOfPassing),
    [form.deceasedDateOfBirth, form.deceasedDateOfPassing]
  );
  const resolvedAge = ageInputMode === "auto" && computedAge != null ? String(computedAge) : form.deceasedAge.trim();

  const setField = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const choosePhoto = useCallback(async (kind: "memorial" | "reference") => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: kind === "memorial" ? [4, 5] : undefined,
      quality: 0.75,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploadingPhoto(kind);
    try {
      const url = await uploadCertificate(picker.assets[0].uri);
      setForm((current) => ({
        ...current,
        [kind === "memorial" ? "memorialPhotoUrl" : "referencePhotoUrl"]: url,
      }));
    } catch (error: any) {
      Alert.alert("Upload Failed", error?.message || "The selected photo could not be uploaded.");
    } finally {
      setUploadingPhoto(null);
    }
  }, []);

  const save = useCallback(async () => {
    const user = auth.currentUser;
    if (!request || !user || saving || uploadingPhoto) return;

    if (request.requesterId !== user.uid || String(request.status).toLowerCase() !== "pending_shop_acceptance") {
      Alert.alert("Editing Unavailable", "This request can no longer be edited because the shop has already responded.");
      return;
    }

    const requiredValues = {
      deceasedFullName: form.deceasedFullName.trim(),
      deceasedDateOfBirth: form.deceasedDateOfBirth?.toISOString() || null,
      deceasedDateOfPassing: form.deceasedDateOfPassing?.toISOString() || null,
      deceasedAge: resolvedAge ? Number(resolvedAge) : null,
      tributeMessage: form.tributeMessage.trim(),
      familyCoordinatorName: form.familyCoordinatorName.trim(),
      wakeAddress: form.wakeAddress.trim(),
      churchName: form.churchName.trim(),
      cemeteryName: form.cemeteryName.trim(),
      wakeStartDate: serializeDateOnly(form.wakeStartDate),
      wakeEndDate: serializeDateOnly(form.wakeEndDate),
      burialTime: serializeTimeOnly(form.burialTime),
      pickupAddress: form.pickupAddress.trim(),
      contactNumber: form.contactNumber.trim(),
    };
    const scheduleIssue = validateServiceSchedule({
      wakeStartDate: form.wakeStartDate,
      wakeEndDate: form.wakeEndDate,
      burialTime: form.burialTime,
      dateOfPassing: form.deceasedDateOfPassing,
    });

    if (!form.deceasedDateOfBirth || !form.deceasedDateOfPassing || computedAge == null) {
      Alert.alert("Check Deceased Information", "Birth date and date of passing cannot be empty.");
      return;
    }
    if (!resolvedAge || !Number.isFinite(Number(resolvedAge)) || Number(resolvedAge) < 0) {
      Alert.alert("Check Age", "Age cannot be empty and must be a valid number.");
      return;
    }

    if (scheduleIssue === "incomplete") {
      Alert.alert("Incomplete Schedule", "Choose the wake start date, wake end date, and burial time.");
      return;
    }
    if (scheduleIssue === "before_passing") {
      Alert.alert("Invalid Wake Schedule", "The wake cannot start before the date of passing.");
      return;
    }
    if (scheduleIssue === "invalid_range") {
      Alert.alert("Invalid Wake Schedule", "The wake end date must be the same as or after the start date.");
      return;
    }
    if (
      !requiredValues.deceasedFullName ||
      !requiredValues.tributeMessage ||
      !requiredValues.familyCoordinatorName ||
      !requiredValues.wakeAddress ||
      !requiredValues.churchName ||
      !requiredValues.cemeteryName ||
      !requiredValues.wakeStartDate ||
      !requiredValues.wakeEndDate ||
      !requiredValues.burialTime ||
      !requiredValues.pickupAddress ||
      !requiredValues.contactNumber
    ) {
      Alert.alert("Incomplete Request", "Complete every required field before saving.");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("funeral_service_requests")
        .update({
          ...requiredValues,
          memorialPhotoUrl: form.memorialPhotoUrl,
          referencePhotoUrl: form.referencePhotoUrl,
          customDesignNotes: form.customDesignNotes.trim() || null,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", request.id)
        .eq("requesterId", user.uid)
        .eq("status", "pending_shop_acceptance")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("This request can no longer be edited because the shop already responded.");

      hapticSuccess();
      Alert.alert("Request Updated", "Your changes were saved.", [
        { text: "Done", onPress: () => navigation.goBack() },
      ]);
    } catch (error: any) {
      Alert.alert("Update Failed", error?.message || "Your request could not be updated.");
    } finally {
      setSaving(false);
    }
  }, [computedAge, form, navigation, request, resolvedAge, saving, uploadingPhoto]);

  if (!request) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <AppBackButton onPress={() => navigation.goBack()} />
          <Text style={styles.headerTitle}>Edit Request</Text>
        </View>
        <View style={styles.unavailable}>
          <Text style={styles.unavailableTitle}>Request unavailable</Text>
          <Text style={styles.unavailableText}>Return to your requests and open it again.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <AppBackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Edit Request</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{request.productName || "Service request"}</Text>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        bottomOffset={28}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.requestSummary}>
          {request.productImageUrl ? (
            <Image source={{ uri: request.productImageUrl }} style={styles.summaryImage} resizeMode="cover" />
          ) : (
            <View style={styles.summaryFallback}>
              <Ionicons name="cube-outline" size={26} color="#66746f" />
            </View>
          )}
          <View style={styles.summaryBody}>
            <Text style={styles.summaryName}>{request.productName || "Service request"}</Text>
            <Text style={styles.summaryShop}>{request.shopName || "Funeral shop"}</Text>
            {request.variationName ? <Text style={styles.summaryVariation}>Option: {request.variationName}</Text> : null}
            <Text style={styles.summaryNote}>Editing closes when the shop responds.</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <PhotoField
            label="Memorial portrait"
            helper="Shown with the deceased’s information."
            value={form.memorialPhotoUrl}
            uploading={uploadingPhoto === "memorial"}
            onChoose={() => void choosePhoto("memorial")}
            onRemove={() => setField("memorialPhotoUrl", null)}
          />
        </View>

        {isCustomRequest ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Custom design</Text>
            <PhotoField
              label="Design reference"
              helper="A photo the shop can use when reviewing the custom design."
              value={form.referencePhotoUrl}
              uploading={uploadingPhoto === "reference"}
              onChoose={() => void choosePhoto("reference")}
              onRemove={() => setField("referencePhotoUrl", null)}
            />
            <Text style={styles.label}>Custom design specifications</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={form.customDesignNotes}
              onChangeText={(value) => setField("customDesignNotes", value)}
              placeholder="e.g. Wood, finish, color, lining, or engraving"
              multiline
            />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Arrangement details</Text>
          <Text style={styles.label}>Full name of the deceased *</Text>
          <TextInput
            style={styles.input}
            value={form.deceasedFullName}
            onChangeText={(value) => setField("deceasedFullName", value)}
          />

          <Text style={styles.label}>Date of birth *</Text>
          <TouchableOpacity style={styles.dateButton} onPress={() => setShowDateOfBirthPicker(true)}>
            <Text style={styles.dateButtonText}>{formatDateLabel(form.deceasedDateOfBirth, "Select date of birth")}</Text>
            <Ionicons name="calendar-outline" size={18} color="#62706b" />
          </TouchableOpacity>
          {showDateOfBirthPicker ? (
            <DateTimePicker
              value={form.deceasedDateOfBirth || new Date()}
              mode="date"
              display="default"
              maximumDate={form.deceasedDateOfPassing || new Date()}
              onChange={(_event, selectedDate) => {
                if (Platform.OS !== "ios") setShowDateOfBirthPicker(false);
                if (selectedDate) setField("deceasedDateOfBirth", selectedDate);
              }}
            />
          ) : null}

          <Text style={styles.label}>Date of passing *</Text>
          <TouchableOpacity style={styles.dateButton} onPress={() => setShowDateOfPassingPicker(true)}>
            <Text style={styles.dateButtonText}>{formatDateLabel(form.deceasedDateOfPassing, "Select date of passing")}</Text>
            <Ionicons name="calendar-outline" size={18} color="#62706b" />
          </TouchableOpacity>
          {showDateOfPassingPicker ? (
            <DateTimePicker
              value={form.deceasedDateOfPassing || new Date()}
              mode="date"
              display="default"
              minimumDate={form.deceasedDateOfBirth || undefined}
              maximumDate={new Date()}
              onChange={(_event, selectedDate) => {
                if (Platform.OS !== "ios") setShowDateOfPassingPicker(false);
                if (selectedDate) setField("deceasedDateOfPassing", selectedDate);
              }}
            />
          ) : null}

          <Text style={styles.label}>Age at passing *</Text>
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
            value={ageInputMode === "auto" ? (computedAge != null ? String(computedAge) : "") : form.deceasedAge}
            onChangeText={(value) => {
              setAgeInputMode("manual");
              setField("deceasedAge", value.replace(/[^0-9]/g, ""));
            }}
            placeholder="Age at time of passing"
            editable={ageInputMode === "manual"}
            keyboardType="number-pad"
          />

          <Text style={styles.label}>Tribute message *</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={form.tributeMessage}
            onChangeText={(value) => setField("tributeMessage", value)}
            placeholder="A short tribute in memory of the deceased"
            multiline
          />

          <Text style={styles.label}>Family coordinator *</Text>
          <TextInput
            style={styles.input}
            value={form.familyCoordinatorName}
            onChangeText={(value) => setField("familyCoordinatorName", value)}
            placeholder="Name of the family member in charge"
          />

          <Text style={styles.label}>Wake venue *</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={form.wakeAddress}
            onChangeText={(value) => setField("wakeAddress", value)}
            placeholder="Complete address of the wake venue"
            multiline
          />

          <Text style={styles.label}>Church / chapel *</Text>
          <TextInput
            style={styles.input}
            value={form.churchName}
            onChangeText={(value) => setField("churchName", value)}
            placeholder="Name of the church or chapel"
          />

          <Text style={styles.label}>Cemetery *</Text>
          <TextInput
            style={styles.input}
            value={form.cemeteryName}
            onChangeText={(value) => setField("cemeteryName", value)}
            placeholder="Name of the cemetery"
          />

          <ServiceRequestScheduleFields
            wakeStartDate={form.wakeStartDate}
            wakeEndDate={form.wakeEndDate}
            burialTime={form.burialTime}
            onWakeStartDateChange={(value) => setField("wakeStartDate", value)}
            onWakeEndDateChange={(value) => setField("wakeEndDate", value)}
            onBurialTimeChange={(value) => setField("burialTime", value)}
            minimumWakeDate={form.deceasedDateOfPassing}
          />

          <Text style={styles.label}>Pickup address *</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={form.pickupAddress}
            onChangeText={(value) => setField("pickupAddress", value)}
            placeholder="Location where the deceased will be picked up"
            multiline
          />

          <Text style={styles.label}>Contact number *</Text>
          <TextInput
            style={styles.input}
            value={form.contactNumber}
            onChangeText={(value) => setField("contactNumber", value)}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveButton, saving || Boolean(uploadingPhoto) ? styles.buttonDisabled : null]}
            onPress={() => void save()}
            disabled={saving || Boolean(uploadingPhoto)}
          >
            {saving ? <ActivityIndicator size="small" color="#ffffff" /> : null}
            <Text style={styles.saveButtonText}>{saving ? "Saving…" : "Save Changes"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.goBack()} disabled={saving}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f3f5f7",
  },
  header: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#dce2df",
    backgroundColor: "#ffffff",
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    color: "#1c2a26",
    fontSize: 18,
    fontWeight: "800",
  },
  headerSubtitle: {
    marginTop: 2,
    color: "#6b7772",
    fontSize: 12,
  },
  content: {
    padding: 18,
    paddingBottom: 120,
    gap: 16,
  },
  requestSummary: {
    flexDirection: "row",
    gap: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#d8e0e8",
  },
  summaryImage: {
    width: 92,
    height: 92,
    borderRadius: 8,
  },
  summaryFallback: {
    width: 92,
    height: 92,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d2d7d1",
    backgroundColor: "#ffffff",
  },
  summaryBody: {
    flex: 1,
    minWidth: 0,
  },
  summaryName: {
    color: "#22312d",
    fontSize: 17,
    fontWeight: "900",
  },
  summaryShop: {
    marginTop: 4,
    color: "#53615d",
    fontSize: 14,
    fontWeight: "700",
  },
  summaryVariation: {
    marginTop: 3,
    color: "#6c7974",
    fontSize: 12,
  },
  summaryNote: {
    marginTop: 8,
    color: "#6c7974",
    fontSize: 12,
    lineHeight: 17,
  },
  section: {
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#d8e0e8",
  },
  sectionTitle: {
    marginBottom: 18,
    color: "#1c2a26",
    fontSize: 17,
    fontWeight: "800",
  },
  label: {
    marginTop: 14,
    marginBottom: 7,
    color: "#35433e",
    fontSize: 13,
    fontWeight: "700",
  },
  fieldHelp: {
    marginTop: -2,
    marginBottom: 10,
    color: "#6d7974",
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "#cfd7d3",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    color: "#22312d",
    fontSize: 14,
  },
  multiline: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  dateButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#cfd7d3",
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  dateButtonText: {
    flex: 1,
    color: "#22312d",
    fontSize: 14,
  },
  ageModeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  ageModeButton: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#cfd7d3",
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  ageModeButtonActive: {
    borderColor: "#22312d",
    backgroundColor: "#22312d",
  },
  ageModeButtonText: {
    color: "#62706b",
    fontSize: 13,
    fontWeight: "800",
  },
  ageModeButtonTextActive: {
    color: "#ffffff",
  },
  photoField: {
    marginBottom: 18,
  },
  photoPicker: {
    height: 220,
    borderWidth: 1,
    borderColor: "#cfd7d3",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  photoPreview: {
    width: "100%",
    height: "100%",
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  photoPlaceholderText: {
    color: "#5f6c67",
    fontSize: 13,
    fontWeight: "700",
  },
  photoActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 18,
    paddingTop: 10,
  },
  photoAction: {
    minHeight: 34,
    justifyContent: "center",
  },
  photoActionText: {
    color: "#315f50",
    fontSize: 13,
    fontWeight: "800",
  },
  removePhotoText: {
    color: "#9b403b",
    fontSize: 13,
    fontWeight: "800",
  },
  footer: {
    paddingTop: 8,
    gap: 10,
  },
  saveButton: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    backgroundColor: "#263d35",
  },
  saveButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  cancelButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    color: "#53615c",
    fontSize: 14,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  unavailable: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  unavailableTitle: {
    color: "#22312d",
    fontSize: 20,
    fontWeight: "800",
  },
  unavailableText: {
    marginTop: 8,
    color: "#65716c",
    fontSize: 14,
    textAlign: "center",
  },
});
