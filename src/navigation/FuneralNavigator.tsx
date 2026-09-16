import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { getFocusedRouteNameFromRoute, CommonActions } from "@react-navigation/native";
import { Pressable, View } from "react-native";
import { emitTabRefresh } from "@/utils/tabRefresh";
import { AppHeaderBackButton } from "@/components";
import { FuneralHomeScreen } from "@/pages/funeral";
import FuneralCartScreen from "@/screens/funeral/FuneralCartScreen";
import FuneralCheckoutScreen from "@/screens/funeral/FuneralCheckoutScreen";
import FuneralCustomCasketRequestScreen from "@/screens/funeral/FuneralCustomCasketRequestScreen";
import FuneralProductViewScreen from "@/screens/funeral/FuneralProductViewScreen";
import FuneralSearchScreen from "@/screens/funeral/FuneralSearchScreen";
import FuneralShopProductsScreen from "@/screens/funeral/FuneralShopProductsScreen";
import FuneralShopsScreen from "@/screens/funeral/FuneralShopsScreen";
import FuneralServiceRequestDetailsScreen from "@/screens/funeral/FuneralServiceRequestDetailsScreen";
import FuneralEditServiceRequestScreen from "@/screens/funeral/FuneralEditServiceRequestScreen";
import { ChatScreen, ConversationsList, DisputeReportScreen, NotificationsScreen } from "@/pages/shared";
import FuneralProfileStackNavigator from "./FuneralProfileStackNavigator";

import AnnouncementsScreen from '@/screens/shared/AnnouncementsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const funeralHeaderOptions = {
  headerStyle: {
    backgroundColor: "#f8f6f2",
  },
  headerTintColor: "#22312d",
  headerShadowVisible: false,
  headerTitleStyle: {
    color: "#22312d",
    fontWeight: "700" as const,
  },
};

function TabBarIcon({ name, color, size }: any) {
  return (
    <View>
      <Ionicons name={name} size={size} color={color} />
    </View>
  );
}

const tabIcon = (routeName: string, focused: boolean): keyof typeof Ionicons.glyphMap => {
  switch (routeName) {
    case "Home":
      return focused ? "home" : "home-outline";
    case "Shops":
      return focused ? "storefront" : "storefront-outline";
    case "Carts":
      return focused ? "cart" : "cart-outline";
    case "Profile":
      return focused ? "person" : "person-outline";
    default:
      return "ellipse-outline";
  }
};

let lastTabTap: { routeName: string; time: number } = { routeName: "", time: 0 };

