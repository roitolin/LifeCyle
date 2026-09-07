import { DefaultTheme as NavigationDefaultTheme } from "@react-navigation/native";
import { MD3LightTheme } from "react-native-paper";
import { colors } from "./colors";

export { colors } from "./colors";
export { radii, spacing } from "./spacing";

export const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.accent,
    secondary: "#f44336",
    background: colors.background,
    surface: colors.surface,
  },
  roundness: 10,
};

export const navigationTheme = {
  ...NavigationDefaultTheme,
  colors: {
    ...NavigationDefaultTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.surface,
    text: colors.textStrong,
    border: colors.border,
  },
};
