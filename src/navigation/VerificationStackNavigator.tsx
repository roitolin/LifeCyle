import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { VerificationScreen } from "@/pages/auth";

const Stack = createNativeStackNavigator();

export default function VerificationStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Verification" component={VerificationScreen} />
    </Stack.Navigator>
  );
}