function FuneralTabs() {
  const tabs = [
    { name: "Home", component: FuneralHomeScreen, icon: "home-outline", activeIcon: "home", options: { title: "Home" } },
    { name: "Shops", component: FuneralShopsScreen, icon: "storefront-outline", activeIcon: "storefront", options: { title: "Shops" } },
    { name: "Carts", component: FuneralCartScreen, icon: "cart-outline", activeIcon: "cart", options: { title: "Carts" } },
    { name: "Profile", component: FuneralProfileStackNavigator, icon: "person-outline", activeIcon: "person", options: { title: "Profile", headerShown: false } },
  ];

  return (
    <Tab.Navigator
      screenOptions={({ route, navigation }) => {
        const tab = tabs.find((item) => item.name === route.name);

        return {
          tabBarPosition: "bottom",
          tabBarShowLabel: true,
          tabBarStyle: {
            backgroundColor: "#ffffff",
            borderTopWidth: 1,
            borderTopColor: "#d9d6cd",
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "700",
          },
          tabBarIcon: ({ focused, color, size }) => (
            <TabBarIcon
              name={(focused ? tab?.activeIcon : tab?.icon) || tabIcon(route.name, focused)}
              color={color}
              size={size}
            />
          ),
          tabBarHideOnKeyboard: true,
          tabBarActiveTintColor: "#5a6b64",
          tabBarInactiveTintColor: "#8a928d",
          tabBarButton: (props: any) => {
            const { onPress, children, ...rest } = props;
            const focused = Boolean(props.accessibilityState?.selected);
            return (
              <Pressable
                {...rest}
                onPress={() => {
                  const now = Date.now();
                  if (lastTabTap.routeName === route.name && now - lastTabTap.time < 450) {
                    lastTabTap = { routeName: "", time: 0 };
                    if (focused) {
                      emitTabRefresh(route.name);
                      return;
                    }
                  }
                  lastTabTap = { routeName: route.name, time: now };

                  // Reset nested stack to initial route when the tab has stale navigation state
                  const tabState = navigation.getState();
                  const routeIndex = tabState?.routes?.findIndex((r: any) => r.name === route.name);
                  const activeRoute = tabState?.routes?.[routeIndex];
                  const nestedState: any = activeRoute?.state;
                  if (nestedState && nestedState.index > 0) {
                    // Strip stale nested state from this tab's route and reset the whole tab navigator
                    const cleanRoutes = tabState.routes.map((r: any) => {
                      if (r.name === route.name) {
                        // Remove nested state so it starts fresh at the initial screen
                        const { state: _staleState, ...clean } = r;
                        return clean;
                      }
                      return r;
                    });
                    navigation.dispatch(
                      CommonActions.reset({
                        ...tabState,
                        routes: cleanRoutes,
                        index: routeIndex,
                      })
                    );
                    return;
                  }

                  onPress?.();
                }}
              >
                {children}
              </Pressable>
            );
          },
          headerShown: route.name !== "Home",
          ...funeralHeaderOptions,
        };
      }}
    >
      {tabs.map((tab) => (
        <Tab.Screen
          key={tab.name}
          name={tab.name}
          component={tab.component}
          options={({ route }) => {
            if (tab.name !== "Profile") {
              return tab.options;
            }

            const nestedRoute = getFocusedRouteNameFromRoute(route) ?? "ProfileMain";

            return {
              ...tab.options,
              tabBarStyle:
                nestedRoute === "ShopCenter" ||
                nestedRoute === "ProductEditor" ||
                nestedRoute === "ProductDetails" ||
                nestedRoute === "ShopCatalog" ||
                nestedRoute === "ShopPackages" ||
                nestedRoute === "ShopCustomers" ||
                nestedRoute === "ShopReports" ||
                nestedRoute === "ShopSettings" ||
                nestedRoute === "MyServiceRequests" ||
                nestedRoute === "ServiceRequestsInbox" ||
                nestedRoute === "ServiceRequestDetails" ||
                nestedRoute === "EditServiceRequest" ||
                nestedRoute === "ServiceSchedule" ||
                nestedRoute === "ShopPayments" ||
                nestedRoute === "ShopPaymentReceipt" ||
                nestedRoute === "ShopInformation" ||
                nestedRoute === "BusinessInformation" ||
                nestedRoute === "Contact" ||
                nestedRoute === "AboutUs" ||
                nestedRoute === "AppFeedback" ||
                nestedRoute === "ManageProfile" ||
                nestedRoute === 'Login' ||
                nestedRoute === 'ForgotPassword' ||
                nestedRoute === 'Register' ||
                nestedRoute === 'VerifyEmail' ||
                nestedRoute === 'ManageDeviceAccounts' ||
                nestedRoute === 'AccountSecurity' ||
                nestedRoute === 'PrivacyData' ||
                nestedRoute === 'NotificationPreferences' ||
                nestedRoute === 'PrivacyPolicy' ||
                nestedRoute === 'TermsOfUse' ||
                nestedRoute === 'PasswordSecurity' ||
                nestedRoute === 'ActiveSessions' ||
                nestedRoute === 'BlockedAccounts' ||
                nestedRoute === 'AccountChangesActivity' ||
                nestedRoute === 'AccountActivityLog' ||
                nestedRoute === 'UserPayments' ||
                nestedRoute === "AccountSettings"
                  ? { display: "none" }
                  : undefined,
            };
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

export default function FuneralNavigator() {
  return (
    <Stack.Navigator
      screenOptions={({ navigation }) => ({
        headerShown: false,
        headerBackVisible: false,
        headerLeft: () => navigation.canGoBack() ? (
          <AppHeaderBackButton onPress={() => navigation.goBack()} />
        ) : null,
        ...funeralHeaderOptions,
      })}
    >
      <Stack.Screen name="FuneralTabs" component={FuneralTabs} />
      <Stack.Screen name="Search" component={FuneralSearchScreen} options={{ headerShown: true, title: "Search" }} />
      <Stack.Screen name='AllProducts' component={FuneralSearchScreen} options={{ headerShown: true, title: 'All Products' }} />
      <Stack.Screen name="ProductView" component={FuneralProductViewScreen} />
      <Stack.Screen name="ShopProducts" component={FuneralShopProductsScreen} />
      <Stack.Screen name="ShopChat" component={ChatScreen} options={{ headerShown: true, title: "Shop Chat" }} />
      <Stack.Screen name="Conversations" component={ConversationsList} options={{ headerShown: true, title: "Chats" }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={{ headerShown: true, title: "Chat" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: true, title: "Notifications" }} />
      <Stack.Screen name="NotificationServiceRequestDetails" component={FuneralServiceRequestDetailsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EditServiceRequest" component={FuneralEditServiceRequestScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ReportCenter" component={DisputeReportScreen} options={{ headerShown: true, title: "Report Center" }} />
      <Stack.Screen name="FuneralCheckout" component={FuneralCheckoutScreen} options={{ headerShown: true, title: "Service Request" }} />
      <Stack.Screen name="FuneralCustomCasketRequest" component={FuneralCustomCasketRequestScreen} options={{ headerShown: true, title: "Custom Casket Request" }} />
      <Stack.Screen
        name='Announcements'
        component={AnnouncementsScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
