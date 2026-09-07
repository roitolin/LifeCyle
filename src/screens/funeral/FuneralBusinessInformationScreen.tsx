import { useState } from "react";
import { Alert, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Button as PaperButton } from "react-native-paper";
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
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.stepLabel}>Step 2 of 2</Text>
            <Text style={styles.title}>Business Information</Text>

            <Text style={styles.label}>Individual Registered Name *</Text>
            <TextInput style={styles.input} value={individualRegisteredName} onChangeText={setIndividualRegisteredName} />

            <Text style={styles.label}>Business Name *</Text>
            <TextInput style={styles.input} value={businessName} onChangeText={setBusinessName} />

            <Text style={styles.label}>General Location *</Text>
            <TextInput style={styles.input} value={generalLocation} onChangeText={setGeneralLocation} />

            <Text style={styles.label}>Registered Address *</Text>
            <TextInput style={[styles.input, styles.multilineInput]} value={registeredAddress} onChangeText={setRegisteredAddress} multiline />

            <Text style={styles.label}>Zip Code *</Text>
            <TextInput style={styles.input} value={zipCode} onChangeText={setZipCode} keyboardType="number-pad" />

            <Text style={styles.label}>Taxpayer Identification Number (TIN) *</Text>
            <TextInput style={styles.input} value={tin} onChangeText={setTin} />

            <Text style={styles.label}>Value Added Tax Registration Status *</Text>
            <View style={styles.pickerContainer}>
              <Picker selectedValue={vatRegistrationStatus} onValueChange={(value) => setVatRegistrationStatus(value)}>
                {VAT_OPTIONS.map((option) => (
                  <Picker.Item key={option} label={option} value={option} />
                ))}
              </Picker>
            </View>

            <Text style={styles.label}>BIR Certificate of Registration *</Text>
            <TouchableOpacity style={styles.uploadButton} onPress={pickBirCertificate} disabled={uploading}>
              <Ionicons name="cloud-upload-outline" size={18} color="#5a6b64" />
              <Text style={styles.uploadButtonText}>{uploading ? "Uploading..." : "Upload Certificate"}</Text>
            </TouchableOpacity>

            {birCertificateUrl ? (
              <View style={styles.previewCard}>
                <Image source={{ uri: birCertificateUrl }} style={styles.previewImage} resizeMode="cover" />
                <Text style={styles.previewText}>BIR certificate ready</Text>
              </View>
            ) : null}

            <PaperButton mode="contained" buttonColor="#5a6b64" onPress={handleSubmit} loading={submitting} disabled={submitting || uploading} style={styles.primaryButton}>
              Submit
            </PaperButton>
          </Card.Content>
        </Card>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef1ec",
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  card: {
    borderRadius: 14,
  },
  stepLabel: {
    color: "#75807b",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8,
  },
  title: {
    color: "#0f172a",
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 8,
  },
  label: {
    color: "#4c5b57",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd2cb",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#ffffff",
    color: "#22312d",
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#cbd2cb",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  uploadButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#cad5cc",
    borderRadius: 10,
    paddingVertical: 14,
    backgroundColor: "#fbfcf8",
  },
  uploadButtonText: {
    color: "#5a6b64",
    fontSize: 14,
    fontWeight: "700",
  },
  previewCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8ddd7",
    alignItems: "center",
  },
  previewImage: {
    width: "100%",
    height: 180,
    borderRadius: 10,
    marginBottom: 10,
  },
  previewText: {
    color: "#5a6b64",
    fontSize: 14,
    fontWeight: "700",
  },
  primaryButton: {
    marginTop: 20,
    borderRadius: 10,
  },
});

