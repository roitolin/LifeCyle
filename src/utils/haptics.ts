import * as Haptics from "expo-haptics";

export async function hapticSelection() {
  try {
    await Haptics.selectionAsync();
  } catch (error) {
    console.warn("Unable to trigger selection haptic:", error);
  }
}

export async function hapticMedium() {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch (error) {
    console.warn("Unable to trigger medium haptic:", error);
  }
}

export async function hapticSuccess() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (error) {
    console.warn("Unable to trigger success haptic:", error);
  }
}

export async function hapticWarning() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch (error) {
    console.warn("Unable to trigger warning haptic:", error);
  }
}

export async function hapticError() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch (error) {
    console.warn("Unable to trigger error haptic:", error);
  }
}
