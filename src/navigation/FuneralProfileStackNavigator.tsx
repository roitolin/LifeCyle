import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AppBackButton, AppHeaderBackButton } from "@/components";
import {
  AboutUsScreen,
  ContactScreen,
  ProfileScreen,
} from "@/pages/user";
import {
  AccountSecurityScreen,
  AccountSettingsScreen,
  AppFeedbackScreen,
  ChatScreen,
  DisputeReportScreen,
  MapLocationPickerScreen,
} from "@/pages/shared";
import FuneralBusinessInformationScreen from "@/screens/funeral/FuneralBusinessInformationScreen";
import FuneralMyServiceRequestsScreen from "@/screens/funeral/FuneralMyServiceRequestsScreen";
import FuneralProductEditorScreen from "@/screens/funeral/FuneralProductEditorScreen";
import FuneralProductDetailsScreen from "@/screens/funeral/FuneralProductDetailsScreen";
import FuneralServiceRequestsInboxScreen from "@/screens/funeral/FuneralServiceRequestsInboxScreen";
import FuneralServiceRequestDetailsScreen from "@/screens/funeral/FuneralServiceRequestDetailsScreen";
import FuneralShopCenterScreen from "@/screens/funeral/FuneralShopCenterScreen";
import FuneralShopInformationScreen from "@/screens/funeral/FuneralShopInformationScreen";

import PasswordSecurityScreen from '@/screens/shared/PasswordSecurityScreen';
import ActiveSessionsScreen from '@/screens/shared/ActiveSessionsScreen';
import AccountActivityLogScreen from '@/screens/shared/AccountActivityLogScreen';
import AccountChangesActivityScreen from '@/screens/shared/AccountChangesActivityScreen';
import BlockedAccountsScreen from '@/screens/shared/BlockedAccountsScreen';
import UserPaymentsScreen from '@/screens/user/UserPaymentsScreen';
import PrivacyDataScreen from '@/screens/shared/PrivacyDataScreen';
import NotificationPreferencesScreen from '@/screens/shared/NotificationPreferencesScreen';
import PrivacyPolicyScreen from '@/screens/shared/PrivacyPolicyScreen';
import TermsOfUseScreen from '@/screens/shared/TermsOfUseScreen';

const Stack = createNativeStackNavigator();

const SHOP_CENTER_ROUTES = new Set([
  "ShopInformation",
  "BusinessInformation",
  "ShopCenter",
  "ProductEditor",
  "ProductDetails",
  "ServiceRequestsInbox",
  "ServiceRequestDetails",
  "MapLocationPicker",
]);

export default function FuneralProfileStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={({ navigation, route }) => {
        const BackButton = SHOP_CENTER_ROUTES.has(route.name)
          ? AppBackButton
          : AppHeaderBackButton;

        return {
          headerBackVisible: false,
          headerLeft: () => navigation.canGoBack() ? (
            <BackButton onPress={() => navigation.goBack()} />
          ) : null,
          headerStyle: {
            backgroundColor: "#f8f6f2",
          },
          headerTintColor: "#22312d",
          headerShadowVisible: false,
          headerTitleStyle: {
            color: "#22312d",
            fontWeight: "700",
          },
          contentStyle: {
            backgroundColor: "#eef1ec",
          },
        };
      }}
    >
      <Stack.Screen
        name="ProfileMain"
        component={ProfileScreen}
        options={{
          title: "Profile",
          headerLeft: () => null,
          headerTitleAlign: "center",
        }}
      />
      <Stack.Screen name="ShopInformation" component={FuneralShopInformationScreen} options={{ title: "Shop Information" }} />
      <Stack.Screen name="BusinessInformation" component={FuneralBusinessInformationScreen} options={{ title: "Business Information" }} />
      <Stack.Screen name="ShopCenter" component={FuneralShopCenterScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProductEditor" component={FuneralProductEditorScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProductDetails" component={FuneralProductDetailsScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="ServiceRequestsInbox"
        component={FuneralServiceRequestsInboxScreen}
        options={({ navigation: nav }) => ({
          title: "Service Request Inbox",
          headerLeft: () => (
            <AppHeaderBackButton onPress={() => nav.navigate("ProfileMain")} />
          ),
        })}
      />
      <Stack.Screen name="ServiceRequestDetails" component={FuneralServiceRequestDetailsScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="MyServiceRequests"
        component={FuneralMyServiceRequestsScreen}
        options={({ navigation: nav }) => ({
          title: "My Service Requests",
          headerLeft: () => (
            <AppHeaderBackButton onPress={() => nav.navigate("ProfileMain")} />
          ),
        })}
      />
      <Stack.Screen name="Contact" component={ContactScreen} options={{ title: "Contact Support" }} />
      <Stack.Screen name="SupportChat" component={ChatScreen} options={{ title: "Support Chat" }} />
      <Stack.Screen name='ManageProfile' component={AccountSettingsScreen} options={{ title: 'Personal Information' }} />
      <Stack.Screen name='AccountSecurity' component={AccountSecurityScreen} options={{ title: 'Account Settings' }} />
      <Stack.Screen name='PrivacyData' component={PrivacyDataScreen} options={{ title: 'Privacy & Data' }} />
      <Stack.Screen name='NotificationPreferences' component={NotificationPreferencesScreen} options={{ title: 'Notification Preferences' }} />
      <Stack.Screen name='PrivacyPolicy' component={PrivacyPolicyScreen} options={{ title: 'Privacy Policy' }} />
      <Stack.Screen name='TermsOfUse' component={TermsOfUseScreen} options={{ title: 'Terms of Use' }} />
      <Stack.Screen name='PasswordSecurity' component={PasswordSecurityScreen} options={{ title: 'Password & Security' }} />
      <Stack.Screen name='ActiveSessions' component={ActiveSessionsScreen} options={{ title: 'Active Sessions' }} />
      <Stack.Screen name='BlockedAccounts' component={BlockedAccountsScreen} options={{ title: 'Blocked Accounts' }} />
      <Stack.Screen name='AccountChangesActivity' component={AccountChangesActivityScreen} options={{ title: 'Activity Log' }} />
      <Stack.Screen name='AccountActivityLog' component={AccountActivityLogScreen} options={{ title: 'Login & Logout History' }} />
      <Stack.Screen name='UserPayments' component={UserPaymentsScreen} options={{ title: 'My Payments' }} />
      <Stack.Screen name="AccountSettings" component={AccountSettingsScreen} options={{ title: "Account Settings" }} />
      <Stack.Screen name="AppFeedback" component={AppFeedbackScreen} options={{ title: "Rate & Feedback" }} />
      <Stack.Screen name="ReportCenter" component={DisputeReportScreen} options={{ title: "Report Center" }} />
      <Stack.Screen name="AboutUs" component={AboutUsScreen} options={{ title: "About Us" }} />
      <Stack.Screen name="MapLocationPicker" component={MapLocationPickerScreen} options={{ title: "Pin Location" }} />
    </Stack.Navigator>
  );
}
