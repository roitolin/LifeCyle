import { Ionicons } from "@expo/vector-icons";
import {
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from "react-native";

type AppBackButtonProps = {
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export default function AppBackButton({
  onPress,
  accessibilityLabel = "Go back",
  style,
}: AppBackButtonProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      onPress={onPress}
      style={[styles.button, style]}
    >
      <Ionicons name="chevron-back" size={23} color="#22312d" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef1ec",
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },
});