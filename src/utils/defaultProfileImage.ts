export type UserGender = "male" | "female" | "other" | null | undefined;

const maleDefault = require("../../assets/Male_Default_Profile.png");
const femaleDefault = require("../../assets/Female_Default_Profile.png");
const otherDefault = require("../../assets/Male_Default_Profile.png");

export const getDefaultProfileImage = (gender: UserGender) => {
  if (gender === "male") return maleDefault;
  if (gender === "female") return femaleDefault;
  return otherDefault;
};
