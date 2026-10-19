export type UserGender = "male" | "female" | "other" | null | undefined;

const maleDefault = require("../../assets/Default Characters/Male.png");
const femaleDefault = require("../../assets/Default Characters/Female.png");
const otherDefault = require("../../assets/Default Characters/Male.png");

export const getDefaultProfileImage = (gender: UserGender) => {
  if (gender === "male") return maleDefault;
  if (gender === "female") return femaleDefault;
  return otherDefault;
};
