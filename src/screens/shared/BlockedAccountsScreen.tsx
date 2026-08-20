import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from '@/components';
import { auth } from '@/services/supabaseAuth';
import { supabase } from '@/services/supabaseClient';
import { unblockUser } from '@/utils/userModeration';

type BlockedAccount = {
  blockId: string;
  userId: string;
  fullName: string;
  email: string;
  photoURL: string | null;
  createdAt?: string;
};

const defaultProfile = require('../../../assets/Male_Default_Profile.png');

export default function BlockedAccountsScreen() {
  const [accounts, setAccounts] = useState<BlockedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const loadBlockedAccounts = useCallback(async () => {
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId) return;

    setLoading(true);
    setErrorMessage('');
    try {
      const blocksResult = await supabase
        .from('user_blocks')
        .select('id,blockedId,createdAt')
        .eq('blockerId', currentUserId)
        .order('createdAt', { ascending: false });
      if (blocksResult.error) throw blocksResult.error;

      const blocks = blocksResult.data || [];
      const blockedIds = blocks.map((item: any) => String(item.blockedId || '')).filter(Boolean);
      if (blockedIds.length === 0) {
        setAccounts([]);
        return;
      }

      const usersResult = await supabase
        .from('users')
        .select('id,fullName,email,photoURL')
        .in('id', blockedIds);
      if (usersResult.error) throw usersResult.error;

      const usersById = new Map((usersResult.data || []).map((user: any) => [String(user.id), user]));
      setAccounts(blocks.map((block: any) => {
        const user: any = usersById.get(String(block.blockedId));
        return {
          blockId: String(block.id),
          userId: String(block.blockedId),
          fullName: String(user?.fullName || 'Blocked account'),
          email: String(user?.email || ''),
          photoURL: user?.photoURL || null,
          createdAt: block.createdAt,
        };
      }));
    } catch (error: any) {
      setErrorMessage(error?.message || 'Blocked accounts could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadBlockedAccounts();
  }, [loadBlockedAccounts]));

  const confirmUnblock = (account: BlockedAccount) => {
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId) return;

    Alert.alert('Unblock account?', `${account.fullName} will be able to contact you again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        onPress: async () => {
          setUnblockingId(account.userId);
          try {
            await unblockUser(currentUserId, account.userId);
            setAccounts((current) => current.filter((item) => item.userId !== account.userId));
          } catch (error: any) {
            Alert.alert('Could not unblock', error?.message || 'Please try again.');
          } finally {
            setUnblockingId(null);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name='ban-outline' size={28} color='#ffffff' />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Blocked accounts</Text>
            <Text style={styles.heroText}>Manage people you have blocked from contacting you.</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your block list</Text>
          <Text style={styles.count}>{accounts.length} blocked</Text>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color='#41514d' />
            <Text style={styles.stateText}>Loading blocked accounts...</Text>
          </View>
        ) : null}

        {!loading && errorMessage ? (
          <View style={styles.stateCard}>
            <Ionicons name='alert-circle-outline' size={30} color='#9a5b32' />
            <Text style={styles.stateTitle}>Block list unavailable</Text>
            <Text style={styles.stateText}>Please check your connection and try again.</Text>
            <TouchableOpacity onPress={loadBlockedAccounts} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !errorMessage && accounts.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name='people-outline' size={32} color='#7a8580' />
            <Text style={styles.stateTitle}>No blocked accounts</Text>
            <Text style={styles.stateText}>Accounts you block from a conversation will appear here.</Text>
          </View>
        ) : null}

        {!loading && !errorMessage ? accounts.map((account) => (
          <View key={account.blockId} style={styles.accountCard}>
            <Image source={account.photoURL ? { uri: account.photoURL } : defaultProfile} style={styles.avatar} />
            <View style={styles.accountCopy}>
              <Text numberOfLines={1} style={styles.accountName}>{account.fullName}</Text>
              {account.email ? <Text numberOfLines={1} style={styles.accountEmail}>{account.email}</Text> : null}
            </View>
            <TouchableOpacity
              accessibilityRole='button'
              disabled={unblockingId === account.userId}
              onPress={() => confirmUnblock(account)}
              style={styles.unblockButton}
            >
              <Text style={styles.unblockText}>{unblockingId === account.userId ? 'Wait...' : 'Unblock'}</Text>
            </TouchableOpacity>
          </View>
        )) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef1ec' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 18, paddingBottom: 120 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 13, padding: 17, borderRadius: 18,
    backgroundColor: '#22312d', marginBottom: 22,
  },
  heroIcon: {
    width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroCopy: { flex: 1 },
  heroTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  heroText: { color: '#d6dfda', fontSize: 12, lineHeight: 18, marginTop: 3 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10,
  },
  sectionTitle: { color: '#22312d', fontSize: 16, fontWeight: '800' },
  count: { color: '#7a8580', fontSize: 11, fontWeight: '700' },
  stateCard: {
    minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 24, borderRadius: 17,
    borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#ffffff',
  },
  stateTitle: { color: '#22312d', fontSize: 15, fontWeight: '800', marginTop: 9 },
  stateText: { color: '#7a8580', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 6 },
  retryButton: { marginTop: 13, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#ebf1e8' },
  retryText: { color: '#2f6b4f', fontSize: 12, fontWeight: '800' },
  accountCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 16,
    borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#ffffff', marginBottom: 9,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#ebf1e8' },
  accountCopy: { flex: 1, minWidth: 0 },
  accountName: { color: '#22312d', fontSize: 14, fontWeight: '800' },
  accountEmail: { color: '#7a8580', fontSize: 11, marginTop: 3 },
  unblockButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#fff0f0' },
  unblockText: { color: '#a52b2b', fontSize: 11, fontWeight: '800' },
});
