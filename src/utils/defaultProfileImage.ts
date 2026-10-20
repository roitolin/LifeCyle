import type { ImageSourcePropType } from "react-native";

export type UserGender = "male" | "female" | "other" | string | null | undefined;

export const maleDefault = require("../../assets/Default Characters/Male.png");
export const femaleDefault = require("../../assets/Default Characters/Female.png");
export const otherDefault = maleDefault;

export const getDefaultProfileImage = (gender?: UserGender): ImageSourcePropType => {
  return String(gender || "").trim().toLowerCase() === "female"
    ? femaleDefault
    : maleDefault;
};

export const getProfileImageSource = (
  photoURL?: string | null,
  gender?: UserGender
): ImageSourcePropType => {
  const trimmed = typeof photoURL === "string" ? photoURL.trim() : "";
  if (trimmed.length > 0) {
    return { uri: trimmed };
  }
  return getDefaultProfileImage(gender);
};

