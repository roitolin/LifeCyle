import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AppHeaderBackButton } from "@/components";
import AdminTabsNavigator from "./AdminTabsNavigator";
import { AdminUserDetailScreen } from "@/pages/admin";
import { ChatScreen, NotificationsScreen } from "@/pages/shared";

const Stack = createNativeStackNavigator();

export default function AdminStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={({ navigation }) => ({
        headerBackVisible: false,
        headerLeft: () => navigation.canGoBack() ? (
          <AppHeaderBackButton onPress={() => navigation.goBack()} />
        ) : null,
      })}
    >
      <Stack.Screen
        name="AdminTabs"
        component={AdminTabsNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ title: "Support Chat" }}
      />
      <Stack.Screen
        name="AdminUserDetail"
        component={AdminUserDetailScreen}
        options={{ title: "User Details" }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: "Notifications" }}
      />
    </Stack.Navigator>
  );
}
