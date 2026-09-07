import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Card, Button as PaperButton } from "react-native-paper";
import { Picker } from "@react-native-picker/picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { KeyboardAwareScrollView } from "@/components";
import { supabase } from "@/services/supabaseClient";
import { auth } from "@/services/supabaseAuth";
import { uploadProfilePicture } from '@/services/supabaseStorage';

import { recordAccountActivity } from '@/utils/accountActivity';

const maleDefault = require("../../../assets/Male_Default_Profile.png");
const femaleDefault = require("../../../assets/Female_Default_Profile.png");
const otherDefault = require("../../../assets/Male_Default_Profile.png");

export default function AccountSettingsScreen({ navigation }: any) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);

  const getDefaultImage = () => {
    if (gender === "male") return maleDefault;
    if (gender === "female") return femaleDefault;
    return otherDefault;
  };

  const loadAccount = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("id", user.uid)
        .single();
      if (!data) return;

      setFullName(String(data.fullName || ""));
      setEmail(String(data.email || user.email || ""));
      setGender((data.gender as "male" | "female" | "other" | null) || null);
      setDateOfBirth(data.dateOfBirth ? new Date(data.dateOfBirth) : null);
      setPhotoURL(data.photoURL || null);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load account information.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadAccount();
    }, [loadAccount])
  );

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return;

    if (!fullName.trim() || !gender || !dateOfBirth) {
      Alert.alert("Missing Fields", "Please complete full name, gender, and date of birth.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("users").update({
        fullName: fullName.trim(),
        gender,
        dateOfBirth: dateOfBirth.toISOString(),
        photoURL: photoURL || null,
        updatedAt: new Date().toISOString(),
      }).eq("id", user.uid);
      if (error) throw error;
      await recordAccountActivity('profile_updated');
      Alert.alert("Saved", "Your account information was updated.");
    } catch (error: any) {
      Alert.alert("Save Failed", error?.message || "Unable to save your account information.");
    } finally {
      setSaving(false);
    }
  };

  const uploadProfilePic = async (uri: string) => {
    const user = auth.currentUser;
    if (!user) return;

    setUploading(true);
    try {
      const downloadURL = await uploadProfilePicture(uri);
      await supabase.from("users").update({ photoURL: downloadURL, updatedAt: new Date().toISOString() }).eq("id", user.uid);
      setPhotoURL(downloadURL);
      Alert.alert("Success", "Profile picture updated.");
    } catch (error: any) {
      Alert.alert("Upload Failed", error?.message || "Failed to upload profile photo.");
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
      Alert.alert("Permission Needed", "Camera permission is required.");
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

  const onDateChange = (_event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) setDateOfBirth(selectedDate);
  };

  const calculatedAge = dateOfBirth ? (() => {
    const today = new Date();
    let a = today.getFullYear() - dateOfBirth.getFullYear();
    const m = today.getMonth() - dateOfBirth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dateOfBirth.getDate())) {
      a--;
    }
    return a;
  })() : null;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Card style={styles.headerCard}>
          <Card.Content>
            <Text style={styles.title}>Personal details</Text>
            <Text style={styles.subtitle}>Update your registration information and profile photo.</Text>
          </Card.Content>
        </Card>

        <Card style={styles.sectionCard}>
          <Card.Content>
            <View style={styles.photoSection}>
              <TouchableOpacity onPress={() => setPreviewVisible(true)} style={styles.photoContainer}>
                {uploading ? (
                  <ActivityIndicator size="large" color="#41514d" />
                ) : photoURL ? (
                  <Image source={{ uri: photoURL }} style={styles.photo} resizeMode="cover" />
                ) : (
                  <Image source={getDefaultImage()} style={styles.photo} resizeMode="cover" />
                )}
              </TouchableOpacity>
              <View style={styles.photoActions}>
                <PaperButton mode="outlined" onPress={pickImage} disabled={uploading}>Gallery</PaperButton>
                <PaperButton mode="outlined" onPress={takePhoto} disabled={uploading}>Camera</PaperButton>
              </View>
            </View>

            <Text style={styles.label}>Email</Text>
            <TextInput style={[styles.input, styles.readOnlyInput]} value={email} editable={false} />

            <Text style={styles.label}>Full Name *</Text>
            <TextInput style={styles.input} value={fullName} onChangeText={setFullName} />

            <Text style={styles.label}>Gender *</Text>
            <View style={styles.pickerContainer}>
              <Picker selectedValue={gender} onValueChange={(value) => setGender(value)}>
                <Picker.Item label="Select gender..." value={null} />
                <Picker.Item label="Male" value="male" />
                <Picker.Item label="Female" value="female" />
                <Picker.Item label="Other" value="other" />
              </Picker>
            </View>

            <Text style={styles.label}>Date of Birth *</Text>
            <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.dateButton}>
              <Text style={styles.dateText}>{dateOfBirth ? dateOfBirth.toLocaleDateString() : "Select date"}</Text>
            </TouchableOpacity>
            {showDatePicker ? (
              <DateTimePicker
                value={dateOfBirth || new Date()}
                mode="date"
                display="default"
                onChange={onDateChange}
                maximumDate={new Date()}
              />
            ) : null}

            <Text style={styles.label}>Age</Text>
            <View style={styles.ageDisplay}>
              <Text style={styles.ageText}>{calculatedAge !== null ? `${calculatedAge} years old` : "Not available"}</Text>
            </View>

            <PaperButton
              mode="contained"
              buttonColor="#22312d"
              onPress={handleSave}
              loading={saving}
              disabled={saving || uploading}
              style={styles.saveButton}
            >
              Save changes
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
    padding: 20,
    paddingBottom: 120,
    gap: 14,
  },
  headerCard: {
    borderRadius: 24,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },

  title: {
    color: "#22312d",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    marginBottom: 8,
  },
  subtitle: {
    color: "#62706b",
    fontSize: 14,
    lineHeight: 22,
  },
  sectionCard: {
    borderRadius: 24,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },
  photoSection: {
    alignItems: "center",
    marginBottom: 12,
  },
  photoContainer: {
    width: 118,
    height: 118,
    borderRadius: 59,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#41514d",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ebf1e8",
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
    color: "#41514d",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    backgroundColor: "#ffffff",
    color: "#22312d",
  },
  readOnlyInput: {
    backgroundColor: "#f9fafb",
    color: "#6b7280",
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  dateButton: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  dateText: {
    color: "#22312d",
    fontSize: 15,
  },
  ageDisplay: {
    borderWidth: 1,
    borderColor: "#d9d6cd",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#f9fafb",
  },
  ageText: {
    fontSize: 15,
    color: "#41514d",
  },
  saveButton: {
    marginTop: 18,
    borderRadius: 999,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
  },
  modalContent: {
    backgroundColor: "#ffffff",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    width: "100%",
    maxWidth: 420,
  },
  previewImage: {
    width: 300,
    height: 300,
    borderRadius: 12,
    marginBottom: 10,
  },
});

