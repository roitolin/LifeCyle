import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { DeviceAccountAvatar } from '@/components/AccountSwitcher';
import { useAuth } from '@/context/AuthContext';
import {
  forgetRememberedAccount,
  getRememberedAccounts,
  type RememberedAccount,
} from '@/services/deviceAccounts';

export default function ManageDeviceAccountsScreen({ navigation }: any) {
  const { user, logout, switchAccount } = useAuth();
  const [accounts, setAccounts] = useState<RememberedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await getRememberedAccounts());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadAccounts();
    }, [loadAccounts])
  );

  const handleSwitch = async (account: RememberedAccount) => {
    if (busyAccountId || account.id === user?.id) return;
    setBusyAccountId(account.id);
    try {
      await switchAccount(account.id);
    } catch (error) {
      setBusyAccountId(null);
      await loadAccounts();
      Alert.alert(
        'Sign-in required',
        error instanceof Error
          ? error.message
          : 'This account must be added again before it can be used.'
      );
    }
  };

  const confirmRemove = (account: RememberedAccount) => {
    const isCurrent = account.id === user?.id;
    Alert.alert(
      'Remove account from this device?',
      isCurrent
        ? 'The current account will be signed out. Other devices will remain signed in.'
        : 'You will need the account password to add it to this device again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusyAccountId(account.id);
            try {
              if (isCurrent) {
                await logout();
                return;
              }
              await forgetRememberedAccount(account.id);
              setAccounts((current) => current.filter((item) => item.id !== account.id));
              setBusyAccountId(null);
            } catch {
              setBusyAccountId(null);
              Alert.alert('Remove failed', 'This account could not be removed. Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.title}>Manage accounts</Text>
        <Text style={styles.subtitle}>
          Switch between saved accounts or remove accounts you no longer use on this device.
        </Text>
      </View>

      <View style={styles.accountCard}>
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color='#41514d' />
            <Text style={styles.loadingText}>Loading saved accounts...</Text>
          </View>
        ) : null}

        {!loading && accounts.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name='people-outline' size={30} color='#62706b' />
            <Text style={styles.emptyTitle}>No saved accounts</Text>
          </View>
        ) : null}

        {!loading
          ? accounts.map((account, index) => {
              const isCurrent = account.id === user?.id;
              const isBusy = busyAccountId === account.id;
              return (
                <View
                  key={account.id}
                  style={[
                    styles.accountRow,
                    index === accounts.length - 1 && styles.lastAccountRow,
                  ]}
                >
                  <DeviceAccountAvatar account={account} size={44} />
                  <View style={styles.accountCopy}>
                    <Text numberOfLines={1} style={styles.accountName}>
                      {account.fullName}
                    </Text>
                    <Text numberOfLines={1} style={styles.accountEmail}>
                      {account.email}
                    </Text>
                    {isCurrent ? <Text style={styles.currentText}>Current account</Text> : null}
                  </View>
                  {isBusy ? (
                    <ActivityIndicator size='small' color='#41514d' />
                  ) : (
                    <View style={styles.rowActions}>
                      {!isCurrent ? (
                        <TouchableOpacity
                          accessibilityRole='button'
                          accessibilityLabel={'Switch to ' + account.email}
                          disabled={Boolean(busyAccountId)}
                          onPress={() => void handleSwitch(account)}
                          style={styles.switchButton}
                        >
                          <Text style={styles.switchButtonText}>Switch</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        accessibilityRole='button'
                        accessibilityLabel={'Remove ' + account.email}
                        disabled={Boolean(busyAccountId)}
                        onPress={() => confirmRemove(account)}
                        style={styles.removeButton}
                      >
                        <Ionicons name='trash-outline' size={18} color='#b4232c' />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          : null}
      </View>

      <TouchableOpacity
        accessibilityRole='button'
        disabled={Boolean(busyAccountId)}
        onPress={() => navigation.navigate('Login', { addAccount: true })}
        style={styles.addButton}
      >
        <View style={styles.addIcon}>
          <Ionicons name='add' size={22} color='#22312d' />
        </View>
        <Text style={styles.addButtonText}>Add another account</Text>
      </TouchableOpacity>

      <View style={styles.securityNote}>
        <Ionicons name='lock-closed-outline' size={18} color='#41514d' />
        <Text style={styles.securityText}>
          Saved sign-in sessions are encrypted by this device. Passwords are never stored.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#eef1ec',
  },
  content: {
    padding: 18,
    paddingBottom: 80,
    gap: 14,
  },
  hero: {
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
  },
  title: {
    color: '#22312d',
    fontSize: 26,
    fontWeight: '900',
    marginBottom: 7,
  },
  subtitle: {
    color: '#62706b',
    fontSize: 13,
    lineHeight: 20,
  },
  accountCard: {
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
  },
  loadingState: {
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#62706b',
    fontSize: 12,
  },
  emptyState: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: '#41514d',
    fontWeight: '800',
  },
  accountRow: {
    minHeight: 74,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#e7e5df',
  },
  lastAccountRow: {
    borderBottomWidth: 0,
  },
  accountCopy: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    color: '#22312d',
    fontSize: 14,
    fontWeight: '800',
  },
  accountEmail: {
    color: '#7a8580',
    fontSize: 10,
    marginTop: 2,
  },
  currentText: {
    color: '#3f6f58',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  switchButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#ebf1e8',
  },
  switchButtonText: {
    color: '#41514d',
    fontSize: 10,
    fontWeight: '800',
  },
  removeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff0f0',
  },
  addButton: {
    minHeight: 58,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
  },
  addIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ebf1e8',
  },
  addButtonText: {
    color: '#22312d',
    fontSize: 14,
    fontWeight: '800',
  },
  securityNote: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderRadius: 16,
    backgroundColor: '#e3ebe0',
  },
  securityText: {
    flex: 1,
    color: '#41514d',
    fontSize: 11,
    lineHeight: 17,
  },
});
