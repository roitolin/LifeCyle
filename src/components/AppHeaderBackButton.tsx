import { StyleProp, StyleSheet, ViewStyle } from "react-native";
import AppBackButton from "./AppBackButton";

type AppHeaderBackButtonProps = {
  onPress: () => void;
  accessibilityLabel?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Back button spacing for React Navigation headers.
 *
 * Keep this separate from AppBackButton because several Shop Center screens
 * position the base button inside their own custom headers.
 */
export default function AppHeaderBackButton({
  onPress,
  accessibilityLabel = "Go back",
  color,
  style,
}: AppHeaderBackButtonProps) {
  return (
    <AppBackButton
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      color={color}
      style={[styles.button, style]}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "center",
    marginStart: 0,
    marginEnd: 8,
  },
});
