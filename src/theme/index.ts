import { DefaultTheme as NavigationDefaultTheme } from "@react-navigation/native";
import { MD3LightTheme } from "react-native-paper";

export const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: "#d32f2f",
    secondary: "#f44336",
    background: "#f3f4f6",
    surface: "#ffffff",
  },
  roundness: 10,
};

export const navigationTheme = {
  ...NavigationDefaultTheme,
  colors: {
    ...NavigationDefaultTheme.colors,
    primary: "#d32f2f",
    background: "#fff5f5",
    card: "#ffffff",
    text: "#111827",
    border: "#f1f5f9",
  },
};
