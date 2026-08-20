import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { DrawerContentScrollView, DrawerItem } from '@react-navigation/drawer';
import { Avatar, Title, Caption, Drawer, useTheme, ActivityIndicator } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../services/supabaseAuth';
import { doc, getDoc } from '@/services/supabaseDbCompat';
import { useSidebar } from '../context/SidebarContext';

export function SidebarContent(props: any) {
  const theme = useTheme();
  const user = auth.currentUser;
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(true);
  const { collapsed } = useSidebar(); // we still need collapsed for width, but no button here

  useEffect(() => {
    const fetchUserData = async () => {
      if (!user) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          setFullName(userDoc.data().fullName || 'User');
        } else {
          setFullName('User');
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
        setFullName('User');
      } finally {
        setLoading(false);
      }
    };
    fetchUserData();
  }, [user]);

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.container}>
      {!collapsed ? (
        <View style={styles.userInfoSection}>
          <Avatar.Icon size={60} icon="account" style={{ backgroundColor: theme.colors.primary }} />
          {loading ? (
            <ActivityIndicator size="small" />
          ) : (
            <Title style={styles.title}>{fullName}</Title>
          )}
          <Caption style={styles.caption}>{user?.email}</Caption>
        </View>
      ) : (
        // Show nothing (or a minimal icon) when collapsed – we keep the drawer empty except items
        <View style={styles.collapsedPlaceholder} />
      )}

      <Drawer.Section style={styles.drawerSection}>
        <DrawerItem
          icon={({ color, size }: { color: string; size: number }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          )}
          label={collapsed ? '' : 'Feed'}
          onPress={() => props.navigation.navigate('Feed')}
          focused={props.state.index === 0}
          activeTintColor={theme.colors.primary}
        />
        <DrawerItem
          icon={({ color, size }: { color: string; size: number }) => (
            <Ionicons name="search-outline" size={size} color={color} />
          )}
          label={collapsed ? '' : 'Funeral Shops'}
          onPress={() => props.navigation.navigate('Shops')}
          focused={props.state.index === 1}
          activeTintColor={theme.colors.primary}
        />
        <DrawerItem
          icon={({ color, size }: { color: string; size: number }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          )}
          label={collapsed ? '' : 'My Requests'}
          onPress={() => props.navigation.navigate('Requests')}
          focused={props.state.index === 2}
          activeTintColor={theme.colors.primary}
        />
        <DrawerItem
          icon={({ color, size }: { color: string; size: number }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          )}
          label={collapsed ? '' : 'Notifications'}
          onPress={() => props.navigation.navigate('Notifications')}
          focused={props.state.index === 3}
          activeTintColor={theme.colors.primary}
        />
        <DrawerItem
          icon={({ color, size }: { color: string; size: number }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          )}
          label={collapsed ? '' : 'Profile'}
          onPress={() => props.navigation.navigate('Profile')}
          focused={props.state.index === 4}
          activeTintColor={theme.colors.primary}
        />
      </Drawer.Section>
    </DrawerContentScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  userInfoSection: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  title: { fontSize: 16, marginTop: 10, fontWeight: 'bold' },
  caption: { fontSize: 14, lineHeight: 14, color: '#6e6e6e' },
  drawerSection: { marginTop: 15 },
  collapsedPlaceholder: {
    height: 20, // tiny spacer when collapsed
  },
});

