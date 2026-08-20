import { Alert } from "react-native";

type ConfirmLogoutParams = {
  logout: () => Promise<void>;
  onError?: (error: any) => void;
};

export function confirmLogout({ logout, onError }: ConfirmLogoutParams) {
  Alert.alert("Logout", "Are you sure you want to log out?", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Log Out",
      style: "destructive",
      onPress: async () => {
        try {
          await logout();
        } catch (error) {
          onError?.(error);
        }
      },
    },
  ]);
}
