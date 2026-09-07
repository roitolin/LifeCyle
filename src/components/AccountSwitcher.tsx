import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '@/theme';

import { useAuth } from '@/context/AuthContext';
import {
  getRememberedAccounts,
  type RememberedAccount,
} from '@/services/deviceAccounts';

type CurrentAccount = {
  id: string;
  email: string;
  fullName: string;
  photoURL: string | null;
};

type AccountSwitcherProps = {
  currentAccount: CurrentAccount;
  onAddAccount: () => void;
  onManageAccounts: () => void;
};

const avatarColors = ['#9b3a3a', '#315f78', '#8a5a44', '#3f6f58', '#765a2f'];

function avatarColor(accountId: string) {
  const total = accountId.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return avatarColors[total % avatarColors.length];
}

export function DeviceAccountAvatar({
  account,
  size = 38,
}: {
  account: Pick<RememberedAccount, 'id' | 'fullName' | 'email' | 'photoURL'>;
  size?: number;
}) {
  const label = account.fullName.trim() || account.email.trim();
  const initial = label.charAt(0).toUpperCase() || '?';
  const avatarStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (account.photoURL) {
    return <Image source={{ uri: account.photoURL }} style={[styles.avatar, avatarStyle]} />;
  }

  return (
    <View
      style={[
        styles.avatar,
        styles.avatarFallback,
        avatarStyle,
        { backgroundColor: avatarColor(account.id) },
      ]}
    >
      <Text style={[styles.avatarInitial, { fontSize: Math.max(11, size * 0.4) }]}>
        {initial}
      </Text>
    </View>
  );
}

export default function AccountSwitcher({
  currentAccount,
  onAddAccount,
  onManageAccounts,
}: AccountSwitcherProps) {
  const { switchAccount } = useAuth();
  const [accounts, setAccounts] = useState<RememberedAccount[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null);

  const refreshAccounts = useCallback(async () => {
    setAccounts(await getRememberedAccounts());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshAccounts();
    }, [refreshAccounts])
  );

  const visibleAccounts = useMemo(() => {
    const fallback: RememberedAccount = {
      ...currentAccount,
      fullName: currentAccount.fullName.trim() || currentAccount.email.split('@')[0],
      lastUsedAt: new Date().toISOString(),
    };
    const storedCurrent = accounts.find((account) => account.id === currentAccount.id);
    const current = storedCurrent ? { ...storedCurrent, ...fallback } : fallback;
    return [current, ...accounts.filter((account) => account.id !== currentAccount.id)];
  }, [accounts, currentAccount]);

  const handleSwitch = async (account: RememberedAccount) => {
    if (switchingAccountId || account.id === currentAccount.id) return;
    setSwitchingAccountId(account.id);
    try {
      await switchAccount(account.id);
    } catch (error) {
      setSwitchingAccountId(null);
      await refreshAccounts();
      Alert.alert(
        'Sign-in required',
        error instanceof Error
          ? error.message
          : 'This account must be added again before it can be used.'
      );
    }
  };

  return (
    <View>
      <TouchableOpacity
        accessibilityRole='button'
        accessibilityLabel={expanded ? 'Collapse account switcher' : 'Expand account switcher'}
        disabled={Boolean(switchingAccountId)}
        onPress={() => setExpanded((current) => !current)}
        style={styles.header}
      >
        <Text style={styles.headerLabel}>Switch account</Text>
        <View style={styles.headerAccounts}>
          <View style={styles.avatarStack}>
            {visibleAccounts.slice(0, 3).map((account, index) => (
              <View key={account.id} style={index > 0 ? styles.stackedAvatar : undefined}>
                <DeviceAccountAvatar account={account} size={29} />
              </View>
            ))}
          </View>
          <View style={styles.chevronCircle}>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={17}
              color={colors.primary}
            />
          </View>
        </View>
      </TouchableOpacity>

      {expanded ? (
        <View>
          {visibleAccounts.map((account) => {
            const isCurrent = account.id === currentAccount.id;
            const isSwitching = switchingAccountId === account.id;
            return (
              <TouchableOpacity
                key={account.id}
                accessibilityRole='button'
                accessibilityState={{ disabled: isCurrent || Boolean(switchingAccountId) }}
                disabled={isCurrent || Boolean(switchingAccountId)}
                onPress={() => void handleSwitch(account)}
                style={styles.accountRow}
              >
                <DeviceAccountAvatar account={account} />
                <View style={styles.accountCopy}>
                  <Text numberOfLines={1} style={styles.accountName}>
                    {account.fullName}
                  </Text>
                  <Text numberOfLines={1} style={styles.accountEmail}>
                    {account.email}
                  </Text>
                </View>
                {isSwitching ? (
                  <ActivityIndicator size='small' color={colors.primary} />
                ) : isCurrent ? (
                  <View style={styles.currentBadge}>
                    <Text style={styles.currentBadgeText}>Current</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}

          <SwitcherAction
            icon='add'
            label='Add another account'
            disabled={Boolean(switchingAccountId)}
            onPress={onAddAccount}
          />
          <SwitcherAction
            icon='people-outline'
            label='Manage accounts on this device'
            disabled={Boolean(switchingAccountId)}
            onPress={onManageAccounts}
          />
        </View>
      ) : null}
    </View>
  );
}

function SwitcherAction({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole='button'
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.actionRow}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  headerAccounts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 7,
  },
  stackedAvatar: {
    marginLeft: -7,
  },
  chevronCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  accountRow: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  avatar: {
    borderWidth: 1,
    borderColor: colors.borderWarm,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: colors.surface,
    fontWeight: '800',
  },
  accountCopy: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  accountEmail: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  currentBadgeText: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  actionRow: {
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  actionLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
});
