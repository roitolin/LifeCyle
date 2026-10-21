import { Alert, Linking, Platform } from "react-native";
import * as ExpoImagePicker from "expo-image-picker";

function canceledResult(): ExpoImagePicker.ImagePickerResult {
  return { canceled: true, assets: null };
}

function showDeniedPermission(kind: "camera" | "photos", canAskAgain: boolean) {
  const label = kind === "camera" ? "Camera" : "Photo library";
  const message = kind === "camera"
    ? "LifeCycle needs camera access when you choose to take a photo."
    : "LifeCycle needs photo access when you choose an image to upload.";

  if (canAskAgain) {
    Alert.alert(label + " permission needed", message);
    return;
  }

  Alert.alert(
    label + " permission blocked",
    message + " You can allow it from your device settings.",
    [
      { text: "Not now", style: "cancel" },
      { text: "Open settings", onPress: () => void Linking.openSettings() },
    ],
  );
}

async function ensureCameraPermission() {
  const current = await ExpoImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) {
    showDeniedPermission("camera", false);
    return false;
  }

  const requested = await ExpoImagePicker.requestCameraPermissionsAsync();
  if (requested.granted) return true;
  showDeniedPermission("camera", requested.canAskAgain);
  return false;
}

async function ensurePhotoPermission() {
  const current = await ExpoImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) {
    showDeniedPermission("photos", false);
    return false;
  }

  const requested = await ExpoImagePicker.requestMediaLibraryPermissionsAsync();
  if (requested.granted) return true;
  showDeniedPermission("photos", requested.canAskAgain);
  return false;
}

export async function launchCameraAsync(
  options: ExpoImagePicker.ImagePickerOptions = {},
): Promise<ExpoImagePicker.ImagePickerResult> {
  // Expo's permission request is a no-op on web. Launch directly so browsers
  // retain the user gesture required to open their camera UI.
  if (Platform.OS === "web") return ExpoImagePicker.launchCameraAsync(options);
  if (!(await ensureCameraPermission())) return canceledResult();
  return ExpoImagePicker.launchCameraAsync(options);
}

export async function launchImageLibraryAsync(
  options: ExpoImagePicker.ImagePickerOptions = {},
): Promise<ExpoImagePicker.ImagePickerResult> {
  // The browser file picker is itself the privacy boundary and must be opened
  // synchronously from the user's click.
  if (Platform.OS === "web") return ExpoImagePicker.launchImageLibraryAsync(options);
  if (!(await ensurePhotoPermission())) return canceledResult();
  return ExpoImagePicker.launchImageLibraryAsync(options);
}
