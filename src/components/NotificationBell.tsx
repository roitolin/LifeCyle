import React from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useUnreadCount } from '@/hooks';
import { ProfileStackParamList } from '@/types';

type ProfileNavigationProp = NativeStackNavigationProp<ProfileStackParamList>;

export default function NotificationBell() {
  const unreadCount = useUnreadCount();
  const navigation = useNavigation<ProfileNavigationProp>();

  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Notifications')}
      style={{ marginRight: 15 }}
    >
      <View>
        <Ionicons name="notifications-outline" size={24} color="black" />
        {unreadCount > 0 && (
          <View
            style={{
              position: 'absolute',
              right: -6,
              top: -3,
              backgroundColor: 'red',
              borderRadius: 10,
              width: 16,
              height: 16,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}
