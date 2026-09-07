import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { TermsAndConditionsScreen } from "@/pages/auth";

const Stack = createNativeStackNavigator();

export default function TermsNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="TermsAndConditions"
        component={TermsAndConditionsScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
