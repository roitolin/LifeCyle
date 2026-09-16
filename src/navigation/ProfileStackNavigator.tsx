import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AppHeaderBackButton } from "@/components";
import {
  ForgotPasswordScreen,
  LoginScreen,
  RegisterScreen,
  VerifyEmailScreen,
} from '@/pages/auth';
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
} from "@/pages/shared";

import PasswordSecurityScreen from '@/screens/shared/PasswordSecurityScreen';
import ActiveSessionsScreen from '@/screens/shared/ActiveSessionsScreen';
import AccountActivityLogScreen from '@/screens/shared/AccountActivityLogScreen';
import AccountChangesActivityScreen from '@/screens/shared/AccountChangesActivityScreen';
import BlockedAccountsScreen from '@/screens/shared/BlockedAccountsScreen';
import UserPaymentsScreen from '@/screens/user/UserPaymentsScreen';
import FuneralMyServiceRequestsScreen from '@/screens/funeral/FuneralMyServiceRequestsScreen';
import FuneralShopCenterScreen from '@/screens/funeral/FuneralShopCenterScreen';
import FuneralShopInformationScreen from '@/screens/funeral/FuneralShopInformationScreen';
import FuneralBusinessInformationScreen from '@/screens/funeral/FuneralBusinessInformationScreen';
import FuneralShopCustomersScreen from '@/screens/funeral/FuneralShopCustomersScreen';
import FuneralShopReportsScreen from '@/screens/funeral/FuneralShopReportsScreen';
import FuneralProductEditorScreen from '@/screens/funeral/FuneralProductEditorScreen';
import FuneralProductDetailsScreen from '@/screens/funeral/FuneralProductDetailsScreen';
import FuneralServiceRequestsInboxScreen from '@/screens/funeral/FuneralServiceRequestsInboxScreen';
import FuneralServiceRequestDetailsScreen from '@/screens/funeral/FuneralServiceRequestDetailsScreen';
import FuneralEditServiceRequestScreen from '@/screens/funeral/FuneralEditServiceRequestScreen';
import FuneralShopCatalogScreen from '@/screens/funeral/FuneralShopCatalogScreen';
import FuneralShopPackagesScreen from '@/screens/funeral/FuneralShopPackagesScreen';
import FuneralShopPaymentsScreen from '@/screens/funeral/FuneralShopPaymentsScreen';
import FuneralShopScheduleScreen from '@/screens/funeral/FuneralShopScheduleScreen';
import FuneralShopSettingsScreen from '@/screens/funeral/FuneralShopSettingsScreen';
import PrivacyDataScreen from '@/screens/shared/PrivacyDataScreen';
import NotificationPreferencesScreen from '@/screens/shared/NotificationPreferencesScreen';
import PrivacyPolicyScreen from '@/screens/shared/PrivacyPolicyScreen';
import TermsOfUseScreen from '@/screens/shared/TermsOfUseScreen';
import ManageDeviceAccountsScreen from '@/screens/shared/ManageDeviceAccountsScreen';

const Stack = createNativeStackNavigator();

export default function ProfileStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={({ navigation }) => ({
        headerBackVisible: false,
        headerLeft: () => navigation.canGoBack() ? (
          <AppHeaderBackButton onPress={() => navigation.goBack()} />
        ) : null,
      })}
    >
      <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ title: "Profile", headerTitleAlign: "center" }} />
      <Stack.Screen name='ShopCustomers' component={FuneralShopCustomersScreen} options={{ headerShown: false }} />
      <Stack.Screen name='ShopReports' component={FuneralShopReportsScreen} options={{ headerShown: false }} />
      <Stack.Screen name='Login' component={LoginScreen} initialParams={{ addAccount: true }} options={{ title: 'Add Account' }} />
      <Stack.Screen name='ForgotPassword' component={ForgotPasswordScreen} options={{ title: 'Forgot Password' }} />
      <Stack.Screen name='Register' component={RegisterScreen} options={{ title: 'Create Account' }} />
      <Stack.Screen name='VerifyEmail' component={VerifyEmailScreen} options={{ title: 'Verify Email' }} />
      <Stack.Screen name='ManageDeviceAccounts' component={ManageDeviceAccountsScreen} options={{ title: 'Accounts on This Device' }} />
      <Stack.Screen name="Contact" component={ContactScreen} options={{ title: "Contact Support" }} />
      <Stack.Screen name="SupportChat" component={ChatScreen} options={{ title: "Support Chat" }} />
      <Stack.Screen name='ManageProfile' component={AccountSettingsScreen} options={{ title: 'Personal Information' }} />
      <Stack.Screen name='ShopInformation' component={FuneralShopInformationScreen} options={{ title: 'Shop Information' }} />
      <Stack.Screen name='BusinessInformation' component={FuneralBusinessInformationScreen} options={{ title: 'Business Information' }} />
      <Stack.Screen name='ShopCenter' component={FuneralShopCenterScreen} options={{ headerShown: false }} />
      <Stack.Screen name='ShopCatalog' component={FuneralShopCatalogScreen} options={{ headerShown: false }} />
      <Stack.Screen name='ShopPackages' component={FuneralShopPackagesScreen} options={{ headerShown: false }} />
      <Stack.Screen name='ShopSettings' component={FuneralShopSettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name='ProductEditor' component={FuneralProductEditorScreen} options={{ headerShown: false }} />
      <Stack.Screen name='ProductDetails' component={FuneralProductDetailsScreen} options={{ headerShown: false }} />
      <Stack.Screen name='ServiceRequestsInbox' component={FuneralServiceRequestsInboxScreen} options={{ title: 'Arrangement Cases' }} />
      <Stack.Screen name='ServiceRequestDetails' component={FuneralServiceRequestDetailsScreen} options={{ headerShown: false }} />
      <Stack.Screen name='EditServiceRequest' component={FuneralEditServiceRequestScreen} options={{ headerShown: false }} />
      <Stack.Screen name='ServiceSchedule' component={FuneralShopScheduleScreen} options={{ headerShown: false }} />
      <Stack.Screen name='ShopPayments' component={FuneralShopPaymentsScreen} options={{ headerShown: false }} />
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
      <Stack.Screen name='MyServiceRequests' component={FuneralMyServiceRequestsScreen} options={{ title: 'My Service Requests' }} />
      <Stack.Screen name='UserPayments' component={UserPaymentsScreen} options={{ title: 'My Payments' }} />
      <Stack.Screen name="AppFeedback" component={AppFeedbackScreen} options={{ title: "Rate & Feedback" }} />
      <Stack.Screen name="ReportCenter" component={DisputeReportScreen} options={{ title: "Report Center" }} />
      <Stack.Screen name="AboutUs" component={AboutUsScreen} options={{ title: "About Us" }} />
    </Stack.Navigator>
  );
}
