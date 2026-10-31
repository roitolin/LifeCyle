import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  ForgotPasswordScreen,
  LoginScreen,
  MobileLandingScreen,
  RegisterScreen,
  VerifyEmailScreen,
} from "@/pages/auth";
import { colors } from "@/theme";
import { smoothAuthTransition } from "./navigationTransitions";

const Stack = createNativeStackNavigator();

export default function AuthNavigator({ showOnboarding }: { showOnboarding: boolean }) {
  return (
    <Stack.Navigator
      initialRouteName={showOnboarding ? "Onboarding" : "Login"}
      screenOptions={{ ...smoothAuthTransition, headerShown: false }}
    >
      <Stack.Screen name="Onboarding" component={MobileLandingScreen} />
      <Stack.Screen
        name="Login"
        component={LoginScreen}
        options={{ contentStyle: { backgroundColor: colors.surfaceWarm } }}
      />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen
        name="Register"
        component={RegisterScreen}
        options={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.surfaceWarm },
        }}
      />
      <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
