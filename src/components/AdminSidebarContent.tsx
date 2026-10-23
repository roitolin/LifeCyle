import { Ionicons } from '@expo/vector-icons';
import {
  DrawerContentComponentProps,
  DrawerContentScrollView,
  DrawerItem,
} from '@react-navigation/drawer';
import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useAdminNotificationCount, useUnreadSupportCount } from '@/hooks';
import { useAppDialog } from '@/hooks/useAppDialog';
import { colors } from '@/theme';
import { confirmLogout } from '@/utils/logoutConfirmation';

type SidebarItemConfig = {
  label: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: number;
};

function formatRole(role: string | null) {
  if (role === 'super_admin') return 'Super admin';
  if (role === 'funeral_admin') return 'Funeral admin';
  return 'Administrator';
}

function SidebarLabel({ label, color, badge }: { label: string; color: string; badge?: number }) {
  return (
    <View style={styles.labelRow}>
      <Text style={[styles.itemLabel, { color }]}>{label}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SidebarSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SidebarNavItem({
  item,
  currentRoute,
  onPress,
}: {
  item: SidebarItemConfig;
  currentRoute: string;
  onPress: () => void;
}) {
  return (
    <DrawerItem
      accessibilityLabel={`Open ${item.label}`}
      focused={currentRoute === item.route}
      icon={({ color, size }) => <Ionicons name={item.icon} size={size} color={color} />}
      label={({ color }) => <SidebarLabel label={item.label} color={color} badge={item.badge} />}
      onPress={onPress}
      activeTintColor={colors.primary}
      inactiveTintColor={colors.textMuted}
      activeBackgroundColor={colors.surfaceMuted}
      style={styles.item}
    />
  );
}

export default function AdminSidebarContent(props: DrawerContentComponentProps) {
  const { logout, role, user } = useAuth();
  const { dialog, showDialog } = useAppDialog();
  const unreadNotifications = useAdminNotificationCount();
  const unreadSupport = useUnreadSupportCount();
  const isRootAdmin = role === 'super_admin' || role === 'admin';
  const isFuneralAdmin = isRootAdmin || role === 'funeral_admin';
  const currentRoute = props.state.routeNames[props.state.index];

  const navigateTo = (route: string) => {
    props.navigation.closeDrawer();
    props.navigation.navigate(route as never);
  };

  const handleLogout = () => {
    confirmLogout({ logout, showDialog });
  };

  const openNotifications = () => {
    props.navigation.closeDrawer();
    props.navigation.getParent()?.navigate('Notifications');
  };

  const workspaceItems: SidebarItemConfig[] = [
    { label: 'Dashboard', route: 'Dashboard', icon: 'grid-outline' },
    ...(isRootAdmin
      ? [{ label: 'Analytics', route: 'Analytics', icon: 'bar-chart-outline' as const }]
      : []),
    ...(isFuneralAdmin
      ? [
          { label: 'Funeral Shops', route: 'Funeral', icon: 'business-outline' as const },
          { label: 'Products', route: 'Products', icon: 'cube-outline' as const },
          { label: 'Service Requests', route: 'Orders', icon: 'receipt-outline' as const },
          { label: 'Payments', route: 'Payments', icon: 'wallet-outline' as const },
          { label: 'Payout Accounts', route: 'PayoutAccounts', icon: 'card-outline' as const },
        ]
      : []),
  ];

  const rootToolItems: SidebarItemConfig[] = [
    ...(isRootAdmin
      ? [
          { label: 'Mobile Home', route: 'HomeContent', icon: 'phone-portrait-outline' as const },
          { label: 'Announcements', route: 'Announcements', icon: 'megaphone-outline' as const },
          { label: 'Account Deletions', route: 'Deletions', icon: 'person-remove-outline' as const },
        ]
      : []),
  ];

  const administrationItems: SidebarItemConfig[] = [
    { label: 'Users', route: 'Users', icon: 'people-outline' },
    { label: 'Moderation', route: 'Moderation', icon: 'shield-checkmark-outline' },
    { label: 'Feedback', route: 'Feedback', icon: 'star-outline' },
    { label: 'Support', route: 'Support', icon: 'chatbubble-ellipses-outline', badge: unreadSupport },
    { label: 'Activity Logs', route: 'ActivityLogs', icon: 'pulse-outline' },
    { label: 'Login & Security', route: 'LoginSecurity', icon: 'lock-closed-outline' },
  ];

  return (
    <View style={styles.drawer}>
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerHeaderTitle}>Menu</Text>
        <TouchableOpacity
          accessibilityLabel="Close admin navigation"
          accessibilityRole="button"
          onPress={() => props.navigation.closeDrawer()}
          style={styles.drawerCloseButton}
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <DrawerContentScrollView
        {...props}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileBlock}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user?.displayName || user?.email || 'A').slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileCopy}>
            <Text numberOfLines={1} style={styles.profileName}>{user?.displayName || 'Admin account'}</Text>
            <Text numberOfLines={1} style={styles.profileEmail}>{user?.email || 'No email available'}</Text>
            <Text numberOfLines={1} style={styles.profileRole}>{formatRole(role)}</Text>
          </View>
          <TouchableOpacity
            accessibilityLabel="Log out"
            accessibilityRole="button"
            onPress={handleLogout}
            style={styles.logoutButton}
          >
            <Ionicons name="log-out-outline" size={16} color={colors.danger} />
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>
        </View>

        {dialog}

        <SidebarSection title="Workspace">
          {workspaceItems.map((item) => (
            <SidebarNavItem key={item.route} item={item} currentRoute={currentRoute} onPress={() => navigateTo(item.route)} />
          ))}
        </SidebarSection>

        {rootToolItems.length > 0 ? (
          <SidebarSection title="Root Tools">
            {rootToolItems.map((item) => (
              <SidebarNavItem key={item.route} item={item} currentRoute={currentRoute} onPress={() => navigateTo(item.route)} />
            ))}
          </SidebarSection>
        ) : null}

        <SidebarSection title="Administration">
          {administrationItems.map((item) => (
            <SidebarNavItem key={item.route} item={item} currentRoute={currentRoute} onPress={() => navigateTo(item.route)} />
          ))}
        </SidebarSection>

        <SidebarSection title="Updates">
          <SidebarNavItem
            item={{ label: 'Notifications', route: 'Notifications', icon: 'notifications-outline', badge: unreadNotifications }}
            currentRoute={currentRoute}
            onPress={openNotifications}
          />
        </SidebarSection>
      </DrawerContentScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  drawerHeaderTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  drawerCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  profileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    padding: 13,
    borderRadius: 14,
    backgroundColor: colors.surfaceWarm,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  avatarText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '800',
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
  },
  profileName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  profileEmail: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  profileRole: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  logoutButton: {
    minWidth: 68,
    minHeight: 32,
    marginLeft: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e8c8c5',
    backgroundColor: '#fff8f7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  logoutText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '800',
  },
  section: {
    marginTop: 22,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginLeft: 28,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  item: {
    marginHorizontal: 12,
    marginVertical: 1,
    borderRadius: 11,
  },
  labelRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 8,
  },
  itemLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  badgeText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: '800',
  },
});
