import { useState } from "react";
import { Alert, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button as PaperButton } from "react-native-paper";
import { Picker } from "@react-native-picker/picker";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "@/components";
import { supabase } from "@/services/supabaseClient";
import { auth, uploadCertificate } from "@/services";
import { sanitizePlainText } from "@/utils/inputSecurity";

const VAT_OPTIONS = ["VAT Registered", "Non Registered"];
const isPermissionDeniedError = (error: any) =>
  error?.code === "permission-denied" ||
  /missing or insufficient permissions/i.test(String(error?.message || ""));

const FIELD_LIMITS = {
  shopName: 120,
  shopAddress: 220,
  shopPhoneNumber: 24,
  individualRegisteredName: 120,
  businessName: 140,
  generalLocation: 120,
  registeredAddress: 220,
  zipCode: 10,
  tin: 32,
  birCertificateUrl: 1000,
} as const;

export default function FuneralBusinessInformationScreen({ navigation, route }: any) {
  const draft = route.params?.draft || {};
  const [individualRegisteredName, setIndividualRegisteredName] = useState(draft.individualRegisteredName || "");
  const [businessName, setBusinessName] = useState(draft.businessName || draft.shopName || "");
  const [generalLocation, setGeneralLocation] = useState(draft.generalLocation || "");
  const [registeredAddress, setRegisteredAddress] = useState(draft.registeredAddress || "");
  const [zipCode, setZipCode] = useState(draft.zipCode || "");
  const [tin, setTin] = useState(draft.tin || "");
  const [vatRegistrationStatus, setVatRegistrationStatus] = useState(draft.vatRegistrationStatus || VAT_OPTIONS[0]);
  const [birCertificateUrl, setBirCertificateUrl] = useState<string | null>(draft.birCertificateUrl || null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const pickBirCertificate = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.7,
    });

    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const uploadedUrl = await uploadCertificate(result.assets[0].uri);
      setBirCertificateUrl(uploadedUrl);
      Alert.alert("Uploaded", "BIR certificate uploaded successfully.");
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Failed to upload BIR certificate.");
    } finally {
      setUploading(false);
    }
  };

  const submitRegistration = async (payload: {
    shopName: string;
    shopAddress: string;
    shopPhoneNumber: string;
    individualRegisteredName: string;
    businessName: string;
    generalLocation: string;
    registeredAddress: string;
    zipCode: string;
    tin: string;
    birCertificateUrl: string;
  }) => {
    const user = auth.currentUser;
    if (!user) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.from("funeral_shops").upsert({
        id: user.uid,
        shopName: payload.shopName,
        shopAddress: payload.shopAddress,
        shopPhoneNumber: payload.shopPhoneNumber,
        shopImageUrl: null,
        individualRegisteredName: payload.individualRegisteredName,
        businessName: payload.businessName,
        generalLocation: payload.generalLocation,
        registeredAddress: payload.registeredAddress,
        zipCode: payload.zipCode,
        tin: payload.tin,
        vatRegistrationStatus: vatRegistrationStatus === VAT_OPTIONS[0],
        birCertificateUrl: payload.birCertificateUrl,
        status: "pending",
        rejectionReason: null,
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      if (error) throw error;

      Alert.alert("Submitted", "Your shop registration has been submitted.", [
        {
          text: "OK",
          onPress: () => navigation.reset({ index: 0, routes: [{ name: "ProfileMain" }] }),
        },
      ]);
    } catch (error: any) {
      const message = isPermissionDeniedError(error)
        ? "Unable to submit your registration right now. Please try again in a moment."
        : error?.message || "Failed to submit shop registration.";
      Alert.alert("Submit failed", message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    const safeShopName = sanitizePlainText(draft.shopName || "", FIELD_LIMITS.shopName);
    const safeShopAddress = sanitizePlainText(draft.shopAddress || "", FIELD_LIMITS.shopAddress);
    const safeShopPhoneNumber = sanitizePlainText(draft.shopPhoneNumber || "", FIELD_LIMITS.shopPhoneNumber);
    const safeIndividualRegisteredName = sanitizePlainText(individualRegisteredName, FIELD_LIMITS.individualRegisteredName);
    const safeBusinessName = sanitizePlainText(businessName, FIELD_LIMITS.businessName);
    const safeGeneralLocation = sanitizePlainText(generalLocation, FIELD_LIMITS.generalLocation);
    const safeRegisteredAddress = sanitizePlainText(registeredAddress, FIELD_LIMITS.registeredAddress);
    const safeZipCode = sanitizePlainText(zipCode, FIELD_LIMITS.zipCode);
    const safeTin = sanitizePlainText(tin, FIELD_LIMITS.tin);
    const safeBirCertificateUrl = birCertificateUrl ? sanitizePlainText(birCertificateUrl, FIELD_LIMITS.birCertificateUrl) : "";

    if (
      !safeShopName ||
      !safeShopAddress ||
      !safeShopPhoneNumber ||
      !safeIndividualRegisteredName ||
      !safeBusinessName ||
      !safeGeneralLocation ||
      !safeRegisteredAddress ||
      !safeZipCode ||
      !safeTin ||
      !safeBirCertificateUrl
    ) {
      Alert.alert("Missing fields", "Please complete all required business information and upload the BIR certificate.");
      return;
    }

    Alert.alert("Submit registration?", "Are you sure you want to submit your funeral shop registration?", [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Submit",
        onPress: () =>
          void submitRegistration({
            shopName: safeShopName,
            shopAddress: safeShopAddress,
            shopPhoneNumber: safeShopPhoneNumber,
            individualRegisteredName: safeIndividualRegisteredName,
            businessName: safeBusinessName,
            generalLocation: safeGeneralLocation,
            registeredAddress: safeRegisteredAddress,
            zipCode: safeZipCode,
            tin: safeTin,
            birCertificateUrl: safeBirCertificateUrl,
          }),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.pageContent}>
          <View style={styles.stepRow}>
            <Text style={styles.stepLabel}>SHOP REGISTRATION</Text>
            <Text style={styles.stepCount}>2 of 2</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={styles.progressFull} />
          </View>

          <View style={styles.heading}>
            <Text style={styles.title}>Business information</Text>
            <Text style={styles.subtitle}>Provide the registered business and tax details used for verification.</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Registered business</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Individual registered name <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={individualRegisteredName}
                onChangeText={setIndividualRegisteredName}
                placeholder="Enter the registered owner's name"
                placeholderTextColor="#8b948f"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Business name <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={businessName}
                onChangeText={setBusinessName}
                placeholder="Enter the registered business name"
                placeholderTextColor="#8b948f"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>General location <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={generalLocation}
                onChangeText={setGeneralLocation}
                placeholder="City or municipality"
                placeholderTextColor="#8b948f"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Registered address <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={registeredAddress}
                onChangeText={setRegisteredAddress}
                placeholder="Enter the complete registered address"
                placeholderTextColor="#8b948f"
                multiline
              />
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tax details</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Zip code <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={zipCode}
                onChangeText={setZipCode}
                placeholder="Enter the zip code"
                placeholderTextColor="#8b948f"
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Taxpayer Identification Number (TIN) <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={tin}
                onChangeText={setTin}
                placeholder="Enter the TIN"
                placeholderTextColor="#8b948f"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>VAT registration status <Text style={styles.required}>*</Text></Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={vatRegistrationStatus}
                  onValueChange={(value) => setVatRegistrationStatus(value)}
                  style={styles.picker}
                  dropdownIconColor="#405b52"
                >
                  {VAT_OPTIONS.map((option) => (
                    <Picker.Item key={option} label={option} value={option} />
                  ))}
                </Picker>
              </View>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Registration document</Text>
            <Text style={styles.sectionDescription}>Upload a clear image of the BIR Certificate of Registration.</Text>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={birCertificateUrl ? "Replace certificate image" : "Choose certificate image"}
              style={styles.uploadButton}
              onPress={pickBirCertificate}
              disabled={uploading}
              activeOpacity={0.75}
            >
              <View style={styles.uploadIcon}>
                <Ionicons name={birCertificateUrl ? "refresh-outline" : "cloud-upload-outline"} size={22} color="#405b52" />
              </View>
              <View style={styles.uploadCopy}>
                <Text style={styles.uploadButtonText}>
                  {uploading ? "Uploading..." : birCertificateUrl ? "Replace certificate image" : "Choose certificate image"}
                </Text>
                <Text style={styles.uploadHint}>
                  {birCertificateUrl ? "Select another image if this one is incorrect" : "Use a readable, uncropped photo"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#7a8782" />
            </TouchableOpacity>

            {birCertificateUrl ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Certificate uploaded. Tap to replace the image"
                style={styles.preview}
                onPress={pickBirCertificate}
                disabled={uploading}
                activeOpacity={0.75}
              >
                <Image source={{ uri: birCertificateUrl }} style={styles.previewImage} resizeMode="cover" />
                <View style={styles.previewCopy}>
                  <Text style={styles.previewText}>Certificate uploaded</Text>
                  <Text style={styles.previewHint}>Tap to replace this image</Text>
                </View>
                <Ionicons name="create-outline" size={21} color="#405b52" />
              </TouchableOpacity>
            ) : null}
          </View>

          <PaperButton
            mode="contained"
            buttonColor="#405b52"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting || uploading}
            style={styles.primaryButton}
            contentStyle={styles.primaryButtonContent}
            labelStyle={styles.primaryButtonLabel}
          >
            Submit
          </PaperButton>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f7f8f5",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 48,
  },
  pageContent: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepLabel: {
    color: "#5c6f68",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  stepCount: {
    color: "#b6463d",
    fontSize: 12,
    fontWeight: "800",
  },
  progressTrack: {
    height: 3,
    marginTop: 10,
    overflow: "hidden",
    borderRadius: 2,
    backgroundColor: "#dce2dd",
  },
  progressFull: {
    width: "100%",
    height: "100%",
    backgroundColor: "#405b52",
  },
  heading: {
    marginTop: 34,
    marginBottom: 30,
  },
  title: {
    color: "#1f2d29",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  subtitle: {
    maxWidth: 520,
    marginTop: 9,
    color: "#66736e",
    fontSize: 15,
    lineHeight: 22,
  },
  section: {
    gap: 20,
  },
  sectionTitle: {
    color: "#263832",
    fontSize: 17,
    fontWeight: "800",
  },
  sectionDescription: {
    marginTop: -12,
    color: "#6e7a75",
    fontSize: 13,
    lineHeight: 19,
  },
  divider: {
    height: 1,
    marginVertical: 30,
    backgroundColor: "#dce2dd",
  },
  field: {
    gap: 8,
  },
  label: {
    color: "#30433d",
    fontSize: 14,
    fontWeight: "700",
  },
  required: {
    color: "#b6463d",
  },
  input: {
    borderWidth: 1,
    borderColor: "#c7d0ca",
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 15,
    paddingVertical: 13,
    backgroundColor: "#ffffff",
    color: "#1f2d29",
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 108,
    textAlignVertical: "top",
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#c7d0ca",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  picker: {
    color: "#1f2d29",
    minHeight: 52,
  },
  uploadButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#aab9b1",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#ffffff",
  },
  uploadIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e8eeea",
  },
  uploadCopy: {
    flex: 1,
  },
  uploadButtonText: {
    color: "#30433d",
    fontSize: 14,
    fontWeight: "800",
  },
  uploadHint: {
    marginTop: 3,
    color: "#7a8782",
    fontSize: 12,
  },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 78,
    padding: 10,
    borderWidth: 1,
    borderColor: "#cbd6cf",
    borderRadius: 12,
    backgroundColor: "#eef3ef",
  },
  previewImage: {
    width: 58,
    height: 58,
    borderRadius: 9,
    backgroundColor: "#e8ece8",
  },
  previewCopy: {
    flex: 1,
  },
  previewText: {
    color: "#30433d",
    fontSize: 14,
    fontWeight: "800",
  },
  previewHint: {
    marginTop: 3,
    color: "#6e7a75",
    fontSize: 12,
  },
  primaryButton: {
    marginTop: 34,
    borderRadius: 12,
  },
  primaryButtonContent: {
    minHeight: 52,
  },
  primaryButtonLabel: {
    fontSize: 15,
    fontWeight: "800",
  },
});

