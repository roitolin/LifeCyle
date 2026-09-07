import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { AppHeaderBackButton } from '@/components';
import {
  AdminAuditLogsScreen,
  AdminDeletionRequestsScreen,
  AdminDashboard,
  AdminFuneralShopVerificationsScreen,
  AdminHomeContentScreen,
  AdminLoginSecurityScreen,
  AdminModerationScreen,
  AdminMoreScreen,
  AdminOrdersScreen,
  AdminPaymentsScreen,
  AdminProductsScreen,
  AdminSupportMessages,
  AdminUsersScreen,
} from '@/pages/admin';
import { AppFeedbackScreen } from '@/pages/shared';
import { useAdminNotificationCount, useUnreadSupportCount } from '@/hooks';
import { logAdminAction } from '@/utils/adminAuditLog';

const Tab = createBottomTabNavigator();

const routeLabels: Record<string, string> = {
  Dashboard: 'Dashboard', Products: 'Products', Orders: 'Service Requests', Funeral: 'Funeral Shops',
  Users: 'Users', More: 'More Tools', Payments: 'Shop Payments', Moderation: 'Moderation',
  Feedback: 'Rate & Feedback', Support: 'Support Inbox', ActivityLogs: 'Activity Logs',
  LoginSecurity: 'Login & Security',
  Deletions: 'Account Deletion Requests',
  HomeContent: 'Mobile Home Feature',
};

function NotificationBell() {
  const navigation = useNavigation<any>();
  const unreadCount = useAdminNotificationCount();
  return (
    <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={styles.notificationButton} accessibilityLabel='Open notifications'>
      <View>
        <Ionicons name='notifications-outline' size={24} color='white' />
        {unreadCount > 0 ? <CountBadge count={unreadCount} /> : null}
      </View>
    </TouchableOpacity>
  );
}

function CountBadge({ count }: { count: number }) {
  return <View style={styles.badgeWrap}><Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text></View>;
}

function TabIcon({ name, color, size, badgeCount }: any) {
  return <View><Ionicons name={name} size={size} color={color} />{badgeCount > 0 ? <CountBadge count={badgeCount} /> : null}</View>;
}

export default function AdminTabsNavigator() {
  const { role, user } = useAuth();
  const unreadSupportCount = useUnreadSupportCount();
  const isRootAdmin = role === 'super_admin' || role === 'admin';
  const isFuneralAdmin = isRootAdmin || role === 'funeral_admin';
  const initialRouteName = role === 'funeral_admin' ? 'Funeral' : 'Dashboard';
  const hiddenTabOptions = { tabBarButton: () => null, tabBarItemStyle: { display: 'none' as const } };
  const hiddenWithBack = (navigation: any, title: string) => ({
    title,
    ...hiddenTabOptions,
    headerLeft: () => <AppHeaderBackButton onPress={() => navigation.navigate('More')} />,
  });

  return (
    <Tab.Navigator
      initialRouteName={initialRouteName}
      screenListeners={({ route }) => ({
        focus: () => {
          void logAdminAction({
            adminId: user?.id,
            action: 'screen_viewed',
            targetType: 'screen',
            targetId: route.name,
            summary: `Opened ${routeLabels[route.name] || route.name}.`,
            metadata: { role },
          });
        },
      })}
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName = 'help-outline';
          let badgeCount = 0;
          if (route.name === 'Dashboard') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Products') iconName = focused ? 'cube' : 'cube-outline';
          else if (route.name === 'Orders') iconName = focused ? 'receipt' : 'receipt-outline';
          else if (route.name === 'Payments') iconName = focused ? 'wallet' : 'wallet-outline';
          else if (route.name === 'Funeral') iconName = focused ? 'business' : 'business-outline';
          else if (route.name === 'Users') iconName = focused ? 'people' : 'people-outline';
          else if (route.name === 'More') {
            iconName = focused ? 'ellipsis-horizontal-circle' : 'ellipsis-horizontal-circle-outline';
            badgeCount = unreadSupportCount;
          } else if (route.name === 'Feedback') iconName = focused ? 'star' : 'star-outline';
          else if (route.name === 'Support') {
            iconName = focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline';
            badgeCount = unreadSupportCount;
          } else if (route.name === 'Moderation') iconName = focused ? 'shield-checkmark' : 'shield-checkmark-outline';
          else if (route.name === 'ActivityLogs') iconName = focused ? 'pulse' : 'pulse-outline';
          else if (route.name === 'LoginSecurity') iconName = focused ? 'lock-closed' : 'lock-closed-outline';
          return <TabIcon name={iconName} color={color} size={size} badgeCount={badgeCount} />;
        },
        tabBarActiveTintColor: '#d32f2f',
        tabBarInactiveTintColor: '#77827d',
        headerRight: () => <NotificationBell />,
        headerStyle: { backgroundColor: '#d32f2f' },
        headerTintColor: 'white',
      })}
    >
      <Tab.Screen name='Dashboard' component={AdminDashboard} options={{ title: 'Dashboard' }} />
      {isFuneralAdmin ? <Tab.Screen name='Products' component={AdminProductsScreen} options={{ title: 'Products' }} /> : null}
      {isFuneralAdmin ? <Tab.Screen name='Orders' component={AdminOrdersScreen} options={{ title: 'Service Requests', tabBarLabel: 'Requests' }} /> : null}
      {isFuneralAdmin ? <Tab.Screen name='Funeral' component={AdminFuneralShopVerificationsScreen} options={{ title: 'Shops' }} /> : null}
      <Tab.Screen name='Users' component={AdminUsersScreen} options={{ title: 'Users' }} />
      <Tab.Screen name='More' component={AdminMoreScreen} options={{ title: 'More' }} />
      <Tab.Screen name='Payments' component={AdminPaymentsScreen} options={({ navigation }) => hiddenWithBack(navigation, 'Shop Payments')} />
      <Tab.Screen name='Moderation' component={AdminModerationScreen} options={({ navigation }) => hiddenWithBack(navigation, 'Moderation')} />
      <Tab.Screen name='Feedback' component={AppFeedbackScreen} options={({ navigation }) => hiddenWithBack(navigation, 'Rate & Feedback')} />
      <Tab.Screen name='Support' component={AdminSupportMessages} options={({ navigation }) => hiddenWithBack(navigation, 'Support Inbox')} />
      <Tab.Screen name='ActivityLogs' component={AdminAuditLogsScreen} options={({ navigation }) => hiddenWithBack(navigation, 'Activity Logs')} />
      <Tab.Screen name='LoginSecurity' component={AdminLoginSecurityScreen} options={({ navigation }) => hiddenWithBack(navigation, 'Login & Security')} />
      {isRootAdmin ? <Tab.Screen name='Deletions' component={AdminDeletionRequestsScreen} options={({ navigation }) => hiddenWithBack(navigation, 'Account Deletion Requests')} /> : null}
      {isRootAdmin ? <Tab.Screen name='HomeContent' component={AdminHomeContentScreen} options={({ navigation }) => hiddenWithBack(navigation, 'Mobile Home Feature')} /> : null}
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  notificationButton: { marginRight: 15 },
  badgeWrap: {
    position: 'absolute', right: -6, top: -3, backgroundColor: '#ef4444', borderRadius: 10,
    width: 16, height: 16, justifyContent: 'center', alignItems: 'center',
  },
  badgeText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
});
