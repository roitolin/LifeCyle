import { createDrawerNavigator } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { AdminSidebarContent } from '@/components';
import {
  AdminAuditLogsScreen,
  AdminAnnouncementsScreen,
  AdminDeletionRequestsScreen,
  AdminDashboard,
  AdminFuneralShopVerificationsScreen,
  AdminHomeContentScreen,
  AdminLoginSecurityScreen,
  AdminModerationScreen,
  AdminOrdersScreen,
  AdminPaymentsScreen,
  AdminPayoutAccountsScreen,
  AdminProductsScreen,
  AdminSupportMessages,
  AdminUsersScreen,
} from '@/pages/admin';
import { AppFeedbackScreen } from '@/pages/shared';
import { useAdminNotificationCount } from '@/hooks';
import { logAdminAction } from '@/utils/adminAuditLog';
import { colors } from '@/theme';

const Drawer = createDrawerNavigator();

const routeLabels: Record<string, string> = {
  Dashboard: 'Dashboard',
  Analytics: 'Analytics',
  Products: 'Products',
  Orders: 'Service Requests',
  Funeral: 'Funeral Shops',
  Users: 'Users',
  Payments: 'Shop Payments',
  Moderation: 'Moderation',
  Feedback: 'Rate & Feedback',
  Support: 'Support Inbox',
  ActivityLogs: 'Activity Logs',
  LoginSecurity: 'Login & Security',
  Deletions: 'Account Deletion Requests',
  HomeContent: 'Mobile Home Feature',
  PayoutAccounts: 'Payout Accounts',
  Announcements: 'Announcements',
};

function HeaderMenuButton({ navigation }: { navigation: any }) {
  return (
    <TouchableOpacity
      accessibilityLabel="Open admin navigation"
      accessibilityRole="button"
      onPress={() => navigation.openDrawer()}
      style={styles.menuButton}
    >
      <Ionicons name="menu-outline" size={27} color={colors.surface} />
    </TouchableOpacity>
  );
}

function NotificationBell() {
  const navigation = useNavigation<any>();
  const unreadCount = useAdminNotificationCount();

  const openNotifications = () => {
    navigation.getParent()?.navigate('Notifications');
  };

  return (
    <TouchableOpacity
      accessibilityLabel="Open notifications"
      onPress={openNotifications}
      style={styles.notificationButton}
    >
      <View>
        <Ionicons name="notifications-outline" size={24} color={colors.surface} />
        {unreadCount > 0 ? <CountBadge count={unreadCount} /> : null}
      </View>
    </TouchableOpacity>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <View style={styles.badgeWrap}>
      <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
    </View>
  );
}

export default function AdminTabsNavigator() {
  const { role, user } = useAuth();
  const isRootAdmin = role === 'super_admin' || role === 'admin';
  const isFuneralAdmin = isRootAdmin || role === 'funeral_admin';

  return (
    <Drawer.Navigator
      initialRouteName="Dashboard"
      drawerContent={(props) => <AdminSidebarContent {...props} />}
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
      screenOptions={({ navigation }) => ({
        drawerType: 'front',
        drawerStyle: styles.drawer,
        headerLeft: () => <HeaderMenuButton navigation={navigation} />,
        headerRight: () => <NotificationBell />,
        headerStyle: styles.header,
        headerTintColor: colors.surface,
        headerTitleStyle: styles.headerTitle,
        drawerActiveTintColor: colors.primary,
        drawerInactiveTintColor: colors.textMuted,
        drawerActiveBackgroundColor: colors.surfaceMuted,
        drawerLabelStyle: styles.drawerLabel,
        drawerItemStyle: styles.drawerItem,
      })}
    >
      <Drawer.Screen name="Dashboard" component={AdminDashboard} options={{ title: 'Dashboard' }} />
      {isRootAdmin ? <Drawer.Screen name="Analytics" component={AdminDashboard} options={{ title: 'Analytics' }} /> : null}
      {isFuneralAdmin ? <Drawer.Screen name="Products" component={AdminProductsScreen} options={{ title: 'Products' }} /> : null}
      {isFuneralAdmin ? <Drawer.Screen name="Orders" component={AdminOrdersScreen} options={{ title: 'Service Requests' }} /> : null}
      {isFuneralAdmin ? <Drawer.Screen name="Funeral" component={AdminFuneralShopVerificationsScreen} options={{ title: 'Funeral Shops' }} /> : null}
      <Drawer.Screen name="Users" component={AdminUsersScreen} options={{ title: 'Users' }} />
      <Drawer.Screen name="Payments" component={AdminPaymentsScreen} options={{ title: 'Shop Payments' }} />
      <Drawer.Screen name="Moderation" component={AdminModerationScreen} options={{ title: 'Moderation' }} />
      <Drawer.Screen name="Feedback" component={AppFeedbackScreen} options={{ title: 'Rate & Feedback' }} />
      <Drawer.Screen name="Support" component={AdminSupportMessages} options={{ title: 'Support Inbox' }} />
      <Drawer.Screen name="ActivityLogs" component={AdminAuditLogsScreen} options={{ title: 'Activity Logs' }} />
      <Drawer.Screen name="LoginSecurity" component={AdminLoginSecurityScreen} options={{ title: 'Login & Security' }} />
      {isRootAdmin ? <Drawer.Screen name="Deletions" component={AdminDeletionRequestsScreen} options={{ title: 'Account Deletions' }} /> : null}
      {isRootAdmin ? <Drawer.Screen name="HomeContent" component={AdminHomeContentScreen} options={{ title: 'Mobile Home Feature' }} /> : null}
      {isFuneralAdmin ? <Drawer.Screen name="PayoutAccounts" component={AdminPayoutAccountsScreen} options={{ title: 'Payout Accounts' }} /> : null}
      {isRootAdmin ? <Drawer.Screen name="Announcements" component={AdminAnnouncementsScreen} options={{ title: 'Announcements' }} /> : null}
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  drawer: {
    width: 304,
    backgroundColor: colors.surface,
  },
  header: {
    backgroundColor: colors.primaryDark,
  },
  headerTitle: {
    color: colors.surface,
    fontSize: 18,
    fontWeight: '800',
  },
  menuButton: {
    marginLeft: 12,
    padding: 7,
  },
  notificationButton: {
    marginRight: 15,
    padding: 5,
  },
  badgeWrap: {
    position: 'absolute',
    right: -6,
    top: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    backgroundColor: colors.accent,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: '800',
  },
  drawerLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  drawerItem: {
    borderRadius: 11,
  },
});
