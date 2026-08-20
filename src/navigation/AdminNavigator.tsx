import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AdminDashboard } from "@/pages/admin";

const Stack = createNativeStackNavigator();

export default function AdminNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="AdminDashboard" component={AdminDashboard} options={{ title: "Admin Panel" }} />
    </Stack.Navigator>
  );
}
