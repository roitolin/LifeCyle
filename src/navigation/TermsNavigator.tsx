import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { TermsAndConditionsScreen } from "@/pages/auth";
import { smoothAuthTransition } from "./navigationTransitions";

const Stack = createNativeStackNavigator();

export default function TermsNavigator() {
  return (
    <Stack.Navigator screenOptions={smoothAuthTransition}>
      <Stack.Screen
        name="TermsAndConditions"
        component={TermsAndConditionsScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
