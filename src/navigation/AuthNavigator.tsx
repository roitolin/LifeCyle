import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  ForgotPasswordScreen,
  LoginScreen,
  MobileLandingScreen,
  RegisterScreen,
  VerifyEmailScreen,
} from "@/pages/auth";

const Stack = createNativeStackNavigator();

export default function AuthNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Onboarding"
      screenOptions={{ animation: "fade_from_bottom", headerShown: false }}
    >
      <Stack.Screen name="Onboarding" component={MobileLandingScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: false }} />
      <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
