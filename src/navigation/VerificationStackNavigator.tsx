import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { VerificationScreen } from "@/pages/auth";
import { smoothAuthTransition } from "./navigationTransitions";

const Stack = createNativeStackNavigator();

export default function VerificationStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ ...smoothAuthTransition, headerShown: false }}>
      <Stack.Screen name="Verification" component={VerificationScreen} />
    </Stack.Navigator>
  );
}
